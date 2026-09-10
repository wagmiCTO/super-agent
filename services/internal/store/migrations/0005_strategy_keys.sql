-- One exchange API key per (wallet, strategy). Keys enrolled before this
-- migration carry an empty strategy and serve every strategy for the wallet.
alter table keys add column if not exists strategy text not null default '';
alter table keys add column if not exists derived boolean not null default false;
alter table keys drop constraint if exists keys_pkey;
alter table keys add primary key (address, strategy);

-- Request-signing keys: Ed25519 public keys a wallet registered with its own
-- signature. A wallet with at least one is served signed requests only.
create table if not exists auth_keys (
    address     text not null,
    public_key  bytea not null,
    created_at  timestamptz not null default now(),
    primary key (address, public_key)
);
