package platform

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// Inviting a friend.
//
// A wallet has one code, minted the first time it asks. A friend arriving on
// that code is attributed once, for good: the first code a wallet claims is
// the one it keeps, so a second link cannot take a friend from the wallet
// that brought them.
//
// What the friend then trades is not stored twice — it is the journal,
// grouped by wallet. The share is computed from the builder fee, which is
// the only fee that is ours: the venue's own cut never was.

// ReferralShare is the part of our builder fee that goes to whoever brought
// the trader, for a year from the day they joined.
const ReferralShare = 0.30

// codeLength is how long a code is. Base32 without the letters that are
// misread aloud, so a code survives being read out over a call.
const codeLength = 6

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// Referral is one friend, as the invite screen shows them.
type Referral struct {
	Wallet   string
	JoinedAt time.Time
	// Trades and Volume are what they have traded since, from the journal.
	Trades int
	Volume fixed.D
}

// Referrals is what the invite screen needs from storage.
type Referrals interface {
	// ReferralCode returns the wallet's code, minting one if it has none.
	ReferralCode(ctx context.Context, wallet string) (string, error)
	// ReferrerOf returns who brought this wallet, if anyone did.
	ReferrerOf(ctx context.Context, wallet string) (string, bool, error)
	// WalletForCode resolves a code to the wallet that owns it.
	WalletForCode(ctx context.Context, code string) (string, bool, error)
	// SaveReferral attributes a wallet to a referrer, once. It reports
	// whether this call is the one that attributed it.
	SaveReferral(ctx context.Context, wallet, referrer, code string) (bool, error)
	// ReferralsOf lists the friends a wallet brought, with what they traded.
	ReferralsOf(ctx context.Context, referrer string) ([]Referral, error)
}

// NewCode mints a code. Random rather than derived from the address: a code
// is read out and typed, and it should not be a piece of a wallet.
func NewCode() (string, error) {
	b := make([]byte, codeLength)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, codeLength)
	for i, v := range b {
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(out), nil
}

// NormalizeCode is how a code is compared: upper case, no spaces, and the
// two characters people substitute by ear folded onto the ones we mint.
func NormalizeCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.NewReplacer("O", "0", "I", "1", "-", "", " ", "").Replace(code)
	// The alphabet has no 0 or 1 either; what the replacer produced is only
	// meant to fail the lookup loudly rather than match the wrong wallet.
	return code
}

// MemReferrals is a Referrals in memory, for tests and for a platform run
// without a database.
type MemReferrals struct {
	mu     sync.Mutex
	codes  map[string]string // wallet -> code
	owners map[string]string // code -> wallet
	by     map[string]string // wallet -> referrer
	joined map[string]time.Time
}

func NewMemReferrals() *MemReferrals {
	return &MemReferrals{codes: map[string]string{}, owners: map[string]string{}, by: map[string]string{}, joined: map[string]time.Time{}}
}

func (m *MemReferrals) ReferralCode(_ context.Context, wallet string) (string, error) {
	wallet = strings.ToLower(wallet)
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.codes[wallet]; ok {
		return c, nil
	}
	c, err := NewCode()
	if err != nil {
		return "", err
	}
	m.codes[wallet], m.owners[c] = c, wallet
	return c, nil
}

func (m *MemReferrals) ReferrerOf(_ context.Context, wallet string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.by[strings.ToLower(wallet)]
	return r, ok, nil
}

func (m *MemReferrals) WalletForCode(_ context.Context, code string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.owners[NormalizeCode(code)]
	return w, ok, nil
}

func (m *MemReferrals) SaveReferral(_ context.Context, wallet, referrer, _ string) (bool, error) {
	wallet, referrer = strings.ToLower(wallet), strings.ToLower(referrer)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.by[wallet]; taken {
		return false, nil
	}
	m.by[wallet], m.joined[wallet] = referrer, time.Now().UTC()
	return true, nil
}

func (m *MemReferrals) ReferralsOf(_ context.Context, referrer string) ([]Referral, error) {
	referrer = strings.ToLower(referrer)
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Referral
	for w, r := range m.by {
		if r == referrer {
			out = append(out, Referral{Wallet: w, JoinedAt: m.joined[w]})
		}
	}
	return out, nil
}

// --- the API ---

type referralFriendDTO struct {
	Wallet   string `json:"wallet"`
	JoinedAt string `json:"joined_at"`
	Trades   int    `json:"trades"`
	// Volume is what they have traded, in collateral units.
	Volume string `json:"volume"`
	// Earned is our builder fee on that volume, times the share.
	Earned string `json:"earned"`
}

type referralDTO struct {
	// Code is this wallet's own; Link is where to send a friend.
	Code string `json:"code"`
	Link string `json:"link"`
	// SharePct is the part of our fee a referrer keeps, as a percent.
	SharePct float64 `json:"share_pct"`
	// FeeBps is the builder fee we charge, in basis points of volume. Zero
	// means we charge nothing yet — and then nothing is earned, which the
	// screen has to be able to say.
	FeeBps  string              `json:"fee_bps"`
	Friends []referralFriendDTO `json:"friends"`
	Totals  struct {
		Invited int    `json:"invited"`
		Volume  string `json:"volume"`
		Earned  string `json:"earned"`
	} `json:"totals"`
	// ReferredBy is who brought this wallet, if anyone did.
	ReferredBy string `json:"referred_by,omitempty"`
}

// referralWallet is the wallet a referral request is about: the one that
// signed it. The platform's own account has no invites.
func (h *handler) referralWallet(w http.ResponseWriter, r *http.Request) (string, bool) {
	addr := strings.ToLower(strings.TrimSpace(r.Header.Get(AccountHeader)))
	if addr == "" {
		writeJSON(w, http.StatusForbidden, errorDTO{Error: "own_account_disabled", Message: "sign in with a passkey to invite"})
		return "", false
	}
	if h.referrals == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "referrals_unavailable", Message: "invites are not enabled"})
		return "", false
	}
	return addr, true
}

// referral serves the wallet's own invite: its code, its friends, and what
// they have earned it.
func (h *handler) referral(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wallet, ok := h.referralWallet(w, r)
	if !ok {
		return
	}
	code, err := h.referrals.ReferralCode(ctx, wallet)
	if err != nil {
		h.fail(w, err)
		return
	}
	friends, err := h.referrals.ReferralsOf(ctx, wallet)
	if err != nil {
		h.fail(w, err)
		return
	}
	feeBps := h.builderFeeBps(ctx)
	out := referralDTO{Code: code, Link: h.inviteLink(code), SharePct: ReferralShare * 100, FeeBps: feeBps.String(), Friends: make([]referralFriendDTO, 0, len(friends))}
	var volume, earned fixed.D
	for _, f := range friends {
		e := earnedOn(f.Volume, feeBps)
		volume, earned = volume.Add(f.Volume), earned.Add(e)
		out.Friends = append(out.Friends, referralFriendDTO{
			Wallet: f.Wallet, JoinedAt: timeOrEmpty(f.JoinedAt), Trades: f.Trades, Volume: f.Volume.String(), Earned: e.String(),
		})
	}
	out.Totals.Invited, out.Totals.Volume, out.Totals.Earned = len(friends), volume.String(), earned.String()
	if by, ok, err := h.referrals.ReferrerOf(ctx, wallet); err == nil && ok {
		out.ReferredBy = by
	}
	writeJSON(w, http.StatusOK, out)
}

// claimReferral attributes the signed-in wallet to whoever owns the code.
// Attribution happens once: a wallet already attributed keeps its referrer,
// and the answer says so rather than failing.
func (h *handler) claimReferral(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wallet, ok := h.referralWallet(w, r)
	if !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := decode(r, &body); err != nil {
		h.fail(w, err)
		return
	}
	code := NormalizeCode(body.Code)
	if code == "" {
		h.fail(w, fmt.Errorf("%w: code is required", ErrInvalid))
		return
	}
	referrer, found, err := h.referrals.WalletForCode(ctx, code)
	if err != nil {
		h.fail(w, err)
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_such_code", Message: "that invite code does not exist"})
		return
	}
	if strings.EqualFold(referrer, wallet) {
		h.fail(w, fmt.Errorf("%w: a wallet cannot invite itself", ErrInvalid))
		return
	}
	attributed, err := h.referrals.SaveReferral(ctx, wallet, referrer, code)
	if err != nil {
		h.fail(w, err)
		return
	}
	if attributed {
		h.log.Info("referral attributed", "wallet", wallet, "referrer", referrer, "code", code)
	}
	by, _, _ := h.referrals.ReferrerOf(ctx, wallet)
	writeJSON(w, http.StatusOK, map[string]any{"attributed": attributed, "referred_by": by})
}

// earnedOn is the share of our builder fee on a volume: fee is charged in
// basis points of what was traded, and the referrer keeps ReferralShare of
// it. Zero fee, zero earned — there is no other honest number.
func earnedOn(volume, feeBps fixed.D) fixed.D {
	if !volume.IsPos() || !feeBps.IsPos() {
		return fixed.D(0)
	}
	fee := volume.Mul(feeBps).Div(fixed.FromInt(10_000))
	return fee.Mul(fixed.Micros(int64(ReferralShare * 1_000_000)))
}

// builderFeeBps is what we charge on top of the venue, in basis points. It
// comes from the market's fee schedule, which is where the builder rate
// lives; unknown means nothing is charged as far as this screen is
// concerned.
func (h *handler) builderFeeBps(ctx context.Context) fixed.D {
	if h.svc == nil {
		return fixed.D(0)
	}
	markets, err := h.svc.Markets(ctx)
	if err != nil || len(markets) == 0 {
		return fixed.D(0)
	}
	return markets[0].Fees.BuilderRate.Mul(fixed.FromInt(10_000))
}

// inviteLink is where a friend goes. The origin is the site that served the
// app, which the request itself names; the fallback is the one deployment
// that exists.
func (h *handler) inviteLink(code string) string {
	return "https://inflight.work/i/" + code
}
