package chain

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Client is a minimal Ethereum JSON-RPC client: what settlement and reads need.
type Client struct {
	url  string
	http *http.Client
	id   atomic.Int64
}

func NewClient(url string) *Client {
	return &Client{url: strings.TrimRight(url, "/"), http: &http.Client{Timeout: 20 * time.Second}}
}

// RPCError is a JSON-RPC error object; reverts arrive this way.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *RPCError) Error() string { return fmt.Sprintf("rpc error %d: %s", e.Code, e.Message) }

func (c *Client) call(ctx context.Context, method string, params []any, out any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": c.id.Add(1), "method": method, "params": params})
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
		return fmt.Errorf("chain: %s: %w", method, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("chain: %s: bad response: %w", method, err)
	}
	if env.Error != nil {
		return fmt.Errorf("chain: %s: %w", method, env.Error)
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

func hexQuantity(s string) (*big.Int, error) {
	v, ok := new(big.Int).SetString(strings.TrimPrefix(s, "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("chain: bad quantity %q", s)
	}
	return v, nil
}

func (c *Client) quantity(ctx context.Context, method string, params ...any) (*big.Int, error) {
	var s string
	if err := c.call(ctx, method, params, &s); err != nil {
		return nil, err
	}
	return hexQuantity(s)
}

func (c *Client) ChainID(ctx context.Context) (uint64, error) {
	v, err := c.quantity(ctx, "eth_chainId")
	if err != nil {
		return 0, err
	}
	return v.Uint64(), nil
}

// Nonce is the pending transaction count, so queued sends line up.
func (c *Client) Nonce(ctx context.Context, addr [20]byte) (uint64, error) {
	v, err := c.quantity(ctx, "eth_getTransactionCount", addrHex(addr), "pending")
	if err != nil {
		return 0, err
	}
	return v.Uint64(), nil
}

func (c *Client) Balance(ctx context.Context, addr [20]byte) (*big.Int, error) {
	return c.quantity(ctx, "eth_getBalance", addrHex(addr), "latest")
}

// Fees suggests a fee cap and a tip from the node.
func (c *Client) Fees(ctx context.Context) (feeCap, tipCap *big.Int, err error) {
	gasPrice, err := c.quantity(ctx, "eth_gasPrice")
	if err != nil {
		return nil, nil, err
	}
	tip, err := c.quantity(ctx, "eth_maxPriorityFeePerGas")
	if err != nil {
		tip = new(big.Int).Set(gasPrice) // nodes without the method: pay the price
	}
	// Room for the base fee to move while the transaction is queued.
	feeCap = new(big.Int).Mul(gasPrice, big.NewInt(2))
	if feeCap.Cmp(tip) < 0 {
		feeCap = new(big.Int).Set(tip)
	}
	return feeCap, tip, nil
}

// EstimateGas asks the node; the caller adds its own margin.
func (c *Client) EstimateGas(ctx context.Context, from [20]byte, to [20]byte, data []byte) (uint64, error) {
	v, err := c.quantity(ctx, "eth_estimateGas", map[string]string{"from": addrHex(from), "to": addrHex(to), "data": "0x" + hex.EncodeToString(data)})
	if err != nil {
		return 0, err
	}
	return v.Uint64(), nil
}

// Call runs a read-only call against the latest block.
func (c *Client) Call(ctx context.Context, to [20]byte, data []byte) ([]byte, error) {
	var s string
	if err := c.call(ctx, "eth_call", []any{map[string]string{"to": addrHex(to), "data": "0x" + hex.EncodeToString(data)}, "latest"}, &s); err != nil {
		return nil, err
	}
	return hex.DecodeString(strings.TrimPrefix(s, "0x"))
}

// SendRaw submits a signed transaction and returns its hash.
func (c *Client) SendRaw(ctx context.Context, raw []byte) ([32]byte, error) {
	var s string
	if err := c.call(ctx, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(raw)}, &s); err != nil {
		return [32]byte{}, err
	}
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil || len(b) != 32 {
		return [32]byte{}, fmt.Errorf("chain: bad tx hash %q", s)
	}
	var h [32]byte
	copy(h[:], b)
	return h, nil
}

// Receipt is the part of a transaction receipt settlement cares about.
type Receipt struct {
	Status      uint64
	BlockNumber uint64
	GasUsed     uint64
}

var ErrNotMined = errors.New("chain: transaction not mined yet")

func (c *Client) Receipt(ctx context.Context, hash [32]byte) (Receipt, error) {
	var r struct {
		Status      string `json:"status"`
		BlockNumber string `json:"blockNumber"`
		GasUsed     string `json:"gasUsed"`
	}
	var raw json.RawMessage
	if err := c.call(ctx, "eth_getTransactionReceipt", []any{"0x" + hex.EncodeToString(hash[:])}, &raw); err != nil {
		return Receipt{}, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return Receipt{}, ErrNotMined
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return Receipt{}, err
	}
	status, _ := hexQuantity(r.Status)
	block, _ := hexQuantity(r.BlockNumber)
	gas, _ := hexQuantity(r.GasUsed)
	return Receipt{Status: status.Uint64(), BlockNumber: block.Uint64(), GasUsed: gas.Uint64()}, nil
}

// WaitMined polls until the receipt exists or ctx ends.
func (c *Client) WaitMined(ctx context.Context, hash [32]byte, every time.Duration) (Receipt, error) {
	for {
		r, err := c.Receipt(ctx, hash)
		if err == nil {
			return r, nil
		}
		if !errors.Is(err, ErrNotMined) {
			return Receipt{}, err
		}
		select {
		case <-ctx.Done():
			return Receipt{}, ctx.Err()
		case <-time.After(every):
		}
	}
}

func addrHex(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }

// ParseAddress reads a 0x-hex 20-byte address, any case.
func ParseAddress(s string) ([20]byte, error) {
	var a [20]byte
	b, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(s), "0x"))
	if err != nil || len(b) != 20 {
		return a, fmt.Errorf("chain: bad address %q", s)
	}
	copy(a[:], b)
	return a, nil
}
