# ADR-0002: Repository layout

- Status: accepted
- Date: 2026-09-08

## Context

This repository holds more than one kind of artifact and will hold more:

- **Backend services in Go.** Today one strategy engine; soon a signer that must
  run in a different trust domain, and likely an indexer and a public API.
- **A mobile app.** The product surface. Written in TypeScript against React
  Native.
- **Smart contracts in Solidity.** The on-chain leaderboard and, later, the
  on-chain policy engine.
- **Planning and design material** that is not code and must not be mixed with it.

The first Go code landed at the repository root (`cmd/`, `internal/`), which is
idiomatic for a Go-only repository and wrong for this one: it puts one
language's conventions at the top of a tree that has to hold three.

## Decision

One directory per kind of deliverable, at the top level.

```
apps/
  mobile/          React Native app — the product surface
services/          Go module: every backend binary and the packages they share
  cmd/<binary>/    one directory per binary
  internal/        shared packages, not importable from outside the module
contracts/         Foundry project: Solidity, tests, deploy scripts
api/               the app <-> services contract, language-neutral
docs/              technical documentation
  adr/             architecture decision records
design/            visual prototypes and design canvases
```

### One Go module, many binaries

`services/` is a single Go module (`github.com/wagmiCTO/super-agent/services`)
with one directory per binary under `cmd/`. Several services share the venue
adapter, the fixed-point type and the policy engine; a module per service would
mean either duplicating them or publishing them, and both are worse than a
shared `internal/` this early.

This is revisited when a service needs a different dependency set or a different
release cadence — the signer is the likely first case, because it is meant to
run inside a TEE with a deliberately minimal dependency surface. Splitting a
`cmd/` directory into its own module later is a contained change; unpicking a
shared `internal/` that grew across module boundaries is not.

### The trust boundary is a directory, not a comment

`services/internal/signer` is the trust boundary described in CLAUDE.md. The
platform is an untrusted client of it. Keeping them in one module is a
convenience for now and must not become an excuse to reach across: the platform
talks to the signer over its API, never by importing its packages. When the
signer moves into an enclave, that rule is what makes the move mechanical.

### Why `api/` is separate from both sides

The mobile app and the services are written in different languages and will be
built by different people. The contract between them belongs to neither: it goes
in `api/` as an OpenAPI document, and both sides generate from it. Putting it
inside `services/` would make the app a downstream consumer of the backend's
internal choices, which is exactly the coupling that makes a mobile release
depend on a backend release.

### Why not a JS monorepo tool

`apps/mobile` is the only TypeScript package today. A workspace manager
(pnpm/turbo) earns its keep at two or more packages that share code; adding one
now is configuration with no consumer. The moment a second TS package appears —
a shared types package generated from `api/`, most likely — this is revisited.

## Consequences

- Go import paths gain a `services/` segment. Done once, now, while there are
  four packages.
- `go build ./...` from `services/` is the whole backend; the repository root is
  not a Go module and must not become one.
- Each top-level directory carries a README saying what belongs in it, so the
  next thing added has an obvious home.

## Alternatives rejected

**Go at the root, everything else in subdirectories.** Privileges one language
in a repository with three, and leaves `cmd/` and `internal/` sitting next to
`apps/` and `contracts/` at the same level, which reads as if they were peers.

**A repository per deliverable.** The app, the engine and the contracts change
together — an on-chain leaderboard change touches all three. Three repositories
would mean three pull requests for one feature.

**`backend/` instead of `services/`.** Names one thing where there will be
several, and invites a single monolithic binary.
