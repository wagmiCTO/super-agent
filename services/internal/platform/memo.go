package platform

import (
	"sync"
	"time"
)

// memo keeps one value per key for a short while and lets everyone who
// asks for the same key at the same time share one computation.
//
// The platform sits in front of a venue that rate-limits it, and in front
// of screens that poll. Every screen open on every phone asks the same
// questions a few times a minute; the venue must hear each question once.
type memo[T any] struct {
	ttl time.Duration
	now func() time.Time

	mu      sync.Mutex
	entries map[string]*memoEntry[T]
}

type memoEntry[T any] struct {
	// done is closed once val and err are set; readers wait on it.
	done chan struct{}
	at   time.Time
	val  T
	err  error
}

func newMemo[T any](ttl time.Duration) *memo[T] {
	return &memo[T]{ttl: ttl, now: time.Now, entries: make(map[string]*memoEntry[T])}
}

// Get answers from a fresh entry, joins a computation already under way,
// or runs compute itself. A failed computation is not kept: the next
// asker tries again.
func (m *memo[T]) Get(key string, compute func() (T, error)) (T, error) {
	m.mu.Lock()
	if e, ok := m.entries[key]; ok {
		select {
		case <-e.done:
			if e.err == nil && m.now().Sub(e.at) < m.ttl {
				m.mu.Unlock()
				return e.val, nil
			}
		default:
			m.mu.Unlock()
			<-e.done
			return e.val, e.err
		}
	}
	e := &memoEntry[T]{done: make(chan struct{})}
	m.entries[key] = e
	m.prune()
	m.mu.Unlock()

	e.val, e.err = compute()
	e.at = m.now()
	close(e.done)
	return e.val, e.err
}

// Forget drops a key: what it stood for has just changed.
func (m *memo[T]) Forget(key string) {
	m.mu.Lock()
	delete(m.entries, key)
	m.mu.Unlock()
}

// prune drops what has gone stale once the table grows; called with the
// lock held. Keys such as a candle range are never asked for again, and
// a table that only grows is a leak with a delay.
func (m *memo[T]) prune() {
	if len(m.entries) < 512 {
		return
	}
	cutoff := m.now().Add(-m.ttl)
	for k, e := range m.entries {
		select {
		case <-e.done:
			if e.at.Before(cutoff) {
				delete(m.entries, k)
			}
		default:
		}
	}
}
