package connections

import (
	"strings"
	"testing"
)

func TestLetterboxdRatingsDatesAndDuplicatePreview(t *testing.T) {
	rows, err := ParseCSV(strings.NewReader("Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Dune,2021,https://letterboxd.com/film/dune-2021/,4.5\n2024-01-02,Dune,2021,https://letterboxd.com/film/dune-2021/,4.5\n"), "letterboxd")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Rating != 9 || rows[0].Date != "2024-01-02" || rows[0].Media != "movie" {
		t.Fatalf("incorrect import preview: %+v", rows)
	}
}
func TestCSVRejectsOversizedOrInvalidRatings(t *testing.T) {
	_, err := ParseCSV(strings.NewReader("title,rating\nDune,100\n"), "csv")
	if err == nil {
		t.Fatal("invalid rating accepted")
	}
}
func TestCSVRejectsMalformedYearInsteadOfRemovingMatchConstraint(t *testing.T) {
	_, err := ParseCSV(strings.NewReader("title,year\nDune,unknown\n"), "csv")
	if err == nil {
		t.Fatal("malformed year accepted as if no year had been supplied")
	}
}
func TestCSVPreservesUnknownDateAndEmulator(t *testing.T) {
	rows, err := ParseCSV(strings.NewReader("title,media,emulator,played_on,episode_id,state\nChrono Trigger,game,snes9x,Steam Deck,,active\n"), "csv")
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].Date != "" || rows[0].Emulator != "snes9x" || rows[0].PlayedOn != "Steam Deck" || rows[0].State != "active" {
		t.Fatal("emulated/manual history lost")
	}
}

func TestCSVRetainsEpisodeIdentityAndDistinctRows(t *testing.T) {
	rows, err := ParseCSV(strings.NewReader("title,media,episode_id,episode,state\nArcane,show,arcane:s1:e1,Welcome to the Playground,active\nArcane,show,arcane:s1:e2,Some Mysteries Are Better Left Unsolved,active\n"), "csv")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].EpisodeID != "arcane:s1:e1" || rows[1].EpisodeID != "arcane:s1:e2" || rows[0].EpisodeTitle == "" || rows[0].ID == rows[1].ID {
		t.Fatalf("episode import rows collapsed or lost identifiers: %+v", rows)
	}
}
func TestSealedCredentialsAreAuthenticated(t *testing.T) {
	key := make([]byte, 32)
	sealed, err := Seal(key, []byte("private-provider-token"))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := Unseal(key, sealed)
	if err != nil || string(plain) != "private-provider-token" {
		t.Fatal("roundtrip failed")
	}
	sealed[len(sealed)-1] ^= 1
	if _, err = Unseal(key, sealed); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}
