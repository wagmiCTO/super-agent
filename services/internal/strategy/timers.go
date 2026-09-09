// Package strategy holds the engine's building blocks: the rules that bound a
// position after the user has opened it, and the timers that enforce them.
//
// A strategy never opens a position. Its signal is a hint the screen shows
// ("the window is open"); the user decides with a tap. What a strategy does
// own is the exit: the horizon timer, and later stop-loss and take-profit —
// the frame that makes the maximum loss known before the tap.
package strategy

import (
	"sync"
	"time"
)

// Stopper is what a scheduled callback can be cancelled through. time.Timer
// satisfies it; tests substitute their own.
type Stopper interface{ Stop() bool }

// AfterFunc schedules fn after d and returns a way to cancel it. The default
// is time.AfterFunc; tests inject one that fires on demand.
type AfterFunc func(d time.Duration, fn func()) Stopper

// Timers holds at most one pending callback per key — one exit per market —
// and remembers when each fires so the screen can count down to it.
type Timers struct {
	now   func() time.Time
	after AfterFunc

	mu      sync.Mutex
	pending map[string]entry
}

type entry struct {
	at   time.Time
	stop Stopper
}

// NewTimers returns timers on the wall clock.
func NewTimers() *Timers {
	return NewTimersWith(time.Now, func(d time.Duration, fn func()) Stopper { return time.AfterFunc(d, fn) })
}

// NewTimersWith injects the clock and the scheduler.
func NewTimersWith(now func() time.Time, after AfterFunc) *Timers {
	return &Timers{now: now, after: after, pending: make(map[string]entry)}
}

// Schedule arranges fn to run at the given time, replacing any pending
// callback for the key. fn runs on its own goroutine, after the key has
// already been forgotten, so a callback may schedule the key again.
func (t *Timers) Schedule(key string, at time.Time, fn func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if old, ok := t.pending[key]; ok {
		old.stop.Stop()
	}
	d := at.Sub(t.now())
	if d < 0 {
		d = 0
	}
	stop := t.after(d, func() {
		t.mu.Lock()
		// Only forget the entry if it is still ours: a reschedule may have
		// replaced it between firing and reaching this lock.
		if cur, ok := t.pending[key]; ok && cur.at.Equal(at) {
			delete(t.pending, key)
		}
		t.mu.Unlock()
		fn()
	})
	t.pending[key] = entry{at: at, stop: stop}
}

// Cancel forgets the pending callback for a key, if any.
func (t *Timers) Cancel(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if e, ok := t.pending[key]; ok {
		e.stop.Stop()
		delete(t.pending, key)
	}
}

// Deadline reports when the key's callback fires.
func (t *Timers) Deadline(key string) (time.Time, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.pending[key]
	return e.at, ok
}

// Close cancels everything.
func (t *Timers) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for k, e := range t.pending {
		e.stop.Stop()
		delete(t.pending, k)
	}
}
