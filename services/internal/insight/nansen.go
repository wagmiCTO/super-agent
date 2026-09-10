// Package insight reads on-chain market intelligence — who is buying and
// selling an asset, and how much — from Nansen, and turns it into the one
// card a player reads before an entry.
//
// Nansen's API is credit-metered, so the client here is thin and the
// caching lives with the caller: nothing in this package remembers anything.
package insight

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultBaseURL is Nansen's production API.
const DefaultBaseURL = "https://api.nansen.ai"

// Nansen is an HTTP client for the endpoints the card needs.
type Nansen struct {
	base   string
	apiKey string
	http   *http.Client
	// Credits is what the last response said about the plan, for the logs.
	Credits CreditInfo
}

// CreditInfo is what the credit headers said on the last call.
type CreditInfo struct {
	LastCost  int
	Remaining int
	Notice    string
}

var ErrNoKey = errors.New("insight: no Nansen API key")

// NewNansen takes the API key; base "" means production.
func NewNansen(apiKey, base string) (*Nansen, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, ErrNoKey
	}
	if base == "" {
		base = DefaultBaseURL
	}
	return &Nansen{base: strings.TrimRight(base, "/"), apiKey: apiKey, http: &http.Client{Timeout: 20 * time.Second}}, nil
}

// APIError is a non-2xx answer.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("nansen: HTTP %d %s: %s", e.Status, e.Code, e.Message)
}

func (n *Nansen) post(ctx context.Context, path string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.base+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", n.apiKey)
	resp, err := n.http.Do(req)
	if err != nil {
		return fmt.Errorf("nansen: %s: %w", path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	fmt.Sscan(resp.Header.Get("X-Nansen-Credits-Cost"), &n.Credits.LastCost)
	fmt.Sscan(resp.Header.Get("X-Nansen-Credits-Remaining"), &n.Credits.Remaining)
	n.Credits.Notice = resp.Header.Get("X-Nansen-Plan-Notice")
	if resp.StatusCode/100 != 2 {
		var e struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &e)
		return &APIError{Status: resp.StatusCode, Code: e.Code, Message: e.Message}
	}
	return json.Unmarshal(data, out)
}

// Pagination is the request page.
type Pagination struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
}

// DateRange is inclusive, YYYY-MM-DD.
type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Days returns the range covering the last n days up to now, UTC.
func Days(now time.Time, n int) DateRange {
	now = now.UTC()
	return DateRange{From: now.AddDate(0, 0, -n).Format("2006-01-02"), To: now.Format("2006-01-02")}
}

// ScreenerRow is one token in the token screener.
type ScreenerRow struct {
	Chain        string  `json:"chain"`
	TokenAddress string  `json:"token_address"`
	TokenSymbol  string  `json:"token_symbol"`
	MarketCapUSD float64 `json:"market_cap_usd"`
	Liquidity    float64 `json:"liquidity"`
	PriceUSD     float64 `json:"price_usd"`
	// PriceChange is a fraction over the timeframe: -0.0071 is -0.71%.
	PriceChange float64 `json:"price_change"`
	BuyVolume   float64 `json:"buy_volume"`
	SellVolume  float64 `json:"sell_volume"`
	Volume      float64 `json:"volume"`
	Netflow     float64 `json:"netflow"`
}

// Screener lists a chain's tokens with their volume and flow over the
// timeframe ("24h" and the like). One credit.
func (n *Nansen) Screener(ctx context.Context, chain, timeframe string, perPage int) ([]ScreenerRow, error) {
	var out struct {
		Data []ScreenerRow `json:"data"`
	}
	err := n.post(ctx, "/api/v1/token-screener", map[string]any{
		"chains": []string{chain}, "timeframe": timeframe, "pagination": Pagination{Page: 1, PerPage: perPage},
	}, &out)
	return out.Data, err
}

// Trader is one address in who-bought-sold.
type Trader struct {
	Address         string  `json:"address"`
	Label           string  `json:"address_label"`
	BoughtVolumeUSD float64 `json:"bought_volume_usd"`
	SoldVolumeUSD   float64 `json:"sold_volume_usd"`
	TradeVolumeUSD  float64 `json:"trade_volume_usd"`
}

// WhoBoughtSold lists the addresses that traded a token most over the
// range, biggest first. One credit.
func (n *Nansen) WhoBoughtSold(ctx context.Context, chain, token string, dates DateRange, perPage int) ([]Trader, error) {
	var out struct {
		Data []Trader `json:"data"`
	}
	err := n.post(ctx, "/api/v1/tgm/who-bought-sold", map[string]any{
		"chain": chain, "token_address": token, "date": dates, "pagination": Pagination{Page: 1, PerPage: perPage},
	}, &out)
	return out.Data, err
}

// FlowBucket is one hour of holder flows for a token.
type FlowBucket struct {
	Date       time.Time `json:"date"`
	BucketEnd  time.Time `json:"bucket_end"`
	IsComplete bool      `json:"is_complete"`
	PriceUSD   float64   `json:"price_usd"`
	// Inflows and Outflows are token amounts; outflows are negative.
	Inflows  float64 `json:"total_inflows_count"`
	Outflows float64 `json:"total_outflows_count"`
}

// Flows lists hourly flows for a token, newest first. One credit.
func (n *Nansen) Flows(ctx context.Context, chain, token string, dates DateRange, perPage int) ([]FlowBucket, error) {
	var out struct {
		Data []FlowBucket `json:"data"`
	}
	err := n.post(ctx, "/api/v1/tgm/flows", map[string]any{
		"chain": chain, "token_address": token, "date": dates, "pagination": Pagination{Page: 1, PerPage: perPage},
	}, &out)
	return out.Data, err
}
