-- The platform's system of record. Money-related tables are journals: rows
-- are inserted and completed, never rewritten in place. Aggregates (boards,
-- daily loss) are computed from them.

create table if not exists keys (
    address           text primary key,            -- wallet, lower-case
    api_key           text not null,               -- the venue's opaque token
    private_key       bytea not null,              -- Ed25519 seed+pub; encryption at rest is the next step
    label             text not null default '',
    builder_id        integer not null,
    max_fee_per_100k  integer not null,
    max_fee_pct       text not null default '',
    enrolled_at       timestamptz not null
);

-- Policy engine state per account: what the limits are measured against.
create table if not exists policy_accounts (
    account         text primary key,
    day_start       timestamptz not null,
    realized_loss   numeric(30, 8) not null default 0,
    last_open       timestamptz,
    open_positions  integer not null default 0,
    exposure        numeric(30, 8) not null default 0,
    updated_at      timestamptz not null default now()
);

create table if not exists kill_switch (
    id        boolean primary key default true check (id),  -- one row
    killed    boolean not null default false,
    note      text not null default '',
    updated_at timestamptz not null default now()
);

-- A position's exit, so a restart re-arms it instead of forgetting it.
create table if not exists horizons (
    account   text not null,
    symbol    text not null,
    closes_at timestamptz not null,
    primary key (account, symbol)
);

-- One row per round trip: inserted on open, completed on close.
create table if not exists trades (
    id             bigserial primary key,
    wallet         text not null,
    strategy       text not null,
    symbol         text not null,
    open_order_id  text not null,
    close_order_id text,
    pnl            numeric(30, 8),
    opened_at      timestamptz not null,
    closed_at      timestamptz,
    unique (wallet, open_order_id)
);
create index if not exists trades_closed_idx on trades (closed_at) where closed_at is not null;
create index if not exists trades_open_idx on trades (wallet, symbol) where closed_at is null;
