package catalog

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchMapsTMDBMovieToNamespacedCatalogHit(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/3/search/movie" {
			t.Errorf("path = %q, want /3/search/movie", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tmdb-server-token" {
			t.Errorf("authorization = %q, want bearer server token", got)
		}
		if got := r.URL.Query().Get("query"); got != "Spirited Away" {
			t.Errorf("query = %q, want Spirited Away", got)
		}
		if got := r.URL.Query().Get("region"); got != "GB" {
			t.Errorf("region = %q, want GB", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"id":129,"title":"Spirited Away","release_date":"2001-07-20","poster_path":"/poster.jpg","backdrop_path":"/backdrop.jpg","overview":"A young girl enters a spirit world."}]}`))
	}))
	defer server.Close()

	svc := New(Config{TMDBToken: "tmdb-server-token", TMDBBaseURL: server.URL + "/3"})
	hits, err := svc.Search(context.Background(), "Spirited Away", "movie", "GB")
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if calls != 1 {
		t.Fatalf("provider calls = %d, want 1", calls)
	}
	want := Hit{
		ID:          "tmdb:movie:129",
		Media:       "movie",
		Title:       "Spirited Away",
		Year:        2001,
		ProviderIDs: map[string]string{"tmdb": "129"},
		Artwork:     "https://image.tmdb.org/t/p/w500/poster.jpg",
		Backdrop:    "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
		Synopsis:    "A young girl enters a spirit world.",
	}
	if len(hits) != 1 || !sameHit(hits[0], want) {
		got, _ := json.Marshal(hits)
		wantJSON, _ := json.Marshal([]Hit{want})
		t.Fatalf("hits = %s, want %s", got, wantJSON)
	}

	// The provider response cache is part of the service contract: repeat searches
	// must not spend another request against a bounded external API.
	if _, err := svc.Search(context.Background(), "Spirited Away", "movie", "GB"); err != nil {
		t.Fatalf("cached Search returned error: %v", err)
	}
	if calls != 1 {
		t.Fatalf("provider calls after cached search = %d, want 1", calls)
	}
}

func TestSearchMapsIGDBGameAndKeepsTwitchCredentialsServerSide(t *testing.T) {
	var tokenCalls, gameCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/oauth2/token":
			tokenCalls++
			if r.Method != http.MethodPost {
				t.Errorf("token method = %s, want POST", r.Method)
			}
			if r.URL.Query().Get("client_id") != "server-client" || r.URL.Query().Get("client_secret") != "server-secret" || r.URL.Query().Get("grant_type") != "client_credentials" {
				t.Errorf("token request did not contain server credentials")
			}
			_, _ = w.Write([]byte(`{"access_token":"igdb-access-token","expires_in":3600,"token_type":"bearer"}`))
		case "/v4/games":
			gameCalls++
			if got := r.Header.Get("Client-ID"); got != "server-client" {
				t.Errorf("client ID = %q, want server client", got)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer igdb-access-token" {
				t.Errorf("authorization = %q, want bearer IGDB token", got)
			}
			body, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(body), `search "Hades"`) {
				t.Errorf("IGDB query did not contain escaped search text: %q", body)
			}
			_, _ = w.Write([]byte(`[{"id":1942,"name":"Hades","first_release_date":1600300800,"summary":"Defy the god of the dead.","cover":{"url":"//images.igdb.com/igdb/image/upload/t_thumb/co1x.jpg"},"platforms":[{"name":"PC (Microsoft Windows)"}]}]`))
		default:
			t.Errorf("unexpected provider path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(Config{
		TwitchClientID: "server-client",
		TwitchSecret:   "server-secret",
		IGDBBaseURL:    server.URL + "/v4",
		TwitchTokenURL: server.URL + "/oauth2/token",
	})
	hits, err := svc.Search(context.Background(), "Hades", "game", "")
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if tokenCalls != 1 || gameCalls != 1 {
		t.Fatalf("provider calls token=%d games=%d, want 1 each", tokenCalls, gameCalls)
	}
	if len(hits) != 1 {
		t.Fatalf("hit count = %d, want 1", len(hits))
	}
	want := Hit{
		ID:          "igdb:game:1942",
		Media:       "game",
		Title:       "Hades",
		Year:        2020,
		ProviderIDs: map[string]string{"igdb": "1942"},
		Artwork:     "https://images.igdb.com/igdb/image/upload/t_cover_big/co1x.jpg",
		Synopsis:    "Defy the god of the dead.",
		Platform:    "PC (Microsoft Windows)",
	}
	if !sameHit(hits[0], want) {
		got, _ := json.Marshal(hits[0])
		wantJSON, _ := json.Marshal(want)
		t.Fatalf("hit = %s, want %s", got, wantJSON)
	}

	// A cached token is reused across bounded searches for this service instance.
	if _, err := svc.Search(context.Background(), "Hades", "game", ""); err != nil {
		t.Fatalf("cached Search returned error: %v", err)
	}
	if tokenCalls != 1 || gameCalls != 1 {
		t.Fatalf("provider calls after cached search token=%d games=%d, want 1 each", tokenCalls, gameCalls)
	}
}

func TestSearchRejectsOversizedQueryBeforeProviderRequest(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
	}))
	defer server.Close()

	svc := New(Config{TMDBToken: "server-token", TMDBBaseURL: server.URL})
	_, err := svc.Search(context.Background(), strings.Repeat("x", 201), "movie", "US")
	if err == nil {
		t.Fatal("Search accepted a query longer than the 200 character contract")
	}
	if calls != 0 {
		t.Fatalf("provider calls = %d, want 0 for rejected query", calls)
	}
}

func TestSearchRejectsInvalidRegionBeforeProviderRequest(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
	}))
	defer server.Close()

	svc := New(Config{TMDBToken: "server-token", TMDBBaseURL: server.URL})
	_, err := svc.Search(context.Background(), "A title", "movie", "../../secret")
	if err == nil {
		t.Fatal("Search accepted a non-ISO region code")
	}
	if calls != 0 {
		t.Fatalf("provider calls = %d, want 0 for rejected region", calls)
	}
}

func TestSearchWithoutMediaQueriesMoviesShowsAndGames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/oauth2/token":
			_, _ = w.Write([]byte(`{"access_token":"igdb-token","expires_in":3600}`))
		case "/3/search/movie":
			_, _ = w.Write([]byte(`{"results":[{"id":1,"title":"Movie One"},{"id":2,"title":"Movie Two"},{"id":3,"title":"Movie Three"}]}`))
		case "/3/search/tv":
			_, _ = w.Write([]byte(`{"results":[{"id":4,"name":"Show One"},{"id":5,"name":"Show Two"},{"id":6,"name":"Show Three"}]}`))
		case "/v4/games":
			_, _ = w.Write([]byte(`[{"id":7,"name":"Game One"},{"id":8,"name":"Game Two"},{"id":9,"name":"Game Three"}]`))
		default:
			t.Errorf("unexpected provider path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(Config{
		TMDBToken:      "tmdb-token",
		TwitchClientID: "client-id",
		TwitchSecret:   "client-secret",
		TMDBBaseURL:    server.URL + "/3",
		IGDBBaseURL:    server.URL + "/v4",
		TwitchTokenURL: server.URL + "/oauth2/token",
		MaxResults:     3,
	})
	hits, err := svc.Search(context.Background(), "one", "", "")
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(hits) != 3 || hits[0].Media != "movie" || hits[1].Media != "show" || hits[2].Media != "game" {
		t.Fatalf("broad search media order = %#v, want one movie, one show, one game", hits)
	}
}

func TestSearchWithoutQueryReturnsTrendingMoviesShowsAndGames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/oauth2/token":
			_, _ = w.Write([]byte(`{"access_token":"igdb-token","expires_in":3600}`))
		case "/3/trending/movie/week":
			if r.URL.Query().Has("query") {
				t.Errorf("trending movie request unexpectedly has a query: %v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"results":[{"id":21,"title":"Trending Movie"}]}`))
		case "/3/trending/tv/week":
			if r.URL.Query().Has("query") {
				t.Errorf("trending TV request unexpectedly has a query: %v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"results":[{"id":22,"name":"Trending Show"}]}`))
		case "/v4/games":
			body, _ := io.ReadAll(r.Body)
			if strings.Contains(string(body), `search `) || !strings.Contains(string(body), `sort follows desc`) {
				t.Errorf("popular IGDB query = %q, want sort by follows without search", body)
			}
			_, _ = w.Write([]byte(`[{"id":23,"name":"Popular Game"}]`))
		default:
			t.Errorf("unexpected provider path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(Config{
		TMDBToken:      "tmdb-token",
		TwitchClientID: "client-id",
		TwitchSecret:   "client-secret",
		TMDBBaseURL:    server.URL + "/3",
		IGDBBaseURL:    server.URL + "/v4",
		TwitchTokenURL: server.URL + "/oauth2/token",
		MaxResults:     3,
	})
	hits, err := svc.Search(context.Background(), "  ", "", "")
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(hits) != 3 || hits[0].ID != "tmdb:movie:21" || hits[1].ID != "tmdb:show:22" || hits[2].ID != "igdb:game:23" {
		t.Fatalf("blank-query hits = %#v, want trending movie, show, and game", hits)
	}
}

func sameHit(got, want Hit) bool {
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	return string(gotJSON) == string(wantJSON)
}

func TestTitleLoadsTMDBMovieDetailsFromNamespacedID(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/3/movie/129" {
			t.Errorf("path = %q, want /3/movie/129", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tmdb-server-token" {
			t.Errorf("authorization = %q, want bearer server token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":129,"title":"Spirited Away","release_date":"2001-07-20","poster_path":"/poster.jpg","backdrop_path":"/backdrop.jpg","overview":"A young girl enters a spirit world.","genres":[{"id":16,"name":"Animation"},{"id":14,"name":"Fantasy"}]}`))
	}))
	defer server.Close()

	svc := New(Config{TMDBToken: "tmdb-server-token", TMDBBaseURL: server.URL + "/3"})
	hit, err := svc.Title(context.Background(), "tmdb:movie:129")
	if err != nil {
		t.Fatalf("Title returned error: %v", err)
	}
	want := Hit{
		ID:          "tmdb:movie:129",
		Media:       "movie",
		Title:       "Spirited Away",
		Year:        2001,
		ProviderIDs: map[string]string{"tmdb": "129"},
		Artwork:     "https://image.tmdb.org/t/p/w500/poster.jpg",
		Backdrop:    "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
		Synopsis:    "A young girl enters a spirit world.",
		Genres:      []string{"Animation", "Fantasy"},
	}
	if !sameHit(hit, want) {
		got, _ := json.Marshal(hit)
		wantJSON, _ := json.Marshal(want)
		t.Fatalf("hit = %s, want %s", got, wantJSON)
	}
	if calls != 1 {
		t.Fatalf("provider calls = %d, want 1", calls)
	}
}
