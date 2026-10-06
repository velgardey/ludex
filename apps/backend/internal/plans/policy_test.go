package plans

import (
	"testing"
	"time"
)

func TestPlanLimits(t *testing.T) {
	if ValidateCreate("Friday night", []string{"a", "b"}, "") == nil {
	} else {
		t.Fatal("valid plan rejected")
	}
	if ValidateCreate("", nil, "") == nil {
		t.Fatal("empty title accepted")
	}
	if ValidateCreate("Night", make([]string, 9), "") == nil {
		t.Fatal("oversized plan accepted")
	}
	if ValidateCreate("Night", nil, "not a date") == nil {
		t.Fatal("invalid time accepted")
	}
	if ValidateCreate("Night", nil, time.Now().UTC().Format(time.RFC3339)) != nil {
		t.Fatal("valid time rejected")
	}
}
