package perpl

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Activation is what a wallet needs to know to open its exchange account
// on-chain. An enrolled API key only authorizes API access; trading needs an
// account created with collateral on the Exchange contract, and the account
// must then allow the exchange to forward API orders:
//
//	approve(exchange, amount) on the collateral token
//	createAccount(amount)      on the Exchange   — amount ≥ MinAccountOpenAmount
//	allowOrderForwarding(true) on the Exchange
//
// All three are sent by the wallet itself; the platform never holds a key
// that could send them.
type Activation struct {
	Network            string
	ChainID            int64
	RPCURL             string
	Explorer           string
	ExchangeAddress    string
	CollateralToken    string
	CollateralSymbol   string
	CollateralDecimals int
	// MinAccountOpenAmount is the raw on-chain integer (scaled by
	// 10^CollateralDecimals) the venue requires for createAccount.
	MinAccountOpenAmount string
}

// Activation reads the live venue configuration: the exchange contract and
// collateral token come from /pub/context rather than from a table here,
// because the docs and the live testnet have disagreed on the token.
func (a *Adapter) Activation(ctx context.Context) (Activation, error) {
	res, err := a.rest.fetchContext(ctx)
	if err != nil {
		return Activation{}, err
	}
	if len(res.Instances) == 0 {
		return Activation{}, errors.New("perpl: context lists no protocol instance")
	}
	inst := res.Instances[0]
	var tok token
	for _, tk := range res.Tokens {
		if tk.ID == inst.CollateralTokenID {
			tok = tk
		}
	}
	if tok.Address == "" || tok.Decimals == 0 {
		return Activation{}, fmt.Errorf("perpl: collateral token %d not in context", inst.CollateralTokenID)
	}
	if inst.MinAccountOpenAmount == "" {
		return Activation{}, errors.New("perpl: context has no min_account_open_amount")
	}
	exchange := inst.Address
	if exchange == "" {
		exchange = a.cfg.Network.ExchangeAddress
	}
	if !strings.EqualFold(exchange, a.cfg.Network.ExchangeAddress) {
		// The app will send collateral to this address; a mismatch with the
		// documented deployment must not go unnoticed.
		return Activation{}, fmt.Errorf("perpl: context exchange %s differs from configured %s", exchange, a.cfg.Network.ExchangeAddress)
	}
	explorer := a.cfg.Network.Explorer
	if len(res.Chain.Explorer) > 0 && res.Chain.Explorer[0] != "" {
		explorer = res.Chain.Explorer[0]
	}
	return Activation{
		Network:              a.cfg.Network.Name,
		ChainID:              a.cfg.Network.ChainID,
		RPCURL:               a.cfg.Network.RPCURL,
		Explorer:             explorer,
		ExchangeAddress:      strings.ToLower(exchange),
		CollateralToken:      strings.ToLower(tok.Address),
		CollateralSymbol:     tok.Symbol,
		CollateralDecimals:   tok.Decimals,
		MinAccountOpenAmount: inst.MinAccountOpenAmount,
	}, nil
}
