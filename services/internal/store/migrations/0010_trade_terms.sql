-- What a round trip was made of, for the card that reports it.
--
-- The journal kept what the venue filled and what it made, which is enough
-- for a board and a list but not for a report: how much of the wallet was
-- put in, at what leverage, where the stop stood, and how far the position
-- ran each way before it closed. Rows written before this stay null, and
-- the card says "—" for them rather than inventing a number.
alter table trades add column if not exists leverage    numeric(30, 8);
alter table trades add column if not exists collateral  numeric(30, 8);
alter table trades add column if not exists stop_pnl    numeric(30, 8);
alter table trades add column if not exists worst_pnl   numeric(30, 8);
alter table trades add column if not exists best_pnl    numeric(30, 8);
