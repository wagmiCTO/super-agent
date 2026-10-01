/**
 * A7 — the strategy, in three steps: the idea, what happens after the tap,
 * the position every tap opens.
 *
 * Nothing here is a test and Next is always live. It was five steps; a tester
 * stopped in the lobby because of how much there was to read before the first
 * tap, so the chart that showed the moment and the "ready" badge are gone, and
 * the rule they carried sits in the idea's own words.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { STRATEGY_NAMES } from '@/config';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { PositionForm, PossibleOutcomes } from '@/trading/position-form';
import { ChannelArt, CrossArt, DirectionIdea, RangeArt, RsiArt, RunArt } from '@/ui/lesson-art';
import { Dots, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

type StrategyId = 'direction' | 'ma-cross' | 'rsi' | 'donchian' | 'orb';

type Step = { title: string; body: string; art: 'idea' | 'run' | 'setup' };

const LESSONS: Record<StrategyId, Step[]> = {
  direction: [
    { art: 'idea', title: 'Fifteen minutes. One call.', body: 'Bitcoin is at one price now. In fifteen minutes it will be higher or lower. You say which. That is the whole game.' },
    { art: 'run', title: 'We take it from here', body: 'You tap Up or Down. Within a second the trade is open at the exchange with your money, a stop guards it, and the system watches it every second while you do anything else.' },
    { art: 'setup', title: 'Your standard position', body: 'Every tap opens this position. Set it once, change it any time.' },
  ],
  'ma-cross': [
    { art: 'idea', title: 'Two lines. One moment.', body: 'A fast line follows the price closely, a slow line lags. When the fast one actually crosses above the slow one, the trend has just turned up. Lines running close together only look busy.' },
    { art: 'run', title: 'The signal names a side', body: 'For a few minutes after a cross the screen shows the signal: Up or Down. Both buttons stay yours; the next cross comes in a few hours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
  ],
  rsi: [
    { art: 'idea', title: 'The crowd overdoes it', body: 'A thermometer from 0 to 100 shows how hard everyone has been buying or selling. Under 30, sellers overdid it and the price tends to bounce up, so the signal names Up. Over 70 it is the other way round.' },
    { art: 'run', title: 'Rare and sharp', body: 'Zones come once or twice a day. The screen shows the signal for a few minutes; both buttons stay yours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
  ],
  donchian: [
    { art: 'idea', title: 'The highest high in twenty bars', body: 'A line over the highest point of the last twenty bars and one under the lowest: that is the channel. Inside it the market is undecided. A bar that closes outside it is a decision; a wick that pokes through and comes back is not.' },
    { art: 'run', title: 'Trends break out again', body: 'After a breakout the channel moves up to include it, and a real trend breaks out of the new one too. The screen names Up or Down for a few bars; both buttons stay yours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
  ],
  orb: [
    { art: 'idea', title: 'Three opens a day', body: 'Crypto never closes, but the world does. The day opens at 00:00 UTC, London at 08:00, New York at 13:30 — shown in your time. The first quarter hour after each sets the range: its high and its low. The first bar to close outside it names Up or Down.' },
    { art: 'run', title: 'Know when to look', body: 'One signal a session; four hours later the open is old news and the watch ends. The screen says where the session is: the range forming, the watch on, or the time of the next open. The tap is still yours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
  ],
};

const ROUTES = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi', donchian: '/donchian', orb: '/orb' } as const;

export default function LessonScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s6);
  const params = useLocalSearchParams<{ strategy?: string }>();
  const id: StrategyId = params.strategy === 'ma-cross' || params.strategy === 'rsi' || params.strategy === 'donchian' || params.strategy === 'orb' ? params.strategy : 'direction';
  const steps = LESSONS[id];
  const [at, setAt] = useState(0);
  const step = steps[at];
  const last = at === steps.length - 1;
  const { markTaught } = useOnboarding();

  // Offered, not enforced: recorded on arrival, so leaving by any door — the
  // Skip, the last step, or the back gesture — never brings it back.
  useEffect(() => {
    void markTaught(id);
  }, [markTaught, id]);

  const leave = () => router.replace(ROUTES[id]);
  const setup = step.art === 'setup';

  // The setup step is a form, not a picture: it reads below its own words and
  // it is taller than the screen, so it scrolls and keeps its footer pinned.
  const head = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="caps">{`${STRATEGY_NAMES[id] ?? 'Direction'} · ${at + 1} of ${steps.length}`}</Text>
        <View style={{ flex: 1 }} />
        <Text variant="small" testID="lesson-skip" onPress={leave}>Skip</Text>
      </View>

      {setup ? null : <Art id={id} kind={step.art} />}

      <Dots count={steps.length} at={at} />

      <View style={{ gap: theme.space.s3 }}>
        <Text variant="h1" style={setup ? { fontSize: theme.type.t2xl } : undefined}>{step.title}</Text>
        <Text variant="body" style={setup ? { fontSize: theme.type.tSm } : undefined}>{step.body}</Text>
      </View>
    </>
  );

  const next = (
    <Button
      testID="lesson-next"
      title={last ? 'Make your first tap' : 'Next'}
      onPress={() => (last ? leave() : setAt(at + 1))}
    />
  );

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, gap: theme.space.s4 }}>
        {setup ? (
          <>
            {/* Bounded, so the outcomes and the button below never leave the screen. */}
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.s4, paddingBottom: theme.space.s4 }}>
              {head}
              <Art id={id} kind={step.art} />
            </ScrollView>
            <View style={{ gap: theme.space.s3 }}>
              <PossibleOutcomes />
              {next}
            </View>
          </>
        ) : (
          <>
            {head}
            <View style={{ flex: 1 }} />
            {next}
          </>
        )}
      </View>
    </Screen>
  );
}

function Art({ id, kind }: { id: StrategyId; kind: Step['art'] }) {
  if (kind === 'setup') return <PositionForm compact />;
  if (kind === 'run') return <RunArt kind={id === 'direction' ? 'direction' : id === 'donchian' ? 'channel' : id === 'orb' ? 'range' : 'signal'} />;
  if (id === 'ma-cross') return <CrossArt />;
  if (id === 'rsi') return <RsiArt />;
  if (id === 'donchian') return <ChannelArt />;
  if (id === 'orb') return <RangeArt />;
  return <DirectionIdea />;
}
