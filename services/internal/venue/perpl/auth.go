package perpl

import (
	"context"
	"errors"
	"fmt"
)

// Wallet sign-in: the venue's own onboarding, which is what creates a wallet's
// profile. Until a wallet has a profile the venue answers API-key enrollment
// with 404, so this runs first. Measured on 2026-09-10 against testnet: a
// fresh wallet that signs the venue's SIWE message is a profile one call
// later, with no access code.
//
// The message is Sign-In-With-Ethereum text the venue composes; the wallet
// signs it as a personal message (EIP-191). The venue fills the domain from
// the request's Origin, so a server-side call with no Origin yields a message
// with an empty domain — which the venue then accepts, since it made it.

// AuthPayload is the sign-in message and the fields that must be echoed back.
type AuthPayload struct {
	Message  string `json:"message"`
	Nonce    string `json:"nonce"`
	IssuedAt int64  `json:"issued_at"`
	MAC      string `json:"mac"`
}

// AuthSession is what a successful sign-in returns. Profiles is the list of
// wallets this session may act for; for a plain wallet it is the wallet.
type AuthSession struct {
	Nonce     string   `json:"nonce"`
	ExpiresAt int64    `json:"expires_at"`
	Profiles  []string `json:"available_profiles"`
	Referrer  *string  `json:"referrer"`
}

// WalletAuthPayload asks the venue for the sign-in message for a wallet.
func (a *Adapter) WalletAuthPayload(ctx context.Context, address string) (AuthPayload, error) {
	if address == "" {
		return AuthPayload{}, errors.New("perpl: wallet address is required")
	}
	body := map[string]any{"address": address, "chain_id": a.cfg.Network.ChainID}
	var out AuthPayload
	if err := a.rest.post(ctx, "/v1/auth/payload", body, a.enrollHeaders(), &out); err != nil {
		return AuthPayload{}, err
	}
	if out.Message == "" || out.MAC == "" {
		return AuthPayload{}, errors.New("perpl: auth payload is missing message or mac")
	}
	return out, nil
}

// WalletAuthConnect submits the wallet's signature over the sign-in message.
// On a first sign-in this creates the wallet's profile at the venue; later
// calls simply sign in again. refCode is optional.
func (a *Adapter) WalletAuthConnect(ctx context.Context, address string, payload AuthPayload, signature, refCode string) (AuthSession, error) {
	body := map[string]any{
		"message":   payload.Message,
		"nonce":     payload.Nonce,
		"issued_at": payload.IssuedAt,
		"mac":       payload.MAC,
		"address":   address,
		"chain_id":  a.cfg.Network.ChainID,
		"signature": signature,
		"ref_code":  refCode,
	}
	var out AuthSession
	if err := a.rest.post(ctx, "/v1/auth/connect", body, a.enrollHeaders(), &out); err != nil {
		return AuthSession{}, fmt.Errorf("wallet sign-in: %w", err)
	}
	return out, nil
}
