# services

One Go module, one binary per directory under `cmd/`, shared packages under
`internal/`.

| Package | Responsibility |
|---|---|
| `internal/fixed` | Fixed-point decimal. Every price, size and amount. No floats touch money. |
| `internal/venue` | The exchange-agnostic interface the strategy engine is written against. |
| `internal/venue/perpl` | Perpl on Monad: REST, market-data and trading WebSockets, order translation. |

| Binary | What it does |
|---|---|
| `cmd/perplcheck` | Walks the Perpl integration end to end, optionally placing one round trip. |
| `cmd/breakeven` | Recomputes the fee threshold from live fee schedules and price history. |

Packages that do not exist yet but have a reserved home: `internal/strategy`
(the engine), `internal/policy` (limits, daily stop, kill switch),
`internal/signer` (the trust boundary — see ADR-0002), `internal/llm`.

## Conventions

- Contexts on all I/O, errors wrapped with context, table-driven tests.
- `gofmt` and `go vet` clean before every commit.
- Never log a private key, a signature, or a full auth header.
