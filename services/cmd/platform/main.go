// Command platform is the trading service the app talks to.
//
// It connects to the venue, installs the policy limits, reconciles open
// positions against the exchange, and serves the HTTP API described in
// api/openapi.yaml. Every order passes through the policy engine; there is no
// route around it.
//
//	go run ./cmd/platform                 # 127.0.0.1:8080, testnet, default limits
//	PLATFORM_ADDR=0.0.0.0:8080 go run ./cmd/platform
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/deposit"
	"github.com/wagmiCTO/super-agent/services/internal/envfile"
	"github.com/wagmiCTO/super-agent/services/internal/envio"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/insight"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/platform"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/seal"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

func main() {
	level := slog.LevelInfo
	if os.Getenv("PLATFORM_LOG") == "debug" {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	if err := run(log); err != nil {
		log.Error("platform exited", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	// .env.local overrides .env: a second venue key for a laptop that runs
	// beside the hosted platform, without touching the shared file.
	if err := envfile.LoadNearest(".env.local"); err != nil {
		return err
	}
	if err := envfile.LoadNearest(".env"); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := perpl.ConfigFromEnv()
	if err != nil {
		return err
	}
	if !cfg.HasCredentials() {
		return errors.New("PERPL_API_KEY and PERPL_API_KEY_SECRET are required: the platform places orders")
	}
	limits, err := limitsFromEnv()
	if err != nil {
		return err
	}

	// The platform's own key was created at the venue's web UI and is not
	// bound to our builder code, so it must not send a builder fee: the venue
	// refuses every such order. The fee applies to keys enrolled through the
	// platform, whose adapters are built with it.
	ownCfg := cfg
	ownCfg.BuilderFeePer100K = 0
	adapter, err := perpl.New(ctx, ownCfg, log)
	if err != nil {
		return fmt.Errorf("connect venue: %w", err)
	}
	defer adapter.Close()

	// The markets follow the venue's list (ADR 0003's open question, settled):
	// every market it publishes unless PLATFORM_ALLOWED_SYMBOLS narrows it.
	markets := platform.NewMarketSync(adapter, nil, nil, limits.AllowedSymbols, log)
	markets.Sync(ctx)
	limits.AllowedSymbols = markets.Allowed()
	if err := limits.Validate(); err != nil {
		return fmt.Errorf("after reading the venue's markets: %w", err)
	}

	ownKey := adapter.WalletAddress()
	if ownKey == "" {
		ownKey = "platform"
	}
	// One policy engine and one ledger for everyone: accounts are keyed by
	// wallet, and the leaderboard is a single table.
	handlerOpts := []platform.Option{}
	eng := policy.New()
	ledger := platform.NewLedger()
	var keyStore *keys.Store
	var db *store.Store
	if url := os.Getenv("DATABASE_URL"); url != "" {
		// Postgres is the system of record: keys, policy state, horizons and
		// the journal of round trips all live there and survive restarts.
		if db, err = store.Open(ctx, url); err != nil {
			return err
		}
		defer db.Close()
		if err := restorePolicy(ctx, eng, db); err != nil {
			return fmt.Errorf("restore policy state: %w", err)
		}
		ledger = platform.NewJournaledLedger(db)
		// Private keys are sealed at rest under PLATFORM_KEY_ENCRYPTION_KEY;
		// rows written before sealing are re-sealed on the first start with one.
		if hexKey := os.Getenv("PLATFORM_KEY_ENCRYPTION_KEY"); hexKey != "" {
			sl, err := seal.New(hexKey)
			if err != nil {
				return fmt.Errorf("PLATFORM_KEY_ENCRYPTION_KEY: %w", err)
			}
			resealed, err := db.UseSealer(ctx, sl)
			if err != nil {
				return fmt.Errorf("seal keys: %w", err)
			}
			if resealed > 0 {
				log.Info("keys sealed at rest", "resealed", resealed)
			}
		} else {
			log.Warn("PLATFORM_KEY_ENCRYPTION_KEY is not set: exchange keys are stored in the clear")
		}
		if keyStore, err = keys.WithBackend(ctx, keyBackend{db}); err != nil {
			return err
		}
		handlerOpts = append(handlerOpts, platform.WithAuthKeys(db))
		log.Info("database connected", "keys", keyStore.Len())
	} else {
		log.Warn("DATABASE_URL is not set: state lives in memory and is lost on restart")
	}
	// Each wallet's chosen limits: the danger zone on the risk screen.
	var prefs platform.LimitsStore = platform.NewMemLimits()
	if db != nil {
		prefs = limitsBackend{db}
	}
	handlerOpts = append(handlerOpts, platform.WithLimitsStore(prefs))

	// Who invited whom. In memory it is lost on restart, which would lose a
	// friend their referrer, so this one is worth the loud line.
	var invites platform.Referrals = platform.NewMemReferrals()
	if db != nil {
		invites = referralBackend{db}
	} else {
		log.Warn("no database: invite codes and attribution live in memory")
	}
	handlerOpts = append(handlerOpts, platform.WithReferrals(invites))

	svc, err := platform.New(ctx, adapter, eng, ownKey, limits, log)
	if err != nil {
		return err
	}
	if db != nil {
		if err := svc.Restore(ctx, db); err != nil {
			return err
		}
	}
	// The platform's own account trades under the same tiers as a wallet.
	own := svc
	svc.UseLimits(func(ctx context.Context, balance, lossToday fixed.D) policy.Limits {
		l := limits
		l.AllowedSymbols = markets.Allowed()
		return platform.ComputeLimits(l, platform.SafeTier, balance, lossToday, ownMaxLeverage(ctx, own, l))
	})

	// Enrollment of user wallets needs our builder code; without one the
	// endpoints answer 503 and the platform trades with its own key only.
	var registry *platform.Registry
	if cfg.BuilderID > 0 {
		// PLATFORM_KEYS_FILE keeps enrolled keys across restarts. Plain JSON
		// with 0600 permissions: fine for a testnet development box, not for
		// real money — see the keys package.
		store := keyStore
		if store == nil {
			store = keys.New()
			if path := os.Getenv("PLATFORM_KEYS_FILE"); path != "" {
				if store, err = keys.WithFile(path); err != nil {
					return err
				}
				log.Info("enrolled keys persisted", "file", path, "keys", store.Len())
			}
		}
		enrollment, err := platform.NewEnrollment(adapter, store, cfg.BuilderID, cfg.BuilderFeePer100K, log)
		if err != nil {
			return err
		}
		registry = platform.NewRegistry(store, platform.PerplFactory(cfg, log), limits, ledger, eng, log)
		registry.UsePrefs(prefs)
		if db != nil {
			registry.OnConnect = func(s *platform.Service) error { return s.Restore(ctx, db) }
		}
		defer registry.Close()
		handlerOpts = append(handlerOpts, platform.WithEnrollment(enrollment), platform.WithRegistry(registry))
		log.Info("enrollment enabled", "builder_id", cfg.BuilderID, "max_fee_per_100k", cfg.BuilderFeePer100K)
	} else {
		log.Warn("enrollment disabled: PERPL_BUILDER_ID is not set")
	}

	// The strategies' signals run on the platform's own market-data
	// connection, one per allowed market, shared by every wallet.
	signals := platform.NewSignals(adapter, log)
	go signals.Run(ctx, limits.AllowedSymbols)
	markets.Attach(registry, signals)
	go markets.Run(ctx)
	handlerOpts = append(handlerOpts, platform.WithSignals(signals), platform.WithLedger(ledger))

	// A position that ends while the phone is in a pocket says so. The
	// platform owns the exit — the horizon, the stop and the target are its
	// own — so it is the only thing that can tell anyone the trade is over.
	// Without a database there is nowhere to keep a device, and the endpoint
	// says notifications are off rather than pretending.
	if db != nil {
		push := platform.NewPush(db, log)
		ledger.OnClosed(push.Closed)
		handlerOpts = append(handlerOpts, platform.WithDevices(db))
		log.Info("push notifications enabled")
	}

	// The market context card (Nansen) and any-chain deposits (Aurora)
	// are partner integrations: each is on when its key is set and absent
	// from the API otherwise.
	if key := os.Getenv("NANSEN_API_KEY"); key != "" {
		n, err := insight.NewNansen(key, os.Getenv("NANSEN_API_URL"))
		if err != nil {
			return err
		}
		tokens, err := contextTokens(envOr("NANSEN_TOKENS", "MON=monad:0x3bd359c1119da7da1d913d1c4d2b7c461115433a"))
		if err != nil {
			return err
		}
		ttl, err := time.ParseDuration(envOr("NANSEN_CACHE", "24h"))
		if err != nil {
			return fmt.Errorf("NANSEN_CACHE: %w", err)
		}
		mc := platform.NewMarketContext(n, tokens, ttl, log)
		if db != nil {
			// The last card per market outlives the process: a deploy
			// serves what the one before it paid for.
			mc.UseStore(db)
		}
		handlerOpts = append(handlerOpts, platform.WithMarketContext(mc))
		log.Info("market context enabled", "source", "nansen", "markets", len(tokens), "cache", ttl, "persisted", db != nil)
	} else {
		log.Warn("market context disabled: NANSEN_API_KEY is not set")
	}
	if url := os.Getenv("ENVIO_GRAPHQL_URL"); url != "" {
		c, err := envio.New(url)
		if err != nil {
			return err
		}
		handlerOpts = append(handlerOpts, platform.WithPrizeHistory(platform.NewPrizeHistory(c, log)))
		log.Info("prize history enabled", "source", "envio")
	} else {
		log.Warn("prize history disabled: ENVIO_GRAPHQL_URL is not set")
	}
	if key := os.Getenv("AURORA_API_KEY"); key != "" {
		a, err := deposit.NewAurora(key, os.Getenv("AURORA_API_URL"))
		if err != nil {
			return err
		}
		feeBps, _ := strconv.Atoi(envOr("AURORA_FEE_BPS", "0"))
		handlerOpts = append(handlerOpts, platform.WithDeposits(platform.NewDeposits(a, platform.DepositConfig{
			DestinationAsset: os.Getenv("AURORA_DESTINATION_ASSET"), FeeRecipient: os.Getenv("AURORA_FEE_RECIPIENT"), FeeBps: feeBps,
		}, log)))
		log.Info("any-chain deposits enabled", "source", "aurora")
	} else {
		log.Warn("any-chain deposits disabled: AURORA_API_KEY is not set")
	}

	// The weekly prize: every closed round trip adds to its strategy's pool
	// on-chain, and last week's winners are published once the week is over.
	if key, pool := os.Getenv("PLATFORM_SETTLER_KEY"), os.Getenv("PLATFORM_PRIZE_POOL_ADDRESS"); key != "" && pool != "" {
		if db == nil {
			return fmt.Errorf("the prize pool needs DATABASE_URL: winners are computed from the journal")
		}
		act, err := adapter.Activation(ctx)
		if err != nil {
			return fmt.Errorf("prize pool: read collateral token: %w", err)
		}
		share, err := strconv.Atoi(envOr("PLATFORM_PRIZE_FEE_SHARE", "50"))
		if err != nil || share < 0 || share > 100 {
			return fmt.Errorf("PLATFORM_PRIZE_FEE_SHARE: want a percent 0..100, got %q", envOr("PLATFORM_PRIZE_FEE_SHARE", "50"))
		}
		prize, err := platform.NewPrize(ctx, platform.PrizeConfig{
			RPCURL: envOr("PLATFORM_CHAIN_RPC", act.RPCURL), PrivateKey: key, Contract: pool, Token: act.CollateralToken, FeeShare: share,
		}, db, log)
		if err != nil {
			return err
		}
		go prize.Run(ctx)
		handlerOpts = append(handlerOpts, platform.WithPrize(prize))
		if token := os.Getenv("PLATFORM_ADMIN_TOKEN"); token != "" {
			handlerOpts = append(handlerOpts, platform.WithAdminToken(token))
			log.Info("operator endpoints enabled: the weekly prize receipt")
		} else {
			log.Warn("operator endpoints disabled: PLATFORM_ADMIN_TOKEN is not set; weeks cannot be funded or settled")
		}
	} else {
		log.Warn("prize pool disabled: PLATFORM_SETTLER_KEY or PLATFORM_PRIZE_POOL_ADDRESS is not set")
	}

	// Bind to loopback unless told otherwise: this API places orders and has
	// no authentication yet.
	addr := envOr("PLATFORM_ADDR", "127.0.0.1:8080")
	if port := os.Getenv("PORT"); port != "" && os.Getenv("PLATFORM_ADDR") == "" {
		// A hosted process is told its port and must listen on every interface.
		addr = "0.0.0.0:" + port
	}
	// Only the web build of the app needs CORS; the defaults cover Expo's
	// dev server. The native app talks to the API directly.
	corsOrigins := splitList(envOr("PLATFORM_CORS_ORIGINS", "http://localhost:8081,http://localhost:19006"))
	// Trading the platform's own account through the API is for development
	// and the browser tests; a hosted platform serves enrolled wallets only.
	if ownAccount := envOr("PLATFORM_OWN_ACCOUNT", "0") == "1"; ownAccount {
		handlerOpts = append(handlerOpts, platform.WithOwnAccount(true))
		log.Warn("the platform's own account is tradable through the API (PLATFORM_OWN_ACCOUNT=1)")
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           platform.Handler(svc, log, append(handlerOpts, platform.WithCORS(corsOrigins))...),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	log.Info("platform listening", "addr", addr, "venue", adapter.Name(), "network", cfg.Network.Name, "wallet", adapter.WalletAddress(),
		"allowed", limits.AllowedSymbols, "max_notional", limits.MaxNotional, "daily_loss", limits.DailyLoss)

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// limitsFromEnv reads the policy limits. The defaults are deliberately small
// testnet numbers; a deployment sets its own.
//
//	PLATFORM_ALLOWED_SYMBOLS   comma-separated; default * — every market the venue lists
//	PLATFORM_MIN_NOTIONAL      default 5
//	PLATFORM_MAX_NOTIONAL      default 50
//	PLATFORM_MAX_LEVERAGE      default 3
//	PLATFORM_MAX_EXPOSURE      default 100
//	PLATFORM_MAX_POSITIONS     default 2
//	PLATFORM_DAILY_LOSS        default 25
//	PLATFORM_COOLDOWN_SECONDS  default 5
func limitsFromEnv() (policy.Limits, error) {
	var l policy.Limits
	var err error

	for _, sym := range splitList(envOr("PLATFORM_ALLOWED_SYMBOLS", "*")) {
		if sym = strings.ToUpper(strings.TrimSpace(sym)); sym != "" && sym != "*" {
			l.AllowedSymbols = append(l.AllowedSymbols, sym)
		}
	}
	if l.MinNotional, err = decimalEnv("PLATFORM_MIN_NOTIONAL", "5"); err != nil {
		return l, err
	}
	if l.MaxNotional, err = decimalEnv("PLATFORM_MAX_NOTIONAL", "50"); err != nil {
		return l, err
	}
	if l.MaxLeverage, err = decimalEnv("PLATFORM_MAX_LEVERAGE", "3"); err != nil {
		return l, err
	}
	if l.MaxTotalExposure, err = decimalEnv("PLATFORM_MAX_EXPOSURE", "100"); err != nil {
		return l, err
	}
	if l.DailyLoss, err = decimalEnv("PLATFORM_DAILY_LOSS", "25"); err != nil {
		return l, err
	}
	positions, err := strconv.Atoi(envOr("PLATFORM_MAX_POSITIONS", "2"))
	if err != nil {
		return l, fmt.Errorf("PLATFORM_MAX_POSITIONS: %w", err)
	}
	l.MaxOpenPositions = positions
	cooldown, err := strconv.ParseFloat(envOr("PLATFORM_COOLDOWN_SECONDS", "5"), 64)
	if err != nil {
		return l, fmt.Errorf("PLATFORM_COOLDOWN_SECONDS: %w", err)
	}
	l.Cooldown = time.Duration(cooldown * float64(time.Second))
	// Validated once the venue's markets are in (see MarketSync in main):
	// with no list configured there is nothing to allow until then.
	if len(l.AllowedSymbols) == 0 {
		return l, nil
	}
	return l, l.Validate()
}

func decimalEnv(key, def string) (fixed.D, error) {
	d, err := fixed.Parse(envOr(key, def))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

// contextTokens parses "MON=monad:0xabc...,ETH=ethereum:0xdef..." into the
// on-chain references the market context reads.
func contextTokens(spec string) (map[string]platform.TokenRef, error) {
	out := make(map[string]platform.TokenRef)
	for _, item := range splitList(spec) {
		sym, ref, ok := strings.Cut(item, "=")
		chain, addr, ok2 := strings.Cut(ref, ":")
		if !ok || !ok2 || sym == "" || chain == "" || !strings.HasPrefix(addr, "0x") {
			return nil, fmt.Errorf("NANSEN_TOKENS: expected SYMBOL=chain:0xaddress, got %q", item)
		}
		out[strings.ToUpper(sym)] = platform.TokenRef{Chain: chain, Address: addr, Symbol: sym}
	}
	return out, nil
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ownMaxLeverage is the venue's leverage ceiling across the allowed markets,
// for the platform's own account; the configured number when unknown.
func ownMaxLeverage(ctx context.Context, svc *platform.Service, limits policy.Limits) fixed.D {
	ms, err := svc.Markets(ctx)
	if err != nil {
		return limits.MaxLeverage
	}
	var out fixed.D
	for _, m := range ms {
		if !slices.Contains(limits.AllowedSymbols, strings.ToUpper(m.Symbol)) {
			continue
		}
		if m.MaxLeverage.Cmp(out) > 0 {
			out = m.MaxLeverage
		}
	}
	if !out.IsPos() {
		return limits.MaxLeverage
	}
	return out
}
