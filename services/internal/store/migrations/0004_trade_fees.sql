-- The order history needs each leg's fee and why the round trip ended.
alter table trades add column if not exists entry_fee numeric(30, 8) not null default 0;
alter table trades add column if not exists exit_fee numeric(30, 8);
alter table trades add column if not exists close_reason text;
