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

## Layout

| Path | What |
|---|---|
| `src/app/` | Expo Router screens. `index.tsx` is strategy #1, Direction. |
| `src/api/client.ts` | Typed client for the platform API; errors carry the policy limit that was hit. |
| `src/api/schema.d.ts` | Generated from the contract. Do not edit; run `npm run gen:api`. |
| `src/config.ts` | API URL, polling interval, notional presets. |

## Decided

- **Account layer is mera** (passkey, no seed, no extension). Not wired yet; it
  needs a development build rather than Expo Go because passkeys are a native
  module.
- **Every amount is a string.** The app formats; it never does money arithmetic.
