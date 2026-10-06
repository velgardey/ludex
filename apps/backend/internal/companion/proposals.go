package companion

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"ludex/backend/internal/catalog"
)

type proposalDraft struct {
	ID            string
	UserID        string
	Label         string
	Summary       string
	Payload       json.RawMessage
	PayloadHash   string
	TargetVersion int
	ExpiresAt     time.Time
}

type progressCommand struct {
	CommandID   string         `json:"commandId"`
	TitleID     string         `json:"titleId"`
	BaseVersion int            `json:"baseVersion"`
	Change      progressChange `json:"change"`
	OccurredAt  dateValue      `json:"occurredAt"`
	Rating      *int           `json:"rating,omitempty"`
	Liked       *bool          `json:"liked,omitempty"`
	Note        string         `json:"note,omitempty"`
	Audience    struct {
		Kind string `json:"kind"`
	} `json:"audience"`
	Spoiler struct {
		Kind string `json:"kind"`
	} `json:"spoiler"`
}

type progressChange struct {
	Kind           string `json:"kind"`
	TitleID        string `json:"titleId"`
	RunID          string `json:"runId,omitempty"`
	SessionID      string `json:"sessionId,omitempty"`
	Medium         string `json:"medium,omitempty"`
	Minutes        *int   `json:"minutes,omitempty"`
	PlayedOn       string `json:"playedOn,omitempty"`
	Emulator       string `json:"emulator,omitempty"`
	EpisodeID      string `json:"episodeId,omitempty"`
	MilestoneID    string `json:"milestoneId,omitempty"`
	Label          string `json:"label,omitempty"`
	ProviderGameID string `json:"providerGameId,omitempty"`
	AchievementID  string `json:"achievementId,omitempty"`
	Mode           string `json:"mode,omitempty"`
}

type dateValue struct {
	Precision string `json:"precision"`
	ISO       string `json:"iso,omitempty"`
	Day       string `json:"day,omitempty"`
	Month     string `json:"month,omitempty"`
}

func validateActionProposals(userID string, actions []wireAction, records []LibraryRecord, expiresAt time.Time) []proposalDraft {
	recordsByID := make(map[string]LibraryRecord, len(records))
	for _, record := range records {
		recordsByID[record.TitleID] = record
	}
	seen := make(map[string]bool)
	var proposals []proposalDraft
	for _, action := range actions {
		if len(strings.TrimSpace(action.Command)) == 0 || len(action.Command) > 4000 {
			continue
		}
		command, payload, err := decodeProgressCommand(action.Command)
		if err != nil || validateProgressCommand(command, recordsByID) != nil || seen[command.CommandID] {
			continue
		}
		seen[command.CommandID] = true
		record := recordsByID[command.TitleID]
		label, summary := proposalPreview(record, command)
		if len(label) > 120 {
			label = truncateRunes(label, 120)
		}
		if len(summary) > 500 {
			summary = truncateRunes(summary, 500)
		}
		hash := sha256.Sum256(payload)
		proposals = append(proposals, proposalDraft{
			ID:            uuid.NewString(),
			UserID:        userID,
			Label:         label,
			Summary:       summary,
			Payload:       payload,
			PayloadHash:   hex.EncodeToString(hash[:]),
			TargetVersion: command.BaseVersion,
			ExpiresAt:     expiresAt,
		})
		if len(proposals) == 4 {
			break
		}
	}
	return proposals
}

func decodeProgressCommand(value string) (progressCommand, json.RawMessage, error) {
	var command progressCommand
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		return command, nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return command, nil, errors.New("progress proposal contains trailing data")
	}
	canonical, err := json.Marshal(command)
	if err != nil {
		return command, nil, err
	}
	return command, canonical, nil
}

func validateProgressCommand(command progressCommand, records map[string]LibraryRecord) error {
	if _, err := uuid.Parse(command.CommandID); err != nil || command.BaseVersion < 0 || command.TitleID == "" || command.Change.TitleID != command.TitleID {
		return errors.New("invalid progress command identity")
	}
	record, ok := records[command.TitleID]
	if !ok || record.Version != command.BaseVersion || !mediaValid(record.Media) {
		return errors.New("progress command title is not in the current library context")
	}
	if command.Audience.Kind != "private" || command.Spoiler.Kind != "none" {
		return errors.New("assistant proposals must be private and non-spoiling")
	}
	if command.Rating != nil && (*command.Rating < 1 || *command.Rating > 10) {
		return errors.New("rating is outside the accepted range")
	}
	if len(command.Note) > 4000 {
		return errors.New("progress note is too long")
	}
	if err := validateDate(command.OccurredAt); err != nil {
		return err
	}
	change := command.Change
	switch change.Kind {
	case "movie-viewed":
		if record.Media != "movie" || !validUUID(change.RunID) {
			return errors.New("invalid movie progress action")
		}
	case "episode-watched":
		if record.Media != "show" || !validUUID(change.RunID) || !knownCatalogEpisode(record.CatalogEpisodes, change.EpisodeID) {
			return errors.New("invalid episode progress action")
		}
	case "game-session":
		if record.Media != "game" || !validUUID(change.RunID) || change.Minutes != nil && (*change.Minutes < 0 || *change.Minutes > 1440) || len(change.PlayedOn) > 100 || len(change.Emulator) > 100 {
			return errors.New("invalid game session action")
		}
	case "story-completed":
		if record.Media != "game" || !validUUID(change.RunID) {
			return errors.New("invalid story completion action")
		}
	case "session-started", "session-ended":
		if !validUUID(change.RunID) || !validUUID(change.SessionID) || change.Medium != record.Media {
			return errors.New("invalid session action")
		}
	default:
		return errors.New("unsupported progress action")
	}
	return nil
}

func knownCatalogEpisode(episodes []catalog.Episode, episodeID string) bool {
	if episodeID == "" {
		return false
	}
	for _, episode := range episodes {
		if episode.ID == episodeID {
			return true
		}
	}
	return false
}

func validateDate(value dateValue) error {
	switch value.Precision {
	case "unknown":
		if value.ISO != "" || value.Day != "" || value.Month != "" {
			return errors.New("unknown date must not contain a value")
		}
	case "instant":
		if _, err := time.Parse(time.RFC3339, value.ISO); err != nil {
			return errors.New("invalid progress timestamp")
		}
	case "day":
		if _, err := time.Parse("2006-01-02", value.Day); err != nil {
			return errors.New("invalid progress date")
		}
	case "month":
		if len(value.Month) != 7 {
			return errors.New("invalid progress month")
		}
		if _, err := time.Parse("2006-01", value.Month); err != nil {
			return errors.New("invalid progress month")
		}
	default:
		return errors.New("invalid progress date precision")
	}
	return nil
}

func proposalPreview(record LibraryRecord, command progressCommand) (string, string) {
	verb := "update progress"
	switch command.Change.Kind {
	case "movie-viewed":
		verb = "mark as viewed"
	case "game-session":
		verb = "log a game session"
	case "story-completed":
		verb = "mark the story complete"
	case "session-started":
		verb = "start a session"
	case "session-ended":
		verb = "end a session"
	}
	label := record.Title + ": " + verb
	summary := fmt.Sprintf("Private progress update for %s at library version %d. Confirmation will recheck the current version.", record.Title, command.BaseVersion)
	if command.Change.Kind == "game-session" && command.Change.Minutes != nil {
		summary = fmt.Sprintf("Privately log %d minutes for %s at library version %d. Confirmation will recheck the current version.", *command.Change.Minutes, record.Title, command.BaseVersion)
	}
	return label, summary
}

func validUUID(value string) bool {
	_, err := uuid.Parse(value)
	return err == nil
}

func mediaValid(media string) bool {
	return media == "movie" || media == "show" || media == "game"
}
