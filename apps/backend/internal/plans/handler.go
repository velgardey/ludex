package plans

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	ResolveUser func(*http.Request) (string, error)
}
type Handler struct {
	db  *pgxpool.Pool
	cfg Config
}

func New(db *pgxpool.Pool, cfg Config) *Handler { return &Handler{db, cfg} }
func ValidateCreate(title string, members []string, starts string) error {
	if len(strings.TrimSpace(title)) < 1 || len(title) > 100 {
		return fmt.Errorf("title must be 1–100 characters")
	}
	if len(members) > 7 {
		return fmt.Errorf("plans support at most 8 people including owner")
	}
	if starts != "" {
		if _, err := time.Parse(time.RFC3339, starts); err != nil {
			return fmt.Errorf("invalid start time")
		}
	}
	return nil
}
func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code string) {
	send(w, status, map[string]string{"code": code, "message": strings.ReplaceAll(code, "-", " ")})
}
func (h *Handler) member(ctx context.Context, user, plan string) bool {
	var ok bool
	err := h.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM plan_members WHERE plan_id=$1 AND user_id=$2) AND NOT EXISTS(SELECT 1 FROM plan_members m JOIN blocks b ON (b.blocker_id=$2::uuid AND b.blocked_id::text=m.user_id) OR (b.blocked_id=$2::uuid AND b.blocker_id::text=m.user_id) WHERE m.plan_id=$1)`, plan, user).Scan(&ok)
	return err == nil && ok
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, err := h.cfg.ResolveUser(r)
	if err != nil {
		fail(w, 401, "authentication-required")
		return
	}
	ctx := r.Context()
	path := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/api")
	if path == "/plans" && r.Method == "GET" {
		rows, err := h.db.Query(ctx, `SELECT p.id,p.owner_id,p.title,p.starts_at,p.version,m.rsvp FROM shared_plans p JOIN plan_members m ON m.plan_id=p.id WHERE m.user_id=$1 AND NOT EXISTS(SELECT 1 FROM plan_members pm JOIN blocks b ON (b.blocker_id=$1::uuid AND b.blocked_id::text=pm.user_id) OR (b.blocked_id=$1::uuid AND b.blocker_id::text=pm.user_id) WHERE pm.plan_id=p.id) ORDER BY p.created_at DESC LIMIT 50`, user)
		if err != nil {
			fail(w, 500, "read-failed")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, owner, title, rsvp string
			var starts *time.Time
			var version int
			if rows.Scan(&id, &owner, &title, &starts, &version, &rsvp) == nil {
				items = append(items, map[string]any{"id": id, "ownerId": owner, "title": title, "startsAt": starts, "version": version, "rsvp": rsvp})
			}
		}
		send(w, 200, items)
		return
	}
	var in struct {
		ID        string          `json:"id"`
		Title     string          `json:"title"`
		MemberIDs []string        `json:"memberIds"`
		StartsAt  string          `json:"startsAt"`
		TitleID   string          `json:"titleId"`
		RSVP      string          `json:"rsvp"`
		Text      string          `json:"text"`
		Scope     json.RawMessage `json:"scope"`
	}
	if r.Method == "POST" {
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil {
			fail(w, 400, "invalid-input")
			return
		}
	}
	if path == "/plans" && r.Method == "POST" {
		if err = ValidateCreate(in.Title, in.MemberIDs, in.StartsAt); err != nil {
			fail(w, 400, "invalid-plan")
			return
		}
		for _, member := range in.MemberIDs {
			if _, e := uuid.Parse(member); e != nil {
				fail(w, 400, "invalid-member")
				return
			}
			var eligible bool
			e := h.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND NOT u.disabled AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=$2::uuid) OR (b.blocker_id=$2::uuid AND b.blocked_id=$1)))`, member, user).Scan(&eligible)
			if e != nil || !eligible {
				fail(w, 400, "invalid-member")
				return
			}
		}
		id := uuid.NewString()
		tx, e := h.db.Begin(ctx)
		if e != nil {
			fail(w, 500, "write-failed")
			return
		}
		defer tx.Rollback(ctx)
		var starts any
		if in.StartsAt != "" {
			starts = in.StartsAt
		}
		if _, e = tx.Exec(ctx, "INSERT INTO shared_plans(id,owner_id,title,starts_at) VALUES($1,$2,$3,$4)", id, user, strings.TrimSpace(in.Title), starts); e != nil {
			fail(w, 500, "write-failed")
			return
		}
		members := append([]string{user}, in.MemberIDs...)
		for _, u := range members {
			if u == "" || len(u) > 160 {
				fail(w, 400, "invalid-member")
				return
			}
			if _, e = tx.Exec(ctx, "INSERT INTO plan_members(plan_id,user_id,rsvp) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", id, u, map[bool]string{true: "yes", false: "pending"}[u == user]); e != nil {
				fail(w, 500, "write-failed")
				return
			}
			if u != user {
				body, _ := json.Marshal(map[string]string{"planId": id, "title": in.Title})
				if _, e = tx.Exec(ctx, "INSERT INTO notification_inbox(id,user_id,kind,body) VALUES($1,$2,'plan-invitation',$3)", uuid.NewString(), u, json.RawMessage(body)); e != nil {
					fail(w, 500, "write-failed")
					return
				}
			}
		}
		if e = tx.Commit(ctx); e != nil {
			fail(w, 500, "write-failed")
			return
		}
		send(w, 201, map[string]any{"id": id, "version": 1})
		return
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[0] != "plans" {
		fail(w, 404, "route-not-found")
		return
	}
	id := parts[1]
	if !h.member(ctx, user, id) {
		fail(w, 404, "plan-not-found")
		return
	}
	if len(parts) == 2 && r.Method == "GET" {
		var owner, title string
		var starts *time.Time
		var version int
		if h.db.QueryRow(ctx, "SELECT owner_id,title,starts_at,version FROM shared_plans WHERE id=$1", id).Scan(&owner, &title, &starts, &version) != nil {
			fail(w, 404, "plan-not-found")
			return
		}
		rows, e := h.db.Query(ctx, "SELECT title_id,added_by FROM plan_candidates WHERE plan_id=$1", id)
		if e != nil {
			fail(w, 500, "read-failed")
			return
		}
		candidates := []map[string]string{}
		for rows.Next() {
			var t, a string
			rows.Scan(&t, &a)
			candidates = append(candidates, map[string]string{"titleId": t, "addedBy": a})
		}
		rows.Close()
		send(w, 200, map[string]any{"id": id, "ownerId": owner, "title": title, "startsAt": starts, "version": version, "candidates": candidates})
		return
	}
	if len(parts) == 3 && parts[2] == "rsvp" && r.Method == "POST" {
		if in.RSVP != "yes" && in.RSVP != "no" && in.RSVP != "maybe" {
			fail(w, 400, "invalid-rsvp")
			return
		}
		if _, err = h.db.Exec(ctx, "UPDATE plan_members SET rsvp=$3 WHERE plan_id=$1 AND user_id=$2", id, user, in.RSVP); err != nil {
			fail(w, 500, "write-failed")
			return
		}
		send(w, 200, map[string]string{"rsvp": in.RSVP})
		return
	}
	if len(parts) == 3 && parts[2] == "shortlist" && r.Method == "POST" {
		if in.TitleID == "" || len(in.TitleID) > 160 {
			fail(w, 400, "invalid-title")
			return
		}
		tx, e := h.db.Begin(ctx)
		if e != nil {
			fail(w, 500, "write-failed")
			return
		}
		defer tx.Rollback(ctx)
		tx.Exec(ctx, "SELECT id FROM shared_plans WHERE id=$1 FOR UPDATE", id)
		var count int
		tx.QueryRow(ctx, "SELECT count(*) FROM plan_candidates WHERE plan_id=$1", id).Scan(&count)
		if count >= 12 {
			fail(w, 400, "shortlist-full")
			return
		}
		if _, e = tx.Exec(ctx, "INSERT INTO plan_candidates(plan_id,title_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", id, in.TitleID, user); e != nil {
			fail(w, 500, "write-failed")
			return
		}
		if e = tx.Commit(ctx); e != nil {
			fail(w, 500, "write-failed")
			return
		}
		send(w, 200, map[string]string{"titleId": in.TitleID})
		return
	}

	if len(parts) == 3 && parts[2] == "discussion" {
		if r.Method == "GET" {
			items, e := h.readDiscussion(ctx, user, id)
			if e != nil {
				fail(w, 500, "read-failed")
				return
			}
			send(w, 200, items)
			return
		}
		if r.Method == "POST" {
			if ValidateDiscussion(in.Text, in.Scope) != nil {
				fail(w, 400, "invalid-discussion")
				return
			}
			messageID := uuid.NewString()
			if _, e := h.db.Exec(ctx, "INSERT INTO plan_messages(id,plan_id,user_id,body,scope) VALUES($1,$2,$3,$4,$5)", messageID, id, user, in.Text, in.Scope); e != nil {
				fail(w, 500, "write-failed")
				return
			}
			send(w, 201, map[string]string{"id": messageID})
			return
		}
	}
	fail(w, 404, "route-not-found")
}
