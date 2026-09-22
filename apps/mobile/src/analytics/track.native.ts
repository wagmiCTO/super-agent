/**
 * The counting, on a phone. The contract and the reasoning are in `track.ts`
 * beside this file; this is the part that talks to PostHog.
 */
import * as Crypto from 'expo-crypto';
import PostHog from 'posthog-react-native';

import { load, save } from './id';
import type { Event, Props } from './track';

export type { Event, Props } from './track';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let starting: Promise<void> | null = null;

export async function startAnalytics(): Promise<void> {
  if (!KEY) return;
  if (starting) return starting;
  starting = (async () => {
    try {
      // The person is a random id made once on this install, and it is the
      // only identity sent. Never the wallet: the address is public on the
      // chain, but joining it to a session here builds a profile of someone.
      let id = await load();
      if (!id) {
        id = Crypto.randomUUID();
        await save(id);
      }
      const ph = new PostHog(KEY, {
        host: HOST,
        // Nothing is captured that we did not name. A screen in this app
        // carries prices, balances and addresses.
        captureAppLifecycleEvents: false,
        disabled: false,
      });
      ph.identify(id);
      client = ph;
    } catch {
      // A build that cannot start analytics is a build without analytics.
      client = null;
    }
  })();
  return starting;
}

export function track(event: Event, props?: Props): void {
  if (!client) return;
  try {
    // Props is a closed, typed shape: every value is a string or a
    // boolean, which is what the client will carry.
    client.capture(event, props as Record<string, string | boolean> | undefined);
  } catch {
    // Counting must never be the reason a tap fails.
  }
}
