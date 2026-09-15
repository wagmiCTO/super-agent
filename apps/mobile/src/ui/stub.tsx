/**
 * A screen the design names and the app has not built yet.
 *
 * It exists so that every link in the lobby leads somewhere the user can come
 * back from, rather than nowhere. The header is the design's: the way back,
 * the screen's name, and the network badge. What follows is the name again,
 * large, and whatever working pieces the lobby handed over until the screen
 * proper replaces them.
 */

import { router } from 'expo-router';
import { ScrollView, View, type ViewProps } from 'react-native';

import { Badge, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** ‹ Lobby · the screen's name · the badge the design gives it. */
export function StubHeader({ title, badge = 'TESTNET', testID }: { title: string; badge?: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
      <Text variant="small" numberOfLines={1} testID={testID ?? 'lobby-link'} onPress={back}>‹ Lobby</Text>
      <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }}>{title}</Text>
      <View style={{ flex: 1 }} />
      <Badge>{badge}</Badge>
    </View>
  );
}

export function StubScreen({ title, badge, children, testID, ...rest }: { title: string; badge?: string; testID?: string } & ViewProps) {
  const theme = useTheme();
  return (
    <Screen testID={testID} {...rest}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <StubHeader title={title} badge={badge} />
        <View style={{ gap: theme.space.s2 }}>
          <Text variant="h1" testID="stub-title">{title}</Text>
          <Text variant="small">This screen is on its way. The lobby link brings you back.</Text>
        </View>
        {children}
      </ScrollView>
    </Screen>
  );
}
