# contracts

Solidity, built with Foundry.

Nothing here yet.

What is meant to live here, and nothing more:

- **The faction leaderboard.** A weekly score computed from real fills and
  settled on-chain, so the leaderboard is a contract anyone can verify rather
  than a row in our database. This is the answer to "why does this need Monad".
- **The policy engine, on-chain.** Per-strategy limits, a daily loss cap, a
  cooldown and a kill switch — which is what turns "non-custodial" from a claim
  into something checkable.

Explicitly not here: a fork of a perp DEX.
