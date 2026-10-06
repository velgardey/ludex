package companion

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"ludex/backend/internal/catalog"
)

type ResolveUser func(*http.Request) (string, error)

type LoadLibrary func(context.Context, string) ([]LibraryRecord, error)

type ApplyProgress func(context.Context, string, json.RawMessage) (json.RawMessage, error)

type Catalog interface {
	Search(context.Context, string, string, string) ([]catalog.Hit, error)
	Title(context.Context, string) (catalog.Hit, error)
}

type LibraryRecord struct {
	TitleID string          `json:"titleId"`
	Title   string          `json:"title"`
	Media   string          `json:"media"`
	State   string          `json:"state"`
	Version int             `json:"version"`
	Rating  *int            `json:"rating,omitempty"`
	Liked   *bool           `json:"liked,omitempty"`
	Note    string          `json:"note,omitempty"`
	Runs    json.RawMessage `json:"runs,omitempty"`
}

type Limits struct {
	// Costs use integer micro-USD per million tokens, supplied from current
	// deployment pricing. Zero rates or zero caps disable paid calls.
	UserDailyMicros                 int64
	SharedDailyMicros               int64
	ResponsesInputMicrosPerMillion  int64
	ResponsesOutputMicrosPerMillion int64
	EmbeddingMicrosPerMillion       int64
	MonthlyResponsesPerUser         int
	MonthlyBudgetMicros             int64
	MaxContextTokens                int
	MaxOutputTokens                 int
	MaxConcurrentRequests           int
	RequestsPerMinute               int
	MaxLibraryRecords               int
}

type Config struct {
	AzureEndpoint       string
	AzureDeployment     string
	AzureAPIKey         string
	AzureEnabled        bool
	EmbeddingDeployment string
	HTTPClient          *http.Client
	ResolveUser         ResolveUser
	LoadLibrary         LoadLibrary
	ApplyProgress       ApplyProgress
	Catalog             Catalog
	Limits              Limits

	MaxProposalAge     time.Duration
	MaxHistoryMessages int
	MaxInputCharacters int
	RequestTimeout     time.Duration
}

type Allowance struct {
	Remaining float64 `json:"remaining"`
	Limit     float64 `json:"limit"`
	ResetsAt  string  `json:"resetsAt,omitempty"`
}

type Citation struct {
	ID      string `json:"id"`
	TitleID string `json:"titleId,omitempty"`
	Label   string `json:"label"`
	URL     string `json:"url,omitempty"`
	Excerpt string `json:"excerpt,omitempty"`
}

type Action struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

type Message struct {
	ID        string     `json:"id"`
	Role      string     `json:"role"`
	Text      string     `json:"text"`
	CreatedAt string     `json:"createdAt"`
	Citations []Citation `json:"citations,omitempty"`
	Actions   []Action   `json:"actions,omitempty"`
	Fallback  bool       `json:"fallback,omitempty"`
}

type StateResponse struct {
	Status    string     `json:"status"`
	Allowance *Allowance `json:"allowance"`
	Messages  []Message  `json:"messages"`
}

type SendResponse struct {
	Status           string     `json:"status"`
	Message          Message    `json:"message"`
	AssistantMessage Message    `json:"assistantMessage"`
	Allowance        *Allowance `json:"allowance"`
}

type ErrorEnvelope struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}
