-- A position's stop: the fraction of its collateral it may lose before the
-- platform closes it. Kept beside the horizon so a restart re-arms both.
alter table horizons add column if not exists max_loss numeric(30,8) not null default 0;
