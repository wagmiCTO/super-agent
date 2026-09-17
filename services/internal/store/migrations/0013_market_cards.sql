-- The last market context card fetched from Nansen, per market, so a
-- restart serves what it already paid for instead of spending a credit
-- per market to learn it again.
create table if not exists market_cards (
    symbol     text primary key,
    card       jsonb not null,
    fetched_at timestamptz not null
);
