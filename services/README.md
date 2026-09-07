# services

One Go module, one binary per directory under `cmd/`, shared packages under
`internal/`.

| Package | Responsibility |
|---|---|
| `internal/fixed` | Fixed-point decimal. Every price, size and amount. No floats touch money. |
| `internal/venue` | The exchange-agnostic interface the strategy engine is written against. |
| `internal/venue/perpl` | Perpl on Monad: REST, market-data and trading WebSockets, order translation. |
| `internal/policy` | The policy engine. Every order passes through it; no bypass path. |
| `internal/platform` | The trading service: request → policy → venue, and the HTTP layer over it. |
| `internal/envfile` | Loads `.env` for local runs; a set environment variable always wins. |

| Binary | What it does |
|---|---|
| `cmd/perplcheck` | Walks the Perpl integration end to end, optionally placing one round trip. |
| `cmd/breakeven` | Recomputes the fee threshold from live fee schedules and price history. |
| `cmd/platform` | The HTTP service the app talks to. Contract: `../api/openapi.yaml`. |

Packages that do not exist yet but have a reserved home: `internal/strategy`
(the engine), `internal/signer` (the trust boundary — see ADR-0002),
`internal/llm`.

## Running the platform

```bash
cd services
go run ./cmd/platform            # 127.0.0.1:8080, testnet, small default limits
curl localhost:8080/v1/state
curl -H 'Content-Type: application/json' -d '{"symbol":"MON","side":"long","notional":"20","leverage":"2"}' localhost:8080/v1/orders/open
curl -H 'Content-Type: application/json' -d '{"symbol":"MON"}' localhost:8080/v1/orders/close
```

Limits come from `PLATFORM_*` variables (see `cmd/platform/main.go`); the
defaults allow MON only, 50 notional, 3x, 25 daily loss. The service binds to
loopback by default because it has no authentication yet.

## Conventions

- Contexts on all I/O, errors wrapped with context, table-driven tests.
- `gofmt` and `go vet` clean before every commit.
- Never log a private key, a signature, or a full auth header.
