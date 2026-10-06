package companion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrRequestInProgress = errors.New("assistant request is already in progress")
	ErrRequestFailed     = errors.New("assistant request previously failed")
	ErrRateLimited       = errors.New("assistant request rate limit reached")
	ErrActionNotFound    = errors.New("assistant action not found")
	ErrActionExpired     = errors.New("assistant action expired")
	ErrActionInProgress  = errors.New("assistant action confirmation is already in progress")
)

type serviceStore struct {
	db *pgxpool.Pool
}

type beginRequestResult struct {
	conversationID string
	requestID      string
	userMessage    Message
	priorMessages  []Message
	existingUser   *Message
	existingReply  *Message
	replay         bool
}

type actionClaim struct {
	ID             string
	ConversationID string
	Payload        json.RawMessage
	PayloadHash    string
	TargetVersion  int
	Status         string
	Result         json.RawMessage
	Replay         bool
}

func (s serviceStore) existingConversation(ctx context.Context, userID string) (string, bool, error) {
	var conversationID string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM assistant_conversations WHERE user_id = $1`, userID).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return conversationID, true, nil
}

func (s serviceStore) stateMessages(ctx context.Context, userID string, limit int) ([]Message, error) {
	conversationID, ok, err := s.existingConversation(ctx, userID)
	if err != nil || !ok {
		return []Message{}, err
	}
	return s.messages(ctx, conversationID, limit)
}

func (s serviceStore) messages(ctx context.Context, conversationID string, limit int) ([]Message, error) {
	rows, err := s.db.Query(ctx, messageQuery+` WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Message
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reverseMessages(result)
	if result == nil {
		result = []Message{}
	}
	return result, nil
}

func (s serviceStore) messageByID(ctx context.Context, conversationID, messageID string) (Message, error) {
	row := s.db.QueryRow(ctx, messageQuery+` WHERE m.conversation_id = $1 AND m.id = $2`, conversationID, messageID)
	return scanMessage(row)
}

const messageQuery = `
	SELECT m.id::text, m.role, m.body, m.citations, m.fallback, m.created_at,
		COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'id', p.id::text,
				'label', p.label,
				'summary', p.summary,
				'status', CASE WHEN p.status = 'confirming' THEN 'pending' WHEN p.status = 'expired' THEN 'rejected' ELSE p.status END
			) ORDER BY p.created_at)
			FROM assistant_action_proposals p WHERE p.message_id = m.id
		), '[]'::jsonb)
	FROM assistant_messages m`

type rowScanner interface {
	Scan(...any) error
}

func scanMessage(row rowScanner) (Message, error) {
	var message Message
	var citationsJSON, actionsJSON []byte
	var created time.Time
	if err := row.Scan(&message.ID, &message.Role, &message.Text, &citationsJSON, &message.Fallback, &created, &actionsJSON); err != nil {
		return Message{}, err
	}
	if err := json.Unmarshal(citationsJSON, &message.Citations); err != nil {
		return Message{}, fmt.Errorf("decode stored assistant citations: %w", err)
	}
	if err := json.Unmarshal(actionsJSON, &message.Actions); err != nil {
		return Message{}, fmt.Errorf("decode stored assistant actions: %w", err)
	}
	if message.Citations == nil {
		message.Citations = []Citation{}
	}
	if message.Actions == nil {
		message.Actions = []Action{}
	}
	message.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	return message, nil
}

func reverseMessages(messages []Message) {
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
}

func (s serviceStore) beginRequest(ctx context.Context, userID, requestID, text string, limits Limits, historyLimit int) (*beginRequestResult, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	conversationID := uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_conversations(id, user_id) VALUES($1, $2) ON CONFLICT(user_id) DO NOTHING`, conversationID, userID); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `SELECT id::text FROM assistant_conversations WHERE user_id = $1 FOR UPDATE`, userID).Scan(&conversationID); err != nil {
		return nil, err
	}
	var existing struct {
		status             string
		userMessageID      string
		assistantMessageID *string
	}
	err = tx.QueryRow(ctx, `SELECT status, user_message_id::text, assistant_message_id::text FROM assistant_requests WHERE conversation_id = $1 AND request_id = $2`, conversationID, requestID).Scan(&existing.status, &existing.userMessageID, &existing.assistantMessageID)
	if err == nil {
		if existing.status == "pending" {
			return nil, ErrRequestInProgress
		}
		if existing.status == "failed" {
			return nil, ErrRequestFailed
		}
		userMessage, err := s.messageByIDTx(ctx, tx, conversationID, existing.userMessageID)
		if err != nil {
			return nil, err
		}
		if existing.assistantMessageID == nil {
			return nil, errors.New("completed assistant request has no reply")
		}
		reply, err := s.messageByIDTx(ctx, tx, conversationID, *existing.assistantMessageID)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &beginRequestResult{conversationID: conversationID, requestID: requestID, existingUser: &userMessage, existingReply: &reply, replay: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var pending, recent int
	err = tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE created_at > now() - interval '1 minute')
		FROM assistant_requests WHERE conversation_id = $1`, conversationID).Scan(&pending, &recent)
	if err != nil {
		return nil, err
	}
	if limits.MaxConcurrentRequests > 0 && pending >= limits.MaxConcurrentRequests {
		return nil, ErrRequestInProgress
	}
	if limits.RequestsPerMinute > 0 && recent >= limits.RequestsPerMinute {
		return nil, ErrRateLimited
	}
	prior, err := s.messagesTx(ctx, tx, conversationID, historyLimit)
	if err != nil {
		return nil, err
	}
	userMessageID := uuid.NewString()
	requestUUID := uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_messages(id, conversation_id, request_id, role, body) VALUES($1, $2, $3, 'user', $4)`, userMessageID, conversationID, requestID, text); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_requests(id, conversation_id, request_id, status, user_message_id) VALUES($1, $2, $3, 'pending', $4)`, requestUUID, conversationID, requestID, userMessageID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_conversations SET updated_at = now() WHERE id = $1`, conversationID); err != nil {
		return nil, err
	}
	userMessage := Message{ID: userMessageID, Role: "user", Text: text, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Citations: []Citation{}, Actions: []Action{}}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &beginRequestResult{conversationID: conversationID, requestID: requestID, userMessage: userMessage, priorMessages: prior}, nil
}

func (s serviceStore) messageByIDTx(ctx context.Context, tx pgx.Tx, conversationID, messageID string) (Message, error) {
	row := tx.QueryRow(ctx, messageQuery+` WHERE m.conversation_id = $1 AND m.id = $2`, conversationID, messageID)
	return scanMessage(row)
}

func (s serviceStore) messagesTx(ctx context.Context, tx pgx.Tx, conversationID string, limit int) ([]Message, error) {
	rows, err := tx.Query(ctx, messageQuery+` WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Message
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reverseMessages(result)
	return result, nil
}

func (s serviceStore) completeRequest(ctx context.Context, conversationID, requestID string, message Message, proposals []proposalDraft) (Message, error) {
	if message.Citations == nil {
		message.Citations = []Citation{}
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback(ctx)
	messageID := uuid.NewString()
	citationsJSON, err := json.Marshal(message.Citations)
	if err != nil {
		return Message{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_messages(id, conversation_id, request_id, role, body, citations, fallback) VALUES($1, $2, $3, 'assistant', $4, $5, $6)`, messageID, conversationID, requestID, message.Text, json.RawMessage(citationsJSON), message.Fallback); err != nil {
		return Message{}, err
	}
	for _, proposal := range proposals {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assistant_action_proposals(id, conversation_id, user_id, message_id, label, summary, payload, payload_hash, target_version, expires_at)
			VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, proposal.ID, conversationID, proposal.UserID, messageID, proposal.Label, proposal.Summary, proposal.Payload, proposal.PayloadHash, proposal.TargetVersion, proposal.ExpiresAt); err != nil {
			return Message{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_requests SET status = 'completed', assistant_message_id = $3, completed_at = now() WHERE conversation_id = $1 AND request_id = $2 AND status = 'pending'`, conversationID, requestID, messageID); err != nil {
		return Message{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_conversations SET updated_at = now() WHERE id = $1`, conversationID); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Message{}, err
	}
	message.ID = messageID
	message.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	message.Actions = []Action{}
	for _, proposal := range proposals {
		message.Actions = append(message.Actions, Action{ID: proposal.ID, Label: proposal.Label, Summary: proposal.Summary, Status: "pending"})
	}
	if message.Actions == nil {
		message.Actions = []Action{}
	}
	if message.Citations == nil {
		message.Citations = []Citation{}
	}
	return message, nil
}

func (s serviceStore) failRequest(ctx context.Context, conversationID, requestID, code string) {
	_, _ = s.db.Exec(ctx, `UPDATE assistant_requests SET status = 'failed', failure_code = $3, completed_at = now() WHERE conversation_id = $1 AND request_id = $2 AND status = 'pending'`, conversationID, requestID, code)
}

func (s serviceStore) claimProposal(ctx context.Context, userID, proposalID string, lease time.Duration) (actionClaim, error) {
	if _, err := uuid.Parse(proposalID); err != nil {
		return actionClaim{}, ErrActionNotFound
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return actionClaim{}, err
	}
	defer tx.Rollback(ctx)
	var claim actionClaim
	var leaseUntil *time.Time
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, payload, payload_hash, target_version, status, result, expires_at, confirmation_lease_until
		FROM assistant_action_proposals WHERE id = $1 AND user_id = $2 FOR UPDATE`, proposalID, userID).Scan(&claim.ID, &claim.ConversationID, &claim.Payload, &claim.PayloadHash, &claim.TargetVersion, &claim.Status, &claim.Result, &expiresAt, &leaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return actionClaim{}, ErrActionNotFound
	}
	if err != nil {
		return actionClaim{}, err
	}
	if claim.Status == "confirmed" || claim.Status == "rejected" {
		claim.Replay = true
		if err := tx.Commit(ctx); err != nil {
			return actionClaim{}, err
		}
		return claim, nil
	}
	if claim.Status == "expired" || time.Now().After(expiresAt) {
		if _, err := tx.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'expired', confirmation_lease_until = NULL WHERE id = $1`, proposalID); err != nil {
			return actionClaim{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return actionClaim{}, err
		}
		return actionClaim{}, ErrActionExpired
	}
	if claim.Status == "confirming" && leaseUntil != nil && leaseUntil.After(time.Now()) {
		return actionClaim{}, ErrActionInProgress
	}
	if claim.Status != "pending" && claim.Status != "confirming" {
		return actionClaim{}, ErrActionNotFound
	}
	claim.Status = "confirming"
	if _, err := tx.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'confirming', confirmation_lease_until = now() + $2::interval WHERE id = $1`, proposalID, fmt.Sprintf("%f seconds", lease.Seconds())); err != nil {
		return actionClaim{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return actionClaim{}, err
	}
	return claim, nil
}

func (s serviceStore) finishProposal(ctx context.Context, userID, proposalID string, result json.RawMessage) error {
	if len(result) == 0 {
		result = json.RawMessage(`{}`)
	}
	_, err := s.db.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'confirmed', result = $3, confirmed_at = now(), confirmation_lease_until = NULL WHERE id = $1 AND user_id = $2 AND status = 'confirming'`, proposalID, userID, result)
	return err
}

func (s serviceStore) releaseProposal(ctx context.Context, userID, proposalID string) {
	_, _ = s.db.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'pending', confirmation_lease_until = NULL WHERE id = $1 AND user_id = $2 AND status = 'confirming'`, proposalID, userID)
}

func (s serviceStore) rejectProposal(ctx context.Context, userID, proposalID string) (string, error) {
	if _, err := uuid.Parse(proposalID); err != nil {
		return "", ErrActionNotFound
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var status string
	var expiresAt time.Time
	var leaseUntil *time.Time
	err = tx.QueryRow(ctx, `SELECT status, expires_at, confirmation_lease_until FROM assistant_action_proposals WHERE id = $1 AND user_id = $2 FOR UPDATE`, proposalID, userID).Scan(&status, &expiresAt, &leaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrActionNotFound
	}
	if err != nil {
		return "", err
	}
	if status == "confirmed" || status == "rejected" {
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return status, nil
	}
	if status == "expired" || time.Now().After(expiresAt) {
		if _, err := tx.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'expired', confirmation_lease_until = NULL WHERE id = $1`, proposalID); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return "expired", nil
	}
	if status == "confirming" && leaseUntil != nil && leaseUntil.After(time.Now()) {
		return "", ErrActionInProgress
	}
	if status != "pending" && status != "confirming" {
		return "", ErrActionNotFound
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_action_proposals SET status = 'rejected', rejected_at = now(), confirmation_lease_until = NULL WHERE id = $1`, proposalID); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return "rejected", nil
}
