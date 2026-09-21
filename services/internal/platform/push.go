package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Telling a trader their position ended while the phone was in a pocket.
//
// The platform owns the exit: the horizon, the stop and the target are its
// timers and its watch on the mark, and they fire whether the app is open or
// not. Until now that was the whole loop — the position closed and nobody was
// told, so the one moment worth coming back for passed in silence.
//
// The message never says how it went. Not to tease for its own sake: a push
// that reads "−12.40 AUSD" on a lock screen is a worse thing to hand someone
// than a line that asks them to look. The result screen is where a trade is
// read, with the fees, the excursions and what closed it.
//
// Delivery is best effort and never blocks a close: a push that fails is a
// push that fails, and the trade is already settled and journalled.

// Devices is where a wallet's push tokens live.
type Devices interface {
	Devices(ctx context.Context, wallet string) ([]string, error)
	ForgetDevice(ctx context.Context, token string) error
}

// Push sends a notification through Expo's push service, which holds the
// Apple and Google credentials and speaks both protocols.
type Push struct {
	Devices Devices
	Client  *http.Client
	URL     string
	Log     *slog.Logger
}

const expoPushURL = "https://exp.host/--/api/v2/push/send"

// NewPush builds a sender over a device store. A nil store disables it, which
// is what a platform with no database gets.
func NewPush(d Devices, log *slog.Logger) *Push {
	if log == nil {
		log = slog.Default()
	}
	return &Push{Devices: d, Client: &http.Client{Timeout: 10 * time.Second}, URL: expoPushURL, Log: log}
}

type expoMessage struct {
	To       string            `json:"to"`
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Sound    string            `json:"sound"`
	Data     map[string]string `json:"data,omitempty"`
	Priority string            `json:"priority,omitempty"`
}

type expoReply struct {
	Data []struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// Closed tells every device of a wallet that one of its positions ended.
func (p *Push) Closed(t Trade) {
	if p == nil || p.Devices == nil || t.Wallet == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		tokens, err := p.Devices.Devices(ctx, t.Wallet)
		if err != nil {
			p.Log.Warn("push: devices not read", "err", err)
			return
		}
		if len(tokens) == 0 {
			return
		}
		title, body := closedWords(t)
		data := map[string]string{"kind": "closed", "symbol": t.Symbol, "strategy": t.Strategy}
		if ref := t.Ref; ref != [32]byte{} {
			data["trade"] = fmt.Sprintf("%x", ref)
		}
		p.send(ctx, tokens, title, body, data)
	}()
}

// closedWords names the market and asks for a look. What the trade made is
// deliberately absent: the result screen reports a trade, a lock screen
// cannot, and a number without its fees and its reason misleads.
func closedWords(t Trade) (string, string) {
	symbol := strings.ToUpper(t.Symbol)
	title := symbol + " is done"
	// The wording turns on the time of day only so that a trader who takes
	// several a day is not read the same sentence every time.
	switch t.ClosedAt.Unix() % 3 {
	case 0:
		return title, "Your position closed. Open it to see how it went."
	case 1:
		return title, "That one has a result waiting for you."
	default:
		return title, "The position is closed — come and read it."
	}
}

func (p *Push) send(ctx context.Context, tokens []string, title, body string, data map[string]string) {
	msgs := make([]expoMessage, 0, len(tokens))
	for _, to := range tokens {
		msgs = append(msgs, expoMessage{To: to, Title: title, Body: body, Sound: "default", Data: data, Priority: "high"})
	}
	payload, err := json.Marshal(msgs)
	if err != nil {
		p.Log.Warn("push: not encoded", "err", err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.URL, bytes.NewReader(payload))
	if err != nil {
		p.Log.Warn("push: request not built", "err", err)
		return
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	res, err := p.Client.Do(req)
	if err != nil {
		p.Log.Warn("push: not sent", "err", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		p.Log.Warn("push: refused", "status", res.StatusCode)
		return
	}
	var reply expoReply
	if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
		return
	}
	// A device that has uninstalled the app answers the same way for ever;
	// dropping it keeps the next close from paying for it again.
	for i, r := range reply.Data {
		if r.Status == "ok" || i >= len(tokens) {
			continue
		}
		p.Log.Warn("push: not delivered", "error", r.Details.Error, "message", r.Message)
		if r.Details.Error == "DeviceNotRegistered" {
			if err := p.Devices.ForgetDevice(ctx, tokens[i]); err != nil {
				p.Log.Warn("push: dead token not dropped", "err", err)
			}
		}
	}
}

// DeviceStore is where a registration is kept.
type DeviceStore interface {
	SaveDevice(ctx context.Context, wallet, token, platform string, seenAt time.Time) error
}

type deviceReqDTO struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
}

// registerDevice records where to reach the signed-in wallet.
//
// Idempotent and silent: the app calls it on every unlock, because a push
// token is not permanent — the platform reissues it — and a wallet that has
// moved to a new phone must stop buzzing the old one.
func (h *handler) registerDevice(w http.ResponseWriter, r *http.Request) {
	wallet := strings.ToLower(strings.TrimSpace(r.Header.Get(AccountHeader)))
	if wallet == "" {
		writeJSON(w, http.StatusForbidden, errorDTO{Error: "sign_in", Message: "sign in with a passkey to be notified"})
		return
	}
	if h.devices == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "push_unavailable", Message: "notifications are not enabled"})
		return
	}
	var req deviceReqDTO
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "bad_request", Message: "a token and a platform are required"})
		return
	}
	token := strings.TrimSpace(req.Token)
	platform := strings.ToLower(strings.TrimSpace(req.Platform))
	if token == "" || (platform != "ios" && platform != "android") {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "bad_request", Message: "a token and a platform of ios or android are required"})
		return
	}
	if err := h.devices.SaveDevice(r.Context(), wallet, token, platform, time.Now().UTC()); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
