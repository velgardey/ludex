package companion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db     *pgxpool.Pool
	cfg    Config
	store  serviceStore
	budget *budgetStore
	client *http.Client
}

func New(db *pgxpool.Pool, cfg Config) http.Handler {
	cfg = normalizeConfig(cfg)

	client := &http.Client{}
	if cfg.HTTPClient != nil {
		*client = *cfg.HTTPClient
	}
	if client.Timeout == 0 || client.Timeout > cfg.RequestTimeout {
		client.Timeout = cfg.RequestTimeout
	}
	// Provider requests carry a custom API key. Never forward it on redirects.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	service := &Service{db: db, cfg: cfg, store: serviceStore{db: db}, budget: newBudgetStore(db, cfg.Limits), client: client}
	router := chi.NewRouter()
	router.Get("/state", service.state)
	router.Get("/history", service.history)
	router.Get("/messages", service.history)
	router.Post("/messages", service.message)
	router.Post("/reset", service.reset)
	router.Post("/actions/{actionID}/confirm", service.confirmAction)
	router.Post("/actions/{actionID}/reject", service.rejectAction)
	return router
}

func normalizeConfig(cfg Config) Config {
	if cfg.MaxProposalAge <= 0 {
		cfg.MaxProposalAge = 15 * time.Minute
	}
	if cfg.MaxProposalAge > 7*24*time.Hour {
		cfg.MaxProposalAge = 7 * 24 * time.Hour
	}
	if cfg.MaxHistoryMessages <= 0 || cfg.MaxHistoryMessages > 100 {
		cfg.MaxHistoryMessages = 12
	}
	if cfg.MaxInputCharacters <= 0 || cfg.MaxInputCharacters > 12000 {
		cfg.MaxInputCharacters = 4000
	}
	if cfg.RequestTimeout <= 0 || cfg.RequestTimeout > time.Minute {
		cfg.RequestTimeout = 15 * time.Second
	}
	if cfg.Limits.MaxConcurrentRequests <= 0 || cfg.Limits.MaxConcurrentRequests > 8 {
		cfg.Limits.MaxConcurrentRequests = 2
	}
	if cfg.Limits.RequestsPerMinute <= 0 || cfg.Limits.RequestsPerMinute > 120 {
		cfg.Limits.RequestsPerMinute = 12
	}
	if cfg.Limits.MaxLibraryRecords <= 0 || cfg.Limits.MaxLibraryRecords > 100 {
		cfg.Limits.MaxLibraryRecords = 30
	}
	if cfg.Limits.MaxContextTokens > 32000 {
		cfg.Limits.MaxContextTokens = 32000
	}
	if cfg.Limits.MaxOutputTokens > 4096 {
		cfg.Limits.MaxOutputTokens = 4096
	}
	return cfg
}

func (s *Service) state(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	if s.db == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant-disabled", "The companion is unavailable.", 0)
		return
	}
	messages, err := s.store.stateMessages(r.Context(), userID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant-state-failed", "Could not load assistant history.", 0)
		return
	}
	allowance, err := s.budget.allowance(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant-allowance-failed", "Could not load assistant allowance.", 0)
		return
	}
	status := s.stateStatus(allowance)
	writeJSON(w, http.StatusOK, StateResponse{Status: status, Allowance: allowance, Messages: messages, CloudConsent: s.cloudAllowed(r.Context(), userID)})
}

func (s *Service) history(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	if s.db == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant-disabled", "The companion is unavailable.", 0)
		return
	}
	messages, err := s.store.stateMessages(r.Context(), userID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant-history-failed", "Could not load assistant history.", 0)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (s *Service) message(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	if s.db == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant-disabled", "The companion is unavailable.", 0)
		return
	}
	var request struct {
		Text      string `json:"text"`
		RequestID string `json:"requestId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid-assistant-message", "Provide a text message and requestId.", 0)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid-assistant-message", "Provide one JSON message object.", 0)
		return
	}
	request.Text = cleanString(request.Text)
	request.RequestID = strings.TrimSpace(request.RequestID)
	if request.Text == "" || utf8.RuneCountInString(request.Text) > s.cfg.MaxInputCharacters || len(request.RequestID) == 0 || len(request.RequestID) > 128 || hasControl(request.RequestID) {
		writeError(w, http.StatusBadRequest, "invalid-assistant-message", "The message or requestId is outside the accepted limits.", 0)
		return
	}
	if s.responsesReady() && len(request.Text) > s.cfg.Limits.MaxContextTokens {
		writeError(w, http.StatusBadRequest, "assistant-context-too-long", "The message exceeds the configured context limit.", 0)
		return
	}
	begin, err := s.store.beginRequest(r.Context(), userID, request.RequestID, request.Text, s.cfg.Limits, s.cfg.MaxHistoryMessages)
	if err != nil {
		s.writeBeginError(w, err)
		return
	}
	if begin.replay {
		allowance, _ := s.budget.allowance(r.Context(), userID)
		status := "ready"
		if begin.existingReply.Fallback {
			status = "fallback"
		}
		writeJSON(w, http.StatusOK, SendResponse{Status: status, Message: *begin.existingUser, AssistantMessage: *begin.existingReply, Allowance: allowance})
		return
	}
	retrieved, err := s.retrieve(r.Context(), userID, request.RequestID, request.Text)
	if err != nil {
		s.store.failRequest(r.Context(), begin.conversationID, request.RequestID, "context-unavailable")
		writeError(w, http.StatusServiceUnavailable, "assistant-context-unavailable", "Could not load permitted assistant context.", 0)
		return
	}
	var (
		assistantText string
		citations     []Citation
		proposals     []proposalDraft
		fallback      bool
		status        string
	)
	if !s.responsesReady() || !s.cloudAllowed(r.Context(), userID) {
		assistantText, citations = fallbackReply(request.Text, retrieved.Docs)
		fallback, status = true, "fallback"
	} else {
		reply, callErr := s.callResponses(r.Context(), userID, request.RequestID, buildSystemPrompt(retrieved.Docs), begin.priorMessages, request.Text)
		if errors.Is(callErr, ErrAllowanceExhausted) {
			assistantText, citations = fallbackReply(request.Text, retrieved.Docs)
			fallback, status = true, "allowance-exhausted"
		} else if callErr != nil {
			s.store.failRequest(r.Context(), begin.conversationID, request.RequestID, "provider-failed")
			writeError(w, http.StatusBadGateway, "assistant-provider-failed", "The cloud assistant could not complete this reply.", 0)
			return
		} else {
			assistantText = cleanString(reply.Text)
			citations = filterCitations(reply.Citations, retrieved.Docs)
			proposals = validateActionProposals(userID, reply.Actions, retrieved.Records, time.Now().Add(s.cfg.MaxProposalAge))
			status = "ready"
		}
	}
	assistant := Message{Role: "assistant", Text: assistantText, Citations: citations, Fallback: fallback, Actions: []Action{}}
	for i := range proposals {
		assistant.Actions = append(assistant.Actions, Action{ID: proposals[i].ID, Label: proposals[i].Label, Summary: proposals[i].Summary, Status: "pending"})
	}
	persisted, err := s.store.completeRequest(r.Context(), begin.conversationID, request.RequestID, assistant, proposals)
	if err != nil {
		s.store.failRequest(r.Context(), begin.conversationID, request.RequestID, "persistence-failed")
		writeError(w, http.StatusInternalServerError, "assistant-save-failed", "Could not save the assistant reply.", 0)
		return
	}
	allowance, _ := s.budget.allowance(r.Context(), userID)
	writeJSON(w, http.StatusOK, SendResponse{Status: status, Message: begin.userMessage, AssistantMessage: persisted, Allowance: allowance})
}

func (s *Service) confirmAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	if s.db == nil || s.cfg.ApplyProgress == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant-actions-disabled", "Progress confirmations are unavailable.", 0)
		return
	}
	actionID := chi.URLParam(r, "actionID")
	claim, err := s.store.claimProposal(r.Context(), userID, actionID, max(30*time.Second, 2*s.cfg.RequestTimeout))
	if err != nil {
		s.writeProposalError(w, err)
		return
	}
	if claim.Replay {
		message := "This action was already applied."
		if claim.Status == "rejected" {
			message = "This action was already rejected."
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": claim.Status, "message": message, "result": claim.Result})
		return
	}
	command, payload, err := decodeProgressCommand(string(claim.Payload))
	if err != nil || command.BaseVersion != claim.TargetVersion {
		s.store.releaseProposal(r.Context(), userID, actionID)
		writeError(w, http.StatusInternalServerError, "assistant-action-invalid", "The stored action could not be verified.", 0)
		return
	}
	if payloadHash(payload) != claim.PayloadHash {
		s.store.releaseProposal(r.Context(), userID, actionID)
		writeError(w, http.StatusInternalServerError, "assistant-action-invalid", "The stored action could not be verified.", 0)
		return
	}
	result, err := s.cfg.ApplyProgress(r.Context(), userID, payload)
	if err != nil {
		s.store.releaseProposal(r.Context(), userID, actionID)
		writeError(w, http.StatusConflict, "assistant-action-stale", "The library changed or the action could not be applied. Refresh and review it again.", 0)
		return
	}
	if !json.Valid(result) {
		result = json.RawMessage(`{}`)
	}
	if err := s.store.finishProposal(r.Context(), userID, actionID, result); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant-action-save-failed", "The progress command completed but confirmation state could not be saved.", 0)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "confirmed", "message": "Progress saved.", "result": result})
}

func (s *Service) rejectAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	if s.db == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant-disabled", "The companion is unavailable.", 0)
		return
	}
	status, err := s.store.rejectProposal(r.Context(), userID, chi.URLParam(r, "actionID"))
	if err != nil {
		s.writeProposalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "message": "Action updated."})
}

func (s *Service) stateStatus(allowance *Allowance) string {
	if s.db == nil {
		return "disabled"
	}
	if !s.responsesReady() {
		return "unconfigured"
	}
	if allowance != nil && allowance.Remaining <= 0 {
		return "allowance-exhausted"
	}
	return "ready"
}

func (s *Service) responsesReady() bool {
	return s.cfg.AzureEnabled && s.cfg.AzureAPIKey != "" && s.cfg.AzureEndpoint != "" && s.cfg.AzureDeployment != "" && s.budget.responsesEnabled()
}

func (s *Service) resolveUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.cfg.ResolveUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to use the companion.", 0)
		return "", false
	}
	userID, err := s.cfg.ResolveUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to use the companion.", 0)
		return "", false
	}
	parsed, err := uuid.Parse(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to use the companion.", 0)
		return "", false
	}
	return parsed.String(), true
}

func (s *Service) writeBeginError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "rate-limited", "Please wait before sending another message.", 60)
	case errors.Is(err, ErrRequestInProgress):
		writeError(w, http.StatusTooManyRequests, "assistant-busy", "An assistant request is already in progress.", 2)
	case errors.Is(err, ErrRequestFailed):
		writeError(w, http.StatusConflict, "request-failed", "This request already failed. Send a new request to try again.", 0)
	default:
		writeError(w, http.StatusInternalServerError, "assistant-request-failed", "Could not start the assistant request.", 0)
	}
}

func (s *Service) writeProposalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrActionNotFound):
		writeError(w, http.StatusNotFound, "action-not-found", "The action is unavailable.", 0)
	case errors.Is(err, ErrActionExpired):
		writeError(w, http.StatusGone, "action-expired", "This action expired. Ask the assistant to prepare a new one.", 0)
	case errors.Is(err, ErrActionInProgress):
		writeError(w, http.StatusConflict, "action-in-progress", "This action is already being confirmed.", 2)
	default:
		writeError(w, http.StatusInternalServerError, "action-failed", "Could not update this action.", 0)
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string, retryAfter int) {
	if retryAfter > 0 {
		w.Header().Set("Retry-After", itoa(retryAfter))
	}
	writeJSON(w, status, ErrorEnvelope{Code: code, Message: message, RetryAfterSeconds: retryAfter})
}

func hasControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

func payloadHash(payload []byte) string {
	command, canonical, err := decodeProgressCommand(string(payload))
	if err != nil || command.CommandID == "" {
		return ""
	}
	return contentHash(string(canonical))
}

func (s *Service) cloudAllowed(ctx context.Context, user string) bool {
	if s.cfg.CloudConsent == nil {
		return false
	}
	allowed, e := s.cfg.CloudConsent(ctx, user)
	return e == nil && allowed
}
func (s *Service) reset(w http.ResponseWriter, r *http.Request) {
	user, ok := s.resolveUser(w, r)
	if !ok {
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		writeError(w, 500, "reset-failed", "Conversation could not be cleared.", 0)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "DELETE FROM assistant_conversations WHERE user_id=$1", user)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM assistant_embeddings WHERE user_id=$1", user)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		writeError(w, 500, "reset-failed", "Conversation could not be cleared.", 0)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "cleared"})
}
