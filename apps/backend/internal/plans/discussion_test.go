package plans

import (
	"encoding/json"
	"testing"
)

func TestScopedDiscussionRejectsUnboundedSpoilers(t *testing.T) {
	if ValidateDiscussion("A thought", json.RawMessage(`{"kind":"none"}`)) != nil {
		t.Fatal("nonspoiler rejected")
	}
	if ValidateDiscussion("secret", json.RawMessage(`{"kind":"episodes","requiredEpisodeIds":[]}`)) == nil {
		t.Fatal("empty spoiler scope accepted")
	}
	if ValidateDiscussion("", json.RawMessage(`{"kind":"none"}`)) == nil {
		t.Fatal("empty discussion accepted")
	}
}
