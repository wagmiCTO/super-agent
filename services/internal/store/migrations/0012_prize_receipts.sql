-- The builder fee each fill paid, so a week's accrued prize pool can be
-- counted from the journal (ADR 0006), and the receipts that turn it into
-- money on the contract: one per week, recorded before anything is funded.
alter table trades add column if not exists entry_builder_fee numeric(30, 8);
alter table trades add column if not exists exit_builder_fee  numeric(30, 8);

create table if not exists prize_receipts (
    week        bigint primary key,
    amount      numeric(30, 8) not null,   -- collateral received, decimal
    funded      text not null,             -- what went to each pool, JSON
    received_at timestamptz not null default now()
);
