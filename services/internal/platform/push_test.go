package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type devicesStub struct {
	tokens    []string
	forgotten []string
}

func (d *devicesStub) Devices(context.Context, string) ([]string, error) { return d.tokens, nil }
func (d *devicesStub) ForgetDevice(_ context.Context, token string) error {
	d.forgotten = append(d.forgotten, token)
	return nil
}

// A closed round trip reaches every device of the wallet that made it, and
// the message keeps the result to itself.
func TestClosedNotifiesEveryDeviceWithoutSayingTheResult(t *testing.T) {
	sent := make(chan []expoMessage, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var msgs []expoMessage
		if err := json.Unmarshal(body, &msgs); err != nil {
			t.Errorf("payload: %v", err)
		}
		sent <- msgs
		_, _ = w.Write([]byte(`{"data":[{"status":"ok"},{"status":"ok"}]}`))
	}))
	defer srv.Close()

	d := &devicesStub{tokens: []string{"ExponentPushToken[a]", "ExponentPushToken[b]"}}
	p := NewPush(d, nil)
	p.URL = srv.URL

	p.Closed(Trade{Wallet: "0xabc", Symbol: "mon", Strategy: "direction", ClosedAt: time.Unix(3, 0)})

	select {
	case msgs := <-sent:
		if len(msgs) != 2 {
			t.Fatalf("messages: want 2, got %d", len(msgs))
		}
		if msgs[0].Title != "MON is done" {
			t.Errorf("title: %q", msgs[0].Title)
		}
		for _, m := range msgs {
			for _, leak := range []string{"AUSD", "+", "−", "profit", "loss"} {
				if contains(m.Body, leak) {
					t.Errorf("body gives the result away: %q", m.Body)
				}
			}
			if m.Data["symbol"] != "mon" {
				t.Errorf("data: %v", m.Data)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("nothing was sent")
	}
}

// A device that has uninstalled the app is dropped rather than paid for on
// every close from here on.
func TestDeviceNotRegisteredIsForgotten(t *testing.T) {
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}}]}`))
		close(done)
	}))
	defer srv.Close()

	d := &devicesStub{tokens: []string{"ExponentPushToken[dead]"}}
	p := NewPush(d, nil)
	p.URL = srv.URL
	p.Closed(Trade{Wallet: "0xabc", Symbol: "MON", ClosedAt: time.Unix(1, 0)})

	<-done
	deadline := time.After(5 * time.Second)
	for {
		if len(d.forgotten) == 1 && d.forgotten[0] == "ExponentPushToken[dead]" {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("token not forgotten: %v", d.forgotten)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// A wallet with no device costs nothing and says nothing.
func TestNoDevicesSendsNothing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a wallet with no device must not be sent to")
	}))
	defer srv.Close()
	p := NewPush(&devicesStub{}, nil)
	p.URL = srv.URL
	p.Closed(Trade{Wallet: "0xabc", Symbol: "MON"})
	time.Sleep(200 * time.Millisecond)
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
