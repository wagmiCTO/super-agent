# apps/mobile

The product surface: a mobile app where each strategy is a screen, and the lobby
lists them with their leaderboards.

Not started yet.

Two constraints are already decided and should not be re-litigated when this is
scaffolded:

- **The account layer is Mera** — passkey, no seed phrase, no extension. Starter
  templates ship with Privy; take the scaffold from them, not the account layer.
- **The app never talks to an exchange directly.** It talks to `services`, which
  owns venue access, the policy engine and the keys. A strategy's rules run
  server-side, not in the app, because the app is not trusted and cannot be.
