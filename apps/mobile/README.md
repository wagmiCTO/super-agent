# apps/mobile

The product surface: a native React Native app built with Expo. One TypeScript
codebase targets iOS, Android and — as a bonus for demos — the web.

The app never talks to an exchange. It talks to `services/cmd/platform`, which
owns venue access, the policy engine and the keys. A strategy's rules run
server-side, because the app is not trusted and cannot be.

## Run

```bash
cd apps/mobile
npm install
npm run gen:api      # TypeScript types from ../../api/openapi.yaml
npm run typecheck

# the platform must be running; on a phone it must listen on all interfaces:
#   cd services && PLATFORM_ADDR=0.0.0.0:8080 go run ./cmd/platform

npx expo start       # then: i (iOS simulator), a (Android), w (web), or scan the QR in Expo Go
```

On a physical phone set the laptop's LAN address:
`EXPO_PUBLIC_API_URL=http://192.168.x.y:8080 npx expo start`.

Static web build for a demo link: `npx expo export --platform web --output-dir dist`
and serve `dist/` from any static host; add that origin to `PLATFORM_CORS_ORIGINS`.

## End-to-end tests

```bash
npm run web:export        # static build into dist/
npm run e2e               # Playwright against dist/ and a platform on :8080
```

They place real orders on testnet, so they are not part of `npm test`. A test
asserts only what the screen shows the player; the server log is never read.

## Layout

| Path | What |
|---|---|
| `src/app/` | Expo Router screens. `index.tsx` is strategy #1, Direction. |
| `src/api/client.ts` | Typed client for the platform API; errors carry the policy limit that was hit. |
| `src/api/schema.d.ts` | Generated from the contract. Do not edit; run `npm run gen:api`. |
| `src/config.ts` | API URL, polling interval, notional presets. |
| `src/account/` | Passkey ceremonies (web and native variants), key derivation, storage, the `useAccount` hook. |
| `well-known/` | Templates a relying-party domain must serve for native passkeys. |
| `e2e/` | Playwright: open on Up, read the one number, close; a policy refusal in words. |

## Account layer: passkeys via mera

`src/account/` derives the wallet from a passkey with
[mera](https://github.com/category-labs/mera): the passkey's PRF output is the
BIP-39 entropy, the wallet is EVM account 0 (what MetaMask would derive from the
same phrase), and a signing session lives in memory only. Nothing derived from
the passkey is ever persisted; the app remembers the credential id and the
address so it can render before any prompt.

One passkey, many keys: `deriveStrategyKey(seed, n)` gives an Ed25519 key per
strategy, to be enrolled as that strategy's exchange API key under its own fee
ceiling and policy limits. The wallet never leaves the device; an API key can
never withdraw.

**Web build** works today: the page's host is the relying party and
`localhost` is a secure context. The e2e test runs the ceremony with a virtual
authenticator that supports PRF.

**Native build** needs three things that are not code:

1. A domain you control, served over HTTPS, for `EXPO_PUBLIC_RP_ID`, hosting the
   two files in `well-known/`.
2. An Apple Developer team id for the iOS file and Associated Domains.
3. A development build, not Expo Go: `npx expo prebuild && npx expo run:ios --device`
   (iOS 18+; Android 9+ with a PRF-capable passkey provider).

Passkey provider caveat: on desktop Chrome only passkeys saved to Google
Password Manager carry PRF; iCloud Keychain (macOS 15+/iOS 18+) and 1Password do.

## Decided

- **Every amount is a string.** The app formats; it never does money arithmetic.
