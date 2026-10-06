package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (a *App) loadLibrary(ctx context.Context, userID string) ([]LibraryItem, error) {
	if a.db == nil {
		return nil, problem(503, "database-unavailable")
	}
	rows, err := a.db.Query(ctx, `SELECT title_id,version,state,rating,liked,note,owned,archived,played_on,emulator,updated_at FROM library_entries WHERE user_id=$1 ORDER BY updated_at DESC,title_id`, userID)
	if err != nil {
		return nil, fmt.Errorf("read library: %w", err)
	}
	items := make([]LibraryItem, 0)
	for rows.Next() {
		var item LibraryItem
		var rating *int16
		var playedOn *time.Time
		var emulator *string
		if err := rows.Scan(&item.TitleID, &item.Version, &item.State, &rating, &item.Liked, &item.Note, &item.Owned, &item.Archived, &playedOn, &emulator, &item.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan library entry: %w", err)
		}
		if emulator != nil {
			item.Emulator = *emulator
		}
		if rating != nil {
			value := int(*rating)
			item.Rating = &value
		}
		if playedOn != nil {
			item.PlayedOn = playedOn.Format("2006-01-02")
		}
		item.Runs = make([]Run, 0)
		item.AchievementIDs = make([]string, 0)
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("iterate library: %w", err)
	}
	for i := range items {
		runs, err := a.readRuns(ctx, userID, items[i].TitleID)
		if err != nil {
			return nil, err
		}
		items[i].Runs = runs
		achievements, err := a.readAchievements(ctx, userID, items[i].TitleID)
		if err != nil {
			return nil, err
		}
		items[i].AchievementIDs = achievements
	}
	return items, nil
}

func (a *App) readRuns(ctx context.Context, userID, titleID string) ([]Run, error) {
	rows, err := a.db.Query(ctx, `SELECT run_id,movie_viewed,story_completed,minutes,session_active,played_on,emulator FROM library_runs WHERE user_id=$1 AND title_id=$2 ORDER BY run_id`, userID, titleID)
	if err != nil {
		return nil, fmt.Errorf("read runs: %w", err)
	}
	defer rows.Close()
	result := make([]Run, 0)
	for rows.Next() {
		var run Run
		var playedOn *time.Time
		var emulator *string
		if err := rows.Scan(&run.ID, &run.MovieViewed, &run.StoryCompleted, &run.Minutes, &run.SessionActive, &playedOn, &emulator); err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		if emulator != nil {
			run.Emulator = *emulator
		}
		if playedOn != nil {
			run.PlayedOn = playedOn.Format("2006-01-02")
		}
		run.WatchedEpisodeIDs = make([]string, 0)
		run.SkippedEpisodeIDs = make([]string, 0)
		run.MilestoneIDs = make([]string, 0)
		result = append(result, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate runs: %w", err)
	}
	rows.Close()
	for i := range result {
		run := &result[i]
		progress, err := a.db.Query(ctx, `SELECT episode_id,status FROM run_episode_progress WHERE user_id=$1 AND title_id=$2 AND run_id=$3 ORDER BY episode_id`, userID, titleID, run.ID)
		if err != nil {
			return nil, fmt.Errorf("read episode progress: %w", err)
		}
		for progress.Next() {
			var episodeID, status string
			if err := progress.Scan(&episodeID, &status); err != nil {
				progress.Close()
				return nil, fmt.Errorf("scan episode progress: %w", err)
			}
			if status == "watched" {
				run.WatchedEpisodeIDs = append(run.WatchedEpisodeIDs, episodeID)
			} else {
				run.SkippedEpisodeIDs = append(run.SkippedEpisodeIDs, episodeID)
			}
		}
		progressErr := progress.Err()
		progress.Close()
		if progressErr != nil {
			return nil, fmt.Errorf("iterate episode progress: %w", progressErr)
		}
		milestones, err := a.db.Query(ctx, `SELECT milestone_id FROM run_milestones WHERE user_id=$1 AND title_id=$2 AND run_id=$3 ORDER BY milestone_id`, userID, titleID, run.ID)
		if err != nil {
			return nil, fmt.Errorf("read milestones: %w", err)
		}
		for milestones.Next() {
			var milestoneID string
			if err := milestones.Scan(&milestoneID); err != nil {
				milestones.Close()
				return nil, fmt.Errorf("scan milestone: %w", err)
			}
			run.MilestoneIDs = append(run.MilestoneIDs, milestoneID)
		}
		milestoneErr := milestones.Err()
		milestones.Close()
		if milestoneErr != nil {
			return nil, fmt.Errorf("iterate milestones: %w", milestoneErr)
		}
	}
	return result, nil
}

func (a *App) readAchievements(ctx context.Context, userID, titleID string) ([]string, error) {
	rows, err := a.db.Query(ctx, `SELECT provider_game_id,achievement_id,mode FROM game_achievements WHERE user_id=$1 AND title_id=$2 ORDER BY provider_game_id,achievement_id,mode`, userID, titleID)
	if err != nil {
		return nil, fmt.Errorf("read achievements: %w", err)
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var providerGameID, achievementID, mode string
		if err := rows.Scan(&providerGameID, &achievementID, &mode); err != nil {
			return nil, fmt.Errorf("scan achievement: %w", err)
		}
		result = append(result, providerGameID+":"+achievementID+":"+mode)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate achievements: %w", err)
	}
	return result, nil
}

func (a *App) readLibrary(ctx context.Context, userID string) ([]LibraryItem, error) {
	return a.loadLibrary(ctx, userID)
}

func (a *App) applyProgress(ctx context.Context, principal Principal, command ProgressCommand) (CommandResult, error) {
	if a.db == nil {
		return CommandResult{}, problem(503, "database-unavailable")
	}
	if err := validateProgressShape(command); err != nil {
		return CommandResult{}, err
	}
	title, err := a.getTitle(ctx, command.TitleID)
	if err != nil {
		return CommandResult{}, err
	}
	if err := validateProgress(command, title); err != nil {
		return CommandResult{}, err
	}
	payloadHash, commandJSON, err := hashJSON(command)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode progress command: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResult{}, fmt.Errorf("begin progress command: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockCommand(ctx, tx, principal.UserID, command.CommandID); err != nil {
		return CommandResult{}, err
	}
	if result, found, err := findReceipt(ctx, tx, principal.UserID, command.CommandID, payloadHash); err != nil {
		return CommandResult{}, err
	} else if found {
		return result, nil
	}
	if command.Audience.Kind == "circle" {
		var owner string
		if err := tx.QueryRow(ctx, `SELECT owner_id::text FROM circles WHERE id=$1`, command.Audience.CircleID).Scan(&owner); err != nil || owner != principal.UserID {
			return CommandResult{}, forbidden("circle-unavailable")
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO library_entries(user_id,title_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, principal.UserID, command.TitleID); err != nil {
		return CommandResult{}, fmt.Errorf("initialize library entry: %w", err)
	}
	var currentVersion int64
	var currentState string
	err = tx.QueryRow(ctx, `SELECT version,state FROM library_entries WHERE user_id=$1 AND title_id=$2 FOR UPDATE`, principal.UserID, command.TitleID).Scan(&currentVersion, &currentState)
	if err != nil {
		return CommandResult{}, fmt.Errorf("lock library entry: %w", err)
	}
	if currentVersion != command.BaseVersion {
		return CommandResult{Status: "conflict", CommandID: command.CommandID, CurrentVersion: currentVersion}, nil
	}
	version := currentVersion + 1
	eventID := "event:" + command.CommandID
	occurredAt, _ := json.Marshal(command.OccurredAt)
	changeJSON, _ := json.Marshal(command.Change)
	if _, err := tx.Exec(ctx, `INSERT INTO progress_events(user_id,event_id,title_id,command_id,sequence,active,change,command,occurred_at,source) VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7::jsonb,$8::jsonb,'manual')`, principal.UserID, eventID, command.TitleID, command.CommandID, version, jsonText(changeJSON), jsonText(commandJSON), jsonText(occurredAt)); err != nil {
		return CommandResult{}, fmt.Errorf("record progress event: %w", err)
	}
	if err := applyChangeTx(ctx, tx, principal.UserID, command, version, currentState); err != nil {
		return CommandResult{}, err
	}
	result := CommandResult{Status: "accepted", CommandID: command.CommandID, Version: version, EventID: eventID}
	resultJSON, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, principal.UserID, command.CommandID, payloadHash, jsonText(resultJSON)); err != nil {
		return CommandResult{}, fmt.Errorf("save progress receipt: %w", err)
	}
	if command.Audience.Kind != "private" {
		if err := insertProgressActivity(ctx, tx, principal.UserID, command, eventID); err != nil {
			return CommandResult{}, err
		}
		_, _ = tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
	}
	if err := tx.Commit(ctx); err != nil {
		if cached, found, readErr := a.readReceipt(ctx, principal.UserID, command.CommandID, payloadHash); readErr == nil && found {
			return cached, nil
		}
		return CommandResult{}, fmt.Errorf("commit progress command: %w", err)
	}
	return result, nil
}

func validateProgressShape(command ProgressCommand) error {
	if len(command.CommandID) < 1 || len(command.CommandID) > 200 || strings.TrimSpace(command.TitleID) == "" || command.BaseVersion < 0 {
		return badRequest("invalid-progress-command")
	}
	if command.Rating != nil && (*command.Rating < 1 || *command.Rating > 10) {
		return badRequest("rating-range")
	}
	if command.Audience.Kind != "private" && command.Audience.Kind != "public" && command.Audience.Kind != "friends" && command.Audience.Kind != "circle" {
		return badRequest("invalid-audience")
	}
	if command.Audience.Kind == "circle" && command.Audience.CircleID == "" {
		return badRequest("invalid-audience")
	}
	switch command.OccurredAt.Precision {
	case "unknown":
	case "instant":
		if _, err := time.Parse(time.RFC3339Nano, command.OccurredAt.ISO); err != nil {
			return badRequest("invalid-occurred-at")
		}
	case "day":
		if _, err := time.Parse("2006-01-02", command.OccurredAt.Day); err != nil {
			return badRequest("invalid-occurred-at")
		}
	case "month":
		if _, err := time.Parse("2006-01", command.OccurredAt.Month); err != nil {
			return badRequest("invalid-occurred-at")
		}
	default:
		return badRequest("invalid-occurred-at")
	}
	if command.Change.TitleID != command.TitleID {
		return badRequest("title-mismatch")
	}
	if command.Change.Kind != "achievement" && (command.Change.RunID == "" || len(command.Change.RunID) > 200) {
		return badRequest("run-required")
	}
	return validateSpoilerShape(command.Spoiler)
}

func validateProgress(command ProgressCommand, title CatalogHit) error {
	if title.ID != command.TitleID {
		return badRequest("title-mismatch")
	}
	types := map[string]string{
		"movie-viewed": "movie", "episode-watched": "show", "episode-skipped": "show",
		"game-session": "game", "milestone": "game", "story-completed": "game", "achievement": "game",
	}
	if media, ok := types[command.Change.Kind]; ok && media != title.Media {
		return badRequest("media-mismatch")
	}
	if title.Media != "movie" && title.Media != "show" && title.Media != "game" {
		return badRequest("invalid-title-media")
	}
	if command.Change.Medium != "" && command.Change.Medium != title.Media {
		return badRequest("media-mismatch")
	}
	if command.Change.Kind == "episode-watched" || command.Change.Kind == "episode-skipped" {
		found := false
		for _, episode := range title.Episodes {
			found = found || episode.ID == command.Change.EpisodeID
		}
		if !found {
			return badRequest("unknown-episode")
		}
	}
	if command.Change.Kind == "game-session" {
		if command.Change.Minutes != nil && (*command.Change.Minutes < 0 || *command.Change.Minutes > 24*60) {
			return badRequest("minutes-range")
		}
		if command.Change.PlayedOn != "" {
			if _, err := time.Parse("2006-01-02", command.Change.PlayedOn); err != nil {
				return badRequest("invalid-played-on")
			}
		}
	}
	if command.Change.Kind == "achievement" && (command.Change.ProviderGameID == "" || command.Change.AchievementID == "") {
		return badRequest("invalid-achievement")
	}
	if err := validateSpoiler(command.Spoiler, title); err != nil {
		return err
	}
	return nil
}

func validateSpoilerShape(spoiler SpoilerScope) error {
	switch spoiler.Kind {
	case "none":
		return nil
	case "hidden":
		if spoiler.TitleID == "" {
			return badRequest("invalid-spoiler")
		}
	case "episodes":
		if spoiler.ShowID == "" || len(spoiler.RequiredEpisodeIDs) == 0 || len(spoiler.RequiredEpisodeIDs) > 100 {
			return badRequest("invalid-spoiler-episodes")
		}
	case "milestone":
		if spoiler.GameID == "" || len(spoiler.RequiredMilestoneIDs) == 0 || len(spoiler.RequiredMilestoneIDs) > 100 {
			return badRequest("invalid-spoiler-milestones")
		}
	default:
		return badRequest("invalid-spoiler")
	}
	return nil
}

func validateSpoiler(spoiler SpoilerScope, title CatalogHit) error {
	if err := validateSpoilerShape(spoiler); err != nil {
		return err
	}
	switch spoiler.Kind {
	case "none":
		return nil
	case "hidden":
		if spoiler.TitleID != title.ID {
			return badRequest("spoiler-title-mismatch")
		}
	case "episodes":
		if spoiler.ShowID != title.ID {
			return badRequest("spoiler-title-mismatch")
		}
		if title.Media != "show" {
			return badRequest("invalid-spoiler-episodes")
		}
		allowed := make(map[string]bool, len(title.Episodes))
		for _, episode := range title.Episodes {
			allowed[episode.ID] = true
		}
		for _, id := range spoiler.RequiredEpisodeIDs {
			if !allowed[id] {
				return badRequest("invalid-spoiler-episodes")
			}
		}
	case "milestone":
		if spoiler.GameID != title.ID {
			return badRequest("spoiler-title-mismatch")
		}
		if title.Media != "game" {
			return badRequest("invalid-spoiler-milestones")
		}
	}
	return nil
}

func applyChangeTx(ctx context.Context, tx pgx.Tx, userID string, command ProgressCommand, version int64, currentState string) error {
	change := command.Change
	state := currentState
	playedOn := any(nil)
	emulator := any(nil)
	if change.PlayedOn != "" {
		playedOn = change.PlayedOn
	}
	if change.Emulator != "" {
		emulator = change.Emulator
	}
	if change.Kind != "achievement" {
		if _, err := tx.Exec(ctx, `INSERT INTO library_runs(user_id,title_id,run_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, userID, command.TitleID, change.RunID); err != nil {
			return fmt.Errorf("initialize progress run: %w", err)
		}
	}
	switch change.Kind {
	case "movie-viewed":
		_, err := tx.Exec(ctx, `UPDATE library_runs SET movie_viewed=true WHERE user_id=$1 AND title_id=$2 AND run_id=$3`, userID, command.TitleID, change.RunID)
		state = "completed"
		if err != nil {
			return fmt.Errorf("record movie progress: %w", err)
		}
	case "episode-watched", "episode-skipped":
		status := "watched"
		if change.Kind == "episode-skipped" {
			status = "skipped"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO run_episode_progress(user_id,title_id,run_id,episode_id,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,title_id,run_id,episode_id) DO UPDATE SET status=EXCLUDED.status`, userID, command.TitleID, change.RunID, change.EpisodeID, status); err != nil {
			return fmt.Errorf("record episode progress: %w", err)
		}
		state = "active"
	case "game-session":
		minutes := 0
		if change.Minutes != nil {
			minutes = *change.Minutes
		}
		if _, err := tx.Exec(ctx, `UPDATE library_runs SET minutes=minutes+$4,played_on=COALESCE($5,played_on),emulator=COALESCE($6,emulator) WHERE user_id=$1 AND title_id=$2 AND run_id=$3`, userID, command.TitleID, change.RunID, minutes, playedOn, emulator); err != nil {
			return fmt.Errorf("record game session: %w", err)
		}
		state = "active"
	case "milestone":
		if change.MilestoneID == "" {
			return badRequest("milestone-required")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO run_milestones(user_id,title_id,run_id,milestone_id,label) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,title_id,run_id,milestone_id) DO UPDATE SET label=EXCLUDED.label`, userID, command.TitleID, change.RunID, change.MilestoneID, change.Label); err != nil {
			return fmt.Errorf("record milestone: %w", err)
		}
		state = "active"
	case "story-completed":
		if _, err := tx.Exec(ctx, `UPDATE library_runs SET story_completed=true WHERE user_id=$1 AND title_id=$2 AND run_id=$3`, userID, command.TitleID, change.RunID); err != nil {
			return fmt.Errorf("record story completion: %w", err)
		}
		state = "completed"
	case "session-started":
		if _, err := tx.Exec(ctx, `UPDATE library_runs SET session_active=true WHERE user_id=$1 AND title_id=$2 AND run_id=$3`, userID, command.TitleID, change.RunID); err != nil {
			return fmt.Errorf("start session: %w", err)
		}
		state = "active"
	case "session-ended":
		if _, err := tx.Exec(ctx, `UPDATE library_runs SET session_active=false WHERE user_id=$1 AND title_id=$2 AND run_id=$3`, userID, command.TitleID, change.RunID); err != nil {
			return fmt.Errorf("end session: %w", err)
		}
	case "achievement":
		mode := change.Mode
		if mode == "" {
			mode = "casual"
		}
		if mode != "casual" && mode != "hardcore" {
			return badRequest("invalid-achievement-mode")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO game_achievements(user_id,title_id,provider_game_id,achievement_id,mode) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, userID, command.TitleID, change.ProviderGameID, change.AchievementID, mode); err != nil {
			return fmt.Errorf("record achievement: %w", err)
		}
	default:
		return badRequest("invalid-progress-kind")
	}
	var rating any
	if command.Rating != nil {
		rating = *command.Rating
	}
	var liked any
	if command.Liked != nil {
		liked = *command.Liked
	}
	var note any
	if command.Note != nil {
		note = *command.Note
	}
	if _, err := tx.Exec(ctx, `UPDATE library_entries SET version=$3,state=$4,rating=COALESCE($5,rating),liked=COALESCE($6,liked),note=COALESCE($7,note),updated_at=now() WHERE user_id=$1 AND title_id=$2`, userID, command.TitleID, version, state, rating, liked, note); err != nil {
		return fmt.Errorf("update library entry: %w", err)
	}
	return nil
}

func insertProgressActivity(ctx context.Context, tx pgx.Tx, userID string, command ProgressCommand, eventID string) error {
	spoilerTitleID, required := spoilerColumns(command.Spoiler)
	spoilerIDs, _ := json.Marshal(required)
	occurred, _ := json.Marshal(command.OccurredAt)
	var rating any
	if command.Rating != nil {
		rating = *command.Rating
	}
	var note any
	if command.Note != nil {
		note = *command.Note
	}
	_, err := tx.Exec(ctx, `INSERT INTO activities(id,author_id,title_id,caption,note,rating,audience_kind,circle_id,spoiler_kind,spoiler_title_id,required_spoiler_ids,occurred_at,kind,progress_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,'progress',$1)`, eventID, userID, command.TitleID, caption(command.Change), note, rating, command.Audience.Kind, nullString(command.Audience.CircleID), command.Spoiler.Kind, nullString(spoilerTitleID), jsonText(spoilerIDs), jsonText(occurred))
	if err != nil {
		return fmt.Errorf("publish progress activity: %w", err)
	}
	return nil
}

func spoilerColumns(spoiler SpoilerScope) (string, []string) {
	switch spoiler.Kind {
	case "episodes":
		return spoiler.ShowID, spoiler.RequiredEpisodeIDs
	case "milestone":
		return spoiler.GameID, spoiler.RequiredMilestoneIDs
	case "hidden":
		return spoiler.TitleID, []string{}
	default:
		return "", []string{}
	}
}

func caption(change ProgressChange) string {
	switch change.Kind {
	case "movie-viewed":
		return "Watched a film"
	case "episode-watched":
		return "Watched an episode"
	case "episode-skipped":
		return "Skipped an episode"
	case "game-session":
		if change.Minutes != nil && *change.Minutes > 0 {
			return fmt.Sprintf("Played for %d minutes", *change.Minutes)
		}
		return "Logged a game session"
	case "story-completed":
		return "Completed the story"
	case "milestone":
		return change.Label
	case "achievement":
		return "Earned an achievement"
	case "session-started":
		if change.Medium == "game" {
			return "Started playing"
		}
		return "Started watching"
	case "session-ended":
		return "Ended a session"
	default:
		return "Shared progress"
	}
}

func hashJSON(value any) ([]byte, []byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, nil, err
	}
	hash := sha256.Sum256(encoded)
	return hash[:], encoded, nil
}

// QueryExecModeExec infers []byte as bytea, so JSONB parameters must be sent as
// text and explicitly cast to jsonb by the SQL statement.
func jsonText(value []byte) string {
	return string(value)
}

func lockCommand(ctx context.Context, tx pgx.Tx, userID, commandID string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, userID, commandID); err != nil {
		return fmt.Errorf("lock command: %w", err)
	}
	return nil
}

func findReceipt(ctx context.Context, tx pgx.Tx, userID, commandID string, payloadHash []byte) (CommandResult, bool, error) {
	var savedHash, raw []byte
	err := tx.QueryRow(ctx, `SELECT payload_hash,result FROM command_receipts WHERE user_id=$1 AND command_id=$2`, userID, commandID).Scan(&savedHash, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return CommandResult{}, false, nil
	}
	if err != nil {
		return CommandResult{}, false, fmt.Errorf("read command receipt: %w", err)
	}
	if !equalBytes(savedHash, payloadHash) {
		return CommandResult{}, false, conflict("command-payload-mismatch")
	}
	var result CommandResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return CommandResult{}, false, fmt.Errorf("decode command receipt: %w", err)
	}
	return result, true, nil
}

func (a *App) readReceipt(ctx context.Context, userID, commandID string, payloadHash []byte) (CommandResult, bool, error) {
	var savedHash, raw []byte
	err := a.db.QueryRow(ctx, `SELECT payload_hash,result FROM command_receipts WHERE user_id=$1 AND command_id=$2`, userID, commandID).Scan(&savedHash, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return CommandResult{}, false, nil
	}
	if err != nil {
		return CommandResult{}, false, fmt.Errorf("read command receipt: %w", err)
	}
	if !equalBytes(savedHash, payloadHash) {
		return CommandResult{}, false, conflict("command-payload-mismatch")
	}
	var result CommandResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return CommandResult{}, false, fmt.Errorf("decode command receipt: %w", err)
	}
	return result, true, nil
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var difference byte
	for i := range a {
		difference |= a[i] ^ b[i]
	}
	return difference == 0
}

type CorrectionCommand struct {
	CommandID   string          `json:"commandId"`
	EventID     string          `json:"eventId"`
	BaseVersion int64           `json:"baseVersion"`
	Retract     bool            `json:"retract"`
	Replacement *ProgressChange `json:"replacement,omitempty"`
}

func (a *App) correctProgress(ctx context.Context, p Principal, command CorrectionCommand) (CommandResult, error) {
	if command.CommandID == "" || command.EventID == "" || command.BaseVersion < 0 {
		return CommandResult{}, badRequest("invalid-correction")
	}
	payloadHash, payload, err := hashJSON(command)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode correction: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResult{}, fmt.Errorf("begin correction: %w", err)
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
	var titleID string
	var oldCommandRaw []byte
	var oldSequence int64
	err = tx.QueryRow(ctx, `SELECT title_id,command,sequence FROM progress_events WHERE user_id=$1 AND event_id=$2 FOR UPDATE`, p.UserID, command.EventID).Scan(&titleID, &oldCommandRaw, &oldSequence)
	if err == pgx.ErrNoRows {
		return CommandResult{}, notFound("progress-event-not-found")
	}
	if err != nil {
		return CommandResult{}, fmt.Errorf("load progress event: %w", err)
	}
	var currentVersion int64
	err = tx.QueryRow(ctx, `SELECT version FROM library_entries WHERE user_id=$1 AND title_id=$2 FOR UPDATE`, p.UserID, titleID).Scan(&currentVersion)
	if err != nil {
		return CommandResult{}, fmt.Errorf("lock corrected library: %w", err)
	}
	if currentVersion != command.BaseVersion {
		return CommandResult{Status: "conflict", CommandID: command.CommandID, CurrentVersion: currentVersion}, nil
	}
	var eventCommand ProgressCommand
	if err := json.Unmarshal(oldCommandRaw, &eventCommand); err != nil {
		return CommandResult{}, fmt.Errorf("decode progress event command: %w", err)
	}
	if command.Replacement != nil {
		updated := eventCommand
		updated.Change = *command.Replacement
		if err := validateProgressShape(updated); err != nil {
			return CommandResult{}, err
		}
		title, err := a.getTitle(ctx, titleID)
		if err != nil {
			return CommandResult{}, err
		}
		if err := validateProgress(updated, title); err != nil {
			return CommandResult{}, err
		}
		eventCommand = updated
	}
	updatedCommand, _ := json.Marshal(eventCommand)
	updatedChange, _ := json.Marshal(eventCommand.Change)
	active := !command.Retract
	if _, err := tx.Exec(ctx, `UPDATE progress_events SET active=$3,command=$4::jsonb,change=$5::jsonb WHERE user_id=$1 AND event_id=$2`, p.UserID, command.EventID, active, jsonText(updatedCommand), jsonText(updatedChange)); err != nil {
		return CommandResult{}, fmt.Errorf("update progress event: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO progress_corrections(user_id,correction_id,target_event_id,command_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)`, p.UserID, "correction:"+command.CommandID, command.EventID, command.CommandID, jsonText(payload)); err != nil {
		return CommandResult{}, fmt.Errorf("record correction: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM library_runs WHERE user_id=$1 AND title_id=$2`, p.UserID, titleID); err != nil {
		return CommandResult{}, fmt.Errorf("clear runs for replay: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM game_achievements WHERE user_id=$1 AND title_id=$2`, p.UserID, titleID); err != nil {
		return CommandResult{}, fmt.Errorf("clear achievements for replay: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE library_entries SET state='planned',rating=NULL,liked=NULL,note=NULL,owned=NULL,archived=NULL,played_on=NULL,emulator=NULL WHERE user_id=$1 AND title_id=$2`, p.UserID, titleID); err != nil {
		return CommandResult{}, fmt.Errorf("reset library for replay: %w", err)
	}
	events, err := tx.Query(ctx, `
		SELECT sequence,'progress'::text AS kind,command AS payload FROM progress_events WHERE user_id=$1 AND title_id=$2 AND active
		UNION ALL
		SELECT sequence,'edit'::text AS kind,patch AS payload FROM library_edit_events WHERE user_id=$1 AND title_id=$2
		ORDER BY sequence`, p.UserID, titleID)
	if err != nil {
		return CommandResult{}, fmt.Errorf("read progress events for replay: %w", err)
	}
	type replayItem struct {
		command  ProgressCommand
		patch    []byte
		kind     string
		sequence int64
	}
	replay := make([]replayItem, 0)
	for events.Next() {
		var raw []byte
		var sequence int64
		var kind string
		if err := events.Scan(&sequence, &kind, &raw); err != nil {
			events.Close()
			return CommandResult{}, fmt.Errorf("scan replay event: %w", err)
		}
		item := replayItem{kind: kind, sequence: sequence}
		if kind == "progress" {
			if err := json.Unmarshal(raw, &item.command); err != nil {
				events.Close()
				return CommandResult{}, fmt.Errorf("decode replay event: %w", err)
			}
		} else {
			item.patch = append([]byte(nil), raw...)
		}
		replay = append(replay, item)
	}
	if err := events.Err(); err != nil {
		events.Close()
		return CommandResult{}, fmt.Errorf("iterate replay events: %w", err)
	}
	events.Close()
	state := "planned"
	for _, item := range replay {
		if item.kind == "progress" {
			if err := applyChangeTx(ctx, tx, p.UserID, item.command, item.sequence, state); err != nil {
				return CommandResult{}, err
			}
			if item.command.Change.Kind == "movie-viewed" || item.command.Change.Kind == "story-completed" {
				state = "completed"
			} else if item.command.Change.Kind != "session-ended" && item.command.Change.Kind != "achievement" {
				state = "active"
			}
		} else {
			patch, err := decodePatch(item.patch)
			if err != nil {
				return CommandResult{}, err
			}
			if err := applyLibraryPatchTx(ctx, tx, p.UserID, titleID, patch, item.sequence); err != nil {
				return CommandResult{}, err
			}
			if patch.State != nil {
				state = *patch.State
			}
		}
	}
	version := currentVersion + 1
	if _, err := tx.Exec(ctx, `UPDATE library_entries SET version=$3,updated_at=now() WHERE user_id=$1 AND title_id=$2`, p.UserID, titleID, version); err != nil {
		return CommandResult{}, fmt.Errorf("finish correction replay: %w", err)
	}
	result := CommandResult{Status: "accepted", CommandID: command.CommandID, Version: version, EventID: "correction:" + command.CommandID}
	resultJSON, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, p.UserID, command.CommandID, payloadHash, jsonText(resultJSON)); err != nil {
		return CommandResult{}, fmt.Errorf("save correction receipt: %w", err)
	}
	var hasActivity bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM activities WHERE id=$1)`, command.EventID).Scan(&hasActivity); err != nil {
		return CommandResult{}, fmt.Errorf("check corrected activity: %w", err)
	}
	if hasActivity {
		if _, err := tx.Exec(ctx, `UPDATE activities SET retracted=$2,caption=$3,version=version+1 WHERE id=$1`, command.EventID, command.Retract, caption(eventCommand.Change)); err != nil {
			return CommandResult{}, fmt.Errorf("update corrected activity: %w", err)
		}
		_, _ = tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`)
	}
	if err := tx.Commit(ctx); err != nil {
		return CommandResult{}, fmt.Errorf("commit correction: %w", err)
	}
	_ = oldSequence
	return result, nil
}
