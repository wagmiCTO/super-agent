-- The journal's wallet column held the policy account, which is
-- "<wallet>/<strategy>" for a strategy's own key. Everything downstream
-- reads it as an address: the boards showed a key nobody recognises, one
-- wallet counted once per strategy, and the settlement skipped every line
-- because none of them parsed as an address — so no prize was ever paid.
-- The strategy is its own column, so the suffix is redundant as well as
-- wrong.
update trades set wallet = split_part(wallet, '/', 1) where wallet like '%/%';
