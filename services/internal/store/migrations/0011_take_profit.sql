-- A position's target: the fraction of its collateral it may make before
-- the platform closes it and banks the result. Kept beside the stop so a
-- restart re-arms both, and on the trade so the card can say where it stood.
alter table horizons add column if not exists take_profit numeric(30,8) not null default 0;
alter table trades add column if not exists tp_pnl numeric(30, 8);
