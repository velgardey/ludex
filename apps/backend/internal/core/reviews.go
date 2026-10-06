package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type reviewDraftInput struct {
	ID      string `json:"id"`
	TitleID string `json:"titleId"`
	Text    string `json:"text"`
	Version int64  `json:"version"`
	Rating  *int   `json:"rating,omitempty"`
}

type publishReviewInput struct {
	CommandID   string       `json:"commandId"`
	DraftID     string       `json:"draftId,omitempty"`
	BaseVersion int64        `json:"baseVersion"`
	TitleID     string       `json:"titleId,omitempty"`
	Text        *string      `json:"text,omitempty"`
	Rating      *int         `json:"rating,omitempty"`
	Audience    Audience     `json:"audience"`
	Spoiler     SpoilerScope `json:"spoiler"`
}

type addReplyInput struct {
	CommandID  string       `json:"commandId"`
	ActivityID string       `json:"activityId"`
	Text       string       `json:"text"`
	Spoiler    SpoilerScope `json:"spoiler"`
}

type reviewEditInput struct {
	ActivityID  string  `json:"activityId"`
	BaseVersion int64   `json:"baseVersion"`
	Text        *string `json:"text,omitempty"`
	Retract     bool    `json:"retract"`
}

type replyEditInput struct {
	ReplyID     string `json:"replyId"`
	BaseVersion int64  `json:"baseVersion"`
	Text        string `json:"text"`
}

func (a *App) saveReviewDraft(ctx context.Context, p Principal, input reviewDraftInput) (map[string]any, error) {
	if input.ID == "" || input.TitleID == "" || input.Version < 0 || len(input.Text) > 10000 {
		return nil, badRequest("invalid-review-draft")
	}
	if input.Rating != nil && (*input.Rating < 1 || *input.Rating > 10) {
		return nil, badRequest("rating-range")
	}
	if _, err := a.getTitle(ctx, input.TitleID); err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin review draft: %w", err)
	}
	defer tx.Rollback(ctx)
	var current int64
	err = tx.QueryRow(ctx, `SELECT version FROM review_drafts WHERE user_id=$1 AND id=$2 FOR UPDATE`, p.UserID, input.ID).Scan(&current)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("read review draft: %w", err)
	}
	if err == pgx.ErrNoRows {
		current = 0
	}
	if current != input.Version {
		return nil, conflict("draft-conflict")
	}
	next := current + 1
	if _, err := tx.Exec(ctx, `INSERT INTO review_drafts(id,user_id,title_id,text,rating,version,updated_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(user_id,id) DO UPDATE SET title_id=EXCLUDED.title_id,text=EXCLUDED.text,rating=EXCLUDED.rating,version=EXCLUDED.version,updated_at=now()`, input.ID, p.UserID, input.TitleID, input.Text, input.Rating, next); err != nil {
		return nil, fmt.Errorf("save review draft: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit review draft: %w", err)
	}
	return map[string]any{"id": input.ID, "version": next}, nil
}

func (a *App) readReviewDrafts(ctx context.Context, p Principal) ([]map[string]any, error) {
	rows, err := a.db.Query(ctx, `SELECT id,title_id,text,version,rating FROM review_drafts WHERE user_id=$1 ORDER BY updated_at DESC`, p.UserID)
	if err != nil {
		return nil, fmt.Errorf("list review drafts: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, titleID, text string
		var version int64
		var rating *int16
		if err := rows.Scan(&id, &titleID, &text, &version, &rating); err != nil {
			return nil, fmt.Errorf("scan review draft: %w", err)
		}
		item := map[string]any{"id": id, "titleId": titleID, "text": text, "version": version}
		if rating != nil {
			item["rating"] = int(*rating)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate review drafts: %w", err)
	}
	return result, nil
}

func (a *App) publishReview(ctx context.Context, p Principal, input publishReviewInput) (map[string]string, error) {
	if input.CommandID == "" || input.BaseVersion < 0 || input.Text != nil && len(*input.Text) > 10000 || input.Rating != nil && (*input.Rating < 1 || *input.Rating > 10) {
		return nil, badRequest("invalid-review")
	}
	if err := a.validateAudience(ctx, p.UserID, input.Audience); err != nil {
		return nil, err
	}
	hash, _, err := hashJSON(input)
	if err != nil {
		return nil, fmt.Errorf("encode review: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin review publish: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockCommand(ctx, tx, p.UserID, input.CommandID); err != nil {
		return nil, err
	}
	if raw, found, err := findPayloadReceipt(ctx, tx, p.UserID, input.CommandID, hash); err != nil {
		return nil, err
	} else if found {
		var saved map[string]string
		if err := json.Unmarshal(raw, &saved); err != nil {
			return nil, fmt.Errorf("decode review receipt: %w", err)
		}
		return saved, nil
	}
	var draftTitle, draftText string
	var draftRating *int16
	if input.DraftID != "" {
		var version int64
		err := tx.QueryRow(ctx, `SELECT title_id,text,rating,version FROM review_drafts WHERE user_id=$1 AND id=$2 FOR UPDATE`, p.UserID, input.DraftID).Scan(&draftTitle, &draftText, &draftRating, &version)
		if err == pgx.ErrNoRows {
			return nil, conflict("draft-conflict")
		}
		if err != nil {
			return nil, fmt.Errorf("read publish draft: %w", err)
		}
		if version != input.BaseVersion {
			return nil, conflict("draft-conflict")
		}
	}
	titleID := input.TitleID
	if titleID == "" {
		titleID = draftTitle
	}
	if titleID == "" {
		return nil, badRequest("title-required")
	}
	title, err := a.getTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	if err := validateSpoiler(input.Spoiler, title); err != nil {
		return nil, err
	}
	text := input.Text
	if text == nil && input.DraftID != "" {
		text = &draftText
	}
	rating := input.Rating
	if rating == nil && draftRating != nil {
		value := int(*draftRating)
		rating = &value
	}
	activityID := "review:" + input.CommandID
	spoilerTitle, required := spoilerColumns(input.Spoiler)
	requiredJSON, _ := json.Marshal(required)
	occurred, _ := json.Marshal(DateValue{Precision: "instant", ISO: time.Now().UTC().Format(time.RFC3339Nano)})
	var note any
	if text != nil {
		note = *text
	}
	var score any
	if rating != nil {
		score = *rating
	}
	if _, err := tx.Exec(ctx, `INSERT INTO activities(id,author_id,title_id,caption,note,rating,audience_kind,circle_id,spoiler_kind,spoiler_title_id,required_spoiler_ids,occurred_at,kind,draft_id,payload_hash) VALUES($1,$2,$3,'Published a review',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'review',$12,$13)`, activityID, p.UserID, titleID, note, score, input.Audience.Kind, nullString(input.Audience.CircleID), input.Spoiler.Kind, nullString(spoilerTitle), jsonText(requiredJSON), jsonText(occurred), nullString(input.DraftID), hash); err != nil {
		return nil, fmt.Errorf("publish review activity: %w", err)
	}
	result := map[string]string{"activityId": activityID}
	resultJSON, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, p.UserID, input.CommandID, hash, jsonText(resultJSON)); err != nil {
		return nil, fmt.Errorf("save review receipt: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return nil, fmt.Errorf("update feed revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit review publish: %w", err)
	}
	return result, nil
}

func (a *App) addReply(ctx context.Context, p Principal, input addReplyInput) (map[string]string, error) {
	text := strings.TrimSpace(input.Text)
	if input.CommandID == "" || input.ActivityID == "" || text == "" || len(text) > 2000 {
		return nil, badRequest("invalid-reply")
	}
	activity, err := a.readActivity(ctx, &p.UserID, input.ActivityID)
	if err != nil {
		return nil, err
	}
	if err := validateSpoiler(input.Spoiler, activity.Title); err != nil {
		return nil, err
	}
	hash, _, err := hashJSON(input)
	if err != nil {
		return nil, fmt.Errorf("encode reply: %w", err)
	}
	var oldHash []byte
	var oldID string
	err = a.db.QueryRow(ctx, `SELECT id,payload_hash FROM activity_replies WHERE activity_id=$1 AND user_id=$2 AND command_id=$3`, input.ActivityID, p.UserID, input.CommandID).Scan(&oldID, &oldHash)
	if err == nil {
		if !equalBytes(oldHash, hash) {
			return nil, conflict("command-payload-mismatch")
		}
		return map[string]string{"replyId": oldID}, nil
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("read reply receipt: %w", err)
	}
	replyID := "reply:" + input.ActivityID + ":" + p.UserID + ":" + input.CommandID
	spoilerTitle, required := spoilerColumns(input.Spoiler)
	requiredJSON, _ := json.Marshal(required)
	_, err = a.db.Exec(ctx, `INSERT INTO activity_replies(id,activity_id,user_id,command_id,payload_hash,text,spoiler_kind,spoiler_title_id,required_spoiler_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, replyID, input.ActivityID, p.UserID, input.CommandID, hash, text, input.Spoiler.Kind, nullString(spoilerTitle), jsonText(requiredJSON))
	if err != nil {
		return nil, fmt.Errorf("save reply: %w", err)
	}
	return map[string]string{"replyId": replyID}, nil
}

func (a *App) readReplies(ctx context.Context, viewer *string, activityID string) ([]Reply, error) {
	if _, err := a.readActivity(ctx, viewer, activityID); err != nil {
		return nil, err
	}
	rows, err := a.db.Query(ctx, `SELECT id,user_id::text,text,spoiler_kind,spoiler_title_id,required_spoiler_ids,created_at FROM activity_replies WHERE activity_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`, activityID)
	if err != nil {
		return nil, fmt.Errorf("read replies: %w", err)
	}
	defer rows.Close()
	result := make([]Reply, 0)
	type row struct {
		id, userID, text, kind string
		titleID                *string
		required               []byte
		created                time.Time
	}
	records := make([]row, 0)
	for rows.Next() {
		var value row
		if err := rows.Scan(&value.id, &value.userID, &value.text, &value.kind, &value.titleID, &value.required, &value.created); err != nil {
			return nil, fmt.Errorf("scan reply: %w", err)
		}
		records = append(records, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate replies: %w", err)
	}
	for i := len(records) - 1; i >= 0; i-- {
		value := records[i]
		if !a.activeUser(ctx, value.userID) || a.blockedViewer(ctx, viewer, value.userID) {
			continue
		}
		spoiler := SpoilerScope{Kind: value.kind}
		if value.titleID != nil {
			spoiler.TitleID = *value.titleID
			spoiler.ShowID = *value.titleID
			spoiler.GameID = *value.titleID
		}
		_ = json.Unmarshal(value.required, &spoiler.RequiredEpisodeIDs)
		if spoiler.Kind == "milestone" {
			_ = json.Unmarshal(value.required, &spoiler.RequiredMilestoneIDs)
		}
		hidden := !a.mayReveal(ctx, viewer, value.userID, spoiler)
		author, err := a.publicUser(ctx, value.userID)
		if err != nil {
			continue
		}
		reply := Reply{ID: value.id, ActivityID: activityID, Author: author, DetailHidden: hidden, CreatedAt: value.created}
		if !hidden {
			reply.Text = &value.text
		}
		result = append(result, reply)
	}
	return result, nil
}

func (a *App) react(ctx context.Context, p Principal, activityID string, liked bool) error {
	if _, err := a.readActivity(ctx, &p.UserID, activityID); err != nil {
		return err
	}
	if liked {
		_, err := a.db.Exec(ctx, `INSERT INTO activity_reactions(activity_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, activityID, p.UserID)
		if err != nil {
			return fmt.Errorf("save reaction: %w", err)
		}
	} else {
		_, err := a.db.Exec(ctx, `DELETE FROM activity_reactions WHERE activity_id=$1 AND user_id=$2`, activityID, p.UserID)
		if err != nil {
			return fmt.Errorf("remove reaction: %w", err)
		}
	}
	return nil
}

func (a *App) editReview(ctx context.Context, p Principal, input reviewEditInput) (map[string]any, error) {
	if input.ActivityID == "" || input.BaseVersion < 1 || input.Text != nil && len(*input.Text) > 10000 {
		return nil, badRequest("invalid-review-edit")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin review edit: %w", err)
	}
	defer tx.Rollback(ctx)
	var owner, kind string
	var version int64
	var note *string
	err = tx.QueryRow(ctx, `SELECT author_id::text,kind,version,note FROM activities WHERE id=$1 FOR UPDATE`, input.ActivityID).Scan(&owner, &kind, &version, &note)
	if err == pgx.ErrNoRows {
		return nil, notFound("activity-unavailable")
	}
	if err != nil {
		return nil, fmt.Errorf("load review: %w", err)
	}
	if owner != p.UserID || kind != "review" {
		return nil, forbidden("wrong-owner")
	}
	if version != input.BaseVersion {
		return nil, conflict("review-conflict")
	}
	if input.Text != nil {
		note = input.Text
	}
	if _, err := tx.Exec(ctx, `UPDATE activities SET note=$2,retracted=$3,version=version+1 WHERE id=$1`, input.ActivityID, note, input.Retract); err != nil {
		return nil, fmt.Errorf("update review: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return nil, fmt.Errorf("update feed revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit review edit: %w", err)
	}
	return map[string]any{"activityId": input.ActivityID, "version": version + 1}, nil
}

func (a *App) editReply(ctx context.Context, p Principal, input replyEditInput) (map[string]any, error) {
	text := strings.TrimSpace(input.Text)
	if input.ReplyID == "" || input.BaseVersion < 1 || text == "" || len(text) > 2000 {
		return nil, badRequest("invalid-reply-edit")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin reply edit: %w", err)
	}
	defer tx.Rollback(ctx)
	var owner, activityID string
	var version int64
	err = tx.QueryRow(ctx, `SELECT user_id::text,activity_id,version FROM activity_replies WHERE id=$1 FOR UPDATE`, input.ReplyID).Scan(&owner, &activityID, &version)
	if err == pgx.ErrNoRows {
		return nil, notFound("reply-not-found")
	}
	if err != nil {
		return nil, fmt.Errorf("load reply: %w", err)
	}
	if owner != p.UserID {
		return nil, forbidden("wrong-owner")
	}
	if _, err := a.readActivity(ctx, &p.UserID, activityID); err != nil {
		return nil, err
	}
	if version != input.BaseVersion {
		return nil, conflict("reply-conflict")
	}
	if _, err := tx.Exec(ctx, `UPDATE activity_replies SET text=$2,version=version+1 WHERE id=$1`, input.ReplyID, text); err != nil {
		return nil, fmt.Errorf("update reply: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit reply edit: %w", err)
	}
	return map[string]any{"replyId": input.ReplyID, "version": version + 1}, nil
}

func (a *App) blockUser(ctx context.Context, p Principal, targetID string) error {
	if targetID == p.UserID {
		return badRequest("cannot-block-self")
	}
	if !a.activeUser(ctx, targetID) {
		return notFound("user-unavailable")
	}
	_, err := a.db.Exec(ctx, `INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, p.UserID, targetID)
	if err != nil {
		return fmt.Errorf("block user: %w", err)
	}
	_, _ = a.db.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
	return nil
}

func (a *App) reportContent(ctx context.Context, p Principal, input struct {
	TargetID string `json:"targetId"`
	Reason   string `json:"reason"`
	Note     string `json:"note,omitempty"`
}) (map[string]string, error) {
	if input.TargetID == "" || input.Reason != "spam" && input.Reason != "harassment" && input.Reason != "spoiler" && input.Reason != "other" || len(input.Note) > 2000 {
		return nil, badRequest("invalid-report")
	}
	var exists bool
	if err := a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id::text=$1) OR EXISTS(SELECT 1 FROM activities WHERE id=$1)`, input.TargetID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check report target: %w", err)
	}
	if !exists {
		return nil, notFound("report-target-unavailable")
	}
	id := uuid.NewString()
	_, err := a.db.Exec(ctx, `INSERT INTO reports(id,reporter_id,target_id,reason,note) VALUES($1,$2,$3,$4,$5)`, id, p.UserID, input.TargetID, input.Reason, nullString(input.Note))
	if err != nil {
		return nil, fmt.Errorf("save report: %w", err)
	}
	return map[string]string{"reportId": id}, nil
}

func (a *App) moderation(ctx context.Context, p Principal) ([]map[string]any, error) {
	if !hasRole(p, "moderator") {
		return nil, forbidden("moderator-required")
	}
	rows, err := a.db.Query(ctx, `SELECT id::text,reporter_id::text,target_id,reason,COALESCE(note,''),status,created_at FROM reports ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list reports: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, reporter, target, reason, note, status string
		var created time.Time
		if err := rows.Scan(&id, &reporter, &target, &reason, &note, &status, &created); err != nil {
			return nil, fmt.Errorf("scan report: %w", err)
		}
		result = append(result, map[string]any{"id": id, "reporterId": reporter, "targetId": target, "reason": reason, "note": note, "status": status, "createdAt": created})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reports: %w", err)
	}
	return result, nil
}

func (a *App) moderate(ctx context.Context, p Principal, input struct {
	TargetID string `json:"targetId"`
	Action   string `json:"action"`
	Reason   string `json:"reason"`
}) error {
	if !hasRole(p, "moderator") {
		return forbidden("moderator-required")
	}
	if input.TargetID == "" || input.Action != "remove" && input.Action != "suspend" || len(strings.TrimSpace(input.Reason)) < 1 || len(input.Reason) > 500 {
		return badRequest("invalid-moderation-action")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin moderation: %w", err)
	}
	defer tx.Rollback(ctx)
	if input.Action == "suspend" {
		tag, err := tx.Exec(ctx, `UPDATE users SET disabled=true WHERE id::text=$1`, input.TargetID)
		if err != nil {
			return fmt.Errorf("suspend user: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return notFound("user-unavailable")
		}
	} else {
		tag, err := tx.Exec(ctx, `UPDATE activities SET retracted=true,version=version+1 WHERE id=$1`, input.TargetID)
		if err != nil {
			return fmt.Errorf("remove activity: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return notFound("activity-unavailable")
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO moderation_audit(id,moderator_id,target_id,action,reason) VALUES($1,$2,$3,$4,$5)`, uuid.NewString(), p.UserID, input.TargetID, input.Action, input.Reason); err != nil {
		return fmt.Errorf("record moderation: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return fmt.Errorf("update feed revision: %w", err)
	}
	return tx.Commit(ctx)
}

func (a *App) saveCircle(ctx context.Context, p Principal, input struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
}) (map[string]string, error) {
	name := strings.TrimSpace(input.Name)
	if input.ID == "" || name == "" || len(name) > 80 || len(input.MemberIDs) > 8 {
		return nil, badRequest("circle-limits")
	}
	for _, member := range input.MemberIDs {
		if member != p.UserID && !a.areFriends(ctx, member, p.UserID) {
			return nil, forbidden("accepted-friend-required")
		}
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin circle save: %w", err)
	}
	defer tx.Rollback(ctx)
	var owner string
	err = tx.QueryRow(ctx, `SELECT owner_id::text FROM circles WHERE id=$1 FOR UPDATE`, input.ID).Scan(&owner)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("read circle: %w", err)
	}
	if err == nil && owner != p.UserID {
		return nil, forbidden("wrong-owner")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO circles(id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name`, input.ID, p.UserID, name); err != nil {
		return nil, fmt.Errorf("save circle: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM circle_members WHERE circle_id=$1`, input.ID); err != nil {
		return nil, fmt.Errorf("replace circle members: %w", err)
	}
	seen := map[string]bool{}
	for _, member := range input.MemberIDs {
		if seen[member] {
			continue
		}
		seen[member] = true
		if _, err := tx.Exec(ctx, `INSERT INTO circle_members(circle_id,user_id) VALUES($1,$2)`, input.ID, member); err != nil {
			return nil, fmt.Errorf("save circle member: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return nil, fmt.Errorf("update visibility revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit circle save: %w", err)
	}
	return map[string]string{"id": input.ID}, nil
}

func (a *App) readCircles(ctx context.Context, p Principal) ([]map[string]any, error) {
	rows, err := a.db.Query(ctx, `SELECT id::text,name,owner_id::text FROM circles WHERE owner_id=$1 ORDER BY name`, p.UserID)
	if err != nil {
		return nil, fmt.Errorf("list circles: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, name, owner string
		if err := rows.Scan(&id, &name, &owner); err != nil {
			return nil, fmt.Errorf("scan circle: %w", err)
		}
		members, err := a.db.Query(ctx, `SELECT user_id::text FROM circle_members WHERE circle_id=$1 ORDER BY user_id`, id)
		if err != nil {
			return nil, fmt.Errorf("read circle members: %w", err)
		}
		ids := make([]string, 0)
		for members.Next() {
			var user string
			if err := members.Scan(&user); err != nil {
				members.Close()
				return nil, fmt.Errorf("scan circle member: %w", err)
			}
			ids = append(ids, user)
		}
		members.Close()
		result = append(result, map[string]any{"id": id, "name": name, "ownerId": owner, "members": ids})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate circles: %w", err)
	}
	return result, nil
}

func findPayloadReceipt(ctx context.Context, tx pgx.Tx, userID, commandID string, payloadHash []byte) ([]byte, bool, error) {
	var savedHash, result []byte
	err := tx.QueryRow(ctx, `SELECT payload_hash,result FROM command_receipts WHERE user_id=$1 AND command_id=$2`, userID, commandID).Scan(&savedHash, &result)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read social receipt: %w", err)
	}
	if !equalBytes(savedHash, payloadHash) {
		return nil, false, conflict("command-payload-mismatch")
	}
	return result, true, nil
}

func hasRole(p Principal, role string) bool {
	for _, value := range p.Roles {
		if value == role {
			return true
		}
	}
	return false
}
func digestHex(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }
