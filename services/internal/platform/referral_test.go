package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

const (
	alice = "0x1111111111111111111111111111111111111111"
	bob   = "0x2222222222222222222222222222222222222222"
)

// The invite, end to end over the API: a wallet gets one code and keeps it,
// a friend arriving on that code is attributed once, and the referrer then
// sees them. Attribution is final — a second code does not move a friend to
// another wallet — and nobody invites themselves.
func TestInviteCodeAttributionAndBoard(t *testing.T) {
	fv := &fakeVenue{}
	svc, _ := newService(t, fv)
	invites := NewMemReferrals()
	h := Handler(svc, nil, WithOwnAccount(true), WithLedger(NewLedger()), WithReferrals(invites))

	call := func(method, path, body, wallet string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if wallet != "" {
			req.Header.Set(AccountHeader, wallet)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	invite := func(wallet string) referralDTO {
		t.Helper()
		rec := call(http.MethodGet, "/v1/referral", "", wallet)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /v1/referral: %d %s", rec.Code, rec.Body)
		}
		var out referralDTO
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	// One code, and the same one every time.
	mine := invite(alice)
	if len(mine.Code) != codeLength || mine.Link == "" || mine.SharePct != 30 || mine.Totals.Invited != 0 {
		t.Fatalf("invite = %+v", mine)
	}
	if again := invite(alice); again.Code != mine.Code {
		t.Fatalf("code changed: %s then %s", mine.Code, again.Code)
	}

	// A wallet with no passkey has no invite to show.
	if rec := call(http.MethodGet, "/v1/referral", "", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("anonymous invite: %d %s", rec.Code, rec.Body)
	}

	// Inviting yourself is not inviting anyone.
	if rec := call(http.MethodPost, "/v1/referral/claim", `{"code":"`+mine.Code+`"}`, alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("self-invite: %d %s", rec.Code, rec.Body)
	}
	// A code nobody owns.
	if rec := call(http.MethodPost, "/v1/referral/claim", `{"code":"ZZZZZZ"}`, bob); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown code: %d %s", rec.Code, rec.Body)
	}

	// The friend arrives.
	rec := call(http.MethodPost, "/v1/referral/claim", `{"code":"`+strings.ToLower(mine.Code)+`"}`, bob)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"attributed":true`) {
		t.Fatalf("claim: %d %s", rec.Code, rec.Body)
	}
	// And is attributed once: a second claim changes nothing.
	rec = call(http.MethodPost, "/v1/referral/claim", `{"code":"`+mine.Code+`"}`, bob)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"attributed":false`) {
		t.Fatalf("second claim: %d %s", rec.Code, rec.Body)
	}

	mine = invite(alice)
	if mine.Totals.Invited != 1 || len(mine.Friends) != 1 || !strings.EqualFold(mine.Friends[0].Wallet, bob) {
		t.Fatalf("friends = %+v", mine.Friends)
	}
	// Bob knows who brought him.
	if his := invite(bob); !strings.EqualFold(his.ReferredBy, alice) || his.Code == mine.Code {
		t.Fatalf("bob's invite = %+v", his)
	}
}

// The share is of our own fee, not of what the venue charges, and a venue we
// charge nothing on earns a referrer nothing.
func TestEarnedIsAShareOfTheBuilderFee(t *testing.T) {
	// 10 bps on 1000 traded is 1; 30% of that is 0.3.
	if got := earnedOn(fixed.FromInt(1000), fixed.FromInt(10)); got != fixed.Micros(300_000) {
		t.Errorf("earned = %v, want 0.3", got)
	}
	if got := earnedOn(fixed.FromInt(1000), 0); got != 0 {
		t.Errorf("earned with no builder fee = %v", got)
	}
	if got := earnedOn(0, fixed.FromInt(10)); got != 0 {
		t.Errorf("earned on nothing = %v", got)
	}
}

// A code is read out loud and typed back in.
func TestNormalizeCode(t *testing.T) {
	for in, want := range map[string]string{
		" abc23x ": "ABC23X",
		"AB-C23X":  "ABC23X",
		"abcooo":   "ABC000", // the alphabet has no O; folding it makes the lookup miss, not match another wallet
	} {
		if got := NormalizeCode(in); got != want {
			t.Errorf("NormalizeCode(%q) = %q, want %q", in, got, want)
		}
	}
	c, err := NewCode()
	if err != nil || len(c) != codeLength || NormalizeCode(c) != c {
		t.Fatalf("NewCode = %q, %v", c, err)
	}
}
