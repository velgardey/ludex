package jobs

import (
	"testing"
	"time"
)

func TestRetryDelayIsBounded(t *testing.T) {
	if RetryDelay(1) < time.Second || RetryDelay(20) > time.Hour {
		t.Fatal("retry backoff unbounded")
	}
}
