-- Where to reach a wallet when its position closes while the phone is away.
--
-- One row per device, not per wallet: the same account signs in on a phone
-- and a tablet and expects both to buzz. The token is the key because that is
-- what the push service hands out, and a device that is handed to someone
-- else re-registers under the new wallet rather than notifying the old one.
create table if not exists devices (
    token      text primary key,
    wallet     text not null,
    platform   text not null,
    seen_at    timestamptz not null
);

create index if not exists devices_wallet on devices (wallet);
