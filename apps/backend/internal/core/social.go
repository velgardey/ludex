package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type activityRecord struct {
	ID                 string
	AuthorID           string
	TitleID            string
	Caption            string
	Note               *string
	Rating             *int16
	AudienceKind       string
	CircleID           *string
	SpoilerKind        string
	SpoilerTitleID     *string
	RequiredSpoilerIDs []byte
	OccurredAt         []byte
	PublishedAt        time.Time
	Kind               string
	ProgressEventID    *string
	DraftID            *string
	Retracted          bool
	Version            int64
}

func (a *App) follow(ctx context.Context, p Principal, targetID string, following bool) error {
	if targetID == p.UserID {
		return badRequest("cannot-follow-self")
	}
	if targetID == "" || !a.activeUser(ctx, targetID) || a.blocked(ctx, p.UserID, targetID) {
		return notFound("user-unavailable")
	}
	if following {
		var count int
		if err := a.db.QueryRow(ctx, `SELECT count(*) FROM follows WHERE follower_id=$1`, p.UserID).Scan(&count); err != nil {
			return fmt.Errorf("count follows: %w", err)
		}
		if count >= 100 {
			return badRequest("following-limit")
		}
		var inserted bool
		if err := a.db.QueryRow(ctx, `INSERT INTO follows(follower_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING true`, p.UserID, targetID).Scan(&inserted); err == nil {
			_, _ = a.db.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
		} else if err != pgx.ErrNoRows {
			return fmt.Errorf("follow user: %w", err)
		}
		return nil
	}
	tag, err := a.db.Exec(ctx, `DELETE FROM follows WHERE follower_id=$1 AND target_id=$2`, p.UserID, targetID)
	if err != nil {
		return fmt.Errorf("unfollow user: %w", err)
	}
	if tag.RowsAffected() > 0 {
		_, _ = a.db.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
	}
	return nil
}

func (a *App) socialStatus(ctx context.Context, p Principal, userID string) (map[string]any, error) {
	if a.blocked(ctx, p.UserID, userID) {
		return nil, notFound("user-unavailable")
	}
	var following bool
	if err := a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND target_id=$2)`, p.UserID, userID).Scan(&following); err != nil {
		return nil, fmt.Errorf("read follow status: %w", err)
	}
	var followers, followingCount int
	if err := a.db.QueryRow(ctx, `SELECT count(*) FROM follows WHERE target_id=$1`, userID).Scan(&followers); err != nil {
		return nil, fmt.Errorf("count followers: %w", err)
	}
	if err := a.db.QueryRow(ctx, `SELECT count(*) FROM follows WHERE follower_id=$1`, userID).Scan(&followingCount); err != nil {
		return nil, fmt.Errorf("count following: %w", err)
	}
	friendship, err := a.friendship(ctx, p.UserID, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"following": following, "followers": followers, "followingCount": followingCount, "friendship": friendship}, nil
}

func (a *App) discoverUsers(ctx context.Context, p Principal, text string) ([]User, error) {
	pattern := "%" + strings.ReplaceAll(strings.ReplaceAll(text, "%", "\\%"), "_", "\\_") + "%"
	rows, err := a.db.Query(ctx, `SELECT id::text,display_name,COALESCE(email,''),roles,bio FROM users WHERE NOT disabled AND id<>$1 AND display_name ILIKE $2 ESCAPE '\' ORDER BY display_name,id LIMIT 50`, p.UserID, pattern)
	if err != nil {
		return nil, fmt.Errorf("discover users: %w", err)
	}
	defer rows.Close()
	result := make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &user.Bio); err != nil {
			return nil, fmt.Errorf("scan discovered user: %w", err)
		}
		user.Email = ""
		if a.blocked(ctx, p.UserID, user.ID) {
			continue
		}
		user.Roles = []string{"user"}
		result = append(result, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate discovered users: %w", err)
	}
	return result, nil
}

func (a *App) readActivity(ctx context.Context, viewer *string, id string) (Activity, error) {
	record, err := a.loadActivity(ctx, id)
	if err != nil {
		return Activity{}, err
	}
	if !(a.activityVisible(ctx, viewer, record)) {
		return Activity{}, notFound("activity-unavailable")
	}
	return a.projectActivity(ctx, viewer, record)
}

func (a *App) readFeed(ctx context.Context, p Principal, query url.Values) (ActivityPage, error) {
	filter := query.Get("filter")
	if filter == "" {
		filter = "following"
	}
	if filter != "following" && filter != "friends" && filter != "circle" {
		return ActivityPage{}, badRequest("invalid-feed-filter")
	}
	limit := 20
	if raw := query.Get("limit"); raw != "" {
		if _, err := fmt.Sscanf(raw, "%d", &limit); err != nil || limit < 1 || limit > 50 {
			return ActivityPage{}, badRequest("invalid-feed-limit")
		}
	}
	media := query.Get("media")
	if media != "" && media != "movie" && media != "show" && media != "game" {
		return ActivityPage{}, badRequest("invalid-media")
	}
	circleID := query.Get("circleId")
	if filter == "circle" && circleID == "" {
		return ActivityPage{}, badRequest("circle-required")
	}
	revision, err := a.policyRevision(ctx)
	if err != nil {
		return ActivityPage{}, err
	}
	var after string
	if cursor := query.Get("cursor"); cursor != "" {
		payload, err := a.decodeCursor(cursor)
		if err != nil {
			return ActivityPage{}, badRequest("invalid-cursor")
		}
		if payload.Viewer != p.UserID || payload.Revision != revision || payload.Filter != filter || payload.Media != media || payload.CircleID != circleID {
			return ActivityPage{}, conflict("cursor-invalidated")
		}
		after = payload.After
	}
	rows, err := a.db.Query(ctx, `SELECT id,author_id::text,title_id,caption,note,rating,audience_kind,circle_id::text,spoiler_kind,spoiler_title_id,required_spoiler_ids,occurred_at,published_at,kind,progress_event_id,draft_id,retracted,version FROM activities WHERE NOT retracted ORDER BY published_at DESC,id DESC LIMIT 2000`)
	if err != nil {
		return ActivityPage{}, fmt.Errorf("read feed activities: %w", err)
	}
	activities := make([]activityRecord, 0)
	for rows.Next() {
		var record activityRecord
		if err := rows.Scan(&record.ID, &record.AuthorID, &record.TitleID, &record.Caption, &record.Note, &record.Rating, &record.AudienceKind, &record.CircleID, &record.SpoilerKind, &record.SpoilerTitleID, &record.RequiredSpoilerIDs, &record.OccurredAt, &record.PublishedAt, &record.Kind, &record.ProgressEventID, &record.DraftID, &record.Retracted, &record.Version); err != nil {
			rows.Close()
			return ActivityPage{}, fmt.Errorf("scan feed activity: %w", err)
		}
		activities = append(activities, record)
	}
	rowsErr := rows.Err()
	rows.Close()
	if rowsErr != nil {
		return ActivityPage{}, fmt.Errorf("iterate feed: %w", rowsErr)
	}
	items := make([]Activity, 0, limit+1)
	for _, record := range activities {
		key := activityKey(record)
		if after != "" && key >= after {
			continue
		}
		if !a.activityVisible(ctx, &p.UserID, record) {
			continue
		}
		switch filter {
		case "following":
			if record.AuthorID != p.UserID {
				var follows bool
				if err := a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND target_id=$2)`, p.UserID, record.AuthorID).Scan(&follows); err != nil {
					return ActivityPage{}, fmt.Errorf("check feed follow: %w", err)
				}
				if !follows {
					continue
				}
			}
		case "friends":
			if record.AuthorID != p.UserID && !a.areFriends(ctx, p.UserID, record.AuthorID) {
				continue
			}
		case "circle":
			if record.AudienceKind != "circle" || record.CircleID == nil || *record.CircleID != circleID {
				continue
			}
		}
		if media != "" {
			title, err := a.getTitle(ctx, record.TitleID)
			if err != nil || title.Media != media {
				continue
			}
		}
		activity, err := a.projectActivity(ctx, &p.UserID, record)
		if err != nil {
			return ActivityPage{}, err
		}
		items = append(items, activity)
		if len(items) > limit {
			break
		}
	}
	page := ActivityPage{Items: items, ETag: "\"" + base64.RawURLEncoding.EncodeToString(hashBytes([]byte(fmt.Sprintf("%d:%s", revision, activityPageKey(items))))) + "\""}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		cursor, err := a.encodeCursor(feedCursor{Viewer: p.UserID, Revision: revision, Filter: filter, Media: media, CircleID: circleID, After: last.PublishedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID})
		if err != nil {
			return ActivityPage{}, err
		}
		page.NextCursor = cursor
	}
	return page, nil
}

func (a *App) loadActivity(ctx context.Context, id string) (activityRecord, error) {
	var record activityRecord
	err := a.db.QueryRow(ctx, `SELECT id,author_id::text,title_id,caption,note,rating,audience_kind,circle_id::text,spoiler_kind,spoiler_title_id,required_spoiler_ids,occurred_at,published_at,kind,progress_event_id,draft_id,retracted,version FROM activities WHERE id=$1`, id).Scan(&record.ID, &record.AuthorID, &record.TitleID, &record.Caption, &record.Note, &record.Rating, &record.AudienceKind, &record.CircleID, &record.SpoilerKind, &record.SpoilerTitleID, &record.RequiredSpoilerIDs, &record.OccurredAt, &record.PublishedAt, &record.Kind, &record.ProgressEventID, &record.DraftID, &record.Retracted, &record.Version)
	if err == pgx.ErrNoRows {
		return activityRecord{}, notFound("activity-unavailable")
	}
	if err != nil {
		return activityRecord{}, fmt.Errorf("load activity: %w", err)
	}
	return record, nil
}

func (a *App) activityVisible(ctx context.Context, viewer *string, record activityRecord) bool {
	if record.Retracted || !a.visible(ctx, viewer, record.AuthorID, audienceFromRecord(record)) {
		return false
	}
	if record.ProgressEventID != nil {
		var active bool
		if err := a.db.QueryRow(ctx, `SELECT active FROM progress_events WHERE user_id=$1 AND event_id=$2`, record.AuthorID, *record.ProgressEventID).Scan(&active); err != nil || !active {
			return false
		}
	}
	return true
}

func (a *App) projectActivity(ctx context.Context, viewer *string, record activityRecord) (Activity, error) {
	user, err := a.publicUser(ctx, record.AuthorID)
	if err != nil {
		return Activity{}, err
	}
	title, err := a.getTitle(ctx, record.TitleID)
	if err != nil {
		return Activity{}, err
	}
	spoiler := spoilerFromRecord(record)
	hidden := !a.mayReveal(ctx, viewer, record.AuthorID, spoiler)
	visibleTitleID := record.TitleID
	if hidden && spoiler.Kind == "hidden" {
		visibleTitleID = "hidden"
		title = CatalogHit{ID: "hidden", Media: title.Media, Title: "Hidden title", ProviderIDs: map[string]string{}}
	}
	var note *string
	if !hidden {
		note = record.Note
	}
	var rating *int
	if !hidden && record.Rating != nil {
		value := int(*record.Rating)
		rating = &value
	}
	captionValue := record.Caption
	if hidden {
		captionValue = "Shared progress"
	}
	var reactionCount, replyCount int
	if err := a.db.QueryRow(ctx, `SELECT count(*) FROM activity_reactions WHERE activity_id=$1`, record.ID).Scan(&reactionCount); err != nil {
		return Activity{}, fmt.Errorf("count reactions: %w", err)
	}
	if err := a.db.QueryRow(ctx, `SELECT count(*) FROM activity_replies WHERE activity_id=$1`, record.ID).Scan(&replyCount); err != nil {
		return Activity{}, fmt.Errorf("count replies: %w", err)
	}
	liked := false
	if viewer != nil {
		if err := a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM activity_reactions WHERE activity_id=$1 AND user_id=$2)`, record.ID, *viewer).Scan(&liked); err != nil {
			return Activity{}, fmt.Errorf("check reaction: %w", err)
		}
	}
	var occurred DateValue
	if err := json.Unmarshal(record.OccurredAt, &occurred); err != nil {
		return Activity{}, fmt.Errorf("decode activity date: %w", err)
	}
	projectedSpoiler := spoiler
	if hidden {
		projectedSpoiler = SpoilerScope{Kind: "hidden", TitleID: "hidden"}
	}
	return Activity{ID: record.ID, AuthorID: record.AuthorID, Author: user, TitleID: visibleTitleID, Title: title, Caption: captionValue, Note: note, Rating: rating, DetailHidden: hidden, OccurredAt: occurred, PublishedAt: record.PublishedAt, Audience: audienceFromRecord(record), Spoiler: projectedSpoiler, Kind: record.Kind, LikedByViewer: liked, ReactionCount: reactionCount, ReplyCount: replyCount}, nil
}

func (a *App) publicUser(ctx context.Context, userID string) (User, error) {
	user, err := a.me(ctx, userID)
	if err != nil {
		return User{}, err
	}
	user.Email = ""
	user.Roles = []string{"user"}
	return user, nil
}

func (a *App) visible(ctx context.Context, viewer *string, author string, audience Audience) bool {
	if !a.activeUser(ctx, author) || a.blockedViewer(ctx, viewer, author) {
		return false
	}
	if viewer != nil && *viewer == author {
		return true
	}
	if audience.Kind == "public" {
		return true
	}
	if viewer == nil || audience.Kind == "private" {
		return false
	}
	switch audience.Kind {
	case "friends":
		return a.areFriends(ctx, *viewer, author)
	case "circle":
		var allowed bool
		_ = a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM circles c JOIN circle_members m ON m.circle_id=c.id WHERE c.id=$1 AND c.owner_id=$2 AND m.user_id=$3)`, audience.CircleID, author, *viewer).Scan(&allowed)
		return allowed
	default:
		return false
	}
}

func (a *App) mayReveal(ctx context.Context, viewer *string, author string, spoiler SpoilerScope) bool {
	if (viewer != nil && *viewer == author) || spoiler.Kind == "none" {
		return true
	}
	if viewer == nil {
		return false
	}
	titleID := spoiler.TitleID
	required := []string{titleID}
	if spoiler.Kind == "episodes" {
		titleID = spoiler.ShowID
		required = spoiler.RequiredEpisodeIDs
	}
	if spoiler.Kind == "milestone" {
		titleID = spoiler.GameID
		required = spoiler.RequiredMilestoneIDs
	}
	items, err := a.loadLibrary(ctx, *viewer)
	if err != nil {
		return false
	}
	viewed := map[string]bool{}
	for _, item := range items {
		for _, run := range item.Runs {
			for _, id := range run.WatchedEpisodeIDs {
				viewed[id] = true
			}
			for _, id := range run.MilestoneIDs {
				viewed[id] = true
			}
			if run.MovieViewed || run.StoryCompleted {
				viewed[item.TitleID] = true
			}
		}
	}
	for _, id := range required {
		if !viewed[id] {
			return false
		}
	}
	return true
}

func (a *App) activeUser(ctx context.Context, userID string) bool {
	var active bool
	return a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND NOT disabled)`, userID).Scan(&active) == nil && active
}

func (a *App) blocked(ctx context.Context, userA, userB string) bool {
	if userA == "" || userB == "" {
		return false
	}
	var blocked bool
	_ = a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))`, userA, userB).Scan(&blocked)
	return blocked
}

func (a *App) blockedViewer(ctx context.Context, viewer *string, author string) bool {
	if viewer == nil {
		return false
	}
	return a.blocked(ctx, *viewer, author)
}

func (a *App) areFriends(ctx context.Context, userA, userB string) bool {
	low, high := orderedPair(userA, userB)
	var accepted bool
	_ = a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted')`, low, high).Scan(&accepted)
	return accepted
}

func (a *App) friendship(ctx context.Context, userA, userB string) (any, error) {
	low, high := orderedPair(userA, userB)
	var users []string
	var requestedBy, status string
	err := a.db.QueryRow(ctx, `SELECT ARRAY[user_low::text,user_high::text],requested_by::text,status FROM friendships WHERE user_low=$1 AND user_high=$2`, low, high).Scan(&users, &requestedBy, &status)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read friendship: %w", err)
	}
	return map[string]any{"users": users, "requestedBy": requestedBy, "status": status}, nil
}

func (a *App) setFriendship(ctx context.Context, p Principal, targetID, action string) error {
	if targetID == p.UserID || !a.activeUser(ctx, targetID) || a.blocked(ctx, p.UserID, targetID) {
		return notFound("user-unavailable")
	}
	low, high := orderedPair(p.UserID, targetID)
	var requestedBy, status string
	err := a.db.QueryRow(ctx, `SELECT requested_by::text,status FROM friendships WHERE user_low=$1 AND user_high=$2`, low, high).Scan(&requestedBy, &status)
	exists := err == nil
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("read friendship: %w", err)
	}
	if action == "remove" {
		_, err := a.db.Exec(ctx, `DELETE FROM friendships WHERE user_low=$1 AND user_high=$2`, low, high)
		if err != nil {
			return fmt.Errorf("remove friendship: %w", err)
		}
		_, _ = a.db.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
		return nil
	}
	if action == "accept" && (!exists || requestedBy != targetID || status != "pending") {
		return forbidden("request-required")
	}
	if action == "request" && exists {
		return nil
	}
	if action != "request" && action != "accept" {
		return badRequest("invalid-friendship-action")
	}
	requester := p.UserID
	newStatus := "pending"
	if action == "accept" {
		requester = targetID
		newStatus = "accepted"
	}
	_, err = a.db.Exec(ctx, `INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES($1,$2,$3,$4) ON CONFLICT(user_low,user_high) DO UPDATE SET requested_by=EXCLUDED.requested_by,status=EXCLUDED.status,created_at=now()`, low, high, requester, newStatus)
	if err != nil {
		return fmt.Errorf("save friendship: %w", err)
	}
	_, _ = a.db.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
	return nil
}

func orderedPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

func audienceFromRecord(record activityRecord) Audience {
	value := Audience{Kind: record.AudienceKind}
	if record.CircleID != nil {
		value.CircleID = *record.CircleID
	}
	return value
}

func spoilerFromRecord(record activityRecord) SpoilerScope {
	var required []string
	_ = json.Unmarshal(record.RequiredSpoilerIDs, &required)
	value := SpoilerScope{Kind: record.SpoilerKind}
	if record.SpoilerTitleID != nil {
		value.TitleID = *record.SpoilerTitleID
		value.ShowID = *record.SpoilerTitleID
		value.GameID = *record.SpoilerTitleID
	}
	if value.Kind == "episodes" {
		value.RequiredEpisodeIDs = required
	}
	if value.Kind == "milestone" {
		value.RequiredMilestoneIDs = required
	}
	return value
}

func (a *App) policyRevision(ctx context.Context) (int64, error) {
	var revision int64
	if err := a.db.QueryRow(ctx, `SELECT revision FROM account_policy WHERE singleton=true`).Scan(&revision); err != nil {
		return 0, fmt.Errorf("read policy revision: %w", err)
	}
	return revision, nil
}

type feedCursor struct {
	Viewer   string `json:"viewer"`
	Revision int64  `json:"revision"`
	Filter   string `json:"filter"`
	Media    string `json:"media"`
	CircleID string `json:"circleId"`
	After    string `json:"after"`
}

func (a *App) encodeCursor(value feedCursor) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode feed cursor: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, a.cursorKey)
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (a *App) decodeCursor(cursor string) (feedCursor, error) {
	parts := strings.Split(cursor, ".")
	if len(parts) != 2 {
		return feedCursor{}, fmt.Errorf("invalid cursor")
	}
	encodedSignature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return feedCursor{}, err
	}
	mac := hmac.New(sha256.New, a.cursorKey)
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(encodedSignature, mac.Sum(nil)) {
		return feedCursor{}, fmt.Errorf("invalid cursor signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return feedCursor{}, err
	}
	var value feedCursor
	if err := json.Unmarshal(raw, &value); err != nil {
		return feedCursor{}, err
	}
	return value, nil
}

func activityKey(record activityRecord) string {
	return record.PublishedAt.UTC().Format(time.RFC3339Nano) + "|" + record.ID
}
func activityPageKey(items []Activity) string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func _unusedActivityID(value string) string { return value }
