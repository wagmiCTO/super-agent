-- What a wallet chose for itself, above the platform's safe defaults and
-- below its ceilings: the daily loss budget as a share of balance, how many
-- positions may be open at once, and the pause between taps. A wallet with
-- no row trades under the safe defaults.
create table if not exists wallet_limits (
    address            text primary key,
    daily_loss_pct     numeric(6, 2) not null,
    max_open_positions integer not null,
    cooldown_seconds   numeric(8, 2) not null,
    updated_at         timestamptz not null default now()
);
