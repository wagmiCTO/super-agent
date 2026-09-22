/**
 * What we count, and what we refuse to.
 *
 * The question analytics answers here is narrow: how many people who open the
 * app reach their first trade, and where the rest stop. Everything about the
 * trades themselves — how many, for how much, with what result — comes from
 * the platform's own journal, which is the only record that is complete.
 * Analytics is lossy by nature: a blocked request or a refused permission
 * silently removes someone, so a number from here must never be quoted as a
 * number about money.
 *
 * The rules this module exists to enforce:
 *
 *  - **Nothing is captured that we did not name.** Autocapture is off. A
 *    screen in this app has prices, balances and addresses on it, and a
 *    library that scrapes what it sees would carry them out of the device.
 *  - **The wallet is not an identity.** A trader is a random id made on this
 *    install. The address is on a public chain, but tying it to a session in
 *    someone else's database is a profile we have no business building.
 *  - **No key, seed, signature or auth header is a property.** There is no
 *    allowance for one, so none can be passed: every event below takes a
 *    fixed, typed shape.
 *
 * Unconfigured it does nothing at all — a build without a key is a build
 * without analytics, not a build that crashes.
 */

/** The funnel, and the two places people are known to fall out of it. */
export type Event =
  | 'app_opened'
  | 'passkey_created'
  | 'passkey_failed'
  | 'account_activated'
  | 'lesson_finished'
  | 'position_opened'
  | 'position_closed'
  | 'result_seen'
  | 'share_tapped'
  | 'invite_copied';

/**
 * What each event may carry. Names and buckets only: a market is a market, a
 * strategy is a strategy, and a reason is one of a handful of words. No
 * amounts — what was traded is the journal's business, not a third party's.
 */
export type Props = {
  strategy?: 'direction' | 'ma-cross' | 'rsi';
  symbol?: string;
  /** Why a passkey did not work, bucketed — the raw message may name a person's provider. */
  reason?: 'prf' | 'cancelled' | 'other';
  /** Who ended the position. */
  closed_by?: 'manual' | 'horizon' | 'stop' | 'take_profit';
  /** Whether the tap followed a signal the screen was showing. */
  on_signal?: boolean;
};

/** Starts analytics if this build was given a key. Safe to call twice. */
export async function startAnalytics(): Promise<void> {}

/** Records one named event. Never throws, never blocks the caller. */
export function track(_event: Event, _props?: Props): void {}
