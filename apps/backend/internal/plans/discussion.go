package plans

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Scope struct {
	Kind                 string   `json:"kind"`
	ShowID               string   `json:"showId,omitempty"`
	GameID               string   `json:"gameId,omitempty"`
	RequiredEpisodeIDs   []string `json:"requiredEpisodeIds,omitempty"`
	RequiredMilestoneIDs []string `json:"requiredMilestoneIds,omitempty"`
}

func ValidateDiscussion(text string, raw json.RawMessage) error {
	if len(strings.TrimSpace(text)) == 0 || len(text) > 2000 {
		return fmt.Errorf("discussion length invalid")
	}
	var s Scope
	if json.Unmarshal(raw, &s) != nil {
		return fmt.Errorf("invalid scope")
	}
	switch s.Kind {
	case "none":
		return nil
	case "episodes":
		if s.ShowID != "" && len(s.RequiredEpisodeIDs) > 0 && len(s.RequiredEpisodeIDs) <= 1000 {
			return nil
		}
	case "milestone":
		if s.GameID != "" && len(s.RequiredMilestoneIDs) > 0 && len(s.RequiredMilestoneIDs) <= 100 {
			return nil
		}
	}
	return fmt.Errorf("invalid scope")
}
func (h *Handler) discussionVisible(ctx context.Context, user string, scope Scope) bool {
	if scope.Kind == "none" {
		return true
	}
	if scope.Kind == "episodes" {
		for _, id := range scope.RequiredEpisodeIDs {
			var ok bool
			if h.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM run_episode_progress WHERE user_id=$1 AND title_id=$2 AND episode_id=$3 AND status='watched')", user, scope.ShowID, id).Scan(&ok) != nil || !ok {
				return false
			}
		}
		return true
	}
	if scope.Kind == "milestone" {
		for _, id := range scope.RequiredMilestoneIDs {
			var ok bool
			if h.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM run_milestones WHERE user_id=$1 AND title_id=$2 AND milestone_id=$3)", user, scope.GameID, id).Scan(&ok) != nil || !ok {
				return false
			}
		}
		return true
	}
	return false
}
func (h *Handler) readDiscussion(ctx context.Context, user, plan string) ([]map[string]any, error) {
	rows, err := h.db.Query(ctx, "SELECT id,user_id,body,scope,created_at FROM plan_messages WHERE plan_id=$1 ORDER BY created_at LIMIT 100", plan)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type message struct {
		id, author, text string
		scope            Scope
		at               time.Time
	}
	messages := []message{}
	for rows.Next() {
		var m message
		var raw json.RawMessage
		if err := rows.Scan(&m.id, &m.author, &m.text, &raw, &m.at); err != nil {
			return nil, fmt.Errorf("read discussion failed")
		}
		if err := json.Unmarshal(raw, &m.scope); err != nil {
			return nil, fmt.Errorf("read discussion scope failed")
		}
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	out := []map[string]any{}
	for _, m := range messages {
		visible := m.author == user || h.discussionVisible(ctx, user, m.scope)
		item := map[string]any{"id": m.id, "authorId": m.author, "createdAt": m.at, "detailHidden": !visible}
		if visible {
			item["text"] = m.text
			item["scope"] = m.scope
		}
		out = append(out, item)
	}
	return out, nil
}
