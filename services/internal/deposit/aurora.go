// Package deposit brings collateral to the wallet from any chain through
// Aurora Intents Deposits: pick what you hold and where, get a one-time
// deposit address, send, and the funds arrive on Monad in the wallet.
// Aurora runs the swap and the bridge; the platform only quotes, hands
// over the address, and reports status. Nothing here holds funds.
package deposit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL is Aurora's production Intents API.
const DefaultBaseURL = "https://intents-api.aurora.dev"

var ErrNoKey = errors.New("deposit: no Aurora API key")

// Aurora is an HTTP client for the deposits API.
type Aurora struct {
	base   string
	apiKey string
	http   *http.Client
}

func NewAurora(apiKey, base string) (*Aurora, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, ErrNoKey
	}
	if base == "" {
		base = DefaultBaseURL
	}
	return &Aurora{base: strings.TrimRight(base, "/"), apiKey: apiKey, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

// APIError is a non-2xx answer; Message is Aurora's text, meant for people.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("aurora: HTTP %d: %s", e.Status, e.Message) }

func (a *Aurora) do(ctx context.Context, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("aurora: %s: %w", strings.SplitN(path, "/"+a.apiKey, 2)[0], err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Message == "" {
			e.Message = strings.TrimSpace(string(data))
		}
		return &APIError{Status: resp.StatusCode, Message: e.Message}
	}
	return json.Unmarshal(data, out)
}

// Token is one asset Aurora can take or deliver.
type Token struct {
	AssetID         string  `json:"assetId"`
	Decimals        int     `json:"decimals"`
	Blockchain      string  `json:"blockchain"`
	Symbol          string  `json:"symbol"`
	Price           float64 `json:"price"`
	ContractAddress string  `json:"contractAddress,omitempty"`
}

// Tokens lists every supported asset.
func (a *Aurora) Tokens(ctx context.Context) ([]Token, error) {
	var out struct {
		Tokens []Token `json:"tokens"`
	}
	err := a.do(ctx, http.MethodGet, "/api/tokens/"+a.apiKey, nil, &out)
	return out.Tokens, err
}

// QuoteRequest asks for a deposit: send Amount of OriginAsset, receive
// DestinationAsset at Recipient; refunds go to RefundTo on the origin chain.
type QuoteRequest struct {
	Dry              bool
	OriginAsset      string
	DestinationAsset string
	// Amount is in the origin asset's smallest unit.
	Amount    string
	Recipient string
	RefundTo  string
	// SlippageBps is the tolerance in basis points.
	SlippageBps int
	Deadline    time.Time
	// AppFeeRecipient and AppFeeBps add the integrator's fee; zero adds none.
	AppFeeRecipient string
	AppFeeBps       int
}

// Quote is Aurora's answer: where to send and what arrives.
type Quote struct {
	CorrelationID      string    `json:"correlationId"`
	TimeEstimateSec    int       `json:"timeEstimate"`
	Deadline           time.Time `json:"deadline"`
	DepositAddress     string    `json:"depositAddress"`
	DepositMemo        string    `json:"depositMemo,omitempty"`
	AmountIn           string    `json:"amountIn"`
	AmountInFormatted  string    `json:"amountInFormatted"`
	AmountInUSD        string    `json:"amountInUsd"`
	MinAmountIn        string    `json:"minAmountIn"`
	AmountOut          string    `json:"amountOut"`
	AmountOutFormatted string    `json:"amountOutFormatted"`
	AmountOutUSD       string    `json:"amountOutUsd"`
	MinAmountOut       string    `json:"minAmountOut"`
}

// Quote asks for a quote; with Dry no deposit address is reserved.
func (a *Aurora) Quote(ctx context.Context, q QuoteRequest) (Quote, error) {
	body := map[string]any{
		"dry":                q.Dry,
		"swapType":           "EXACT_INPUT",
		"depositType":        "ORIGIN_CHAIN",
		"depositMode":        "SIMPLE",
		"amount":             q.Amount,
		"originAsset":        q.OriginAsset,
		"destinationAsset":   q.DestinationAsset,
		"slippageTolerance":  q.SlippageBps,
		"refundTo":           q.RefundTo,
		"refundType":         "ORIGIN_CHAIN",
		"recipient":          q.Recipient,
		"recipientType":      "DESTINATION_CHAIN",
		"deadline":           q.Deadline.UTC().Format(time.RFC3339),
		"quoteWaitingTimeMs": 3000,
	}
	if q.AppFeeRecipient != "" && q.AppFeeBps > 0 {
		body["appFees"] = []map[string]any{{"recipient": q.AppFeeRecipient, "fee": q.AppFeeBps}}
	}
	var out struct {
		CorrelationID string `json:"correlationId"`
		Quote         Quote  `json:"quote"`
	}
	if err := a.do(ctx, http.MethodPost, "/api/quote/"+a.apiKey, body, &out); err != nil {
		return Quote{}, err
	}
	out.Quote.CorrelationID = out.CorrelationID
	return out.Quote, nil
}

// Status is where a deposit stands.
type Status struct {
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updatedAt"`
	Details   struct {
		AmountIn         string   `json:"amountIn"`
		AmountOut        string   `json:"amountOut"`
		OriginTxHashes   []TxRef  `json:"originChainTxHashes"`
		DestinationTxRef []TxRef  `json:"destinationChainTxHashes"`
		RefundedAmount   string   `json:"refundedAmount"`
		Raw              []string `json:"-"`
	} `json:"swapDetails"`
}

// TxRef is a transaction Aurora saw.
type TxRef struct {
	Hash     string `json:"hash"`
	Explorer string `json:"explorerUrl"`
}

// Status reports a deposit by its address. Values: PENDING_DEPOSIT,
// KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED.
func (a *Aurora) Status(ctx context.Context, depositAddress string) (Status, error) {
	var out Status
	err := a.do(ctx, http.MethodGet, "/api/status/"+a.apiKey+"?depositAddress="+url.QueryEscape(depositAddress), nil, &out)
	return out, err
}

// SubmitDeposit tells Aurora the deposit transaction was sent; optional,
// it only speeds things up.
func (a *Aurora) SubmitDeposit(ctx context.Context, depositAddress, txHash string) error {
	var out map[string]any
	return a.do(ctx, http.MethodPost, "/api/deposit/submit/"+a.apiKey, map[string]string{"depositAddress": depositAddress, "txHash": txHash}, &out)
}
