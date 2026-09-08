// Command perplenroll exercises Perpl API-key enrollment.
//
// With -check it stops after the payload step: no wallet signature, no key
// created. That is enough to verify that a builder code is registered and that
// our Origin is whitelisted, because the server validates both before it
// issues a payload.
//
//	go run ./cmd/perplenroll -check -builder 18 -fee 50
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/envfile"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

func main() {
	var (
		check   = flag.Bool("check", true, "payload step only; verifies the builder code and Origin without creating a key")
		builder = flag.Int("builder", 0, "builder id to bind (default: PERPL_BUILDER_ID)")
		fee     = flag.Int("fee", 0, "max builder fee per 100k the user would sign for (1 = 0.1 bps, max 100)")
		address = flag.String("address", "", "wallet address the key is for (default: a placeholder for -check)")
		label   = flag.String("label", "super-agent", "key label")
	)
	flag.Parse()

	if err := run(*check, *builder, *fee, *address, *label); err != nil {
		fmt.Fprintf(os.Stderr, "perplenroll: %v\n", err)
		os.Exit(1)
	}
}

func run(check bool, builder, fee int, address, label string) error {
	if err := envfile.LoadNearest(".env"); err != nil {
		return err
	}
	cfg, err := perpl.ConfigFromEnv()
	if err != nil {
		return err
	}
	if builder == 0 {
		builder = cfg.BuilderID
	}
	if !check {
		return fmt.Errorf("full enrollment needs the user's wallet signature and is done from the app; only -check is supported here")
	}
	if address == "" {
		// The payload step does not verify ownership; any well-formed address
		// lets the server validate the builder code and Origin.
		address = "0x000000000000000000000000000000000000dEaD"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The payload step is unauthenticated. Dropping the credentials keeps the
	// adapter from opening a trading socket it does not need — and from
	// failing on mainnet when the key in .env belongs to testnet.
	cfg.APIKey, cfg.APIKeySecret = "", ""
	adapter, err := perpl.New(ctx, cfg, nil)
	if err != nil {
		return err
	}
	defer adapter.Close()

	pub, _, err := perpl.NewAPIKeyPair()
	if err != nil {
		return err
	}

	origin := cfg.EnrollOrigin
	if origin == "" {
		origin = "(none — server-side path)"
	}
	fmt.Printf("network %s  origin %s  builder %d  fee ceiling %d per 100k\n",
		cfg.Network.Name, origin, builder, fee)

	payload, err := adapter.EnrollmentPayload(ctx, perpl.EnrollmentRequest{
		Address:              address,
		PublicKey:            pub,
		ScopeMask:            perpl.ScopeRead | perpl.ScopeTrade,
		Label:                label,
		BuilderID:            builder,
		MaxBuilderFeePer100K: fee,
	})
	if err != nil {
		return err
	}

	fmt.Println("payload issued: builder code and origin accepted by the server")
	if id, ceiling, ok := payload.BuilderTerms(); ok {
		fmt.Printf("  bound terms: builderId=%d maxBuilderFeePer100K=%d\n", id, ceiling)
	}
	if st := payload.Statement(); st != "" {
		fmt.Printf("  the user would read: %q\n", st)
	}
	fmt.Println("no key was created (-check)")
	return nil
}
