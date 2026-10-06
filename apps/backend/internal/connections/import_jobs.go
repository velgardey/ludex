package connections

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"ludex/backend/internal/jobs"
)

const importCommitJobKind = "import-commit"

type importJobPayload struct {
	BatchID string `json:"batchId"`
}

type importJobStatus struct {
	JobID     string      `json:"jobId"`
	Status    string      `json:"status"`
	Accepted  int         `json:"accepted"`
	Remaining int         `json:"remaining"`
	Rows      []ImportRow `json:"rows"`
}

// WorkHandlers returns the connection jobs understood by this handler. The
// application worker should pass this map to jobs.Run.
func (h *Handler) WorkHandlers() map[string]jobs.Handler {
	return map[string]jobs.Handler{importCommitJobKind: h.runImportCommit}
}

func (h *Handler) matchImportRow(w http.ResponseWriter, r *http.Request, user, batchID, rowID string) {
	var in struct {
		TitleID   string `json:"titleId"`
		EpisodeID string `json:"episodeId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		problem(w, http.StatusBadRequest, "invalid-import-match")
		return
	}
	in.TitleID = strings.TrimSpace(in.TitleID)
	in.EpisodeID = strings.TrimSpace(in.EpisodeID)
	if len(in.TitleID) > 200 || len(in.EpisodeID) > 200 {
		problem(w, http.StatusBadRequest, "invalid-import-match")
		return
	}
	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		problem(w, http.StatusInternalServerError, "write-failed")
		return
	}
	defer tx.Rollback(r.Context())
	var batchStatus string
	var body json.RawMessage
	if err = tx.QueryRow(r.Context(), `SELECT status,rows FROM import_batches WHERE id=$1 AND user_id=$2 FOR UPDATE`, batchID, user).Scan(&batchStatus, &body); err != nil {
		problem(w, http.StatusNotFound, "import-not-found")
		return
	}
	if batchStatus != "preview" && batchStatus != "partial" {
		problem(w, http.StatusConflict, "import-not-editable")
		return
	}
	var rows []ImportRow
	if err = json.Unmarshal(body, &rows); err != nil {
		problem(w, http.StatusInternalServerError, "invalid-saved-import")
		return
	}
	index := -1
	for i := range rows {
		if rows[i].ID == rowID {
			index = i
			break
		}
	}
	if index < 0 {
		problem(w, http.StatusNotFound, "import-row-not-found")
		return
	}
	row := rows[index]
	if row.Status != "needs-match" && row.Status != "matched" && row.Status != "needs-episode" {
		problem(w, http.StatusConflict, "import-row-not-matchable")
		return
	}
	titleID := in.TitleID
	if titleID == "" {
		titleID = row.MatchedTitleID
	}
	if titleID == "" || !validImportTitleID(titleID, row.Media) {
		problem(w, http.StatusBadRequest, "import-title-media-mismatch")
		return
	}
	if row.Media != "show" && in.EpisodeID != "" {
		problem(w, http.StatusBadRequest, "episode-not-supported")
		return
	}
	needsEpisode := row.EpisodeTitle != "" || row.EpisodeID != "" || row.Status == "needs-episode"
	if titleID != row.MatchedTitleID {
		row.EpisodeID = ""
	}
	row.MatchedTitleID = titleID
	if in.EpisodeID != "" {
		row.EpisodeID = in.EpisodeID
	}
	if row.Media == "show" && row.EpisodeID != "" {
		if h.cfg.EpisodeExists == nil {
			problem(w, http.StatusServiceUnavailable, "episode-validation-unavailable")
			return
		}
		exists, err := h.cfg.EpisodeExists(r.Context(), row.MatchedTitleID, row.EpisodeID)
		if err != nil {
			problem(w, http.StatusServiceUnavailable, "episode-validation-unavailable")
			return
		}
		if !exists {
			problem(w, http.StatusBadRequest, "unknown-episode")
			return
		}
	}
	row.Status = "matched"
	if row.Media == "show" && needsEpisode && row.EpisodeID == "" {
		row.Status = "needs-episode"
	}
	row.Outcome = ""
	row.BaseVersion = nil
	rows[index] = row
	encoded, err := json.Marshal(rows)
	if err != nil {
		problem(w, http.StatusInternalServerError, "write-failed")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
		problem(w, http.StatusInternalServerError, "write-failed")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		problem(w, http.StatusInternalServerError, "write-failed")
		return
	}
	result := map[string]string{"id": row.ID, "status": row.Status, "matchedTitleId": row.MatchedTitleID}
	if row.EpisodeID != "" {
		result["episodeId"] = row.EpisodeID
	}
	output(w, http.StatusOK, result)
}

func validImportTitleID(id, media string) bool {
	parts := strings.Split(id, ":")
	return len(parts) == 3 && parts[0] != "" && parts[1] == media && parts[2] != "" && !strings.ContainsAny(id, " \t\r\n")
}

func (h *Handler) queueImport(w http.ResponseWriter, r *http.Request, user, batchID string) {
	if h.cfg.LoadVersion == nil {
		problem(w, http.StatusServiceUnavailable, "library-version-unavailable")
		return
	}
	ctx := r.Context()
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		problem(w, http.StatusInternalServerError, "queue-failed")
		return
	}
	defer tx.Rollback(ctx)
	var batchStatus string
	if err = tx.QueryRow(ctx, `SELECT status FROM import_batches WHERE id=$1 AND user_id=$2 FOR UPDATE`, batchID, user).Scan(&batchStatus); err != nil {
		problem(w, http.StatusNotFound, "import-not-found")
		return
	}
	var jobID, jobState string
	if err = tx.QueryRow(ctx, `SELECT id,state FROM work_jobs WHERE user_id=$1 AND kind=$2 AND payload->>'batchId'=$3 AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`, user, importCommitJobKind, batchID).Scan(&jobID, &jobState); err == nil {
		if err = tx.Commit(ctx); err != nil {
			problem(w, http.StatusInternalServerError, "queue-failed")
			return
		}
		output(w, http.StatusAccepted, map[string]any{"jobId": jobID, "status": jobState, "pollUrl": "/api/imports/jobs/" + jobID})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem(w, http.StatusInternalServerError, "queue-failed")
		return
	}
	if batchStatus == "completed" {
		if err = tx.QueryRow(ctx, `SELECT id FROM work_jobs WHERE user_id=$1 AND kind=$2 AND payload->>'batchId'=$3 ORDER BY created_at DESC LIMIT 1`, user, importCommitJobKind, batchID).Scan(&jobID); err != nil {
			problem(w, http.StatusInternalServerError, "job-not-found")
			return
		}
		if err = tx.Commit(ctx); err != nil {
			problem(w, http.StatusInternalServerError, "queue-failed")
			return
		}
		output(w, http.StatusOK, map[string]any{"jobId": jobID, "status": "completed", "pollUrl": "/api/imports/jobs/" + jobID})
		return
	}
	jobID = uuid.NewString()
	payload, _ := json.Marshal(importJobPayload{BatchID: batchID})
	if _, err = tx.Exec(ctx, `INSERT INTO work_jobs(id,user_id,kind,payload) VALUES($1,$2,$3,$4::jsonb)`, jobID, user, importCommitJobKind, string(payload)); err != nil {
		problem(w, http.StatusInternalServerError, "queue-failed")
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE import_batches SET status='queued',committed_at=NULL WHERE id=$1 AND user_id=$2`, batchID, user); err != nil {
		problem(w, http.StatusInternalServerError, "queue-failed")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		problem(w, http.StatusInternalServerError, "queue-failed")
		return
	}
	output(w, http.StatusAccepted, map[string]any{"jobId": jobID, "status": "queued", "pollUrl": "/api/imports/jobs/" + jobID})
}

func (h *Handler) importJobStatus(w http.ResponseWriter, r *http.Request, user, jobID string) {
	var state, batchStatus string
	var body json.RawMessage
	err := h.db.QueryRow(r.Context(), `
		SELECT j.state,b.status,b.rows
		FROM work_jobs j
		JOIN import_batches b ON b.id=j.payload->>'batchId' AND b.user_id=j.user_id
		WHERE j.id=$1 AND j.user_id=$2 AND j.kind=$3`, jobID, user, importCommitJobKind).Scan(&state, &batchStatus, &body)
	if err != nil {
		problem(w, http.StatusNotFound, "job-not-found")
		return
	}
	var rows []ImportRow
	if err = json.Unmarshal(body, &rows); err != nil {
		problem(w, http.StatusInternalServerError, "invalid-saved-import")
		return
	}
	accepted := 0
	for _, row := range rows {
		if row.Status == "accepted" {
			accepted++
		}
	}
	status := state
	switch state {
	case "done":
		if batchStatus == "completed" {
			status = "completed"
		} else {
			status = "partial"
		}
	case "running", "queued", "failed":
	default:
		status = "failed"
	}
	output(w, http.StatusOK, importJobStatus{JobID: jobID, Status: status, Accepted: accepted, Remaining: len(rows) - accepted, Rows: rows})
}

func (h *Handler) runImportCommit(ctx context.Context, job jobs.Job) error {
	var payload importJobPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil || payload.BatchID == "" || job.UserID == "" {
		return errors.New("invalid import job")
	}
	if h.cfg.LoadVersion == nil {
		return errors.New("library version callback unavailable")
	}
	if _, err := h.db.Exec(ctx, `UPDATE import_batches SET status='running' WHERE id=$1 AND user_id=$2`, payload.BatchID, job.UserID); err != nil {
		return fmt.Errorf("start import batch: %w", err)
	}
	rows, err := h.readImportRows(ctx, job.UserID, payload.BatchID)
	if err != nil {
		return err
	}
	for _, original := range rows {
		if original.Status == "accepted" || original.Status == "needs-match" || original.Status == "needs-episode" || original.Status == "conflict" {
			continue
		}
		row, skip, err := h.prepareImportRow(ctx, job.UserID, payload.BatchID, original.ID)
		if err != nil {
			return err
		}
		if skip {
			continue
		}
		raw, callback, outcome, err := h.importCommand(payload.BatchID, row)
		if err != nil {
			row.Status = "failed"
			row.Outcome = "command-unavailable"
			if persistErr := h.persistImportRow(ctx, job.UserID, payload.BatchID, row); persistErr != nil {
				return persistErr
			}
			continue
		}
		result, applyErr := callback(ctx, job.UserID, raw)
		status := ""
		code := ""
		if applyErr == nil {
			var response struct {
				Status string `json:"status"`
				Code   string `json:"code"`
			}
			if json.Unmarshal(result, &response) == nil {
				status, code = response.Status, response.Code
			}
		}
		switch status {
		case "accepted":
			row.Status, row.Outcome = "accepted", outcome
		case "conflict":
			row.Status, row.Outcome = "conflict", "library-version-conflict"
		case "rejected":
			row.Status, row.Outcome = "failed", "apply-failed"
			if code == "episode-evidence-required" || code == "unknown-episode" {
				row.Status, row.Outcome = "needs-episode", "episode-evidence-required"
			} else if code != "" {
				row.Outcome = safeImportOutcome(code)
			}
		default:
			row.Status, row.Outcome = "failed", "apply-failed"
			if applyErr != nil {
				row.Outcome = "apply-failed"
			} else if code != "" {
				row.Outcome = safeImportOutcome(code)
			}
		}
		if err := h.persistImportRow(ctx, job.UserID, payload.BatchID, row); err != nil {
			return err
		}
	}
	rows, err = h.readImportRows(ctx, job.UserID, payload.BatchID)
	if err != nil {
		return err
	}
	completed := true
	for _, row := range rows {
		completed = completed && row.Status == "accepted"
	}
	status := "partial"
	if completed {
		status = "completed"
	}
	if _, err := h.db.Exec(ctx, `UPDATE import_batches SET status=$3,committed_at=now() WHERE id=$1 AND user_id=$2`, payload.BatchID, job.UserID, status); err != nil {
		return fmt.Errorf("finish import batch: %w", err)
	}
	return nil
}

func (h *Handler) prepareImportRow(ctx context.Context, user, batchID, rowID string) (ImportRow, bool, error) {
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ImportRow{}, false, err
	}
	defer tx.Rollback(ctx)
	var body json.RawMessage
	if err := tx.QueryRow(ctx, `SELECT rows FROM import_batches WHERE id=$1 AND user_id=$2 FOR UPDATE`, batchID, user).Scan(&body); err != nil {
		return ImportRow{}, false, err
	}
	var rows []ImportRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return ImportRow{}, false, fmt.Errorf("decode saved import: %w", err)
	}
	index := -1
	for i := range rows {
		if rows[i].ID == rowID {
			index = i
			break
		}
	}
	if index < 0 {
		return ImportRow{}, true, nil
	}
	row := rows[index]
	if row.Status == "accepted" || row.Status == "needs-match" || row.Status == "needs-episode" || row.Status == "conflict" {
		return row, true, nil
	}
	if row.MatchedTitleID == "" {
		row.Status, row.Outcome = "needs-match", "title-match-required"
		rows[index] = row
		encoded, _ := json.Marshal(rows)
		if _, err = tx.Exec(ctx, `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
			return ImportRow{}, false, err
		}
		return row, true, tx.Commit(ctx)
	}
	if row.Media == "show" && row.EpisodeTitle != "" && row.EpisodeID == "" {
		row.Status, row.Outcome = "needs-episode", "episode-id-required"
		rows[index] = row
		encoded, _ := json.Marshal(rows)
		if _, err = tx.Exec(ctx, `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
			return ImportRow{}, false, err
		}
		return row, true, tx.Commit(ctx)
	}
	if row.Media == "show" && row.State == "completed" && row.EpisodeID == "" {
		row.Status, row.Outcome = "needs-episode", "complete-episode-evidence-required"
		rows[index] = row
		encoded, _ := json.Marshal(rows)
		if _, err = tx.Exec(ctx, `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
			return ImportRow{}, false, err
		}
		return row, true, tx.Commit(ctx)
	}
	if row.BaseVersion == nil {
		version, versionErr := h.cfg.LoadVersion(ctx, user, row.MatchedTitleID)
		if versionErr != nil || version < 0 {
			row.Status, row.Outcome = "failed", "library-version-unavailable"
		} else {
			row.BaseVersion = &version
		}
		rows[index] = row
		encoded, _ := json.Marshal(rows)
		if _, err = tx.Exec(ctx, `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
			return ImportRow{}, false, err
		}
		if err = tx.Commit(ctx); err != nil {
			return ImportRow{}, false, err
		}
		if versionErr != nil || version < 0 {
			return row, true, nil
		}
	} else if err = tx.Commit(ctx); err != nil {
		return ImportRow{}, false, err
	}
	return row, false, nil
}

func (h *Handler) importCommand(batchID string, row ImportRow) (json.RawMessage, func(context.Context, string, json.RawMessage) (json.RawMessage, error), string, error) {
	if row.BaseVersion == nil {
		return nil, nil, "", errors.New("missing base version")
	}
	commandID := "import:" + batchID + ":" + row.ID
	if row.Media == "show" && row.EpisodeID == "" ||
		(row.Media == "movie" || row.Media == "game") && (row.State != "" || row.Date == "" && row.PlayedOn == "") {
		if h.cfg.ApplyLibrary == nil {
			return nil, nil, "", errors.New("library edit callback unavailable")
		}
		state := row.State
		if state == "" {
			if row.Media == "show" {
				state = "active"
			} else {
				state = "planned"
			}
		}
		patch := map[string]any{"state": state}
		if row.Media == "game" {
			playedOn := row.PlayedOn
			if playedOn == "" {
				playedOn = row.Date
			}
			if playedOn != "" {
				patch["playedOn"] = playedOn
			}
			if row.Emulator != "" {
				patch["emulator"] = row.Emulator
			}
		}
		if row.Rating > 0 {
			patch["rating"] = row.Rating
		}
		if row.Note != "" {
			patch["note"] = row.Note
		}
		raw, err := json.Marshal(map[string]any{"commandId": commandID, "titleId": row.MatchedTitleID, "baseVersion": *row.BaseVersion, "patch": patch})
		return raw, h.cfg.ApplyLibrary, "library-updated", err
	}
	if h.cfg.ApplyProgress == nil {
		return nil, nil, "", errors.New("progress callback unavailable")
	}
	change := map[string]any{"titleId": row.MatchedTitleID, "runId": commandID}
	switch row.Media {
	case "movie":
		change["kind"] = "movie-viewed"
	case "show":
		change["kind"] = "episode-watched"
		change["episodeId"] = row.EpisodeID
	case "game":
		change["kind"] = "game-session"
		change["minutes"] = 0
		if row.PlayedOn != "" {
			change["playedOn"] = row.PlayedOn
		}
		if row.Emulator != "" {
			change["emulator"] = row.Emulator
		}
	default:
		return nil, nil, "", errors.New("unsupported media")
	}
	date := map[string]string{"precision": "unknown"}
	occurredOn := row.Date
	if occurredOn == "" && row.Media == "game" {
		occurredOn = row.PlayedOn
	}
	if occurredOn != "" {
		date = map[string]string{"precision": "day", "day": occurredOn}
	}
	command := map[string]any{"commandId": commandID, "titleId": row.MatchedTitleID, "baseVersion": *row.BaseVersion, "change": change, "occurredAt": date, "audience": map[string]string{"kind": "private"}, "spoiler": map[string]string{"kind": "none"}}
	if row.Rating > 0 {
		command["rating"] = row.Rating
	}
	if row.Note != "" {
		command["note"] = row.Note
	}
	raw, err := json.Marshal(command)
	return raw, h.cfg.ApplyProgress, "progress-recorded", err
}

func (h *Handler) readImportRows(ctx context.Context, user, batchID string) ([]ImportRow, error) {
	var body json.RawMessage
	if err := h.db.QueryRow(ctx, `SELECT rows FROM import_batches WHERE id=$1 AND user_id=$2`, batchID, user).Scan(&body); err != nil {
		return nil, err
	}
	var rows []ImportRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("decode saved import: %w", err)
	}
	return rows, nil
}

func (h *Handler) persistImportRow(ctx context.Context, user, batchID string, updated ImportRow) error {
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var body json.RawMessage
	if err := tx.QueryRow(ctx, `SELECT rows FROM import_batches WHERE id=$1 AND user_id=$2 FOR UPDATE`, batchID, user).Scan(&body); err != nil {
		return err
	}
	var rows []ImportRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return fmt.Errorf("decode saved import: %w", err)
	}
	found := false
	for i := range rows {
		if rows[i].ID == updated.ID {
			rows[i].Status = updated.Status
			rows[i].Outcome = updated.Outcome
			rows[i].BaseVersion = updated.BaseVersion
			found = true
			break
		}
	}
	if !found {
		return errors.New("import row not found")
	}
	encoded, _ := json.Marshal(rows)
	if _, err := tx.Exec(ctx, `UPDATE import_batches SET rows=$3::jsonb WHERE id=$1 AND user_id=$2`, batchID, user, string(encoded)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func safeImportOutcome(code string) string {
	code = strings.ToLower(code)
	if code == "episode-evidence-required" || code == "unknown-episode" {
		return "episode-evidence-required"
	}
	if len(code) > 80 {
		return "apply-failed"
	}
	for _, r := range code {
		if !(r == '-' || r == '_' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') {
			return "apply-failed"
		}
	}
	return code
}
