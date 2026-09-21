/**
 * A7 — the strategy, in five steps.
 *
 * Nothing here is a test. The step that used to ask "spot it" now shows it:
 * the chart names the moment it means and the moment it does not, and Next is
 * always live. A teaching screen that holds the reader hostage is not teaching.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { STRATEGY_NAMES } from '@/config';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { PositionForm, PossibleOutcomes } from '@/trading/position-form';
import { CrossArt, DirectionIdea, DirectionShown, ReadyArt, RsiArt, RunArt } from '@/ui/lesson-art';
import { Dots, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

type StrategyId = 'direction' | 'ma-cross' | 'rsi';

type Step = { title: string; body: string; art: 'idea' | 'shown' | 'run' | 'setup' | 'ready' };

const LESSONS: Record<StrategyId, Step[]> = {
  direction: [
    { art: 'idea', title: 'Fifteen minutes. One call.', body: 'Bitcoin is at one price now. In fifteen minutes it will be higher or lower. You say which. That is the whole game.' },
    { art: 'shown', title: 'Where you tap', body: 'The price keeps turning on the same line. The turn is the tap; the middle of a move is not.' },
    { art: 'run', title: 'We take it from here', body: 'You tap. Within a second the trade is open at the exchange with your money. The system watches it every second while you do anything else.' },
    { art: 'setup', title: 'Your standard position', body: 'Every tap opens this position. Set it once, change it any time.' },
    { art: 'ready', title: 'Ready', body: 'You know when to tap, what happens, and what it can cost.' },
  ],
  'ma-cross': [
    { art: 'idea', title: 'Two lines. One moment.', body: 'A fast line follows the price closely, a slow line lags. When the fast one crosses above the slow one, the trend has just turned up.' },
    { art: 'shown', title: 'What a cross looks like', body: 'The fast line has to actually cross the slow one. Lines running close together only look busy.' },
    { art: 'run', title: 'The signal names a side', body: 'For a few minutes after a cross the screen shows the signal: Up or Down. Both buttons stay yours; the next cross comes in a few hours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
    { art: 'ready', title: 'Ready', body: 'You can read a cross and you know a window lasts minutes.' },
  ],
  rsi: [
    { art: 'idea', title: 'The crowd overdoes it', body: 'A thermometer from 0 to 100 shows how hard everyone has been buying or selling. Under 30, sellers overdid it and the price tends to bounce up.' },
    { art: 'shown', title: 'Cold means up', body: 'Under 30 the sellers overdid it, so the signal names Up. Over 70 it is the other way round.' },
    { art: 'run', title: 'Rare and sharp', body: 'Zones come once or twice a day. The screen shows the signal for a few minutes; both buttons stay yours.' },
    { art: 'setup', title: 'Your standard position', body: 'Same position for every strategy. Set it once, change it any time.' },
    { art: 'ready', title: 'Ready', body: 'You can read the band and you know to wait.' },
  ],
};

const ROUTES = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' } as const;

export default function LessonScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s6);
  const params = useLocalSearchParams<{ strategy?: string }>();
  const id: StrategyId = params.strategy === 'ma-cross' || params.strategy === 'rsi' ? params.strategy : 'direction';
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
      title={setup ? 'Save and continue' : last ? 'Make your first tap' : 'Next'}
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
  if (kind === 'ready') return <ReadyArt />;
  if (kind === 'run') return <RunArt kind={id === 'direction' ? 'direction' : 'signal'} />;
  if (kind === 'shown') {
    if (id === 'ma-cross') return <CrossArt shown />;
    if (id === 'rsi') return <RsiArt />;
    return <DirectionShown />;
  }
  if (id === 'ma-cross') return <CrossArt />;
  if (id === 'rsi') return <RsiArt />;
  return <DirectionIdea />;
}
