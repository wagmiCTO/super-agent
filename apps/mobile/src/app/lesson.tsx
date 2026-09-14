/**
 * A7 — the strategy, in five steps.
 *
 * Nothing here is a test. The step that used to ask "spot it" now shows it:
 * the chart names the moment it means and the moment it does not, and Next is
 * always live. A teaching screen that holds the reader hostage is not teaching.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { STRATEGY_NAMES } from '@/config';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { CrossArt, DirectionIdea, DirectionShown, ReadyArt, RsiArt, RunArt } from '@/ui/lesson-art';
import { Dots, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

type StrategyId = 'direction' | 'ma-cross' | 'rsi';

type Step = { title: string; body: string; art: 'idea' | 'shown' | 'run' | 'ready' };

const LESSONS: Record<StrategyId, Step[]> = {
  direction: [
    { art: 'idea', title: 'Fifteen minutes. One call.', body: 'Bitcoin is at one price now. In fifteen minutes it will be higher or lower. You say which. That is the whole game.' },
    { art: 'shown', title: 'Where you tap', body: 'The price keeps turning on the same line. The turn is the tap; the middle of a move is not.' },
    { art: 'run', title: 'We take it from here', body: 'You tap. Within a second the trade is open at the exchange with your money. The system watches it every second while you do anything else.' },
    { art: 'run', title: 'What it can cost', body: 'Every tap has a size and a stop, and the screen says what it risks before you press. You never risk more than that number.' },
    { art: 'ready', title: 'Ready', body: 'You know when to tap, what happens, and what it can cost.' },
  ],
  'ma-cross': [
    { art: 'idea', title: 'Two lines. One moment.', body: 'A fast line follows the price closely, a slow line lags. When the fast one crosses above the slow one, the trend has just turned up.' },
    { art: 'shown', title: 'What a cross looks like', body: 'The fast line has to actually cross the slow one. Lines running close together only look busy.' },
    { art: 'run', title: 'The signal names a side', body: 'For a few minutes after a cross the screen shows the signal: Up or Down. Both buttons stay yours; the next cross comes in a few hours.' },
    { art: 'run', title: 'What it can cost', body: 'Every tap has a size and a stop, and the screen says what it risks before you press.' },
    { art: 'ready', title: 'Ready', body: 'You can read a cross and you know a window lasts minutes.' },
  ],
  rsi: [
    { art: 'idea', title: 'The crowd overdoes it', body: 'A thermometer from 0 to 100 shows how hard everyone has been buying or selling. Under 30, sellers overdid it and the price tends to bounce up.' },
    { art: 'shown', title: 'Cold means up', body: 'Under 30 the sellers overdid it, so the signal names Up. Over 70 it is the other way round.' },
    { art: 'run', title: 'Rare and sharp', body: 'Zones come once or twice a day. The screen shows the signal for a few minutes; both buttons stay yours.' },
    { art: 'run', title: 'What it can cost', body: 'Every tap has a size and a stop, and the screen says what it risks before you press.' },
    { art: 'ready', title: 'Ready', body: 'You can read the band and you know to wait.' },
  ],
};

const ROUTES = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' } as const;

export default function LessonScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ strategy?: string }>();
  const id: StrategyId = params.strategy === 'ma-cross' || params.strategy === 'rsi' ? params.strategy : 'direction';
  const steps = LESSONS[id];
  const [at, setAt] = useState(0);
  const step = steps[at];
  const last = at === steps.length - 1;
  const { markLessonSeen } = useOnboarding();

  const leave = async () => {
    await markLessonSeen();
    router.replace(ROUTES[id]);
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="caps">{`${STRATEGY_NAMES[id] ?? 'Direction'} · ${at + 1} of ${steps.length}`}</Text>
          <View style={{ flex: 1 }} />
          <Text variant="small" testID="lesson-skip" onPress={() => void leave()}>Skip</Text>
        </View>

        <Art id={id} kind={step.art} />

        <Dots count={steps.length} at={at} />

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">{step.title}</Text>
          <Text variant="body">{step.body}</Text>
        </View>

        <View style={{ flex: 1 }} />

        <Button
          testID="lesson-next"
          title={last ? 'Make your first tap' : 'Next'}
          onPress={() => (last ? void leave() : setAt(at + 1))}
        />
      </View>
    </Screen>
  );
}

function Art({ id, kind }: { id: StrategyId; kind: Step['art'] }) {
  if (kind === 'ready') return <ReadyArt />;
  if (kind === 'run') return <RunArt />;
  if (kind === 'shown') {
    if (id === 'ma-cross') return <CrossArt shown />;
    if (id === 'rsi') return <RsiArt />;
    return <DirectionShown />;
  }
  if (id === 'ma-cross') return <CrossArt />;
  if (id === 'rsi') return <RsiArt />;
  return <DirectionIdea />;
}
