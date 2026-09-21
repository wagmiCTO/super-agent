/**
 * The standard position — what every tap opens.
 *
 * Set once, applies to every strategy. The screen's job is that the two
 * numbers at the bottom are never a surprise: what a tap can win and what it
 * can lose, in collateral, before anything is pressed.
 *
 * The form itself is shared with the lesson's fourth step, so what the lesson
 * teaches and what the taps use cannot drift apart.
 */

import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { DEFAULT_SYMBOL } from '@/config';
import { PositionForm, PossibleOutcomes } from '@/trading/position-form';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s5);
  // The market the form was opened from: its leverage is the one the
  // slider sets. The size and the rules are the same everywhere.
  const params = useLocalSearchParams<{ symbol?: string }>();
  const symbol = (typeof params.symbol === 'string' && params.symbol ? params.symbol : DEFAULT_SYMBOL).toUpperCase();

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
      {/* The grips here span the screen, so a drag on one starts inside the
          edge strip iOS reads as "go back". Holding the gesture off from the
          control is a race the native recogniser usually wins, so this screen
          does not offer it at all; `‹ Back` is right there. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, gap: theme.space.s4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="settings-back" onPress={back} style={{ flexShrink: 0 }}>‹ Back</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 0 }}>{`Position · ${symbol}`}</Text>
          <View style={{ flex: 1 }} />
          <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs, flexShrink: 1 }}>leverage per market</Text>
        </View>

        {/* `flex: 1` bounds the scroll to what is left of the screen: without
            it a tall form pushes the outcomes and the button below the fold. */}
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: theme.space.s4 }}>
          <PositionForm symbol={symbol} />
        </ScrollView>

        <View style={{ gap: theme.space.s3 }}>
          <PossibleOutcomes symbol={symbol} />
          <Button testID="settings-done" title="Done" onPress={back} />
        </View>
      </View>
    </Screen>
  );
}
