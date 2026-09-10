-- Published winners: what the settler sent to the prize contract, so the
-- lobby can show last week's board and a wallet can find its claims.
create table if not exists prizes (
    week       bigint not null,
    strategy   text not null,
    wallet     text not null,
    amount     numeric(40, 0) not null,   -- token units
    pnl        numeric(30, 8) not null,
    settled_at timestamptz not null,
    primary key (week, strategy, wallet)
);
