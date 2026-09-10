package platform

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// Settler writes every closed round trip to the StrategyLeaderboard contract
// and reads the boards back from it. Writes run off the trade path: a close
// enqueues a record and returns; the queue sends one transaction at a time,
// in order, with retries, so a chain hiccup never blocks trading and never
// double-counts (the contract refuses a repeated ref).
type Settler struct {
	client   *chain.Client
	key      *chain.Key
	contract [20]byte
	chainID  uint64
	log      *slog.Logger
	now      func() time.Time

	mu      sync.Mutex
	queue   []Trade
	wake    chan struct{}
	pending int
	sent    int
	failed  int
	lastErr string
}

// SettlerConfig is what the platform needs to sign and read.
type SettlerConfig struct {
	RPCURL     string
	PrivateKey string
	Contract   string
}

// NewSettler connects to the chain and checks the contract accepts this key.
func NewSettler(ctx context.Context, cfg SettlerConfig, log *slog.Logger) (*Settler, error) {
	if log == nil {
		log = slog.Default()
	}
	key, err := chain.ParseKey(cfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	contract, err := chain.ParseAddress(cfg.Contract)
	if err != nil {
		return nil, err
	}
	client := chain.NewClient(cfg.RPCURL)
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return nil, fmt.Errorf("platform: settler: %w", err)
	}
	s := &Settler{client: client, key: key, contract: contract, chainID: chainID, log: log, now: time.Now, wake: make(chan struct{}, 1)}
	ok, err := s.isSettler(ctx, key.Address)
	if err != nil {
		return nil, fmt.Errorf("platform: settler: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("platform: settler %s is not authorised on %s", addr(key.Address), cfg.Contract)
	}
	bal, err := client.Balance(ctx, key.Address)
	if err == nil {
		log.Info("settler ready", "address", addr(key.Address), "contract", cfg.Contract, "chain_id", chainID, "balance_wei", bal.String())
	}
	return s, nil
}

// Address is the settler's own address, for logs and for funding.
func (s *Settler) Address() string { return addr(s.key.Address) }

// Contract is the board's address.
func (s *Settler) Contract() string { return addr(s.contract) }

func addr(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }

// StrategyKey is how a strategy id is written on-chain: keccak256 of the id.
func StrategyKey(id string) [32]byte { return eip712.Keccak256([]byte(id)) }

// TradeRef is the record's idempotency key and audit trail: the hash of the
// venue order ids of the round trip.
func TradeRef(openOrderID, closeOrderID string) [32]byte {
	return eip712.Keccak256([]byte(openOrderID + "|" + closeOrderID))
}

// collateralMicros converts a fixed-point collateral amount to the contract's
// 6-decimal integer.
func collateralMicros(d fixed.D) *big.Int {
	v := new(big.Int).SetInt64(int64(d))
	return v.Div(v, big.NewInt(int64(fixed.Scale)/1_000_000))
}

// Enqueue records a closed trade for settlement.
func (s *Settler) Enqueue(t Trade) {
	s.mu.Lock()
	s.queue = append(s.queue, t)
	s.pending = len(s.queue)
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Run drains the queue until ctx ends.
func (s *Settler) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		}
		for {
			s.mu.Lock()
			if len(s.queue) == 0 {
				s.mu.Unlock()
				break
			}
			t := s.queue[0]
			s.mu.Unlock()
			if err := s.settle(ctx, t); err != nil {
				if ctx.Err() != nil {
					return
				}
				s.mu.Lock()
				s.failed++
				s.lastErr = err.Error()
				s.mu.Unlock()
				s.log.Warn("settlement failed, retrying", "wallet", t.Wallet, "strategy", t.Strategy, "err", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(settleRetry):
				}
				continue
			}
			s.mu.Lock()
			s.queue = s.queue[1:]
			s.pending = len(s.queue)
			s.sent++
			s.mu.Unlock()
		}
	}
}

const (
	settleRetry   = 10 * time.Second
	settleTimeout = 90 * time.Second
	gasMargin     = 120 // percent
)

// settle sends one recordTrade and waits for it to be mined.
func (s *Settler) settle(ctx context.Context, t Trade) error {
	ctx, cancel := context.WithTimeout(ctx, settleTimeout)
	defer cancel()
	wallet, err := chain.ParseAddress(t.Wallet)
	if err != nil {
		// Not a chain address (the platform's own account key): nothing to settle.
		s.log.Info("settlement skipped: wallet is not an address", "wallet", t.Wallet)
		return nil
	}
	data := chain.Encode("recordTrade(bytes32,address,int128,uint64,bytes32)",
		StrategyKey(t.Strategy), wallet, collateralMicros(t.PnL), uint64(t.ClosedAt.Unix()), t.Ref)
	nonce, err := s.client.Nonce(ctx, s.key.Address)
	if err != nil {
		return err
	}
	feeCap, tipCap, err := s.client.Fees(ctx)
	if err != nil {
		return err
	}
	gas, err := s.client.EstimateGas(ctx, s.key.Address, s.contract, data)
	if err != nil {
		// A revert here is final: most likely the ref was already recorded.
		var rpcErr *chain.RPCError
		if errors.As(err, &rpcErr) {
			s.log.Warn("settlement rejected by the contract; dropping", "wallet", t.Wallet, "err", rpcErr.Message)
			return nil
		}
		return err
	}
	to := s.contract
	raw, err := s.key.Sign(chain.Tx{
		ChainID: s.chainID, Nonce: nonce, TipCap: tipCap, FeeCap: feeCap,
		Gas: gas * gasMargin / 100, To: &to, Value: new(big.Int), Data: data,
	})
	if err != nil {
		return err
	}
	hash, err := s.client.SendRaw(ctx, raw)
	if err != nil {
		return err
	}
	rcpt, err := s.client.WaitMined(ctx, hash, time.Second)
	if err != nil {
		return err
	}
	if rcpt.Status != 1 {
		return fmt.Errorf("recordTrade reverted in block %d (tx %s)", rcpt.BlockNumber, "0x"+hex.EncodeToString(hash[:]))
	}
	s.log.Info("trade settled on-chain", "wallet", t.Wallet, "strategy", t.Strategy, "pnl", t.PnL, "tx", "0x"+hex.EncodeToString(hash[:]), "block", rcpt.BlockNumber, "gas", rcpt.GasUsed)
	return nil
}

func (s *Settler) isSettler(ctx context.Context, a [20]byte) (bool, error) {
	out, err := s.client.Call(ctx, s.contract, chain.Encode("settlers(address)", a))
	if err != nil {
		return false, err
	}
	w, err := chain.Words(out)
	if err != nil || len(w) != 1 {
		return false, errors.New("settlers(): bad return")
	}
	return w[0][31] == 1, nil
}

// score reads one (pnl, trades) pair from totalOf or scoreOf.
func (s *Settler) score(ctx context.Context, data []byte) (fixed.D, int, error) {
	out, err := s.client.Call(ctx, s.contract, data)
	if err != nil {
		return 0, 0, err
	}
	w, err := chain.Words(out)
	if err != nil || len(w) != 2 {
		return 0, 0, errors.New("score: bad return")
	}
	micros := chain.Int128(w[0])
	// micros → fixed: multiply back up to Scale.
	d := new(big.Int).Mul(micros, big.NewInt(int64(fixed.Scale)/1_000_000))
	return fixed.D(d.Int64()), int(chain.Uint64(w[1])), nil
}

// WeekOf mirrors the contract: weeks start Monday 00:00 UTC.
func WeekOf(t time.Time) uint64 { return uint64((t.Unix() + 3*86400) / (7 * 86400)) }

// Board reads a strategy's week from the contract: the total, and the
// standing of each wallet the caller names (the contract does not enumerate
// wallets; the indexer will).
func (s *Settler) Board(ctx context.Context, week uint64, strategyID string, wallets []string) (Board, error) {
	key := StrategyKey(strategyID)
	pnl, trades, err := s.score(ctx, chain.Encode("totalOf(uint64,bytes32)", week, key))
	if err != nil {
		return Board{}, err
	}
	b := Board{PnL: pnl, Trades: trades}
	for _, w := range wallets {
		a, err := chain.ParseAddress(w)
		if err != nil {
			continue
		}
		p, n, err := s.score(ctx, chain.Encode("scoreOf(uint64,bytes32,address)", week, key, a))
		if err != nil {
			return Board{}, err
		}
		if n > 0 {
			b.Top = append(b.Top, Standing{Wallet: w, PnL: p, Trades: n})
			b.Players++
		}
	}
	return b, nil
}

// Stats reports the queue for /v1/leaderboard.
type SettlerStats struct {
	Pending, Sent, Failed int
	LastError             string
}

func (s *Settler) Stats() SettlerStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SettlerStats{Pending: s.pending, Sent: s.sent, Failed: s.failed, LastError: s.lastErr}
}
