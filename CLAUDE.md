# super-agent

## Communication
- Be concise. No filler, no restating the question.

## What this project is
Two coupled products around Hyperliquid perps trading for AI agents:

1. **Signer (MPC / TEE)** — a secure signing/custody layer for Hyperliquid accounts. Agents never hold raw private keys. Signing happens inside an MPC protocol and/or a TEE enclave with policy checks (per-agent limits, allowed markets, max notional, kill-switch). Exposes an API that agents call to place/cancel orders, and it signs Hyperliquid L1 actions on their behalf.
2. **AI trading platform (client)** — takes natural-language prompts/strategies from a user, turns them into a trading plan via an LLM, and trades autonomously on Hyperliquid through the Signer. Includes market data ingestion, strategy loop, risk management, position/PnL tracking, and a user-facing surface (API/UI/bot).

The Signer is the trust boundary. The platform is an untrusted client of it. Keep that separation strict in code and in design discussions.

## Stack (assumed until the code says otherwise)
- **Go** for backend services (signer, platform core, Hyperliquid client).
- Hyperliquid: REST/WS info API + exchange API; L1 actions signed with EIP-712 (agent/API wallets). Prefer implementing the wire protocol ourselves over pulling in half-maintained SDKs; verify against official docs before assuming a payload shape.
- LLM: Anthropic Claude via the official SDK. Load the `claude-api` skill before writing LLM code — do not answer model/pricing questions from memory.
- TEE target: TBD (candidates: AWS Nitro Enclaves, Intel TDX/SGX via Gramine, Phala/dstack). MPC: TBD (candidates: threshold ECDSA — GG20/CGGMP, or a library like tss-lib). Do not hard-commit to one in code until decided; keep the signer behind an interface.

## Repo layout (target — create as needed)
```
cmd/            entrypoints (signer, platform, cli)
internal/
  hyperliquid/  API client, types, signing (EIP-712), WS feeds
  signer/       key management, policy engine, MPC/TEE adapters
  platform/     prompt → strategy, execution loop, risk, portfolio
  llm/          Anthropic client wrappers, prompt templates, tool defs
docs/           design notes, threat model, ADRs
```

## Engineering rules
- Security first: this system controls real money. No secrets in code, logs, or LLM prompts. Never log private keys, seeds, signatures, or full auth headers.
- Every signer action goes through the policy engine. No bypass paths, even "for testing" — use a mock signer interface instead.
- Default to **testnet** (`api.hyperliquid-testnet.xyz`). Mainnet must be an explicit, loud config flag.
- LLM output is untrusted input: validate/parse strictly, clamp sizes and leverage, never let the model construct raw signed payloads.
- Idempotency and reconciliation for orders (client order IDs, resync positions from the exchange on startup).
- Standard Go: `gofmt`, `go vet`, table-driven tests, errors wrapped with context, contexts on all I/O.
- Small commits, English messages, no attribution lines.

## Working with Claude Code here
- When a design decision is open (LLM tool schema, order model, wallet provider), write a short ADR in `docs/adr/` rather than deciding silently in code.
- Ask before: touching anything mainnet-related, adding a new external dependency for crypto/signing, or changing the signer↔platform API contract.
- Do not spawn subagents / workflows unless explicitly asked.

## Open questions (update as they get answered)
- MPC vs TEE vs both — which ships first?
- Single-tenant (own agents) or multi-tenant (third-party agents as customers)?
- Platform surface: HTTP API, Telegram bot, web UI?
- Spot + perps or perps only?
