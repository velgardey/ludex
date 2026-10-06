package companion

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"ludex/backend/internal/catalog"
)

func TestRetrieveRanksLibraryBeforeApplyingRecordLimit(t *testing.T) {
	records := []LibraryRecord{
		{TitleID: "alien", Title: "Alien", Media: "movie"},
		{TitleID: "darksiders", Title: "Darksiders", Media: "game"},
		{TitleID: "dune-two", Title: "Dune: Part Two", Media: "movie"},
		{TitleID: "zelda", Title: "The Legend of Zelda", Media: "game"},
	}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) { return records, nil },
		Limits:      Limits{MaxLibraryRecords: 2},
	}}

	result, err := service.retrieve(context.Background(), "user-1", "request-1", "Dune Part Two")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Docs) == 0 || result.Docs[0].TitleID != "dune-two" {
		t.Fatalf("top retrieved document = %#v, want Dune: Part Two", result.Docs)
	}
	if len(result.Records) == 0 || result.Records[0].TitleID != "dune-two" {
		t.Fatalf("proposal records = %#v, want ranked Dune record first", result.Records)
	}
}

func TestRetrieveStopsAtBoundedCandidateCap(t *testing.T) {
	records := make([]LibraryRecord, maxRetrievalCandidates+1)
	for i := 0; i < maxRetrievalCandidates; i++ {
		records[i] = LibraryRecord{TitleID: "unrelated-" + itoa(i), Title: "Unrelated " + itoa(i), Media: "movie"}
	}
	records[maxRetrievalCandidates] = LibraryRecord{TitleID: "rare", Title: "Rare Target", Media: "movie"}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) { return records, nil },
		Limits:      Limits{MaxLibraryRecords: 30},
	}}

	result, err := service.retrieve(context.Background(), "user-1", "request-1", "Rare Target")
	if err != nil {
		t.Fatal(err)
	}
	for _, doc := range result.Docs {
		if doc.TitleID == "rare" {
			t.Fatal("retrieval scanned beyond its candidate cap")
		}
	}
}

func TestRetrieveHydratesEpisodesForMatchedLibraryShow(t *testing.T) {
	provider := &retrievalCatalogFixture{title: catalog.Hit{
		ID: "tmdb:show:42", Media: "show", Title: "The Expanse",
		Episodes: []catalog.Episode{
			{ID: "tmdb:episode:101", Order: 1, Title: "Dulcinea"},
			{ID: "tmdb:episode:102", Order: 2, Title: "The Big Empty"},
		},
	}}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) {
			runs, _ := json.Marshal([]map[string]any{{"id": "7b4c5b13-54b3-4d3a-9d40-10737c390a67", "watchedEpisodeIds": []string{"tmdb:episode:101"}}})
			return []LibraryRecord{{TitleID: "tmdb:show:42", Title: "The Expanse", Media: "show", Version: 3, Runs: runs}}, nil
		},
		Catalog: provider,
		Limits:  Limits{MaxLibraryRecords: 2},
	}}

	result, err := service.retrieve(context.Background(), "user-1", "request-1", "The Expanse episode two")
	if err != nil {
		t.Fatal(err)
	}
	if provider.titleCalls != 1 {
		t.Fatalf("catalog title calls = %d, want one matched-show lookup", provider.titleCalls)
	}
	for _, want := range []string{"version: 3", "7b4c5b13-54b3-4d3a-9d40-10737c390a67", "tmdb:episode:101", "Dulcinea"} {
		if !strings.Contains(result.Docs[0].Text, want) {
			t.Errorf("retrieved show context %q does not contain %q", result.Docs[0].Text, want)
		}
	}
	prompt := buildSystemPrompt(result.Docs)
	for _, want := range []string{"episode-watched", "new UUID commandId", "audience.kind to private", "never guess a date"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("system prompt does not contain proposal guidance %q", want)
		}
	}
}

func TestRetrieveDoesNotHydrateShowForGenericWatchedQuestion(t *testing.T) {
	provider := &retrievalCatalogFixture{title: catalog.Hit{
		ID: "tmdb:show:42", Media: "show", Title: "The Expanse",
		Episodes: []catalog.Episode{{ID: "tmdb:episode:101", Order: 1, Title: "Dulcinea"}},
	}}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) {
			return []LibraryRecord{{TitleID: "tmdb:show:42", Title: "The Expanse", Media: "show", Note: "I have watched these episodes"}}, nil
		},
		Catalog: provider,
		Limits:  Limits{MaxLibraryRecords: 2},
	}}

	if _, err := service.retrieve(context.Background(), "user-1", "request-1", "What have I watched?"); err != nil {
		t.Fatal(err)
	}
	if provider.titleCalls != 0 {
		t.Fatalf("catalog title calls = %d, want no lookup without a title match", provider.titleCalls)
	}
}

func TestRetrieveBoundsEpisodeContextAndProposalAllowlistTogether(t *testing.T) {
	episodes := make([]catalog.Episode, 100)
	for i := range episodes {
		episodes[i] = catalog.Episode{
			ID:    "tmdb:episode:" + itoa(i+1),
			Order: i + 1,
			Title: strings.Repeat("Long episode title ", 5) + itoa(i+1),
		}
	}
	provider := &retrievalCatalogFixture{title: catalog.Hit{ID: "tmdb:show:42", Media: "show", Title: "The Expanse", Episodes: episodes}}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) {
			return []LibraryRecord{{TitleID: "tmdb:show:42", Title: "The Expanse", Media: "show", Version: 3}}, nil
		},
		Catalog: provider,
		Limits:  Limits{MaxLibraryRecords: 2},
	}}
	result, err := service.retrieve(context.Background(), "user-1", "request-1", "The Expanse")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Records) != 1 || len(result.Records[0].CatalogEpisodes) > maxPromptEpisodes {
		t.Fatalf("catalog episode allowlist is not bounded: %#v", result.Records)
	}
	const marker = "; catalog episodes: "
	start := strings.Index(result.Docs[0].Text, marker)
	if start < 0 {
		t.Fatal("catalog episode context is missing")
	}
	contextText := result.Docs[0].Text[start+len(marker):]
	if got := len([]rune(contextText)); got > maxEpisodeSummaryRunes {
		t.Fatalf("catalog episode context has %d runes, want at most %d", got, maxEpisodeSummaryRunes)
	}
	for _, episode := range result.Records[0].CatalogEpisodes {
		if !strings.Contains(contextText, episode.ID) {
			t.Fatalf("proposal allowlist includes unshown episode %q", episode.ID)
		}
	}
}

func TestProposalGuidanceFitsAppContextCap(t *testing.T) {
	docs := []retrievalDocument{
		libraryDocument(LibraryRecord{TitleID: "one", Title: "One", Media: "movie", Version: 1}),
		libraryDocument(LibraryRecord{TitleID: "two", Title: "Two", Media: "show", Version: 2}),
		libraryDocument(LibraryRecord{TitleID: "three", Title: "Three", Media: "game", Version: 3}),
	}
	prompt := buildSystemPrompt(docs)
	input, err := makeResponsesInput(prompt, nil, "Summarize my saved titles.", 4000)
	if err != nil {
		t.Fatalf("normal three-title context did not fit the app cap: %v", err)
	}
	if got := tokenEstimate(input); got > 4000 {
		t.Fatalf("context estimate = %d, exceeds the app cap", got)
	}
	if _, err := makeResponsesInput(prompt, nil, strings.Repeat("x", 4001), 4000); err == nil {
		t.Fatal("oversized request unexpectedly passed the app context cap")
	}
}

func TestEpisodeWatchedProposalRequiresCatalogEpisodeID(t *testing.T) {
	runID := uuid.NewString()
	provider := &retrievalCatalogFixture{title: catalog.Hit{
		ID: "tmdb:show:42", Media: "show", Title: "The Expanse",
		Episodes: []catalog.Episode{{ID: "tmdb:episode:101", Order: 1, Title: "Dulcinea"}},
	}}
	service := &Service{cfg: Config{
		LoadLibrary: func(context.Context, string) ([]LibraryRecord, error) {
			runs, _ := json.Marshal([]map[string]any{{"id": runID}})
			return []LibraryRecord{{TitleID: "tmdb:show:42", Title: "The Expanse", Media: "show", Version: 3, Runs: runs}}, nil
		},
		Catalog: provider,
		Limits:  Limits{MaxLibraryRecords: 2},
	}}
	result, err := service.retrieve(context.Background(), "user-1", "request-1", "The Expanse episode two")
	if err != nil {
		t.Fatal(err)
	}

	command := func(episodeID string) string {
		value, err := json.Marshal(progressCommand{
			CommandID: uuid.NewString(), TitleID: "tmdb:show:42", BaseVersion: 3,
			Change:     progressChange{Kind: "episode-watched", TitleID: "tmdb:show:42", RunID: runID, EpisodeID: episodeID},
			OccurredAt: dateValue{Precision: "unknown"},
			Audience: struct {
				Kind string `json:"kind"`
			}{Kind: "private"},
			Spoiler: struct {
				Kind string `json:"kind"`
			}{Kind: "none"},
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(value)
	}

	valid := validateActionProposals("user-1", []wireAction{{Label: "Watch Dulcinea", Command: command("tmdb:episode:101")}}, result.Records, time.Now().Add(time.Minute))
	if len(valid) != 1 {
		t.Fatal("proposal for a catalog episode ID was rejected")
	}
	unknown := validateActionProposals("user-1", []wireAction{{Label: "Watch a guessed episode", Command: command("tmdb:episode:999")}}, result.Records, time.Now().Add(time.Minute))
	if len(unknown) != 0 {
		t.Fatal("proposal for an unknown episode ID was accepted")
	}

	provider.titleErr = errors.New("catalog unavailable")
	withoutCatalog, err := service.retrieve(context.Background(), "user-1", "request-2", "The Expanse episode two")
	if err != nil {
		t.Fatal(err)
	}
	noEpisodeProof := validateActionProposals("user-1", []wireAction{{Label: "Watch Dulcinea", Command: command("tmdb:episode:101")}}, withoutCatalog.Records, time.Now().Add(time.Minute))
	if len(noEpisodeProof) != 0 {
		t.Fatal("proposal was accepted without a successful catalog episode lookup")
	}
}

type retrievalCatalogFixture struct {
	title      catalog.Hit
	titleErr   error
	titleCalls int
}

func (f *retrievalCatalogFixture) Search(context.Context, string, string, string) ([]catalog.Hit, error) {
	return nil, nil
}

func (f *retrievalCatalogFixture) Title(_ context.Context, id string) (catalog.Hit, error) {
	f.titleCalls++
	if f.titleErr != nil {
		return catalog.Hit{}, f.titleErr
	}
	if id != f.title.ID {
		return catalog.Hit{}, nil
	}
	return f.title, nil
}

func TestLibraryDocumentIncludesBoundedRunProgress(t *testing.T) {
	runs, err := json.Marshal([]map[string]any{{
		"milestoneIds": []string{"chapter-one", "chapter-two"},
		"minutes":      95,
	}})
	if err != nil {
		t.Fatal(err)
	}

	doc := libraryDocument(LibraryRecord{
		TitleID: "dusk", Title: "Dusk", Media: "game", Runs: runs,
	})
	for _, want := range []string{"chapter-one", "95 game minutes"} {
		if !strings.Contains(doc.Text, want) {
			t.Errorf("library document text %q does not contain %q", doc.Text, want)
		}
	}

	var episodeIDs []string
	for i := 0; i < 40; i++ {
		episodeIDs = append(episodeIDs, strings.Repeat("episode-", 8)+string(rune('a'+i)))
	}
	episodeRuns, err := json.Marshal([]map[string]any{{"watchedEpisodeIds": episodeIDs}})
	if err != nil {
		t.Fatal(err)
	}
	showDoc := libraryDocument(LibraryRecord{
		TitleID: "show", Title: "Example Show", Media: "show", Runs: episodeRuns,
	})
	if !strings.Contains(showDoc.Text, "watched episodes") {
		t.Fatalf("show progress omitted from library document: %q", showDoc.Text)
	}
	if got := len([]rune(showDoc.Text)); got > 380 {
		t.Fatalf("run summary was not bounded; document has %d runes", got)
	}
}
