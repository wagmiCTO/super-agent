package perpl

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// readLimit is generous: an order-book snapshot on a busy market is far larger
// than the library's 32 KiB default, and exceeding the limit kills the socket.
const readLimit = 8 << 20

// reconnectDelays is the backoff ladder from the API docs.
var reconnectDelays = []time.Duration{
	time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second,
	16 * time.Second, 32 * time.Second, time.Minute,
}

func delayFor(attempt int) time.Duration {
	if attempt >= len(reconnectDelays) {
		return reconnectDelays[len(reconnectDelays)-1]
	}
	return reconnectDelays[attempt]
}

func dial(ctx context.Context, url string) (*websocket.Conn, error) {
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return nil, fmt.Errorf("perpl: dial %s: %w", url, err)
	}
	conn.SetReadLimit(readLimit)
	return conn, nil
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("perpl: marshal frame: %w", err)
	}
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		return fmt.Errorf("perpl: write frame: %w", err)
	}
	return nil
}

// mdClient is the market-data socket. It holds one connection, re-subscribes
// everything after a reconnect, and dispatches frames to per-stream handlers.
//
// The connection is subject to 16 subscriptions and 10 requests/minute, so
// subscriptions are batched into a single frame whenever more than one is
// pending, and application pings are not sent at all — the server keeps the
// socket alive itself.
type mdClient struct {
	url string
	log *slog.Logger

	mu       sync.Mutex
	handlers map[string]func(msgType int, raw []byte)
	bySID    map[int64]string
	conn     *websocket.Conn
	ready    bool

	head    int64
	started bool
	wake    chan struct{}
}

func newMDClient(baseURL string, log *slog.Logger) *mdClient {
	return &mdClient{
		url:      baseURL + "/ws/v1/market-data",
		log:      log,
		handlers: make(map[string]func(int, []byte)),
		bySID:    make(map[int64]string),
		wake:     make(chan struct{}, 1),
	}
}

// subscribe registers a handler for a stream and asks the run loop to send the
// subscription. Handlers must not block: the reader dispatches inline, and a
// slow consumer is closed by the server with 1013.
func (c *mdClient) subscribe(ctx context.Context, stream string, h func(msgType int, raw []byte)) error {
	c.mu.Lock()
	if _, dup := c.handlers[stream]; dup {
		c.mu.Unlock()
		return fmt.Errorf("perpl: already subscribed to %s", stream)
	}
	c.handlers[stream] = h
	if !c.started {
		c.started = true
		go c.run(ctx)
	}
	c.mu.Unlock()

	select {
	case c.wake <- struct{}{}:
	default:
	}
	return nil
}

// head returns the latest block number seen on the heartbeat stream. Orders
// need it to compute their last execution block.
func (c *mdClient) latestHead() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.head
}

func (c *mdClient) run(ctx context.Context) {
	attempt := 0
	for ctx.Err() == nil {
		if err := c.session(ctx); err != nil && ctx.Err() == nil {
			c.log.Warn("perpl market-data session ended", "err", err, "attempt", attempt)
		}
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delayFor(attempt)):
		}
		attempt++
		if attempt > len(reconnectDelays) {
			attempt = len(reconnectDelays)
		}
	}
}

func (c *mdClient) session(ctx context.Context) error {
	conn, err := dial(ctx, c.url)
	if err != nil {
		return err
	}
	defer conn.CloseNow()

	c.mu.Lock()
	c.conn, c.ready = conn, true
	c.bySID = make(map[int64]string)
	streams := make([]string, 0, len(c.handlers))
	for s := range c.handlers {
		streams = append(streams, s)
	}
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.conn, c.ready = nil, false
		c.mu.Unlock()
	}()

	if len(streams) > 0 {
		if err := c.sendSubscribe(ctx, conn, streams); err != nil {
			return err
		}
	}

	// A goroutine turns wake signals into subscribe frames for streams
	// registered after the connection came up.
	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go c.watchNewSubscriptions(sessCtx, conn)

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("perpl: market-data read: %w", err)
		}
		c.dispatch(raw)
	}
}

func (c *mdClient) watchNewSubscriptions(ctx context.Context, conn *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.wake:
		}
		c.mu.Lock()
		var missing []string
		subscribed := make(map[string]bool, len(c.bySID))
		for _, s := range c.bySID {
			subscribed[s] = true
		}
		for s := range c.handlers {
			if !subscribed[s] {
				missing = append(missing, s)
			}
		}
		c.mu.Unlock()
		if len(missing) == 0 {
			continue
		}
		if err := c.sendSubscribe(ctx, conn, missing); err != nil && ctx.Err() == nil {
			c.log.Warn("perpl subscribe failed", "err", err, "streams", missing)
		}
	}
}

func (c *mdClient) sendSubscribe(ctx context.Context, conn *websocket.Conn, streams []string) error {
	subs := make([]subscribeElement, 0, len(streams))
	for _, s := range streams {
		subs = append(subs, subscribeElement{Stream: s, Subscribe: true})
	}
	return writeJSON(ctx, conn, subscribeRequest{MsgType: msgSubscribeRequest, Subs: subs})
}

func (c *mdClient) dispatch(raw []byte) {
	mt, err := peekMsgType(raw)
	if err != nil {
		c.log.Warn("perpl market-data: unparseable frame", "err", err)
		return
	}

	switch mt {
	case msgSubscribeResponse:
		var resp subscribeResponse
		if err := json.Unmarshal(raw, &resp); err != nil {
			c.log.Warn("perpl: bad subscription response", "err", err)
			return
		}
		c.mu.Lock()
		for _, s := range resp.Subs {
			// Failures are per subscription; the socket stays usable.
			if s.Status != nil && s.Status.Code != 0 {
				c.log.Error("perpl subscription rejected",
					"stream", s.Stream, "code", s.Status.Code, "error", s.Status.Error)
				continue
			}
			c.bySID[s.SubID] = s.Stream
		}
		c.mu.Unlock()
		return
	case msgHeartbeat:
		var hb heartbeat
		if err := json.Unmarshal(raw, &hb); err == nil {
			c.mu.Lock()
			c.head = hb.Head
			c.mu.Unlock()
		}
	}

	var h struct {
		SubID int64 `json:"sid"`
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		return
	}
	c.mu.Lock()
	stream := c.bySID[h.SubID]
	handler := c.handlers[stream]
	c.mu.Unlock()
	if handler != nil {
		handler(mt, raw)
	}
}

func (c *mdClient) close() {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
}
