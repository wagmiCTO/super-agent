// Package envio reads what the prize-pool indexer (indexers/prize-pool,
// Envio HyperIndex) has seen on-chain: pools per week and strategy, the
// prizes in them and whether they were claimed. The platform's own view of
// prizes comes from its journal; this is the chain's view, for the lobby's
// history and for anyone who wants to check the platform against the chain.
package envio

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

var ErrNoURL = errors.New("envio: no GraphQL endpoint configured")

// Client posts GraphQL queries to a HyperIndex endpoint.
type Client struct {
	url  string
	http *http.Client
}

func New(url string) (*Client, error) {
	if strings.TrimSpace(url) == "" {
		return nil, ErrNoURL
	}
	return &Client{url: strings.TrimSpace(url), http: &http.Client{Timeout: 15 * time.Second}}, nil
}

// Query runs one GraphQL query and decodes `data` into out.
func (c *Client) Query(ctx context.Context, query string, variables map[string]any, out any) error {
	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("envio: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("envio: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var env struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("envio: bad response: %w", err)
	}
	if len(env.Errors) > 0 {
		return fmt.Errorf("envio: %s", env.Errors[0].Message)
	}
	return json.Unmarshal(env.Data, out)
}

// Pool is one week of one strategy as the chain saw it.
type Pool struct {
	ID        string  `json:"id"`
	Week      string  `json:"week"`
	Strategy  string  `json:"strategy"` // bytes32 hex of keccak(strategy id)
	Funded    string  `json:"funded"`
	Fundings  int     `json:"fundings"`
	Settled   bool    `json:"settled"`
	SettledAt *string `json:"settledAt"`
	Carried   string  `json:"carried"`
	Winners   int     `json:"winners"`
	Claimed   string  `json:"claimed"`
	Prizes    []Prize `json:"prizes"`
}

// Prize is one winner's line.
type Prize struct {
	Wallet    string  `json:"wallet"`
	Rank      int     `json:"rank"`
	Amount    string  `json:"amount"`
	PnL       string  `json:"pnl"`
	Claimed   bool    `json:"claimed"`
	ClaimedAt *string `json:"claimedAt"`
	ClaimTx   *string `json:"claimTx"`
}

// Totals is the one-row summary across every week.
type Totals struct {
	Funded       string `json:"funded"`
	Paid         string `json:"paid"`
	Claimed      string `json:"claimed"`
	Pools        int    `json:"pools"`
	SettledPools int    `json:"settledPools"`
}

const poolsQuery = `query($limit: Int!) {
  Pool(order_by: {week: desc}, limit: $limit) {
    id week strategy funded fundings settled settledAt carried winners claimed
    prizes(order_by: {rank: asc}) { wallet rank amount pnl claimed claimedAt claimTx }
  }
  Totals { funded paid claimed pools settledPools }
}`

// Pools reads the newest pools with their prizes, and the totals.
func (c *Client) Pools(ctx context.Context, limit int) ([]Pool, Totals, error) {
	var out struct {
		Pool   []Pool   `json:"Pool"`
		Totals []Totals `json:"Totals"`
	}
	if err := c.Query(ctx, poolsQuery, map[string]any{"limit": limit}, &out); err != nil {
		return nil, Totals{}, err
	}
	var t Totals
	if len(out.Totals) > 0 {
		t = out.Totals[0]
	}
	return out.Pool, t, nil
}
