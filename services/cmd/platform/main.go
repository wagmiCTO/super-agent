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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/envfile"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/platform"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
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

	ownKey := adapter.WalletAddress()
	if ownKey == "" {
		ownKey = "platform"
	}
	// One policy engine and one ledger for everyone: accounts are keyed by
	// wallet, and the leaderboard is a single table.
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
		if keyStore, err = keys.WithBackend(ctx, keyBackend{db}); err != nil {
			return err
		}
		log.Info("database connected", "keys", keyStore.Len())
	} else {
		log.Warn("DATABASE_URL is not set: state lives in memory and is lost on restart")
	}
	svc, err := platform.New(ctx, adapter, eng, ownKey, limits, log)
	if err != nil {
		return err
	}
	if db != nil {
		if err := svc.Restore(ctx, db); err != nil {
			return err
		}
	}

	// Enrollment of user wallets needs our builder code; without one the
	// endpoints answer 503 and the platform trades with its own key only.
	handlerOpts := []platform.Option{}
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
		registry := platform.NewRegistry(store, platform.PerplFactory(cfg, log), limits, ledger, eng, log)
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
	handlerOpts = append(handlerOpts, platform.WithSignals(signals), platform.WithLedger(ledger))

	// Bind to loopback unless told otherwise: this API places orders and has
	// no authentication yet.
	addr := envOr("PLATFORM_ADDR", "127.0.0.1:8080")
	// Only the web build of the app needs CORS; the defaults cover Expo's
	// dev server. The native app talks to the API directly.
	corsOrigins := splitList(envOr("PLATFORM_CORS_ORIGINS", "http://localhost:8081,http://localhost:19006"))
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
//	PLATFORM_ALLOWED_SYMBOLS   comma-separated, default MON
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

	for _, sym := range splitList(envOr("PLATFORM_ALLOWED_SYMBOLS", "MON")) {
		l.AllowedSymbols = append(l.AllowedSymbols, strings.ToUpper(sym))
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
	return l, l.Validate()
}

func decimalEnv(key, def string) (fixed.D, error) {
	d, err := fixed.Parse(envOr(key, def))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
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
