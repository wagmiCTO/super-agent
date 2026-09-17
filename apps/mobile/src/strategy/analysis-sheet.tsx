/**
 * The day's analysis, once a day, on the first strategy screen opened: what
 * the crowd on-chain has been doing with the market when Nansen has a read,
 * and which of the three strategies fits the tape today, in one sentence.
 *
 * It informs the tap; it never makes it. Both keys are exactly where they
 * were once the sheet is gone, and nothing about the position changes.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api/client';
import { useMarketContext, usd } from '@/components/context';
import { STRATEGY_NAMES } from '@/config';
import { strategyOfTheDay, todayKey, type Today } from '@/strategy/today';
import type { StrategyId } from '@/strategy/useSignal';
import { Button } from '@/ui/button';
import { StrategyTile } from '@/ui/glyph';
import { Sheet } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { face, useTheme } from '@/theme';

const ROUTES: Record<StrategyId, '/direction' | '/ma-cross' | '/rsi'> = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' };

export function AnalysisSheet({ open, symbol, current, onClose }: { open: boolean; symbol: string; current: StrategyId; onClose: () => void }) {
  return (
    <Sheet open={open} title="" onClose={onClose} testID="analysis">
      {open ? <Analysis symbol={symbol} current={current} onClose={onClose} /> : null}
    </Sheet>
  );
}

function Analysis({ symbol, current, onClose }: { symbol: string; current: StrategyId; onClose: () => void }) {
  const theme = useTheme();
  const card = useMarketContext(symbol);
  const [today, setToday] = useState<Today | null>(null);

  // The pick is read off the fifteen-minute chart's own signals: the same
  // numbers the RSI and MA Cross screens show for that timeframe.
  useEffect(() => {
    let alive = true;
    Promise.all([api.rsi(symbol, 900).catch(() => null), api.maCross(symbol, 900).catch(() => null)]).then(([r, m]) => {
      if (!alive) return;
      const crossAt = m?.last_cross?.at ? (Date.now() - new Date(m.last_cross.at).getTime()) / 60_000 : undefined;
      setToday(
        strategyOfTheDay({
          day: todayKey(),
          symbol,
          rsi: r?.ready ? Number(r.value) : undefined,
          trend: m?.ready ? m.trend : undefined,
          lastCrossMinutes: crossAt,
        }),
      );
    });
    return () => {
      alive = false;
    };
  }, [symbol]);

  const hasCard = card !== null && card !== 'unavailable';
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const pick = today ?? strategyOfTheDay({ day: todayKey(), symbol });
  const name = STRATEGY_NAMES[pick.id] ?? pick.id;

  return (
    <>
      <Text variant="caps" testID="analysis-kicker">{`Today on ${symbol}${hasCard ? ' · Nansen' : ''} · ${hm}`}</Text>
      {hasCard ? (
        <View style={{ gap: theme.space.s2 }}>
          <Text variant="h2" testID="analysis-headline" style={{ fontSize: theme.type.tXl, lineHeight: theme.type.tXl * 1.2 }}>{card.headline}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space.s3 }}>
            <Text variant="small">{`buys ${usd(card.buy_volume_usd)} · sells ${usd(card.sell_volume_usd)}`}</Text>
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>
              {card.lean === 'balanced' ? 'even' : `${card.lean} ahead`}
            </Text>
          </View>
        </View>
      ) : (
        <Text variant="h2" testID="analysis-headline" style={{ fontSize: theme.type.tXl, lineHeight: theme.type.tXl * 1.2 }}>
          {`Strategy of the day: ${name}`}
        </Text>
      )}

      <View
        testID="analysis-pick"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.s3,
          padding: theme.space.s4,
          borderRadius: theme.radius.rLg,
          backgroundColor: theme.color.soft,
        }}
      >
        <StrategyTile id={pick.id} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caps" style={{ color: theme.color.accent }}>Strategy of the day</Text>
          <Text variant="bodyStrong" style={{ fontFamily: face(theme, 'display', 700) }}>{name}</Text>
        </View>
      </View>
      <Text variant="body" testID="analysis-reason" style={{ fontSize: theme.type.tSm }}>{pick.reason}</Text>

      <Text variant="small" style={{ fontSize: theme.type.tXs }}>Shown once a day when you open a strategy. It informs the tap; it never makes it.</Text>

      <Button testID="analysis-got-it" title="Got it" onPress={onClose} />
      {pick.id !== current ? (
        <Button
          testID="analysis-open"
          title={`Open ${name}`}
          variant="outline"
          onPress={() => {
            onClose();
            router.replace(ROUTES[pick.id]);
          }}
        />
      ) : null}
    </>
  );
}
