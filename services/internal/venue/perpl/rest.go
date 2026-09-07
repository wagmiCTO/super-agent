package perpl

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// restClient performs the HTTP half of the API. Signing is optional: the public
// endpoints (context, candles, funding) need no credentials.
type restClient struct {
	base   string
	http   *http.Client
	signer *signer
}

func newRESTClient(base string, timeout time.Duration, s *signer) *restClient {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &restClient{base: base, http: &http.Client{Timeout: timeout}, signer: s}
}

// httpError carries the status and body of a failed request. 429 and 5xx are
// retried by the caller; 401 and 403 are not, because a retry cannot fix a bad
// key or a missing scope.
type httpError struct {
	Status int
	Target string
	Body   string
}

func (e *httpError) Error() string {
	return fmt.Sprintf("perpl: %s: HTTP %d: %s", e.Target, e.Status, e.Body)
}

// Retryable reports whether repeating the request could succeed.
func (e *httpError) Retryable() bool {
	return e.Status == http.StatusTooManyRequests || e.Status >= 500
}

// get performs an unauthenticated GET.
func (c *restClient) get(ctx context.Context, target string, out any) error {
	return c.do(ctx, http.MethodGet, target, nil, false, out)
}

// getSigned performs a GET signed with the API key.
func (c *restClient) getSigned(ctx context.Context, target string, out any) error {
	return c.do(ctx, http.MethodGet, target, nil, true, out)
}

// do issues one request, retrying on 429 and 5xx with exponential backoff. Each
// attempt is signed afresh: a nonce is single-use and a timestamp goes stale.
func (c *restClient) do(ctx context.Context, method, target string, body []byte, sign bool, out any) error {
	const maxAttempts = 4
	var lastErr error
	for attempt := range maxAttempts {
		if attempt > 0 {
			delay := time.Duration(1<<(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}
		err := c.attempt(ctx, method, target, body, sign, out)
		if err == nil {
			return nil
		}
		var he *httpError
		if !errors.As(err, &he) || !he.Retryable() {
			return err
		}
		lastErr = err
	}
	return fmt.Errorf("perpl: %s: giving up after %d attempts: %w", target, maxAttempts, lastErr)
}

func (c *restClient) attempt(ctx context.Context, method, target string, body []byte, sign bool, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.base+target, bodyReader(body))
	if err != nil {
		return fmt.Errorf("perpl: build request %s: %w", target, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if sign {
		if c.signer == nil {
			return errNoCredentials
		}
		headers, err := c.signer.restHeaders(method, target, body)
		if err != nil {
			return err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("perpl: %s: %w", target, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return &httpError{Status: resp.StatusCode, Target: target, Body: string(b)}
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("perpl: %s: decode response: %w", target, err)
	}
	return nil
}

// fetchContext reads chain, token, instance and market configuration. It is the
// source of truth for market ids, decimals, fee schedules and order TTL, all of
// which are per-market and change without notice.
func (c *restClient) fetchContext(ctx context.Context) (*contextResponse, error) {
	var out contextResponse
	if err := c.get(ctx, "/v1/pub/context", &out); err != nil {
		return nil, err
	}
	if len(out.Markets) == 0 {
		return nil, fmt.Errorf("perpl: context returned no markets")
	}
	return &out, nil
}

// maxCandlesPerRequest is the venue's cap on one candles call.
const maxCandlesPerRequest = 1024

// fetchCandles reads OHLCV history for a market. The venue caps a single
// request at 1024 bars, so longer ranges are paged.
func (c *restClient) fetchCandles(ctx context.Context, marketID, resolutionSec int, from, to time.Time) ([]candle, error) {
	if resolutionSec <= 0 {
		return nil, fmt.Errorf("perpl: candle resolution must be positive, got %d", resolutionSec)
	}
	step := time.Duration(resolutionSec) * time.Second * maxCandlesPerRequest

	var all []candle
	for start := from; start.Before(to); start = start.Add(step) {
		end := start.Add(step)
		if end.After(to) {
			end = to
		}
		target := fmt.Sprintf("/v1/market-data/%d/candles/%d/%d-%d",
			marketID, resolutionSec, start.UnixMilli(), end.UnixMilli())

		var page candleSeries
		if err := c.get(ctx, target, &page); err != nil {
			return nil, err
		}
		all = append(all, page.Data...)
	}
	return all, nil
}

func bodyReader(body []byte) io.Reader {
	if body == nil {
		return nil
	}
	return bytes.NewReader(body)
}
