package platform

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func storeWithKey(t *testing.T, address string) *keys.Store {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	s := keys.New()
	s.Put(keys.Key{Address: address, APIKey: "pk", PrivateKey: priv, BuilderID: 18, MaxBuilderFeePer100K: 50})
	return s
}

func TestRegistryBuildsOneServicePerWallet(t *testing.T) {
	const addr = "0x00000000000000000000000000000000000000aa"
	var builds atomic.Int32
	factory := func(ctx context.Context, k keys.Key) (venue.Adapter, error) {
		builds.Add(1)
		if k.APIKey != "pk" {
			t.Errorf("factory got key %+v", k)
		}
		return &fakeVenue{}, nil
	}
	r := NewRegistry(storeWithKey(t, addr), factory, testLimits(), nil)

	// Twenty concurrent first calls share one connection.
	var wg sync.WaitGroup
	svcs := make([]*Service, 20)
	for i := range svcs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s, err := r.Get(context.Background(), addr)
			if err != nil {
				t.Errorf("Get: %v", err)
			}
			svcs[i] = s
		}(i)
	}
	wg.Wait()
	if got := builds.Load(); got != 1 {
		t.Errorf("venue built %d times, want 1", got)
	}
	for _, s := range svcs[1:] {
		if s != svcs[0] {
			t.Error("concurrent callers got different services")
		}
	}
	// Address matching is case-insensitive: a checksummed address is the same wallet.
	again, err := r.Get(context.Background(), "0x00000000000000000000000000000000000000AA")
	if err != nil || again != svcs[0] {
		t.Errorf("checksummed lookup: %v, same=%v", err, again == svcs[0])
	}
}

func TestRegistryUnknownWallet(t *testing.T) {
	r := NewRegistry(keys.New(), func(context.Context, keys.Key) (venue.Adapter, error) {
		t.Fatal("factory must not run for a wallet with no key")
		return nil, nil
	}, testLimits(), nil)
	if _, err := r.Get(context.Background(), "0x00000000000000000000000000000000000000bb"); !errors.Is(err, ErrNoKey) {
		t.Errorf("err = %v, want ErrNoKey", err)
	}
	if _, err := r.Get(context.Background(), ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("empty address: %v", err)
	}
}

// A failed connection is not cached: the next call tries again.
func TestRegistryRetriesAfterFailedConnect(t *testing.T) {
	const addr = "0x00000000000000000000000000000000000000cc"
	var calls atomic.Int32
	factory := func(context.Context, keys.Key) (venue.Adapter, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("venue down")
		}
		return &fakeVenue{}, nil
	}
	r := NewRegistry(storeWithKey(t, addr), factory, testLimits(), nil)
	if _, err := r.Get(context.Background(), addr); err == nil {
		t.Fatal("first Get should fail")
	}
	if _, err := r.Get(context.Background(), addr); err != nil {
		t.Fatalf("second Get: %v", err)
	}
}

func TestHeaderRouting(t *testing.T) {
	own, _ := newService(t, &fakeVenue{})
	const addr = "0x00000000000000000000000000000000000000dd"
	r := NewRegistry(storeWithKey(t, addr), func(context.Context, keys.Key) (venue.Adapter, error) {
		return &fakeVenue{}, nil
	}, testLimits(), nil)
	h := Handler(own, nil, WithRegistry(r))

	get := func(header string) int {
		req := httptest.NewRequest(http.MethodGet, "/v1/state", nil)
		if header != "" {
			req.Header.Set(AccountHeader, header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := get(""); got != http.StatusOK {
		t.Errorf("no header: %d", got)
	}
	if got := get(addr); got != http.StatusOK {
		t.Errorf("enrolled wallet: %d", got)
	}
	if got := get("0x00000000000000000000000000000000000000ee"); got != http.StatusNotFound {
		t.Errorf("unknown wallet: %d, want 404", got)
	}

	// Without a registry the header is refused outright.
	bare := Handler(own, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/state", nil)
	req.Header.Set(AccountHeader, addr)
	rec := httptest.NewRecorder()
	bare.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("no registry: %d, want 503", rec.Code)
	}
}
