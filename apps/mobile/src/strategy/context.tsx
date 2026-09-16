/**
 * What the crowd on-chain has been doing, from Nansen through the platform.
 *
 * Folded by default: one line of lean and a bar of the day's flow, which is
 * all most taps need. Tapping it opens the day's numbers and the wallets
 * behind them. It informs the tap; it never makes it, so it sits below the
 * fold and never moves the keys.
 */

import { useState } from 'react';

import { useMarketContext, usd } from '@/components/context';
import { Text } from '@/ui/text';
import { face, useTheme } from '@/theme';
import { Pressable, View } from 'react-native';

export function ContextPanel({ symbol }: { symbol: string }) {
  const theme = useTheme();
  const card = useMarketContext(symbol);
  const [open, setOpen] = useState(false);

  if (!card || card === 'unavailable') return null;

  const buy = Number(card.buy_volume_usd);
  const sell = Number(card.sell_volume_usd);
  const share = buy + sell > 0 ? Math.round((buy / (buy + sell)) * 100) : 50;
  const lean = card.lean === 'balanced' ? 'Even' : `${card.lean === 'buyers' ? 'Buyers' : 'Sellers'} ahead`;
  const asOf = card.stale ? 'last known' : hm(card.updated_at);

  const flow = (
    <View style={{ flexDirection: 'row', height: open ? 8 : 4, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.color.hair }}>
      <View style={{ width: `${share}%`, backgroundColor: theme.color.up }} />
      <View style={{ flex: 1, backgroundColor: theme.color.down }} />
    </View>
  );

  if (!open) {
    return (
      <Pressable testID="context-card" accessibilityRole="button" accessibilityLabel="Open the on-chain analysis" onPress={() => setOpen(true)}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.s3,
            paddingHorizontal: theme.space.s4,
            paddingVertical: theme.space.s3,
            borderRadius: theme.radius.rLg,
            borderWidth: theme.size.bw,
            borderColor: theme.color.line,
            backgroundColor: theme.color.cardBg,
          }}
        >
          <View style={{ flex: 1, gap: theme.space.s1, minWidth: 0 }}>
            <Text variant="caps">{`Analysis · Nansen · ${asOf}`}</Text>
            <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm }} testID="context-lean">
              <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>{lean}</Text>
              {` · ${card.headline}`}
            </Text>
            {flow}
          </View>
          <Text variant="small">›</Text>
        </View>
      </Pressable>
    );
  }

  const buyers = card.top_buyers.slice(0, 2).map((t) => ({ name: who(t.address, t.label), size: t.bought_usd, buy: true }));
  const sellers = card.top_sellers.slice(0, 2).map((t) => ({ name: who(t.address, t.label), size: t.sold_usd, buy: false }));

  return (
    <Pressable testID="context-card" accessibilityRole="button" accessibilityLabel="Fold the on-chain analysis" onPress={() => setOpen(false)}>
      <View
        style={{
          gap: theme.space.s3,
          padding: theme.space.s4,
          borderRadius: theme.radius.rLg,
          borderWidth: theme.size.bw,
          borderColor: theme.color.cardLine === 'transparent' ? theme.color.line : theme.color.cardLine,
          backgroundColor: theme.color.cardBg,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="caps">Analysis · Nansen</Text>
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{`as of ${asOf} · tap to fold`}</Text>
        </View>

        <Text variant="bodyStrong" style={{ fontSize: theme.type.tMd }} testID="context-headline">{card.headline}</Text>

        <View style={{ gap: theme.space.s1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="small">{`Buys ${usd(card.buy_volume_usd)}`}</Text>
            <Text variant="small">{`Sells ${usd(card.sell_volume_usd)}`}</Text>
          </View>
          {flow}
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
            {`${share}% of today's flow is buying · `}
            <Text variant="small" style={{ fontSize: theme.type.t2xs, color: theme.color.ink }}>{lean}</Text>
          </Text>
        </View>

        {buyers.length + sellers.length > 0 ? (
          <View style={{ gap: theme.space.s2, paddingTop: theme.space.s2, borderTopWidth: theme.size.bw, borderTopColor: theme.color.hair }} testID="context-traders">
            {[...buyers, ...sellers].map((w) => (
              <View key={`${w.buy ? 'b' : 's'}-${w.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: w.buy ? theme.color.up : theme.color.down }} />
                <Text variant="small" numberOfLines={1} style={{ flex: 1, fontSize: theme.type.tXs }}>{w.name}</Text>
                <Text
                  variant="num"
                  style={{ fontSize: theme.type.tXs, fontFamily: face(theme, 'num', 600), color: w.buy ? theme.color.up : theme.color.down }}
                >
                  {`${w.buy ? '+' : '−'}${usd(w.size)}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function who(address: string, label?: string): string {
  return label && label.trim() ? label : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
