/**
 * The card before an entry: what the crowd on-chain has been doing with
 * the asset, from Nansen through the platform. One sentence, the day's
 * numbers, and who has been buying and selling. It informs the tap; it
 * never makes it.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, ApiError, type MarketContext } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { CONTEXT_POLL_MS } from '@/config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function useMarketContext(symbol: string): MarketContext | null | 'unavailable' {
  const [card, setCard] = useState<MarketContext | null | 'unavailable'>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .context(symbol)
        .then((c) => alive && setCard(c))
        .catch((e) => alive && e instanceof ApiError && e.code === 'context_unavailable' && setCard('unavailable'));
    void read();
    const id = setInterval(read, CONTEXT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol]);
  return card;
}

const UP = '#16a34a';
const DOWN = '#dc2626';

export function ContextCard({ symbol }: { symbol: string }) {
  const theme = useTheme();
  const card = useMarketContext(symbol);
  if (!card || card === 'unavailable') return null;
  const change = Number(card.change_24h_pct);
  const changeColor = change > 0 ? UP : change < 0 ? DOWN : theme.text;
  const leanColor = card.lean === 'buyers' ? UP : card.lean === 'sellers' ? DOWN : theme.textSecondary;
  const buyers = card.top_buyers.slice(0, 2);
  const sellers = card.top_sellers.slice(0, 2);
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]} testID="context-card">
      <View style={styles.row}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ON-CHAIN · {card.token_symbol} on {chainName(card.chain)}
        </ThemedText>
        <ThemedText type="small" style={{ color: changeColor }} testID="context-change">
          ${trimPrice(card.price_usd)} · {change > 0 ? '+' : ''}
          {change.toFixed(1)}%
        </ThemedText>
      </View>
      <ThemedText type="small" testID="context-headline">
        {card.headline}
      </ThemedText>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">
          buys {usd(card.buy_volume_usd)} · sells {usd(card.sell_volume_usd)}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: leanColor }} testID="context-lean">
          {card.lean === 'balanced' ? 'even' : `${card.lean} ahead`}
        </ThemedText>
      </View>
      {buyers.length + sellers.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary" testID="context-traders">
          {buyers.length ? `Buying: ${buyers.map((t) => `${who(t.address, t.label)} ${usd(t.bought_usd)}`).join(', ')}` : ''}
          {buyers.length && sellers.length ? ' · ' : ''}
          {sellers.length ? `Selling: ${sellers.map((t) => `${who(t.address, t.label)} ${usd(t.sold_usd)}`).join(', ')}` : ''}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" style={styles.source}>
        Nansen · {card.stale ? 'last known' : `as of ${clock(card.updated_at)}`}
      </ThemedText>
    </View>
  );
}

function who(address: string, label?: string): string {
  return label && label.trim() ? label : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** $1.2M, $82k, $950 — the same shorthand the headline uses. */
export function usd(s: string): string {
  const v = Math.abs(Number(s));
  const sign = Number(s) < 0 ? '-' : '';
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${sign}$${Math.round(v / 1e3)}k`;
  return `${sign}$${Math.round(v)}`;
}

function trimPrice(s: string): string {
  const v = Number(s);
  return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function chainName(slug: string): string {
  return { monad: 'Monad', ethereum: 'Ethereum', base: 'Base', solana: 'Solana' }[slug] ?? slug;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.two, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.one },
  source: { opacity: 0.7 },
});
