/** Scratch screen: renders every primitive in both skins so a change can be
 *  looked at rather than reasoned about. Deleted before the onboarding lands. */
import { ScrollView, View } from 'react-native';

import { Button, DirectionKeys } from '@/ui/button';
import { Mark, RiskDial } from '@/ui/mark';
import { Badge, Card, Chip, Dots, Progress, Row, Screen, Toggle } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme, useThemeControls } from '@/theme';

export default function Probe() {
  const theme = useTheme();
  const { name, toggleTheme } = useThemeControls();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space.s4, paddingVertical: 48 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Mark size={28} />
          <Badge>testnet</Badge>
          <View style={{ flex: 1 }} />
          <Text variant="num">10 001 AUSD</Text>
          <RiskDial percent={72} />
        </View>
        <Text variant="h1">Choose a strategy</Text>
        <Text variant="body">Direction leads this week with +12.3 · MA Cross +2.1 · RSI −0.4</Text>
        <Card>
          <Text variant="caps">Today&apos;s loss budget</Text>
          <Row label="Result" value={money(-22.72) + ' AUSD'} tone={-22.72} />
          <Row label="Won" value="2 of 4" />
          <View style={{ flexDirection: 'row', gap: theme.space.s2 }}><Progress value={32} /></View>
        </Card>
        <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
          <Chip label="Direction" on /><Chip label="MA Cross" /><Chip label="RSI" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Dots count={5} at={2} /><View style={{ flex: 1 }} /><Toggle on /><Toggle on={false} />
        </View>
        <Text variant="caps">Direction · both keys yours</Text>
        <DirectionKeys onPress={() => {}} alwaysArmed />
        <Text variant="caps">MA Cross · signal names Up</Text>
        <DirectionKeys onPress={() => {}} recommended="up" />
        <Text variant="caps">MA Cross · waiting</Text>
        <DirectionKeys onPress={() => {}} />
        <Text variant="hero" signOf={1.04}>{money(1.04)}</Text>
        <Button title="Open account" />
        <Button title="Close now" variant="outline" />
        <Button title="Working…" busy disabled />
        <Button title={`Theme: ${name} — tap to switch`} variant="danger" onPress={toggleTheme} />
      </ScrollView>
    </Screen>
  );
}
