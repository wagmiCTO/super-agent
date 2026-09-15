/**
 * The prize pools as the chain records them: the wallet's own prizes with a
 * claim for each one not taken yet, and the weeks gone by from the indexer.
 *
 * The lobby asks only whether there is something to claim; the leaderboard
 * screen shows the rest.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Wallet } from '@/account/derive';
import { api, ApiError, describeError, type PrizeHistory } from '@/api/client';
import { trim } from '@/components/format';
import { ThemedText } from '@/components/themed-text';
import { styles as trading } from '@/components/trading';
import { STRATEGY_NAMES } from '@/config';
import { Spacing } from '@/constants/legacy-theme';
import { claimPrize, fetchMyPrizes, type MyPrizes as PrizeList } from '@/exchange/prize';
import { useTheme } from '@/hooks/use-theme';

/** The wallet's published prizes, re-read on demand after a claim. */
export function useMyPrizes(address: string | null): { mine: PrizeList | null; reload: () => void } {
  const [mine, setMine] = useState<PrizeList | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    fetchMyPrizes(address)
      .then((m) => alive && setMine(m))
      .catch(() => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [address, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { mine: address ? mine : null, reload };
}

/** What the wallet can still collect, summed; null when nothing is waiting. */
export function unclaimedTotal(mine: PrizeList | null): number | null {
  if (!mine) return null;
  const total = mine.prizes.filter((p) => !p.claimed).reduce((sum, p) => sum + Number(p.amount), 0);
  return total > 0 ? total : null;
}

/**
 * The wallet's prizes, with a claim for each one not taken yet. The claim is
 * the wallet's own transaction, like its activation.
 */
export function MyPrizes({ wallet, contract, mine, reload }: { wallet: Wallet; contract: string; mine: PrizeList | null; reload: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!mine || mine.prizes.length === 0) return null;
  const claim = async (i: number) => {
    const p = mine.prizes[i];
    const key = `${mine.weeks[i]}-${p.strategy}`;
    setBusy(key);
    setNotice(null);
    try {
      await claimPrize(wallet, contract, mine.weeks[i], p.strategy);
      setNotice(`Claimed ${trim(p.amount)} AUSD`);
      reload();
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]} testID="my-prizes">
      <ThemedText type="subtitle">Your prizes</ThemedText>
      {mine.prizes.map((p, i) => (
        <View key={`${mine.weeks[i]}-${p.strategy}`} style={trading.header}>
          <ThemedText type="small">
            Week {mine.weeks[i]} · {p.strategy} · {trim(p.amount)} AUSD
          </ThemedText>
          {p.claimed ? (
            <ThemedText type="small" themeColor="textSecondary">
              claimed
            </ThemedText>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Claim ${trim(p.amount)}`}
              disabled={busy !== null}
              onPress={() => void claim(i)}
              style={[trading.smallButton, { backgroundColor: theme.backgroundSelected, opacity: busy ? 0.6 : 1 }]}>
              <ThemedText type="smallBold">Claim</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
});

/**
 * The weeks gone by as the chain recorded them, read from the prize-pool
 * indexer: what each pool held, who won, who has collected.
 */
export function PastWeeks() {
  const theme = useTheme();
  const [history, setHistory] = useState<PrizeHistory | null | 'unavailable'>(null);
  useEffect(() => {
    let alive = true;
    api
      .prizeHistory()
      .then((h) => alive && setHistory(h))
      .catch((e) => alive && setHistory(e instanceof ApiError && e.code === 'history_unavailable' ? 'unavailable' : null));
    return () => {
      alive = false;
    };
  }, []);
  if (!history || history === 'unavailable') return null;
  const settled = history.pools.filter((p) => p.settled);
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]} testID="past-weeks">
      <View style={trading.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ON-CHAIN · PRIZE POOLS
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {history.totals.pools} pools · {micros(history.totals.funded)} AUSD funded
        </ThemedText>
      </View>
      {settled.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No week settled yet — the first settlement runs when the current week ends.
        </ThemedText>
      ) : (
        settled.slice(0, 6).map((p) => (
          <View key={`${p.week}-${p.strategy}`} style={{ gap: 2 }} testID="past-week">
            <ThemedText type="small">
              {STRATEGY_NAMES[p.strategy] ?? p.strategy} · week of {new Date(p.week_start).toLocaleDateString()} · pool {micros(p.funded)} AUSD
            </ThemedText>
            {p.prizes.map((pr) => (
              <ThemedText key={pr.wallet} type="small" themeColor="textSecondary">
                #{pr.rank} {shortAddress(pr.wallet)} · {micros(pr.amount)} AUSD · {pr.claimed ? 'claimed' : 'unclaimed'}
              </ThemedText>
            ))}
          </View>
        ))
      )}
      <ThemedText type="small" themeColor="textSecondary" style={{ opacity: 0.7 }}>
        Indexed by Envio{history.stale ? ' · last known' : ''}
      </ThemedText>
    </View>
  );
}

/** Token units (6 decimals) to a short decimal. */
function micros(units: string): string {
  const n = Number(units) / 1e6;
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : units;
}
