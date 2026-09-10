// Package store is the platform's system of record on Postgres: enrolled
// keys, the policy engine's state, pending horizons and the journal of round
// trips the leaderboard is computed from. Every engine keeps working from
// memory; this is where memory is written through to and restored from.
package store

import (
	"context"
	"crypto/ed25519"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/seal"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store is safe for concurrent use.
type Store struct {
	pool   *pgxpool.Pool
	sealer *seal.Sealer // nil stores private keys in the clear
}

// UseSealer encrypts private keys at rest from now on and re-seals any row
// that was written in the clear.
func (s *Store) UseSealer(ctx context.Context, sl *seal.Sealer) (resealed int, err error) {
	s.sealer = sl
	keys, err := s.Keys(ctx)
	if err != nil {
		return 0, err
	}
	for _, k := range keys {
		if k.sealed {
			continue
		}
		if err := s.PutKey(ctx, k); err != nil {
			return resealed, err
		}
		resealed++
	}
	return resealed, nil
}

// Open connects and applies migrations in file order.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	s := &Store{pool: pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) migrate(ctx context.Context) error {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	if _, err := s.pool.Exec(ctx, `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`); err != nil {
		return fmt.Errorf("store: migrations table: %w", err)
	}
	for _, name := range names {
		var applied bool
		if err := s.pool.QueryRow(ctx, `select exists(select 1 from schema_migrations where name = $1)`, name).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		sql, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("store: migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `insert into schema_migrations (name) values ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

// --- keys ---

// KeyRecord is an enrolled venue API key as stored.
type KeyRecord struct {
	Address              string
	Strategy             string // "" serves every strategy
	APIKey               string
	PrivateKey           ed25519.PrivateKey
	Label                string
	BuilderID            int
	MaxBuilderFeePer100K int
	MaxBuilderFeePct     string
	Derived              bool
	EnrolledAt           time.Time
	sealed               bool // as read: was the row encrypted at rest
}

// keyLabel binds a sealed private key to its row.
func keyLabel(address, strategy string) string { return strings.ToLower(address) + "/" + strategy }

func (s *Store) PutKey(ctx context.Context, k KeyRecord) error {
	priv := []byte(k.PrivateKey)
	if s.sealer != nil {
		var err error
		if priv, err = s.sealer.Seal(priv, keyLabel(k.Address, k.Strategy)); err != nil {
			return err
		}
	}
	_, err := s.pool.Exec(ctx, `
		insert into keys (address, strategy, api_key, private_key, label, builder_id, max_fee_per_100k, max_fee_pct, derived, enrolled_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		on conflict (address, strategy) do update set api_key = excluded.api_key, private_key = excluded.private_key,
			label = excluded.label, builder_id = excluded.builder_id, max_fee_per_100k = excluded.max_fee_per_100k,
			max_fee_pct = excluded.max_fee_pct, derived = excluded.derived, enrolled_at = excluded.enrolled_at`,
		strings.ToLower(k.Address), k.Strategy, k.APIKey, priv, k.Label, k.BuilderID, k.MaxBuilderFeePer100K, k.MaxBuilderFeePct, k.Derived, k.EnrolledAt)
	return err
}

func (s *Store) DeleteKey(ctx context.Context, address, strategy string) error {
	_, err := s.pool.Exec(ctx, `delete from keys where address = $1 and strategy = $2`, strings.ToLower(address), strategy)
	return err
}

// Keys loads every key. Rows written before sealing are read as they are;
// a sealed row without a sealer, or under another key, is an error rather
// than a silently missing key.
func (s *Store) Keys(ctx context.Context) ([]KeyRecord, error) {
	rows, err := s.pool.Query(ctx, `select address, strategy, api_key, private_key, label, builder_id, max_fee_per_100k, max_fee_pct, derived, enrolled_at from keys`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KeyRecord
	for rows.Next() {
		var k KeyRecord
		var priv []byte
		if err := rows.Scan(&k.Address, &k.Strategy, &k.APIKey, &priv, &k.Label, &k.BuilderID, &k.MaxBuilderFeePer100K, &k.MaxBuilderFeePct, &k.Derived, &k.EnrolledAt); err != nil {
			return nil, err
		}
		if seal.Sealed(priv) {
			if s.sealer == nil {
				return nil, fmt.Errorf("store: key for %s/%s is sealed but no PLATFORM_KEY_ENCRYPTION_KEY is set", k.Address, k.Strategy)
			}
			if priv, err = s.sealer.Open(priv, keyLabel(k.Address, k.Strategy)); err != nil {
				return nil, fmt.Errorf("store: key for %s/%s: %w", k.Address, k.Strategy, err)
			}
			k.sealed = true
		}
		if len(priv) != ed25519.PrivateKeySize {
			return nil, fmt.Errorf("store: key for %s has %d bytes", k.Address, len(priv))
		}
		k.PrivateKey = ed25519.PrivateKey(priv)
		out = append(out, k)
	}
	return out, rows.Err()
}

// --- request-signing keys ---

// PutAuthKey registers an Ed25519 public key a wallet signs requests with.
func (s *Store) PutAuthKey(ctx context.Context, address string, publicKey []byte, at time.Time) error {
	_, err := s.pool.Exec(ctx, `insert into auth_keys (address, public_key, created_at) values ($1, $2, $3) on conflict do nothing`,
		strings.ToLower(address), publicKey, at)
	return err
}

// AuthKeys lists a wallet's registered request-signing keys.
func (s *Store) AuthKeys(ctx context.Context, address string) ([][]byte, error) {
	rows, err := s.pool.Query(ctx, `select public_key from auth_keys where address = $1 order by created_at`, strings.ToLower(address))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]byte
	for rows.Next() {
		var pk []byte
		if err := rows.Scan(&pk); err != nil {
			return nil, err
		}
		out = append(out, pk)
	}
	return out, rows.Err()
}

// --- policy ---

// PolicyAccount is the policy engine's state for one account.
type PolicyAccount struct {
	Account       string
	DayStart      time.Time
	RealizedLoss  fixed.D
	LastOpen      time.Time
	OpenPositions int
	Exposure      fixed.D
}

func (s *Store) SavePolicyAccount(ctx context.Context, a PolicyAccount) error {
	var lastOpen *time.Time
	if !a.LastOpen.IsZero() {
		lastOpen = &a.LastOpen
	}
	_, err := s.pool.Exec(ctx, `
		insert into policy_accounts (account, day_start, realized_loss, last_open, open_positions, exposure, updated_at)
		values ($1, $2, $3, $4, $5, $6, now())
		on conflict (account) do update set day_start = excluded.day_start, realized_loss = excluded.realized_loss,
			last_open = excluded.last_open, open_positions = excluded.open_positions, exposure = excluded.exposure, updated_at = now()`,
		a.Account, a.DayStart, a.RealizedLoss.String(), lastOpen, a.OpenPositions, a.Exposure.String())
	return err
}

func (s *Store) PolicyAccounts(ctx context.Context) ([]PolicyAccount, error) {
	rows, err := s.pool.Query(ctx, `select account, day_start, realized_loss::text, last_open, open_positions, exposure::text from policy_accounts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PolicyAccount
	for rows.Next() {
		var a PolicyAccount
		var loss, exp string
		var lastOpen *time.Time
		if err := rows.Scan(&a.Account, &a.DayStart, &loss, &lastOpen, &a.OpenPositions, &exp); err != nil {
			return nil, err
		}
		if a.RealizedLoss, err = fixed.Parse(loss); err != nil {
			return nil, err
		}
		if a.Exposure, err = fixed.Parse(exp); err != nil {
			return nil, err
		}
		if lastOpen != nil {
			a.LastOpen = *lastOpen
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) SaveKill(ctx context.Context, killed bool, note string) error {
	_, err := s.pool.Exec(ctx, `
		insert into kill_switch (id, killed, note, updated_at) values (true, $1, $2, now())
		on conflict (id) do update set killed = excluded.killed, note = excluded.note, updated_at = now()`, killed, note)
	return err
}

func (s *Store) Kill(ctx context.Context) (killed bool, note string, err error) {
	err = s.pool.QueryRow(ctx, `select killed, note from kill_switch where id`).Scan(&killed, &note)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "", nil
	}
	return killed, note, err
}

// --- horizons ---

type Horizon struct {
	Account  string
	Symbol   string
	ClosesAt time.Time
}

func (s *Store) SaveHorizon(ctx context.Context, h Horizon) error {
	_, err := s.pool.Exec(ctx, `insert into horizons (account, symbol, closes_at) values ($1, $2, $3)
		on conflict (account, symbol) do update set closes_at = excluded.closes_at`, h.Account, h.Symbol, h.ClosesAt)
	return err
}

func (s *Store) DeleteHorizon(ctx context.Context, account, symbol string) error {
	_, err := s.pool.Exec(ctx, `delete from horizons where account = $1 and symbol = $2`, account, symbol)
	return err
}

func (s *Store) Horizons(ctx context.Context, account string) ([]Horizon, error) {
	rows, err := s.pool.Query(ctx, `select account, symbol, closes_at from horizons where account = $1`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Horizon
	for rows.Next() {
		var h Horizon
		if err := rows.Scan(&h.Account, &h.Symbol, &h.ClosesAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// --- trades ---

// Fill is what an opening or closing order did: side, size and price.
type Fill struct {
	Side  string // "long" or "short"
	Size  fixed.D
	Price fixed.D
	Fee   fixed.D
}

// TradeOpened journals an opening fill.
func (s *Store) TradeOpened(ctx context.Context, wallet, strategy, symbol, orderID string, f Fill, at time.Time) error {
	_, err := s.pool.Exec(ctx, `insert into trades (wallet, strategy, symbol, open_order_id, side, size, entry_price, entry_fee, opened_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		on conflict (wallet, open_order_id) do nothing`, wallet, strategy, symbol, orderID, f.Side, f.Size.String(), f.Price.String(), f.Fee.String(), at)
	return err
}

// ClosedTrade is a round trip as journaled; an open one has no exit.
type ClosedTrade struct {
	Wallet, Strategy, Symbol  string
	OpenOrderID, CloseOrderID string
	Side                      string
	Size, EntryPrice          fixed.D
	ExitPrice                 fixed.D
	EntryFee, ExitFee         fixed.D
	PnL                       fixed.D
	CloseReason               string
	OpenedAt, ClosedAt        time.Time
}

// TradeClosed completes the open round trip for a wallet's symbol. A close
// with no open on record (a position from before the journal) is inserted
// as a whole under the given strategy, with the exit as its only price.
func (s *Store) TradeClosed(ctx context.Context, wallet, symbol, fallbackStrategy, closeOrderID string, f Fill, pnl fixed.D, reason string, at time.Time) (ClosedTrade, error) {
	var t ClosedTrade
	var size, entry, exit, entryFee, pnlS string
	err := s.pool.QueryRow(ctx, `
		with open as (
			select id from trades where wallet = $1 and symbol = $2 and closed_at is null order by opened_at desc limit 1
		)
		update trades set close_order_id = $3, pnl = $4, closed_at = $5, exit_price = $6, exit_fee = $7, close_reason = $8 where id = (select id from open)
		returning wallet, strategy, symbol, open_order_id, close_order_id, side, size::text, entry_price::text, exit_price::text, entry_fee::text, pnl::text, opened_at, closed_at`,
		wallet, symbol, closeOrderID, pnl.String(), at, f.Price.String(), f.Fee.String(), reason).Scan(&t.Wallet, &t.Strategy, &t.Symbol, &t.OpenOrderID, &t.CloseOrderID, &t.Side, &size, &entry, &exit, &entryFee, &pnlS, &t.OpenedAt, &t.ClosedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = s.pool.Exec(ctx, `insert into trades (wallet, strategy, symbol, open_order_id, close_order_id, side, size, entry_price, exit_price, exit_fee, pnl, close_reason, opened_at, closed_at)
			values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $12)`, wallet, fallbackStrategy, symbol, "unknown-"+closeOrderID, closeOrderID, f.Side, f.Size.String(), f.Price.String(), f.Fee.String(), pnl.String(), reason, at)
		t = ClosedTrade{Wallet: wallet, Strategy: fallbackStrategy, Symbol: symbol, OpenOrderID: "unknown-" + closeOrderID, CloseOrderID: closeOrderID, Side: f.Side, Size: f.Size, ExitPrice: f.Price, ExitFee: f.Fee, PnL: pnl, CloseReason: reason, OpenedAt: at, ClosedAt: at}
		return t, err
	}
	if err != nil {
		return ClosedTrade{}, err
	}
	t.Size, _ = fixed.Parse(size)
	t.EntryPrice, _ = fixed.Parse(entry)
	t.ExitPrice, _ = fixed.Parse(exit)
	t.EntryFee, _ = fixed.Parse(entryFee)
	t.ExitFee = f.Fee
	t.CloseReason = reason
	t.PnL = pnl
	return t, nil
}

// Trades lists a wallet's round trips in a symbol, newest first: what the
// chart marks and the history shows. An empty strategy means every
// strategy. Open ones have no exit.
func (s *Store) Trades(ctx context.Context, wallet, symbol, strategy string, limit int) ([]ClosedTrade, error) {
	rows, err := s.pool.Query(ctx, `select wallet, strategy, symbol, open_order_id, coalesce(close_order_id, ''), side, size::text, entry_price::text,
		coalesce(exit_price::text, ''), entry_fee::text, coalesce(exit_fee::text, ''), coalesce(pnl::text, ''), coalesce(close_reason, ''), opened_at, closed_at
		from trades where wallet = $1 and symbol = $2 and ($3 = '' or strategy = $3) order by opened_at desc limit $4`, wallet, symbol, strategy, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClosedTrade
	for rows.Next() {
		var t ClosedTrade
		var size, entry, exit, entryFee, exitFee, pnl string
		var closedAt *time.Time
		if err := rows.Scan(&t.Wallet, &t.Strategy, &t.Symbol, &t.OpenOrderID, &t.CloseOrderID, &t.Side, &size, &entry, &exit, &entryFee, &exitFee, &pnl, &t.CloseReason, &t.OpenedAt, &closedAt); err != nil {
			return nil, err
		}
		t.Size, _ = fixed.Parse(size)
		t.EntryPrice, _ = fixed.Parse(entry)
		t.EntryFee, _ = fixed.Parse(entryFee)
		if exit != "" {
			t.ExitPrice, _ = fixed.Parse(exit)
		}
		if exitFee != "" {
			t.ExitFee, _ = fixed.Parse(exitFee)
		}
		if pnl != "" {
			t.PnL, _ = fixed.Parse(pnl)
		}
		if closedAt != nil {
			t.ClosedAt = *closedAt
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// OpenStrategy reports the strategy of a wallet's open round trip.
func (s *Store) OpenStrategy(ctx context.Context, wallet, symbol string) (string, bool, error) {
	var st string
	err := s.pool.QueryRow(ctx, `select strategy from trades where wallet = $1 and symbol = $2 and closed_at is null order by opened_at desc limit 1`, wallet, symbol).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return st, err == nil, err
}

// Standing is one wallet's line on a board.
type Standing struct {
	Wallet string
	PnL    fixed.D
	Trades int
}

// BoardRow is a strategy's week as the journal has it.
type BoardRow struct {
	Strategy  string
	PnL       fixed.D
	Players   int
	Trades    int
	ActiveNow int
	Top       []Standing
}

// Boards aggregates closed trades in [since, until) by strategy, with the
// top wallets, and counts open positions per strategy.
func (s *Store) Boards(ctx context.Context, since, until time.Time, topN int) (map[string]*BoardRow, error) {
	out := make(map[string]*BoardRow)
	rows, err := s.pool.Query(ctx, `
		select strategy, wallet, sum(pnl)::text, count(*)
		from trades where closed_at >= $1 and closed_at < $2
		group by strategy, wallet`, since, until)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var strategy, wallet, pnl string
		var n int
		if err := rows.Scan(&strategy, &wallet, &pnl, &n); err != nil {
			rows.Close()
			return nil, err
		}
		d, err := fixed.Parse(pnl)
		if err != nil {
			rows.Close()
			return nil, err
		}
		b := out[strategy]
		if b == nil {
			b = &BoardRow{Strategy: strategy}
			out[strategy] = b
		}
		b.PnL = b.PnL.Add(d)
		b.Trades += n
		b.Players++
		b.Top = append(b.Top, Standing{Wallet: wallet, PnL: d, Trades: n})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, b := range out {
		sort.Slice(b.Top, func(i, j int) bool {
			if b.Top[i].PnL != b.Top[j].PnL {
				return b.Top[i].PnL > b.Top[j].PnL
			}
			return b.Top[i].Wallet < b.Top[j].Wallet
		})
		if len(b.Top) > topN {
			b.Top = b.Top[:topN]
		}
	}
	active, err := s.pool.Query(ctx, `select strategy, count(distinct wallet) from trades where closed_at is null group by strategy`)
	if err != nil {
		return nil, err
	}
	defer active.Close()
	for active.Next() {
		var strategy string
		var n int
		if err := active.Scan(&strategy, &n); err != nil {
			return nil, err
		}
		b := out[strategy]
		if b == nil {
			b = &BoardRow{Strategy: strategy}
			out[strategy] = b
		}
		b.ActiveNow = n
	}
	return out, active.Err()
}

// Wallets lists every wallet in the journal.
func (s *Store) Wallets(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `select distinct wallet from trades order by wallet`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var w string
		if err := rows.Scan(&w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// --- prizes ---

// PrizeRecord is one published winner: what the settler sent on-chain.
type PrizeRecord struct {
	Week      uint64
	Strategy  string
	Wallet    string
	Amount    string // token units
	PnL       fixed.D
	SettledAt time.Time
}

func (s *Store) SavePrize(ctx context.Context, r PrizeRecord) error {
	_, err := s.pool.Exec(ctx, `insert into prizes (week, strategy, wallet, amount, pnl, settled_at) values ($1, $2, $3, $4, $5, $6)
		on conflict (week, strategy, wallet) do nothing`, r.Week, r.Strategy, r.Wallet, r.Amount, r.PnL.String(), r.SettledAt)
	return err
}

// Prizes lists the published winners of a week, best first.
func (s *Store) Prizes(ctx context.Context, week uint64) ([]PrizeRecord, error) {
	rows, err := s.pool.Query(ctx, `select week, strategy, wallet, amount::text, pnl::text, settled_at from prizes where week = $1 order by strategy, amount desc`, week)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPrizes(rows)
}

// PrizesFor lists every prize a wallet was ever published for.
func (s *Store) PrizesFor(ctx context.Context, wallet string) ([]PrizeRecord, error) {
	rows, err := s.pool.Query(ctx, `select week, strategy, wallet, amount::text, pnl::text, settled_at from prizes where wallet = $1 order by week desc`, wallet)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPrizes(rows)
}

func scanPrizes(rows pgx.Rows) ([]PrizeRecord, error) {
	var out []PrizeRecord
	for rows.Next() {
		var r PrizeRecord
		var pnl string
		if err := rows.Scan(&r.Week, &r.Strategy, &r.Wallet, &r.Amount, &pnl, &r.SettledAt); err != nil {
			return nil, err
		}
		d, err := fixed.Parse(pnl)
		if err != nil {
			return nil, err
		}
		r.PnL = d
		out = append(out, r)
	}
	return out, rows.Err()
}
