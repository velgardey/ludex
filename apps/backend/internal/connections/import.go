package connections

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

type ImportRow struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Year           int    `json:"year,omitempty"`
	Media          string `json:"media"`
	Date           string `json:"date,omitempty"`
	Rating         int    `json:"rating,omitempty"`
	Note           string `json:"note,omitempty"`
	Emulator       string `json:"emulator,omitempty"`
	PlayedOn       string `json:"playedOn,omitempty"`
	State          string `json:"state,omitempty"`
	EpisodeID      string `json:"episodeId,omitempty"`
	EpisodeTitle   string `json:"episodeTitle,omitempty"`
	MatchedTitleID string `json:"matchedTitleId,omitempty"`
	Status         string `json:"status"`
	Outcome        string `json:"outcome,omitempty"`
	BaseVersion    *int64 `json:"baseVersion,omitempty"`
}

func ParseCSV(reader io.Reader, source string) ([]ImportRow, error) {
	b, err := io.ReadAll(io.LimitReader(reader, 5*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(b) > 5*1024*1024 {
		return nil, fmt.Errorf("CSV exceeds 5 MiB")
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(b), "\ufeff")))
	r.FieldsPerRecord = -1
	headers, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("CSV header required")
	}
	if len(headers) > 100 {
		return nil, fmt.Errorf("too many columns")
	}
	mapping := map[string]int{}
	for i, h := range headers {
		mapping[strings.ToLower(strings.TrimSpace(h))] = i
	}
	get := func(row []string, names ...string) string {
		for _, name := range names {
			if i, ok := mapping[name]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	result := []ImportRow{}
	seen := map[string]bool{}
	count := 0
	for {
		row, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, fmt.Errorf("invalid CSV row")
		}
		count++
		if count > 10000 {
			return nil, fmt.Errorf("CSV exceeds 10000 rows")
		}
		title := get(row, "title", "name")
		if title == "" {
			continue
		}
		if len(title) > 500 {
			return nil, fmt.Errorf("title too long")
		}
		media := get(row, "media", "type")
		if media == "" {
			media = "movie"
		}
		if media != "movie" && media != "show" && media != "game" {
			return nil, fmt.Errorf("invalid media type")
		}
		state := strings.ToLower(get(row, "state", "status"))
		if state != "" && state != "planned" && state != "active" && state != "paused" && state != "dropped" && state != "completed" {
			return nil, fmt.Errorf("invalid library state")
		}
		year := 0
		if raw := get(row, "year"); raw != "" {
			parsedYear, yearErr := strconv.Atoi(raw)
			if yearErr != nil || parsedYear < 1 {
				return nil, fmt.Errorf("invalid year")
			}
			year = parsedYear
		}
		date := get(row, "watched date", "date")
		if date != "" {
			if _, err = time.Parse("2006-01-02", date); err != nil {
				return nil, fmt.Errorf("invalid date")
			}
		}
		rating := 0
		if raw := get(row, "rating"); raw != "" {
			v, e := strconv.ParseFloat(raw, 64)
			if e != nil {
				return nil, fmt.Errorf("invalid rating")
			}
			if source == "letterboxd" {
				v *= 2
			}
			if v < 1 || v > 10 || v != float64(int(v)) {
				return nil, fmt.Errorf("ratings must map to whole 1–10")
			}
			rating = int(v)
		}
		note := get(row, "note", "review")
		if len(note) > 4000 {
			return nil, fmt.Errorf("note exceeds 4000 bytes")
		}
		episodeID := get(row, "episode_id", "episode id", "episodeid")
		episodeTitle := get(row, "episode", "episode title")
		emulator := get(row, "emulator")
		playedOn := get(row, "played_on", "played on")
		hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s|%s|%d|%s|%s|%s|%s|%s|%s", title, year, media, date, rating, note, state, episodeID, episodeTitle, playedOn, emulator)))
		id := hex.EncodeToString(hash[:])
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, ImportRow{
			ID: id, Title: title, Year: year, Media: media, Date: date, Rating: rating, Note: note,
			Emulator: emulator, PlayedOn: playedOn, State: state,
			EpisodeID: episodeID, EpisodeTitle: episodeTitle, Status: "needs-match",
		})
	}
	return result, nil
}
func Seal(key, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	a, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, a.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return a.Seal(nonce, nonce, plain, []byte("ludex-connection-v1")), nil
}
func Unseal(key, sealed []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	a, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < a.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted credential")
	}
	return a.Open(nil, sealed[:a.NonceSize()], sealed[a.NonceSize():], []byte("ludex-connection-v1"))
}
