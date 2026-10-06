package core

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CatalogHit is the stable portion of a catalog result consumed by the core.
// Catalog adapters may keep provider-specific fields in Extra.
type CatalogHit struct {
	ID                 string            `json:"id"`
	Media              string            `json:"media"`
	Title              string            `json:"title"`
	Year               *int              `json:"year,omitempty"`
	ProviderIDs        map[string]string `json:"providerIds"`
	Artwork            string            `json:"artwork,omitempty"`
	Backdrop           string            `json:"backdrop,omitempty"`
	Synopsis           string            `json:"synopsis,omitempty"`
	Genres             []string          `json:"genres,omitempty"`
	Platform           string            `json:"platform,omitempty"`
	Ended              bool              `json:"ended,omitempty"`
	Episodes           []Episode         `json:"episodes,omitempty"`
	Sample             bool              `json:"sample,omitempty"`
	ArtworkAttribution string            `json:"artworkAttribution,omitempty"`
}

type Episode struct {
	ID         string  `json:"id"`
	Order      int     `json:"order"`
	ReleasedAt *string `json:"releasedAt"`
	Title      string  `json:"title,omitempty"`
	Season     *int    `json:"season,omitempty"`
	Number     *int    `json:"number,omitempty"`
}

type Config struct {
	Env                   string
	InviteCode            string
	MaxAccounts           int
	GoogleWebClientID     string
	GoogleWebClientSecret string
	GoogleAndroidClientID string
	RedirectURI           string
	WebOrigin             string
	AllowedOrigins        []string
	ModeratorEmails       []string
	SessionCookieName     string
	SessionLifetime       time.Duration
	HTTPClient            *http.Client
	CatalogSearch         func(context.Context, string, string, string) ([]CatalogHit, error)
	CatalogGet            func(context.Context, string) (CatalogHit, error)
}

type App struct {
	db         *pgxpool.Pool
	cfg        Config
	httpClient *http.Client
	cursorKey  []byte
}

type User struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
	Email       string   `json:"email,omitempty"`
	Roles       []string `json:"roles"`
	Bio         string   `json:"bio,omitempty"`
}

type Session struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	User      User      `json:"user"`
}

type Principal struct {
	UserID string
	Roles  []string
}

type Viewer struct {
	UserID *string
}

type Audience struct {
	Kind     string `json:"kind"`
	CircleID string `json:"circleId,omitempty"`
}

type SpoilerScope struct {
	Kind                 string   `json:"kind"`
	ShowID               string   `json:"showId,omitempty"`
	GameID               string   `json:"gameId,omitempty"`
	TitleID              string   `json:"titleId,omitempty"`
	RequiredEpisodeIDs   []string `json:"requiredEpisodeIds,omitempty"`
	RequiredMilestoneIDs []string `json:"requiredMilestoneIds,omitempty"`
}

type DateValue struct {
	Precision string `json:"precision"`
	ISO       string `json:"iso,omitempty"`
	Day       string `json:"day,omitempty"`
	Month     string `json:"month,omitempty"`
}

type ProgressChange struct {
	Kind           string `json:"kind"`
	TitleID        string `json:"titleId"`
	RunID          string `json:"runId,omitempty"`
	SessionID      string `json:"sessionId,omitempty"`
	Medium         string `json:"medium,omitempty"`
	EpisodeID      string `json:"episodeId,omitempty"`
	Minutes        *int   `json:"minutes,omitempty"`
	PlayedOn       string `json:"playedOn,omitempty"`
	Emulator       string `json:"emulator,omitempty"`
	MilestoneID    string `json:"milestoneId,omitempty"`
	Label          string `json:"label,omitempty"`
	ProviderGameID string `json:"providerGameId,omitempty"`
	AchievementID  string `json:"achievementId,omitempty"`
	Mode           string `json:"mode,omitempty"`
}

type ProgressCommand struct {
	CommandID   string         `json:"commandId"`
	TitleID     string         `json:"titleId"`
	BaseVersion int64          `json:"baseVersion"`
	Change      ProgressChange `json:"change"`
	OccurredAt  DateValue      `json:"occurredAt"`
	Rating      *int           `json:"rating,omitempty"`
	Liked       *bool          `json:"liked,omitempty"`
	Note        *string        `json:"note,omitempty"`
	Audience    Audience       `json:"audience"`
	Spoiler     SpoilerScope   `json:"spoiler"`
}

type CommandResult struct {
	Status         string `json:"status"`
	CommandID      string `json:"commandId"`
	Version        int64  `json:"version,omitempty"`
	EventID        string `json:"eventId,omitempty"`
	CurrentVersion int64  `json:"currentVersion,omitempty"`
	Code           string `json:"code,omitempty"`
}

type Run struct {
	ID                string   `json:"id"`
	WatchedEpisodeIDs []string `json:"watchedEpisodeIds"`
	SkippedEpisodeIDs []string `json:"skippedEpisodeIds"`
	MovieViewed       bool     `json:"movieViewed"`
	StoryCompleted    bool     `json:"storyCompleted"`
	Minutes           int      `json:"minutes"`
	MilestoneIDs      []string `json:"milestoneIds"`
	SessionActive     bool     `json:"sessionActive"`
	PlayedOn          string   `json:"playedOn,omitempty"`
	Emulator          string   `json:"emulator,omitempty"`
}

type LibraryItem struct {
	TitleID        string     `json:"titleId"`
	Version        int64      `json:"version"`
	State          string     `json:"state"`
	Rating         *int       `json:"rating,omitempty"`
	Liked          *bool      `json:"liked,omitempty"`
	Note           *string    `json:"note,omitempty"`
	Owned          *bool      `json:"owned,omitempty"`
	Archived       *bool      `json:"archived,omitempty"`
	PlayedOn       string     `json:"playedOn,omitempty"`
	Emulator       string     `json:"emulator,omitempty"`
	Runs           []Run      `json:"runs"`
	AchievementIDs []string   `json:"achievementIds"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}

type Showcase struct {
	UserID          string  `json:"userId"`
	Version         int64   `json:"version"`
	Theme           string  `json:"theme"`
	FeaturedTitleID string  `json:"featuredTitleId,omitempty"`
	Shelves         []Shelf `json:"shelves"`
}

type Shelf struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Layout   string   `json:"layout"`
	ItemIDs  []string `json:"itemIds"`
	Audience Audience `json:"audience"`
}

type Collection struct {
	ID          string   `json:"id"`
	UserID      string   `json:"userId"`
	Version     int64    `json:"version"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	TitleIDs    []string `json:"titleIds"`
	Audience    Audience `json:"audience"`
}

type Activity struct {
	ID            string       `json:"id"`
	AuthorID      string       `json:"authorId"`
	Author        User         `json:"author"`
	TitleID       string       `json:"titleId"`
	Title         CatalogHit   `json:"title"`
	Caption       string       `json:"caption"`
	Note          *string      `json:"note,omitempty"`
	Rating        *int         `json:"rating,omitempty"`
	DetailHidden  bool         `json:"detailHidden"`
	OccurredAt    DateValue    `json:"occurredAt"`
	PublishedAt   time.Time    `json:"publishedAt"`
	Audience      Audience     `json:"audience"`
	Spoiler       SpoilerScope `json:"spoiler"`
	Kind          string       `json:"kind"`
	LikedByViewer bool         `json:"likedByViewer"`
	ReactionCount int          `json:"reactionCount"`
	ReplyCount    int          `json:"replyCount"`
}

type ActivityPage struct {
	Items      []Activity `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
	ETag       string     `json:"etag"`
}

type Reply struct {
	ID           string    `json:"id"`
	ActivityID   string    `json:"activityId"`
	Author       User      `json:"author"`
	Text         *string   `json:"text,omitempty"`
	DetailHidden bool      `json:"detailHidden"`
	CreatedAt    time.Time `json:"createdAt"`
}

// LoadLibrary returns normalized current library state for trusted server-side
// callers such as assistant retrieval. It never bypasses user visibility checks
// on public HTTP endpoints because the caller supplies the authenticated user.
func (a *App) LoadLibrary(ctx context.Context, userID string) ([]LibraryItem, error) {
	return a.loadLibrary(ctx, userID)
}

// ApplyProgress is the same persisted, versioned command path used by HTTP.
// Callers must pass a previously authenticated Ludex user ID.
func (a *App) ApplyProgress(ctx context.Context, userID string, raw json.RawMessage) (json.RawMessage, error) {
	var command ProgressCommand
	if err := json.Unmarshal(raw, &command); err != nil {
		return nil, badRequest("invalid-progress-command")
	}
	result, err := a.applyProgress(ctx, Principal{UserID: userID}, command)
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}
