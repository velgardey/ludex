package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type LibraryEditCommand struct {
	CommandID   string                     `json:"commandId"`
	TitleID     string                     `json:"titleId"`
	BaseVersion int64                      `json:"baseVersion"`
	Patch       map[string]json.RawMessage `json:"patch"`
}

// ApplyLibrary uses the same versioned edit path as the authenticated HTTP
// route. Callers must pass a previously authenticated Ludex user ID.
func (a *App) ApplyLibrary(ctx context.Context, userID string, raw json.RawMessage) (json.RawMessage, error) {
	var command LibraryEditCommand
	if err := json.Unmarshal(raw, &command); err != nil {
		return nil, badRequest("invalid-library-edit")
	}
	result, err := a.editLibrary(ctx, Principal{UserID: userID}, command)
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

type libraryPatchValues struct {
	State       *string
	RatingSet   bool
	Rating      *int
	Liked       *bool
	Note        *string
	Owned       *bool
	Archived    *bool
	PlayedOnSet bool
	PlayedOn    *string
	Emulator    *string
}

func (a *App) editLibrary(ctx context.Context, p Principal, command LibraryEditCommand) (CommandResult, error) {
	if command.CommandID == "" || command.TitleID == "" || command.BaseVersion < 0 {
		return CommandResult{}, badRequest("invalid-library-edit")
	}
	patch, err := parseLibraryPatch(command.Patch)
	if err != nil {
		return CommandResult{}, err
	}
	if a.db == nil {
		return CommandResult{}, problem(503, "database-unavailable")
	}
	title, err := a.getTitle(ctx, command.TitleID)
	if err != nil {
		return CommandResult{}, err
	}
	payloadHash, _, err := hashJSON(command)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode library edit: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResult{}, fmt.Errorf("begin library edit: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockCommand(ctx, tx, p.UserID, command.CommandID); err != nil {
		return CommandResult{}, err
	}
	if result, found, err := findReceipt(ctx, tx, p.UserID, command.CommandID, payloadHash); err != nil {
		return CommandResult{}, err
	} else if found {
		return result, nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO library_entries(user_id,title_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, p.UserID, command.TitleID); err != nil {
		return CommandResult{}, fmt.Errorf("initialize library edit entry: %w", err)
	}
	var version int64
	if err := tx.QueryRow(ctx, `SELECT version FROM library_entries WHERE user_id=$1 AND title_id=$2 FOR UPDATE`, p.UserID, command.TitleID).Scan(&version); err != nil {
		return CommandResult{}, fmt.Errorf("lock library edit entry: %w", err)
	}
	if version != command.BaseVersion {
		return CommandResult{Status: "conflict", CommandID: command.CommandID, CurrentVersion: version}, nil
	}
	if patch.State != nil && *patch.State == "completed" && title.Media == "show" {
		if !title.Ended || !hasCompleteShowEvidence(ctx, tx, p.UserID, command.TitleID, title.Episodes) {
			return CommandResult{Status: "rejected", CommandID: command.CommandID, Code: "episode-evidence-required"}, nil
		}
	}
	nextVersion := version + 1
	if err := applyLibraryPatchTx(ctx, tx, p.UserID, command.TitleID, patch, nextVersion); err != nil {
		return CommandResult{}, err
	}
	patchJSON, _ := json.Marshal(command.Patch)
	eventID := "edit:" + command.CommandID
	if _, err := tx.Exec(ctx, `INSERT INTO library_edit_events(user_id,event_id,title_id,command_id,sequence,patch) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, p.UserID, eventID, command.TitleID, command.CommandID, nextVersion, jsonText(patchJSON)); err != nil {
		return CommandResult{}, fmt.Errorf("record library edit: %w", err)
	}
	result := CommandResult{Status: "accepted", CommandID: command.CommandID, Version: nextVersion, EventID: eventID}
	resultJSON, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, p.UserID, command.CommandID, payloadHash, jsonText(resultJSON)); err != nil {
		return CommandResult{}, fmt.Errorf("save library edit receipt: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		if cached, found, readErr := a.readReceipt(ctx, p.UserID, command.CommandID, payloadHash); readErr == nil && found {
			return cached, nil
		}
		return CommandResult{}, fmt.Errorf("commit library edit: %w", err)
	}
	return result, nil
}

func parseLibraryPatch(raw map[string]json.RawMessage) (libraryPatchValues, error) {
	if len(raw) == 0 || len(raw) > 12 {
		return libraryPatchValues{}, badRequest("invalid-library-patch")
	}
	allowed := map[string]bool{"state": true, "rating": true, "liked": true, "note": true, "owned": true, "archived": true, "playedOn": true, "emulator": true}
	for key := range raw {
		if !allowed[key] {
			return libraryPatchValues{}, badRequest("invalid-library-patch")
		}
	}
	var result libraryPatchValues
	decode := func(key string, target any) error {
		value, ok := raw[key]
		if !ok {
			return nil
		}
		if err := json.Unmarshal(value, target); err != nil {
			return badRequest("invalid-library-patch")
		}
		return nil
	}
	if value, ok := raw["state"]; ok {
		var v string
		if err := json.Unmarshal(value, &v); err != nil {
			return result, badRequest("invalid-library-state")
		}
		switch v {
		case "planned", "active", "paused", "dropped", "completed":
		default:
			return result, badRequest("invalid-library-state")
		}
		result.State = &v
	}
	if value, ok := raw["rating"]; ok {
		result.RatingSet = true
		if string(value) != "null" {
			var v int
			if err := json.Unmarshal(value, &v); err != nil || v < 1 || v > 10 {
				return result, badRequest("rating-range")
			}
			result.Rating = &v
		}
	}
	if value, ok := raw["playedOn"]; ok {
		result.PlayedOnSet = true
		if string(value) != "null" {
			var v string
			if err := json.Unmarshal(value, &v); err != nil {
				return result, badRequest("invalid-played-on")
			}
			if _, err := time.Parse("2006-01-02", v); err != nil {
				return result, badRequest("invalid-played-on")
			}
			result.PlayedOn = &v
		}
	}
	for key, target := range map[string]any{"liked": &result.Liked, "note": &result.Note, "owned": &result.Owned, "archived": &result.Archived, "emulator": &result.Emulator} {
		if err := decode(key, target); err != nil {
			return result, err
		}
	}
	if result.Note != nil && len(*result.Note) > 10000 {
		return result, badRequest("note-too-long")
	}
	if result.Emulator != nil && len(*result.Emulator) > 200 {
		return result, badRequest("emulator-too-long")
	}
	return result, nil
}

func applyLibraryPatchTx(ctx context.Context, tx pgx.Tx, userID, titleID string, patch libraryPatchValues, version int64) error {
	var state string
	var rating *int16
	var liked *bool
	var note, emulator *string
	var owned, archived *bool
	var playedOn *time.Time
	err := tx.QueryRow(ctx, `SELECT state,rating,liked,note,owned,archived,played_on,emulator FROM library_entries WHERE user_id=$1 AND title_id=$2 FOR UPDATE`, userID, titleID).Scan(&state, &rating, &liked, &note, &owned, &archived, &playedOn, &emulator)
	if err != nil {
		return fmt.Errorf("read library edit state: %w", err)
	}
	if patch.State != nil {
		state = *patch.State
	}
	if patch.RatingSet {
		rating = nil
		if patch.Rating != nil {
			v := int16(*patch.Rating)
			rating = &v
		}
	}
	if patch.Liked != nil {
		liked = patch.Liked
	}
	if patch.Note != nil {
		note = patch.Note
	}
	if patch.Owned != nil {
		owned = patch.Owned
	}
	if patch.Archived != nil {
		archived = patch.Archived
	}
	if patch.PlayedOnSet {
		playedOn = nil
		if patch.PlayedOn != nil {
			v, err := time.Parse("2006-01-02", *patch.PlayedOn)
			if err != nil {
				return badRequest("invalid-played-on")
			}
			playedOn = &v
		}
	}
	if patch.Emulator != nil {
		emulator = patch.Emulator
	}
	_, err = tx.Exec(ctx, `UPDATE library_entries SET state=$3,rating=$4,liked=$5,note=$6,owned=$7,archived=$8,played_on=$9,emulator=$10,version=$11,updated_at=now() WHERE user_id=$1 AND title_id=$2`, userID, titleID, state, rating, liked, note, owned, archived, playedOn, emulator, version)
	if err != nil {
		return fmt.Errorf("apply library edit: %w", err)
	}
	return nil
}

func hasCompleteShowEvidence(ctx context.Context, tx pgx.Tx, userID, titleID string, episodes []Episode) bool {
	if len(episodes) == 0 {
		return false
	}
	ids := make([]string, 0, len(episodes))
	for _, episode := range episodes {
		ids = append(ids, episode.ID)
	}
	var complete bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM library_runs r WHERE r.user_id=$1 AND r.title_id=$2 AND (SELECT count(*) FROM run_episode_progress e WHERE e.user_id=r.user_id AND e.title_id=r.title_id AND e.run_id=r.run_id AND e.status='watched' AND e.episode_id=ANY($3::text[]))=cardinality($3::text[]))`, userID, titleID, ids).Scan(&complete)
	return err == nil && complete
}

func decodePatch(raw []byte) (libraryPatchValues, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return libraryPatchValues{}, fmt.Errorf("decode replay patch: %w", err)
	}
	return parseLibraryPatch(fields)
}
