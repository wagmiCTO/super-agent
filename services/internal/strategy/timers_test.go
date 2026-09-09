package strategy

import (
	"sync"
	"testing"
	"time"
)

// fakeAfter captures scheduled callbacks and fires them on demand.
type fakeAfter struct {
	mu    sync.Mutex
	calls []*fakeTimer
}

type fakeTimer struct {
	d       time.Duration
	fn      func()
	stopped bool
}

func (f *fakeTimer) Stop() bool { f.stopped = true; return true }

func (f *fakeAfter) after(d time.Duration, fn func()) Stopper {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := &fakeTimer{d: d, fn: fn}
	f.calls = append(f.calls, t)
	return t
}

func TestScheduleFiresAndForgets(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	fa := &fakeAfter{}
	tm := NewTimersWith(func() time.Time { return now }, fa.after)

	fired := 0
	tm.Schedule("MON", now.Add(15*time.Minute), func() { fired++ })
	if at, ok := tm.Deadline("MON"); !ok || !at.Equal(now.Add(15*time.Minute)) {
		t.Fatalf("deadline = %v, %v", at, ok)
	}
	if fa.calls[0].d != 15*time.Minute {
		t.Fatalf("scheduled after %s", fa.calls[0].d)
	}
	fa.calls[0].fn()
	if fired != 1 {
		t.Fatal("callback did not run")
	}
	if _, ok := tm.Deadline("MON"); ok {
		t.Fatal("fired timer still pending")
	}
}

func TestRescheduleReplaces(t *testing.T) {
	now := time.Now()
	fa := &fakeAfter{}
	tm := NewTimersWith(func() time.Time { return now }, fa.after)
	tm.Schedule("MON", now.Add(time.Minute), func() {})
	tm.Schedule("MON", now.Add(time.Hour), func() {})
	if !fa.calls[0].stopped {
		t.Fatal("first timer not stopped by reschedule")
	}
	if at, _ := tm.Deadline("MON"); !at.Equal(now.Add(time.Hour)) {
		t.Fatalf("deadline = %v", at)
	}
}

func TestCancel(t *testing.T) {
	now := time.Now()
	fa := &fakeAfter{}
	tm := NewTimersWith(func() time.Time { return now }, fa.after)
	tm.Schedule("MON", now.Add(time.Minute), func() { t.Fatal("cancelled timer ran") })
	tm.Cancel("MON")
	if !fa.calls[0].stopped {
		t.Fatal("timer not stopped")
	}
	if _, ok := tm.Deadline("MON"); ok {
		t.Fatal("cancelled timer still pending")
	}
}

func TestRulesValidate(t *testing.T) {
	cases := []struct {
		h  time.Duration
		ok bool
	}{{0, true}, {time.Second, false}, {15 * time.Minute, true}, {MaxHorizon, true}, {25 * time.Hour, false}}
	for _, c := range cases {
		if err := (Rules{Horizon: c.h}).Validate(); (err == nil) != c.ok {
			t.Errorf("Horizon %s: err = %v", c.h, err)
		}
	}
}
