-- What the chart needs to draw a round trip: which way, how much, at what.
alter table trades add column if not exists side text not null default 'long';
alter table trades add column if not exists size numeric(30, 8) not null default 0;
alter table trades add column if not exists entry_price numeric(30, 8) not null default 0;
alter table trades add column if not exists exit_price numeric(30, 8);
