-- Who invited whom.
--
-- A wallet has one code, minted the first time it opens the invite screen,
-- and is attributed to at most one referrer, the first code it arrives on.
-- What the friend trades is not copied here: the journal already has it,
-- by wallet.
create table if not exists referral_codes (
    code       text primary key,
    wallet     text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists referrals (
    wallet     text primary key,
    referrer   text not null,
    code       text not null,
    created_at timestamptz not null default now()
);

create index if not exists referrals_by_referrer on referrals (referrer);
