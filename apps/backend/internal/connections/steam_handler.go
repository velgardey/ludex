package connections

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) previewSteam(w http.ResponseWriter, r *http.Request, user string) {
	var in struct {
		SteamID64 string `json:"steamId64"`
		Offset    int    `json:"offset"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		problem(w, http.StatusBadRequest, "invalid-steam-id")
		return
	}
	if in.Offset < 0 || in.Offset > 10000 {
		problem(w, http.StatusBadRequest, "invalid-steam-offset")
		return
	}
	client := SteamClient{Key: h.cfg.SteamKey, BaseURL: h.cfg.SteamBaseURL, HTTP: h.cfg.SteamHTTP}
	games, err := client.OwnedGames(r.Context(), in.SteamID64)
	if err != nil {
		if strings.Contains(err.Error(), "not configured") {
			problem(w, http.StatusServiceUnavailable, "steam-not-configured")
		} else if strings.Contains(err.Error(), "invalid SteamID64") {
			problem(w, http.StatusBadRequest, "invalid-steam-id")
		} else {
			problem(w, http.StatusBadGateway, "steam-library-unavailable")
		}
		return
	}
	if in.Offset > len(games) {
		in.Offset = len(games)
	}
	end := min(in.Offset+100, len(games))
	items := make([]map[string]any, 0, end-in.Offset)
	for _, game := range games[in.Offset:end] {
		if strings.TrimSpace(game.Name) == "" {
			continue
		}
		providerRecord := in.SteamID64 + ":" + strconv.Itoa(game.AppID)
		payload, _ := json.Marshal(map[string]any{
			"title": game.Name, "steamId64": in.SteamID64, "appId": game.AppID, "minutes": game.Minutes,
		})
		id := uuid.NewString()
		observationStatus := "needs-review"
		err := h.db.QueryRow(r.Context(), `
			INSERT INTO connector_observations(id,user_id,source,provider_record,payload)
			VALUES($1,$2,'steam-manual',$3,$4::jsonb)
			ON CONFLICT(user_id,source,provider_record) DO UPDATE SET payload=EXCLUDED.payload
			WHERE connector_observations.status='needs-review'
			RETURNING id,status`, id, user, providerRecord, string(payload)).Scan(&id, &observationStatus)
		if err == pgx.ErrNoRows {
			err = h.db.QueryRow(r.Context(), `SELECT id,status FROM connector_observations WHERE user_id=$1 AND source='steam-manual' AND provider_record=$2`, user, providerRecord).Scan(&id, &observationStatus)
		}
		if err != nil {
			problem(w, http.StatusInternalServerError, "write-failed")
			return
		}
		items = append(items, map[string]any{"id": id, "title": game.Name, "appId": game.AppID, "minutes": game.Minutes, "status": observationStatus})
	}
	response := map[string]any{"status": "needs-review", "steamId64": in.SteamID64, "accountLinked": false, "observations": items, "truncated": end < len(games)}
	if end < len(games) {
		response["nextOffset"] = end
	}
	output(w, http.StatusOK, response)
}
