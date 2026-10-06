package connections

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type observationConfirmation struct {
	TitleID   string          `json:"titleId"`
	Media     string          `json:"media"`
	EpisodeID string          `json:"episodeId,omitempty"`
	Date      string          `json:"date,omitempty"`
	Command   json.RawMessage `json:"command"`
}

func (h *Handler) confirmObservation(w http.ResponseWriter, r *http.Request, user, observationID string) {
	var in struct {
		TitleID   string `json:"titleId"`
		Media     string `json:"media"`
		EpisodeID string `json:"episodeId"`
		Date      string `json:"date"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || strings.TrimSpace(in.TitleID) == "" || (in.Media != "movie" && in.Media != "show" && in.Media != "game") {
		problem(w, http.StatusBadRequest, "invalid-confirmation")
		return
	}
	if in.Media == "show" && in.EpisodeID == "" {
		problem(w, http.StatusBadRequest, "episode-required")
		return
	}
	if in.Date != "" {
		if _, err := time.Parse("2006-01-02", in.Date); err != nil {
			problem(w, http.StatusBadRequest, "invalid-date")
			return
		}
	}
	if h.cfg.LoadVersion == nil || h.cfg.ApplyProgress == nil && h.cfg.ApplyLibrary == nil {
		problem(w, http.StatusServiceUnavailable, "progress-unavailable")
		return
	}
	ctx := r.Context()
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		problem(w, http.StatusInternalServerError, "read-failed")
		return
	}
	defer tx.Rollback(ctx)
	var source, status string
	var payload json.RawMessage
	if err = tx.QueryRow(ctx, `SELECT source,status,payload FROM connector_observations WHERE id=$1 AND user_id=$2 FOR UPDATE`, observationID, user).Scan(&source, &status, &payload); err != nil {
		problem(w, http.StatusNotFound, "observation-not-found")
		return
	}
	if status == "confirmed" {
		if tx.Commit(ctx) != nil {
			problem(w, http.StatusInternalServerError, "read-failed")
			return
		}
		output(w, http.StatusOK, map[string]string{"id": observationID, "status": "confirmed"})
		return
	}
	apply := h.cfg.ApplyProgress
	if source == "steam-manual" {
		apply = h.cfg.ApplyLibrary
	}
	if apply == nil {
		problem(w, http.StatusServiceUnavailable, "progress-unavailable")
		return
	}
	var capture map[string]json.RawMessage
	if err = json.Unmarshal(payload, &capture); err != nil {
		problem(w, http.StatusInternalServerError, "invalid-observation")
		return
	}
	var confirmation observationConfirmation
	if status == "confirming" {
		if err = json.Unmarshal(capture["confirmation"], &confirmation); err != nil || confirmation.TitleID != in.TitleID || confirmation.Media != in.Media || confirmation.EpisodeID != in.EpisodeID || confirmation.Date != in.Date {
			problem(w, http.StatusConflict, "confirmation-in-progress")
			return
		}
	} else {
		version, versionErr := h.cfg.LoadVersion(ctx, user, in.TitleID)
		if versionErr != nil || version < 0 {
			problem(w, http.StatusServiceUnavailable, "library-version-unavailable")
			return
		}
		command, commandErr := h.observationCommand(source, observationID, in.TitleID, in.Media, in.EpisodeID, in.Date, version)
		if commandErr != nil {
			if errors.Is(commandErr, errObservationEpisodeRequired) {
				problem(w, http.StatusBadRequest, "episode-required")
			} else {
				problem(w, http.StatusBadRequest, "invalid-observation-action")
			}
			return
		}
		confirmation = observationConfirmation{TitleID: in.TitleID, Media: in.Media, EpisodeID: in.EpisodeID, Date: in.Date, Command: command}
		capture["confirmation"], _ = json.Marshal(confirmation)
		payload, _ = json.Marshal(capture)
		if _, err = tx.Exec(ctx, `UPDATE connector_observations SET status='confirming',payload=$3::jsonb WHERE id=$1 AND user_id=$2`, observationID, user, string(payload)); err != nil {
			problem(w, http.StatusInternalServerError, "write-failed")
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		problem(w, http.StatusInternalServerError, "write-failed")
		return
	}
	result, applyErr := apply(ctx, user, confirmation.Command)
	if applyErr != nil {
		problem(w, http.StatusServiceUnavailable, "confirmation-pending")
		return
	}
	var response struct {
		Status string `json:"status"`
		Code   string `json:"code"`
	}
	if json.Unmarshal(result, &response) != nil {
		problem(w, http.StatusServiceUnavailable, "confirmation-pending")
		return
	}
	if response.Status == "conflict" || response.Status == "rejected" {
		_, _ = h.db.Exec(ctx, `UPDATE connector_observations SET status='needs-review',payload=payload-'confirmation' WHERE id=$1 AND user_id=$2 AND status='confirming'`, observationID, user)
		problem(w, http.StatusConflict, safeImportOutcome(response.Code))
		return
	}
	if response.Status != "accepted" {
		problem(w, http.StatusServiceUnavailable, "confirmation-pending")
		return
	}
	if _, err = h.db.Exec(ctx, `UPDATE connector_observations SET status='confirmed' WHERE id=$1 AND user_id=$2 AND status='confirming'`, observationID, user); err != nil {
		problem(w, http.StatusServiceUnavailable, "confirmation-pending")
		return
	}
	output(w, http.StatusOK, map[string]string{"id": observationID, "status": "confirmed"})
}

var errObservationEpisodeRequired = errors.New("episode required")

func (h *Handler) observationCommand(source, observationID, titleID, media, episodeID, date string, version int64) (json.RawMessage, error) {
	if source == "steam-manual" {
		if media != "game" {
			return nil, fmt.Errorf("Steam observations require game titles")
		}
	}
	if media == "show" && episodeID == "" {
		return nil, errObservationEpisodeRequired
	}
	identity, _ := json.Marshal(map[string]string{"source": source, "titleId": titleID, "media": media, "episodeId": episodeID, "date": date})
	hash := sha256.Sum256(append([]byte(observationID+":"), identity...))
	commandID := "observation:" + hex.EncodeToString(hash[:])
	if source == "steam-manual" {
		command := map[string]any{"commandId": commandID, "titleId": titleID, "baseVersion": version, "patch": map[string]any{"owned": true}}
		return json.Marshal(command)
	}
	change := map[string]any{"kind": "movie-viewed", "titleId": titleID, "runId": commandID}
	switch media {
	case "movie":
		change["kind"] = "movie-viewed"
	case "show":
		change["kind"] = "episode-watched"
		change["episodeId"] = episodeID
	case "game":
		change["kind"] = "game-session"
		change["minutes"] = 0
	default:
		return nil, fmt.Errorf("unsupported observation media")
	}
	occurredAt := map[string]string{"precision": "unknown"}
	if date != "" {
		occurredAt = map[string]string{"precision": "day", "day": date}
	}
	command := map[string]any{"commandId": commandID, "titleId": titleID, "baseVersion": version, "change": change, "occurredAt": occurredAt, "audience": map[string]string{"kind": "private"}, "spoiler": map[string]string{"kind": "none"}}
	return json.Marshal(command)
}
