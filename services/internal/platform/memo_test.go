package platform

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMemoSharesOneComputationAndKeepsIt(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	m := newMemo[int](2 * time.Second)
	m.now = func() time.Time { return now }

	var calls atomic.Int32
	release := make(chan struct{})
	compute := func() (int, error) {
		calls.Add(1)
		<-release
		return 42, nil
	}

	// Ten askers at once: one computation, ten answers.
	var wg sync.WaitGroup
	got := make([]int, 10)
	for i := range got {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got[i], _ = m.Get("k", compute)
		}()
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	for i, v := range got {
		if v != 42 {
			t.Fatalf("asker %d got %d", i, v)
		}
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("computed %d times, want 1", n)
	}

	// Within the TTL the answer stands; past it, it is computed again.
	now = now.Add(time.Second)
	if v, _ := m.Get("k", compute); v != 42 || calls.Load() != 1 {
		t.Fatalf("fresh entry recomputed: v=%d calls=%d", v, calls.Load())
	}
	now = now.Add(2 * time.Second)
	if _, _ = m.Get("k", compute); calls.Load() != 2 {
		t.Fatalf("stale entry not recomputed: calls=%d", calls.Load())
	}

	// Forgotten means asked again.
	m.Forget("k")
	if _, _ = m.Get("k", compute); calls.Load() != 3 {
		t.Fatalf("forgotten entry not recomputed: calls=%d", calls.Load())
	}
}

func TestMemoDoesNotKeepAFailure(t *testing.T) {
	m := newMemo[int](time.Minute)
	var calls int
	boom := errors.New("boom")
	if _, err := m.Get("k", func() (int, error) { calls++; return 0, boom }); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if v, err := m.Get("k", func() (int, error) { calls++; return 7, nil }); err != nil || v != 7 {
		t.Fatalf("after a failure: v=%d err=%v", v, err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func TestMemoPrunesStaleEntries(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	m := newMemo[int](time.Second)
	m.now = func() time.Time { return now }
	for i := 0; i < 600; i++ {
		_, _ = m.Get(string(rune('a'+i%26))+string(rune(i)), func() (int, error) { return i, nil })
		now = now.Add(10 * time.Millisecond)
	}
	if n := len(m.entries); n >= 600 {
		t.Fatalf("entries = %d, nothing pruned", n)
	}
}
