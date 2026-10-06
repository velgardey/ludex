package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	queryLimit      = 200
	defaultResults  = 20
	maxResults      = 50
	maxResponseSize = 2 << 20
)

var (
	ErrInvalidQuery         = errors.New("invalid catalog query")
	ErrProviderUnconfigured = errors.New("catalog provider is not configured")
	ErrTitleNotFound        = errors.New("catalog title not found")
)

// Episode mirrors the optional episode shape in the public CatalogHit contract.
type Episode struct {
	ID         string `json:"id"`
	Order      int    `json:"order"`
	ReleasedAt string `json:"releasedAt,omitempty"`
	Title      string `json:"title,omitempty"`
	Season     int    `json:"season,omitempty"`
	Number     int    `json:"number,omitempty"`
}

// Hit is the server-side catalog form serialized as the domain CatalogHit JSON.
type Hit struct {
	ID                 string            `json:"id"`
	Media              string            `json:"media"`
	Title              string            `json:"title"`
	Year               int               `json:"year,omitempty"`
	ProviderIDs        map[string]string `json:"providerIds"`
	Artwork            string            `json:"artwork,omitempty"`
	Backdrop           string            `json:"backdrop,omitempty"`
	Synopsis           string            `json:"synopsis,omitempty"`
	Genres             []string          `json:"genres,omitempty"`
	Platform           string            `json:"platform,omitempty"`
	Ended              *bool             `json:"ended,omitempty"`
	Episodes           []Episode         `json:"episodes,omitempty"`
	Sample             bool              `json:"sample,omitempty"`
	ArtworkAttribution string            `json:"artworkAttribution,omitempty"`
}

type Config struct {
	TMDBKey        string
	TMDBToken      string
	TwitchClientID string
	TwitchSecret   string

	// These endpoints and HTTPClient are injectable for deterministic provider fixtures.
	TMDBBaseURL    string
	IGDBBaseURL    string
	TwitchTokenURL string
	HTTPClient     *http.Client
	RequestTimeout time.Duration
	CacheTTL       time.Duration
	MaxResults     int
}

type cacheEntry struct {
	hits    []Hit
	hit     Hit
	created time.Time
}

type Service struct {
	cfg       Config
	client    *http.Client
	cacheMu   sync.Mutex
	cache     map[string]cacheEntry
	tokenMu   sync.Mutex
	token     string
	tokenTill time.Time
}

func New(cfg Config) *Service {
	if cfg.TMDBBaseURL == "" {
		cfg.TMDBBaseURL = "https://api.themoviedb.org/3"
	}
	if cfg.IGDBBaseURL == "" {
		cfg.IGDBBaseURL = "https://api.igdb.com/v4"
	}
	if cfg.TwitchTokenURL == "" {
		cfg.TwitchTokenURL = "https://id.twitch.tv/oauth2/token"
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 5 * time.Second
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 5 * time.Minute
	}
	if cfg.MaxResults <= 0 || cfg.MaxResults > maxResults {
		cfg.MaxResults = defaultResults
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: cfg.RequestTimeout}
	} else if client.Timeout == 0 || client.Timeout > cfg.RequestTimeout {
		boundedClient := *client
		boundedClient.Timeout = cfg.RequestTimeout
		client = &boundedClient
	}
	return &Service{cfg: cfg, client: client, cache: make(map[string]cacheEntry)}
}

func (s *Service) Search(ctx context.Context, text, media, region string) ([]Hit, error) {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > queryLimit {
		return nil, ErrInvalidQuery
	}
	media = strings.ToLower(strings.TrimSpace(media))
	if media != "" && media != "movie" && media != "show" && media != "game" {
		return nil, fmt.Errorf("%w: unsupported media", ErrInvalidQuery)
	}
	region = strings.ToUpper(strings.TrimSpace(region))
	if region != "" && !validRegion(region) {
		return nil, fmt.Errorf("%w: region must be a two-letter code", ErrInvalidQuery)
	}
	key := "search\x00" + strings.ToLower(text) + "\x00" + media + "\x00" + region
	if hits, ok := s.getCachedHits(key); ok {
		return hits, nil
	}

	providers := []string{}
	if media == "" || media == "movie" || media == "show" {
		if s.tmdbConfigured() {
			if media == "" {
				providers = append(providers, "movie", "show")
			} else {
				providers = append(providers, media)
			}
		} else if media != "" && media != "game" {
			return nil, fmt.Errorf("%w: TMDB", ErrProviderUnconfigured)
		}
	}
	if media == "" || media == "game" {
		if s.igdbConfigured() {
			providers = append(providers, "game")
		} else if media == "game" || len(providers) == 0 {
			return nil, fmt.Errorf("%w: IGDB", ErrProviderUnconfigured)
		}
	}
	if len(providers) == 0 {
		return nil, ErrProviderUnconfigured
	}

	var hits []Hit
	var providerErrs []error
	succeeded := 0
	perProviderLimit := s.cfg.MaxResults
	if media == "" && len(providers) > 1 {
		perProviderLimit = (s.cfg.MaxResults + len(providers) - 1) / len(providers)
	}
	for _, provider := range providers {
		var (
			found []Hit
			err   error
		)
		switch provider {
		case "movie", "show":
			found, err = s.searchTMDB(ctx, text, provider, region, perProviderLimit)
		case "game":
			found, err = s.searchIGDB(ctx, text, perProviderLimit)
		}
		if err != nil {
			providerErrs = append(providerErrs, fmt.Errorf("%s search: %w", provider, err))
			continue
		}
		succeeded++
		hits = append(hits, found...)
	}
	if succeeded == 0 {
		return nil, errors.Join(providerErrs...)
	}
	if len(hits) > s.cfg.MaxResults {
		hits = hits[:s.cfg.MaxResults]
	}
	s.setCachedHits(key, hits)
	return cloneHits(hits), nil
}

func (s *Service) Title(ctx context.Context, id string) (Hit, error) {
	id = strings.TrimSpace(id)
	if hit, ok := s.getCachedHit("title\x00" + id); ok {
		return hit, nil
	}
	parts := strings.Split(id, ":")
	if len(parts) != 3 {
		return Hit{}, fmt.Errorf("%w: invalid namespaced ID", ErrInvalidQuery)
	}
	provider, media, providerID := parts[0], parts[1], parts[2]
	if providerID == "" || !allDigits(providerID) {
		return Hit{}, fmt.Errorf("%w: invalid provider ID", ErrInvalidQuery)
	}
	var hit Hit
	switch {
	case provider == "tmdb" && (media == "movie" || media == "show"):
		if !s.tmdbConfigured() {
			return Hit{}, fmt.Errorf("%w: TMDB", ErrProviderUnconfigured)
		}
		var err error
		hit, err = s.tmdbTitle(ctx, providerID, media)
		if err != nil {
			return Hit{}, err
		}
	case provider == "igdb" && media == "game":
		if !s.igdbConfigured() {
			return Hit{}, fmt.Errorf("%w: IGDB", ErrProviderUnconfigured)
		}
		var err error
		hit, err = s.igdbTitle(ctx, providerID)
		if err != nil {
			return Hit{}, err
		}
	default:
		return Hit{}, fmt.Errorf("%w: unsupported namespaced ID", ErrInvalidQuery)
	}
	if hit.Title == "" {
		return Hit{}, ErrTitleNotFound
	}
	s.setCachedHit("title\x00"+id, hit)
	return cloneHit(hit), nil
}

func (s *Service) searchTMDB(ctx context.Context, text, media, region string, resultLimit int) ([]Hit, error) {
	path := "/search/movie"
	if text == "" {
		if media == "show" {
			path = "/trending/tv/week"
		} else {
			path = "/trending/movie/week"
		}
	} else if media == "show" {
		path = "/search/tv"
	}
	endpoint, err := url.Parse(strings.TrimRight(s.cfg.TMDBBaseURL, "/") + path)
	if err != nil {
		return nil, fmt.Errorf("TMDB endpoint: %w", err)
	}
	query := endpoint.Query()
	if text != "" {
		query.Set("query", text)
		query.Set("include_adult", "false")
		if region != "" {
			query.Set("region", region)
		}
	}
	if s.cfg.TMDBKey != "" && s.cfg.TMDBToken == "" {
		query.Set("api_key", s.cfg.TMDBKey)
	}
	endpoint.RawQuery = query.Encode()
	req, err := s.newRequest(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	if s.cfg.TMDBToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.TMDBToken)
	}
	var response tmdbSearchResponse
	if err := s.doJSON(req, &response); err != nil {
		return nil, err
	}
	results := make([]Hit, 0, len(response.Results))
	for _, item := range response.Results {
		title := item.Title
		if media == "show" {
			title = item.Name
		}
		if item.ID <= 0 || strings.TrimSpace(title) == "" {
			continue
		}
		results = append(results, tmdbHit(item.ID, media, title, item.ReleaseDate, item.FirstAirDate, item.PosterPath, item.BackdropPath, item.Overview))
		if len(results) == resultLimit {
			break
		}
	}
	return results, nil
}

func (s *Service) tmdbTitle(ctx context.Context, providerID, media string) (Hit, error) {
	path := "/movie/" + providerID
	if media == "show" {
		path = "/tv/" + providerID
	}
	endpoint, err := url.Parse(strings.TrimRight(s.cfg.TMDBBaseURL, "/") + path)
	if err != nil {
		return Hit{}, fmt.Errorf("TMDB endpoint: %w", err)
	}
	if s.cfg.TMDBKey != "" && s.cfg.TMDBToken == "" {
		query := endpoint.Query()
		query.Set("api_key", s.cfg.TMDBKey)
		endpoint.RawQuery = query.Encode()
	}
	req, err := s.newRequest(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Hit{}, err
	}
	if s.cfg.TMDBToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.TMDBToken)
	}
	var item tmdbTitleResponse
	if err := s.doJSON(req, &item); err != nil {
		return Hit{}, err
	}
	if item.ID <= 0 {
		return Hit{}, ErrTitleNotFound
	}
	title, date := item.Title, item.ReleaseDate
	if media == "show" {
		title, date = item.Name, item.FirstAirDate
	}
	if strings.TrimSpace(title) == "" {
		return Hit{}, ErrTitleNotFound
	}
	hit := tmdbHit(item.ID, media, title, date, date, item.PosterPath, item.BackdropPath, item.Overview)
	for _, genre := range item.Genres {
		if name := strings.TrimSpace(genre.Name); name != "" {
			hit.Genres = append(hit.Genres, name)
		}
	}
	if media == "show" {
		ended := strings.EqualFold(item.Status, "Ended")
		hit.Ended = &ended
		seasons := []int{}
		for _, season := range item.Seasons {
			if season.Number > 0 {
				seasons = append(seasons, season.Number)
			}
		}
		sort.Ints(seasons)
		if len(seasons) > 40 {
			return Hit{}, errors.New("episode catalog exceeds beta season limit")
		}
		hit.Episodes = []Episode{}
		for _, season := range seasons {
			episodes, e := s.tmdbSeason(ctx, providerID, season, len(hit.Episodes))
			if e != nil {
				return Hit{}, e
			}
			hit.Episodes = append(hit.Episodes, episodes...)
		}
	}
	return hit, nil
}

func (s *Service) searchIGDB(ctx context.Context, text string, resultLimit int) ([]Hit, error) {
	token, err := s.twitchAccessToken(ctx)
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf("search \"%s\"; fields name,first_release_date,summary,cover.url,genres.name,platforms.name,artworks.url; limit %d;", escapeIGDBSearch(text), resultLimit)
	if text == "" {
		query = fmt.Sprintf("fields name,first_release_date,summary,cover.url,genres.name,platforms.name,artworks.url; sort follows desc; where follows != null; limit %d;", resultLimit)
	}
	req, err := s.newRequest(ctx, http.MethodPost, strings.TrimRight(s.cfg.IGDBBaseURL, "/")+"/games", strings.NewReader(query))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Client-ID", s.cfg.TwitchClientID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "text/plain")
	var response []igdbGame
	if err := s.doJSON(req, &response); err != nil {
		return nil, err
	}
	results := make([]Hit, 0, len(response))
	for _, item := range response {
		if item.ID <= 0 || strings.TrimSpace(item.Name) == "" {
			continue
		}
		results = append(results, igdbHit(item))
		if len(results) == resultLimit {
			break
		}
	}
	return results, nil
}

func (s *Service) igdbTitle(ctx context.Context, providerID string) (Hit, error) {
	token, err := s.twitchAccessToken(ctx)
	if err != nil {
		return Hit{}, err
	}
	query := fmt.Sprintf("fields name,first_release_date,summary,cover.url,genres.name,platforms.name,artworks.url; where id = %s; limit 1;", providerID)
	req, err := s.newRequest(ctx, http.MethodPost, strings.TrimRight(s.cfg.IGDBBaseURL, "/")+"/games", strings.NewReader(query))
	if err != nil {
		return Hit{}, err
	}
	req.Header.Set("Client-ID", s.cfg.TwitchClientID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "text/plain")
	var response []igdbGame
	if err := s.doJSON(req, &response); err != nil {
		return Hit{}, err
	}
	if len(response) == 0 {
		return Hit{}, ErrTitleNotFound
	}
	return igdbHit(response[0]), nil
}

func (s *Service) twitchAccessToken(ctx context.Context) (string, error) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	if s.token != "" && time.Now().Before(s.tokenTill) {
		return s.token, nil
	}
	endpoint, err := url.Parse(s.cfg.TwitchTokenURL)
	if err != nil {
		return "", fmt.Errorf("Twitch token endpoint: %w", err)
	}
	query := endpoint.Query()
	query.Set("client_id", s.cfg.TwitchClientID)
	query.Set("client_secret", s.cfg.TwitchSecret)
	query.Set("grant_type", "client_credentials")
	endpoint.RawQuery = query.Encode()
	req, err := s.newRequest(ctx, http.MethodPost, endpoint.String(), nil)
	if err != nil {
		return "", err
	}
	var response twitchTokenResponse
	if err := s.doJSON(req, &response); err != nil {
		return "", err
	}
	if response.AccessToken == "" || response.ExpiresIn <= 0 {
		return "", errors.New("Twitch returned an invalid access token response")
	}
	s.token = response.AccessToken
	// Refresh before provider expiry so an in-flight request does not use a stale token.
	s.tokenTill = time.Now().Add(time.Duration(response.ExpiresIn) * time.Second).Add(-time.Minute)
	if time.Until(s.tokenTill) <= 0 {
		s.tokenTill = time.Now().Add(time.Duration(response.ExpiresIn) * time.Second / 2)
	}
	return s.token, nil
}

func (s *Service) newRequest(ctx context.Context, method, endpoint string, body io.Reader) (*http.Request, error) {
	return http.NewRequestWithContext(ctx, method, endpoint, body)
}

func (s *Service) doJSON(req *http.Request, target any) error {
	response, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("provider request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil {
		return fmt.Errorf("read provider response: %w", err)
	}
	if len(body) > maxResponseSize {
		return errors.New("provider response exceeded size limit")
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("decode provider response: %w", err)
	}
	return nil
}

type tmdbSearchResponse struct {
	Results []tmdbTitleResponse `json:"results"`
}

type tmdbTitleResponse struct {
	Seasons []struct {
		Number int `json:"season_number"`
	} `json:"seasons"`
	ID           int         `json:"id"`
	Title        string      `json:"title"`
	Name         string      `json:"name"`
	ReleaseDate  string      `json:"release_date"`
	FirstAirDate string      `json:"first_air_date"`
	PosterPath   string      `json:"poster_path"`
	BackdropPath string      `json:"backdrop_path"`
	Overview     string      `json:"overview"`
	Status       string      `json:"status"`
	Genres       []tmdbGenre `json:"genres"`
}

type tmdbGenre struct {
	Name string `json:"name"`
}

type twitchTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

type igdbGame struct {
	ID               int         `json:"id"`
	Name             string      `json:"name"`
	FirstReleaseDate int64       `json:"first_release_date"`
	Summary          string      `json:"summary"`
	Cover            *igdbImage  `json:"cover"`
	Artworks         []igdbImage `json:"artworks"`
	Genres           []igdbName  `json:"genres"`
	Platforms        []igdbName  `json:"platforms"`
}

type igdbImage struct {
	URL string `json:"url"`
}

type igdbName struct {
	Name string `json:"name"`
}

func tmdbHit(id int, media, title, movieDate, showDate, poster, backdrop, synopsis string) Hit {
	date := movieDate
	if media == "show" {
		date = showDate
	}
	return Hit{
		ID:          fmt.Sprintf("tmdb:%s:%d", media, id),
		Media:       media,
		Title:       strings.TrimSpace(title),
		Year:        yearFromDate(date),
		ProviderIDs: map[string]string{"tmdb": strconv.Itoa(id)},
		Artwork:     tmdbImage(poster, "w500"),
		Backdrop:    tmdbImage(backdrop, "w1280"),
		Synopsis:    strings.TrimSpace(synopsis),
	}
}

func igdbHit(item igdbGame) Hit {
	hit := Hit{
		ID:          fmt.Sprintf("igdb:game:%d", item.ID),
		Media:       "game",
		Title:       strings.TrimSpace(item.Name),
		ProviderIDs: map[string]string{"igdb": strconv.Itoa(item.ID)},
		Synopsis:    strings.TrimSpace(item.Summary),
	}
	if item.FirstReleaseDate > 0 {
		hit.Year = time.Unix(item.FirstReleaseDate, 0).UTC().Year()
	}
	if item.Cover != nil {
		hit.Artwork = igdbImageURL(item.Cover.URL, "t_cover_big")
	}
	if len(item.Artworks) > 0 {
		hit.Backdrop = igdbImageURL(item.Artworks[0].URL, "t_1080p")
	}
	for _, genre := range item.Genres {
		if name := strings.TrimSpace(genre.Name); name != "" {
			hit.Genres = append(hit.Genres, name)
		}
	}
	if len(item.Platforms) > 0 {
		hit.Platform = strings.TrimSpace(item.Platforms[0].Name)
	}
	return hit
}

func tmdbImage(path, size string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if strings.HasPrefix(path, "https://") {
		return path
	}
	path = "/" + strings.TrimLeft(path, "/")
	return "https://image.tmdb.org/t/p/" + size + path
}

func igdbImageURL(path, size string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if strings.HasPrefix(path, "//") {
		path = "https:" + path
	} else if strings.HasPrefix(path, "/") {
		path = "https://images.igdb.com" + path
	} else if !strings.HasPrefix(path, "https://") {
		return ""
	}
	path = strings.Replace(path, "/t_thumb/", "/"+size+"/", 1)
	return path
}

func yearFromDate(value string) int {
	value = strings.TrimSpace(value)
	if len(value) < 4 {
		return 0
	}
	year, err := strconv.Atoi(value[:4])
	if err != nil || year < 1800 || year > 3000 {
		return 0
	}
	return year
}

func escapeIGDBSearch(value string) string {
	var out strings.Builder
	for _, r := range value {
		if unicode.IsControl(r) {
			out.WriteByte(' ')
			continue
		}
		if r == '\\' || r == '"' {
			out.WriteByte('\\')
		}
		out.WriteRune(r)
	}
	return out.String()
}

func validRegion(value string) bool {
	if len(value) != 2 {
		return false
	}
	return value[0] >= 'A' && value[0] <= 'Z' && value[1] >= 'A' && value[1] <= 'Z'
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (s *Service) tmdbConfigured() bool {
	return s.cfg.TMDBToken != "" || s.cfg.TMDBKey != ""
}

func (s *Service) igdbConfigured() bool {
	return s.cfg.TwitchClientID != "" && s.cfg.TwitchSecret != ""
}

func (s *Service) getCachedHits(key string) ([]Hit, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	entry, ok := s.cache[key]
	if !ok || time.Since(entry.created) >= s.cfg.CacheTTL {
		delete(s.cache, key)
		return nil, false
	}
	return cloneHits(entry.hits), true
}

func (s *Service) getCachedHit(key string) (Hit, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	entry, ok := s.cache[key]
	if !ok || time.Since(entry.created) >= s.cfg.CacheTTL {
		delete(s.cache, key)
		return Hit{}, false
	}
	return cloneHit(entry.hit), true
}

func (s *Service) setCachedHits(key string, hits []Hit) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if len(s.cache) >= 512 {
		for oldKey := range s.cache {
			delete(s.cache, oldKey)
			break
		}
	}
	s.cache[key] = cacheEntry{hits: cloneHits(hits), created: time.Now()}
}

func (s *Service) setCachedHit(key string, hit Hit) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if len(s.cache) >= 512 {
		for oldKey := range s.cache {
			delete(s.cache, oldKey)
			break
		}
	}
	s.cache[key] = cacheEntry{hit: cloneHit(hit), created: time.Now()}
}

func cloneHits(hits []Hit) []Hit {
	if hits == nil {
		return nil
	}
	cloned := make([]Hit, len(hits))
	for i, hit := range hits {
		cloned[i] = cloneHit(hit)
	}
	return cloned
}

func cloneHit(hit Hit) Hit {
	if hit.ProviderIDs != nil {
		providers := make(map[string]string, len(hit.ProviderIDs))
		for key, value := range hit.ProviderIDs {
			providers[key] = value
		}
		hit.ProviderIDs = providers
	}
	if hit.Genres != nil {
		hit.Genres = append([]string(nil), hit.Genres...)
	}
	if hit.Episodes != nil {
		hit.Episodes = append([]Episode(nil), hit.Episodes...)
	}
	if hit.Ended != nil {
		ended := *hit.Ended
		hit.Ended = &ended

	}
	return hit
}

func (s *Service) tmdbSeason(ctx context.Context, show string, season, offset int) ([]Episode, error) {
	endpoint, e := url.Parse(strings.TrimRight(s.cfg.TMDBBaseURL, "/") + "/tv/" + show + "/season/" + strconv.Itoa(season))
	if e != nil {
		return nil, e
	}
	if s.cfg.TMDBKey != "" && s.cfg.TMDBToken == "" {
		q := endpoint.Query()
		q.Set("api_key", s.cfg.TMDBKey)
		endpoint.RawQuery = q.Encode()
	}
	req, e := s.newRequest(ctx, http.MethodGet, endpoint.String(), nil)
	if e != nil {
		return nil, e
	}
	if s.cfg.TMDBToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.TMDBToken)
	}
	var data struct {
		Episodes []struct {
			ID     int     `json:"id"`
			Name   string  `json:"name"`
			Number int     `json:"episode_number"`
			Date   *string `json:"air_date"`
		} `json:"episodes"`
	}
	if e = s.doJSON(req, &data); e != nil {
		return nil, e
	}
	sort.Slice(data.Episodes, func(i, j int) bool { return data.Episodes[i].Number < data.Episodes[j].Number })
	out := []Episode{}
	for _, item := range data.Episodes {
		if item.ID <= 0 || item.Number <= 0 {
			continue
		}
		date := ""
		if item.Date != nil {
			if at, e := time.Parse("2006-01-02", *item.Date); e == nil {
				date = at.UTC().Format(time.RFC3339)
			}
		}
		out = append(out, Episode{ID: "tmdb:episode:" + strconv.Itoa(item.ID), Order: offset + len(out) + 1, Title: item.Name, Season: season, Number: item.Number, ReleasedAt: date})
	}
	return out, nil
}
