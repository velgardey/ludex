package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type exportRecord struct {
	ID   string          `json:"id"`
	Body json.RawMessage `json:"body"`
}

type accountExport struct {
	SchemaVersion  int            `json:"schemaVersion"`
	ExportedAt     time.Time      `json:"exportedAt"`
	User           User           `json:"user"`
	PrivateRecords []exportRecord `json:"privateRecords"`
	SocialRecords  []exportRecord `json:"socialRecords"`
}

func (a *App) createAccountExport(ctx context.Context, principal Principal, request *http.Request) (map[string]any, error) {
	if a.db == nil {
		return nil, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	downloadID, err := randomToken(32)
	if err != nil {
		return nil, fmt.Errorf("generate export download id: %w", err)
	}
	expiresAt := time.Now().UTC().Add(15 * time.Minute)
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("begin account export: %w", err)
	}
	defer tx.Rollback(ctx)
	data, err := a.readAccountExport(ctx, tx, principal.UserID)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("encode account export: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM account_exports WHERE user_id=$1`, principal.UserID); err != nil {
		return nil, fmt.Errorf("replace prior account exports: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO account_exports(download_id_hash,user_id,payload,expires_at) VALUES($1,$2,$3::jsonb,$4)`, tokenHash(downloadID), principal.UserID, jsonText(payload), expiresAt); err != nil {
		return nil, fmt.Errorf("save account export: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit account export: %w", err)
	}
	pathPrefix := "/api"
	if strings.HasPrefix(request.URL.Path, "/api/v1/") {
		pathPrefix = "/api/v1"
	}
	scheme := "http"
	if request.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-Proto"), ",")[0]), "https") {
		scheme = "https"
	}
	downloadURL := scheme + "://" + request.Host + pathPrefix + "/account/download?id=" + url.QueryEscape(downloadID)
	return map[string]any{"downloadId": downloadID, "expiresAt": expiresAt, "downloadUrl": downloadURL}, nil
}

func (a *App) readAccountExport(ctx context.Context, tx pgx.Tx, userID string) (accountExport, error) {
	var user User
	err := tx.QueryRow(ctx, `SELECT id::text,display_name,COALESCE(email,''),roles,bio FROM users WHERE id=$1 AND NOT disabled`, userID).Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &user.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		return accountExport{}, notFound("user-unavailable")
	}
	if err != nil {
		return accountExport{}, fmt.Errorf("read export user: %w", err)
	}
	data := accountExport{SchemaVersion: 1, ExportedAt: time.Now().UTC(), User: user, PrivateRecords: make([]exportRecord, 0), SocialRecords: make([]exportRecord, 0)}
	privateQueries := []struct {
		query string
		args  []any
	}{
		{`SELECT 'settings',to_jsonb(s)-'user_id' FROM account_settings s WHERE user_id=$1`, []any{userID}},
		{`SELECT title_id,to_jsonb(l)-'user_id' FROM library_entries l WHERE user_id=$1 ORDER BY title_id`, []any{userID}},
		{`SELECT title_id||':'||run_id,to_jsonb(r)-'user_id' FROM library_runs r WHERE user_id=$1 ORDER BY title_id,run_id`, []any{userID}},
		{`SELECT title_id||':'||run_id||':'||episode_id,to_jsonb(p)-'user_id' FROM run_episode_progress p WHERE user_id=$1 ORDER BY title_id,run_id,episode_id`, []any{userID}},
		{`SELECT title_id||':'||run_id||':'||milestone_id,to_jsonb(m)-'user_id' FROM run_milestones m WHERE user_id=$1 ORDER BY title_id,run_id,milestone_id`, []any{userID}},
		{`SELECT title_id||':'||provider_game_id||':'||achievement_id||':'||mode,to_jsonb(g)-'user_id' FROM game_achievements g WHERE user_id=$1 ORDER BY title_id,provider_game_id,achievement_id,mode`, []any{userID}},
		{`SELECT event_id,to_jsonb(e)-'user_id' FROM progress_events e WHERE user_id=$1 ORDER BY sequence`, []any{userID}},
		{`SELECT correction_id,to_jsonb(c)-'user_id' FROM progress_corrections c WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT event_id,to_jsonb(e)-'user_id' FROM library_edit_events e WHERE user_id=$1 ORDER BY sequence`, []any{userID}},
		{`SELECT command_id,jsonb_build_object('result',result,'createdAt',created_at) FROM command_receipts WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT 'showcase',jsonb_build_object('version',version,'theme',theme,'featuredTitleId',featured_title_id,'updatedAt',updated_at) FROM showcases WHERE user_id=$1`, []any{userID}},
		{`SELECT shelf_id,to_jsonb(s)-'user_id' FROM showcase_shelves s WHERE user_id=$1 ORDER BY position`, []any{userID}},
		{`SELECT shelf_id||':'||title_id,jsonb_build_object('shelfId',shelf_id,'titleId',title_id,'position',position) FROM showcase_shelf_items WHERE user_id=$1 ORDER BY shelf_id,position`, []any{userID}},
		{`SELECT id::text,to_jsonb(c)-'user_id' FROM collections c WHERE user_id=$1 ORDER BY updated_at`, []any{userID}},
		{`SELECT c.id::text||':'||ct.title_id,jsonb_build_object('collectionId',c.id,'titleId',ct.title_id,'position',ct.position) FROM collection_titles ct JOIN collections c ON c.id=ct.collection_id WHERE c.user_id=$1 ORDER BY c.id,ct.position`, []any{userID}},
		{`SELECT id,to_jsonb(d)-'user_id' FROM review_drafts d WHERE user_id=$1 ORDER BY updated_at`, []any{userID}},
		{`SELECT id::text,jsonb_build_object('createdAt',created_at,'updatedAt',updated_at) FROM assistant_conversations WHERE user_id=$1`, []any{userID}},
		{`SELECT r.id::text,jsonb_build_object('requestId',r.request_id,'status',r.status,'userMessageId',r.user_message_id,'assistantMessageId',r.assistant_message_id,'failureCode',r.failure_code,'createdAt',r.created_at,'completedAt',r.completed_at) FROM assistant_requests r JOIN assistant_conversations c ON c.id=r.conversation_id WHERE c.user_id=$1 ORDER BY r.created_at`, []any{userID}},
		{`SELECT m.id::text,jsonb_build_object('conversationId',m.conversation_id,'requestId',m.request_id,'role',m.role,'body',m.body,'citations',m.citations,'fallback',m.fallback,'createdAt',m.created_at) FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 ORDER BY m.created_at,m.id`, []any{userID}},
		{`SELECT id::text,jsonb_build_object('label',label,'summary',summary,'payload',payload,'status',status,'expiresAt',expires_at,'result',result,'createdAt',created_at) FROM assistant_action_proposals WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT id,jsonb_build_object('source',source,'providerUser',provider_user,'shareCompletions',share_completions,'presenceAudience',presence_audience,'lastSuccess',last_success,'lastError',last_error,'nextSync',next_sync,'createdAt',created_at) FROM connector_accounts WHERE user_id=$1 ORDER BY source`, []any{userID}},
		{`SELECT id,jsonb_build_object('source',source,'providerRecord',provider_record,'payload',payload,'status',status,'observedAt',observed_at) FROM connector_observations WHERE user_id=$1 ORDER BY observed_at,id`, []any{userID}},
		{`SELECT id,jsonb_build_object('source',source,'rows',rows,'status',status,'createdAt',created_at,'committedAt',committed_at) FROM import_batches WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT id,jsonb_build_object('kind',kind,'state',state,'availableAt',available_at,'attempts',attempts,'lastError',last_error,'createdAt',created_at) FROM work_jobs WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT id,jsonb_build_object('title',title,'startsAt',starts_at,'version',version,'createdAt',created_at) FROM shared_plans WHERE owner_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT plan_id||':'||title_id,jsonb_build_object('planId',plan_id,'titleId',title_id,'addedBy',added_by) FROM plan_candidates WHERE added_by=$1 OR plan_id IN (SELECT id FROM shared_plans WHERE owner_id=$1) ORDER BY plan_id,title_id`, []any{userID}},
		{`SELECT plan_id,jsonb_build_object('planId',plan_id,'rsvp',rsvp) FROM plan_members WHERE user_id=$1 ORDER BY plan_id`, []any{userID}},
		{`SELECT id,jsonb_build_object('planId',plan_id,'body',body,'scope',scope,'createdAt',created_at) FROM plan_messages WHERE user_id=$1 OR plan_id IN (SELECT id FROM shared_plans WHERE owner_id=$1) ORDER BY created_at`, []any{userID}},
		{`SELECT id::text,jsonb_build_object('name',name,'createdAt',created_at) FROM circles WHERE owner_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT circle_id::text,jsonb_build_object('circleId',circle_id,'createdAt',created_at) FROM circle_members WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT id,jsonb_build_object('kind',kind,'body',body,'readAt',read_at,'createdAt',created_at) FROM notification_inbox WHERE user_id=$1 ORDER BY created_at`, []any{userID}},
	}
	for _, item := range privateQueries {
		if err := appendExportRecords(ctx, tx, &data.PrivateRecords, item.query, item.args...); err != nil {
			return accountExport{}, fmt.Errorf("read private export record: %w", err)
		}
	}
	socialQueries := []struct {
		query string
		args  []any
	}{
		{`SELECT follower_id::text||':'||target_id::text,jsonb_build_object('followerId',follower_id,'targetId',target_id,'createdAt',created_at) FROM follows WHERE follower_id=$1 OR target_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT user_low::text||':'||user_high::text,jsonb_build_object('userLow',user_low,'userHigh',user_high,'requestedBy',requested_by,'status',status,'createdAt',created_at) FROM friendships WHERE user_low=$1 OR user_high=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT blocker_id::text||':'||blocked_id::text,jsonb_build_object('blockerId',blocker_id,'blockedId',blocked_id,'createdAt',created_at) FROM blocks WHERE blocker_id=$1 OR blocked_id=$1 ORDER BY created_at`, []any{userID}},
		{`SELECT id,to_jsonb(a)-'author_id' FROM activities a WHERE author_id=$1 ORDER BY published_at,id`, []any{userID}},
		{`SELECT id,jsonb_build_object('activityId',activity_id,'text',text,'spoilerKind',spoiler_kind,'spoilerTitleId',spoiler_title_id,'requiredSpoilerIds',required_spoiler_ids,'createdAt',created_at,'version',version) FROM activity_replies WHERE user_id=$1 ORDER BY created_at,id`, []any{userID}},
		{`SELECT activity_id,jsonb_build_object('activityId',activity_id,'createdAt',created_at) FROM activity_reactions WHERE user_id=$1 ORDER BY created_at,activity_id`, []any{userID}},
		{`SELECT id::text,jsonb_build_object('targetId',target_id,'reason',reason,'note',note,'status',status,'createdAt',created_at) FROM reports WHERE reporter_id=$1 ORDER BY created_at`, []any{userID}},
	}
	for _, item := range socialQueries {
		if err := appendExportRecords(ctx, tx, &data.SocialRecords, item.query, item.args...); err != nil {
			return accountExport{}, fmt.Errorf("read social export record: %w", err)
		}
	}
	return data, nil
}

func appendExportRecords(ctx context.Context, tx pgx.Tx, records *[]exportRecord, query string, args ...any) error {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var record exportRecord
		if err := rows.Scan(&record.ID, &record.Body); err != nil {
			return err
		}
		*records = append(*records, record)
	}
	return rows.Err()
}

func (a *App) downloadAccountExport(ctx context.Context, principal Principal, downloadID string) (json.RawMessage, error) {
	if downloadID == "" {
		return nil, badRequest("export-id-required")
	}
	if a.db == nil {
		return nil, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	var payload []byte
	var expiresAt time.Time
	err := a.db.QueryRow(ctx, `SELECT payload,expires_at FROM account_exports WHERE user_id=$1 AND download_id_hash=$2`, principal.UserID, tokenHash(downloadID)).Scan(&payload, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("export-unavailable")
	}
	if err != nil {
		return nil, fmt.Errorf("read account export: %w", err)
	}
	if !expiresAt.After(time.Now()) {
		if _, err := a.db.Exec(ctx, `DELETE FROM account_exports WHERE user_id=$1 AND download_id_hash=$2`, principal.UserID, tokenHash(downloadID)); err != nil {
			return nil, fmt.Errorf("remove expired account export: %w", err)
		}
		return nil, problem(http.StatusGone, "export-expired")
	}
	if !json.Valid(payload) {
		return nil, fmt.Errorf("saved account export is invalid json")
	}
	return json.RawMessage(payload), nil
}

func (a *App) deleteAccount(ctx context.Context, principal Principal) (map[string]string, error) {
	if a.db == nil {
		return nil, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	requestID := uuid.NewString()
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	var userID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 FOR UPDATE`, principal.UserID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, unauthorized("account-unavailable")
	}
	if err != nil {
		return nil, fmt.Errorf("lock account for deletion: %w", err)
	}
	deletes := []struct {
		query string
		args  []any
	}{
		{`DELETE FROM moderation_audit WHERE moderator_id=$1 OR target_id=$1::text`, []any{userID}},
		{`DELETE FROM reports WHERE reporter_id=$1 OR target_id=$1::text`, []any{userID}},
		{`DELETE FROM assistant_budget_windows WHERE scope_key=$1`, []any{"user:" + userID}},
		{`DELETE FROM assistant_monthly_usage WHERE scope_key=$1`, []any{"user:" + userID}},
		{`DELETE FROM plan_messages WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM plan_candidates WHERE added_by=$1`, []any{userID}},
		{`DELETE FROM plan_members WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM shared_plans WHERE owner_id=$1`, []any{userID}},
		{`DELETE FROM connector_accounts WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM connector_observations WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM import_batches WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM work_jobs WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM notification_inbox WHERE user_id=$1`, []any{userID}},
		{`DELETE FROM users WHERE id=$1`, []any{userID}},
	}
	for _, deletion := range deletes {
		if _, err := tx.Exec(ctx, deletion.query, deletion.args...); err != nil {
			return nil, fmt.Errorf("delete account data: %w", err)
		}
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `INSERT INTO account_deletion_receipts(request_id,user_hash,requested_at,completed_at) VALUES($1,$2,$3,$3)`, requestID, tokenHash(userID), now); err != nil {
		return nil, fmt.Errorf("write account deletion receipt: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit account deletion: %w", err)
	}
	return map[string]string{"jobId": requestID}, nil
}
