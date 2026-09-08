// Package perpl implements venue.Adapter for the Perpl perpetual futures
// exchange on Monad.
//
// Reference: https://github.com/PerplFoundation/api-docs
//
// Three things are separate on Perpl and all three are required to trade:
// an enrolled API key (authenticates), an on-chain exchange account (holds
// collateral), and the on-chain order-forwarding permission (lets the exchange
// submit orders for us). A missing permission is not an auth error — orders are
// acknowledged and then fail with reason 34.
package perpl

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// Network is one of the two Perpl deployments.
type Network struct {
	Name    string
	ChainID int64
	APIURL  string
	WSURL   string
	RPCURL  string
	// ExchangeAddress is the Exchange contract: createAccount and
	// allowOrderForwarding are called here.
	ExchangeAddress string
	Explorer        string
}

// Testnet and Mainnet as published by the API docs. Collateral token addresses
// are deliberately absent: the docs' .env.example disagrees with the live
// /pub/context on testnet, so the token is read from the context at runtime.
var (
	Testnet = Network{
		Name:            "testnet",
		ChainID:         10143,
		APIURL:          "https://testnet.perpl.xyz/api",
		WSURL:           "wss://testnet.perpl.xyz",
		RPCURL:          "https://testnet-rpc.monad.xyz",
		ExchangeAddress: "0x1964c32f0be608e7d29302aff5e61268e72080cc",
		Explorer:        "https://testnet.monadscan.com/",
	}
	Mainnet = Network{
		Name:            "mainnet",
		ChainID:         143,
		APIURL:          "https://app.perpl.xyz/api",
		WSURL:           "wss://app.perpl.xyz",
		RPCURL:          "https://rpc.monad.xyz",
		ExchangeAddress: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
		Explorer:        "https://monadscan.com/",
	}
)

// Config configures an adapter. APIKey and APIKeySecret may be empty, which
// yields a market-data-only adapter (see venue.ErrNoCredentials).
type Config struct {
	Network Network
	// APIKey is the opaque X-API-Key token from enrollment.
	APIKey string
	// APIKeySecret is the hex-encoded 32-byte Ed25519 private key.
	APIKeySecret string
	// AccountID is the on-chain exchange account. Zero means "discover it
	// from the wallet snapshot on connect", which is the normal case.
	AccountID uint64
	// BuilderID is our registered builder code (1..255). It is bound to an
	// API key at enrollment and frozen there; orders never carry it.
	BuilderID int
	// BuilderFeePer100K is the fee charged per order, in hundred-thousandths
	// (1 = 0.1 bps), capped at 100 by the protocol. It is only accepted on a
	// builder-bound key.
	BuilderFeePer100K int
	// EnrollOrigin is the HTTP Origin sent when enrolling API keys. Perpl
	// whitelists it per integration; an unlisted origin is rejected.
	EnrollOrigin string
	// HTTPTimeout bounds a single REST call.
	HTTPTimeout time.Duration
}

// ErrMainnetNotEnabled guards against reaching mainnet by accident: the
// hackathon and all development run on testnet, and mainnet must be a loud,
// explicit choice.
var ErrMainnetNotEnabled = errors.New("perpl: mainnet requires PERPL_ALLOW_MAINNET=1")

// ConfigFromEnv reads a Config from the environment, defaulting to testnet.
//
//	PERPL_NETWORK          testnet (default) | mainnet
//	PERPL_API_KEY          X-API-Key token
//	PERPL_API_KEY_SECRET   hex Ed25519 private key
//	PERPL_ACCOUNT_ID       optional, discovered when unset
//	PERPL_BUILDER_ID       optional, our registered builder code
//	PERPL_BUILDER_FEE_PER_100K  optional, requires a builder-bound key
//	PERPL_ENROLL_ORIGIN    Origin header for key enrollment, whitelisted by Perpl
//	PERPL_ALLOW_MAINNET    must be 1 to select mainnet
func ConfigFromEnv() (Config, error) {
	cfg := Config{
		Network:      Testnet,
		APIKey:       os.Getenv("PERPL_API_KEY"),
		APIKeySecret: strings.TrimPrefix(os.Getenv("PERPL_API_KEY_SECRET"), "0x"),
		HTTPTimeout:  15 * time.Second,
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PERPL_NETWORK"))) {
	case "", "testnet":
	case "mainnet":
		if os.Getenv("PERPL_ALLOW_MAINNET") != "1" {
			return Config{}, ErrMainnetNotEnabled
		}
		cfg.Network = Mainnet
	default:
		return Config{}, fmt.Errorf("perpl: unknown PERPL_NETWORK %q", os.Getenv("PERPL_NETWORK"))
	}
	if v := os.Getenv("PERPL_ACCOUNT_ID"); v != "" {
		var id uint64
		if _, err := fmt.Sscan(v, &id); err != nil {
			return Config{}, fmt.Errorf("perpl: bad PERPL_ACCOUNT_ID %q: %w", v, err)
		}
		cfg.AccountID = id
	}
	if v := os.Getenv("PERPL_BUILDER_ID"); v != "" {
		var id int
		if _, err := fmt.Sscan(v, &id); err != nil {
			return Config{}, fmt.Errorf("perpl: bad PERPL_BUILDER_ID %q: %w", v, err)
		}
		if id < 1 || id > maxBuilderID {
			return Config{}, fmt.Errorf("perpl: builder id %d out of range 1..%d", id, maxBuilderID)
		}
		cfg.BuilderID = id
	}
	cfg.EnrollOrigin = strings.TrimSpace(os.Getenv("PERPL_ENROLL_ORIGIN"))
	if v := os.Getenv("PERPL_BUILDER_FEE_PER_100K"); v != "" {
		var bf int
		if _, err := fmt.Sscan(v, &bf); err != nil {
			return Config{}, fmt.Errorf("perpl: bad PERPL_BUILDER_FEE_PER_100K %q: %w", v, err)
		}
		if bf < 0 || bf > maxBuilderFeePer100K {
			return Config{}, fmt.Errorf("perpl: builder fee %d out of range 0..%d", bf, maxBuilderFeePer100K)
		}
		cfg.BuilderFeePer100K = bf
	}
	return cfg, nil
}

// HasCredentials reports whether the config can authenticate.
func (c Config) HasCredentials() bool { return c.APIKey != "" && c.APIKeySecret != "" }

const (
	maxBuilderFeePer100K = 100 // protocol ceiling: 0.1%
	maxBuilderID         = 255 // uint8 on-chain
)
