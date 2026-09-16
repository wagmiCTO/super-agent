/**
 * Account — the wallet, the money in it, and the way out.
 *
 * As the design has it: the address, what the exchange calls it, what it
 * holds, which network it is on, the way to the invite, and at the bottom
 * the only destructive thing on the screen.
 *
 * Adding and withdrawing money are missing on purpose while the app is on
 * testnet. The practice balance comes from the venue when the account
 * opens; the deposit route is Aurora bridging real USDC to Monad mainnet,
 * which would take real money and deliver it somewhere this app cannot
 * trade. A button that takes money to nowhere is worse than no button.
 *
 * Activating the exchange account is not here. It has its own screen, and
 * the gate sends a wallet there before it ever reaches the lobby.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { shortAddress } from '@/components/prizes';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { useTrading } from '@/trading/useTrading';
import { Button } from '@/ui/button';
import { copy } from '@/ui/clipboard';
import { back } from '@/ui/stub';
import { Badge, Card, Chip, Row, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function AccountScreen() {
  const theme = useTheme();
  const account = useAccount();
  const { prefs } = useOnboarding();
  const testnet = prefs.network !== 'mainnet';
  const t = useTrading('MON', 'direction');
  const address = account.state.status === 'unlocked' || account.state.status === 'remembered' ? account.state.stored.address : null;
  const inTrades = (t.state?.positions ?? []).reduce((sum, p) => sum + Number(p.collateral), 0);
  const [notice, setNotice] = useState<string | null>(null);

  const take = async () => {
    if (!address) return;
    const what = await copy(address);
    setNotice(what === 'failed' ? 'Could not copy' : what === 'copied' ? 'Copied' : 'Shared');
  };

  return (
    <Screen testID="account">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="lobby-link" onPress={back}>‹ Lobby</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="account-title">Account</Text>
          <View style={{ flex: 1 }} />
          <Badge>TESTNET</Badge>
        </View>

        <Card style={{ gap: theme.space.s3 }} testID="wallet-card">
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>Your wallet · passkey on this phone</Text>
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
              <Text variant="num" numberOfLines={1} style={{ flexShrink: 1 }} testID="wallet-address">
                {address ? shortAddress(address) : 'not signed in'}
              </Text>
              {address ? (
                <Text variant="small" testID="wallet-copy" onPress={() => void take()} style={{ color: theme.color.accent }}>
                  {notice ?? 'copy'}
                </Text>
              ) : null}
            </View>
            {/* What the exchange calls the same wallet, under the address it
                belongs to rather than adrift at the bottom of the screen. */}
            <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }} testID="exchange-account">
              {!t.state
                ? t.offline ? 'Exchange account · offline' : 'Exchange account · …'
                : t.state.account.id === '0'
                  ? 'No exchange account yet'
                  : `Exchange account #${t.state.account.id} · ${t.state.account.can_trade ? 'open' : t.state.account.frozen ? 'frozen' : 'not trading yet'}`}
            </Text>
          </View>
          <Row label="Balance" value={t.state ? `${Number(t.state.account.balance).toFixed(2)} AUSD` : t.offline ? 'offline' : '…'} />
          <Row label="In open trades" value={`${inTrades.toFixed(2)} AUSD`} />
          {testnet ? (
            <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="testnet-funding">
              Practice money: the exchange hands it to every account it opens. Adding and withdrawing arrive with real money.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
              <Button testID="add-funds" title="Add funds" small style={{ flex: 1 }} onPress={() => router.push('/deposit')} />
              <Button testID="withdraw" title="Withdraw" variant="outline" small style={{ flex: 1 }} onPress={() => router.push('/withdraw')} />
            </View>
          )}
        </Card>

        <Card style={{ gap: theme.space.s2 }} testID="network-card">
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>Network</Text>
          <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
            <View style={{ flex: 1 }}>
              <Chip label="Testnet" on={testnet} center testID="network-testnet" />
            </View>
            {/* Mainnet is drawn, not offered: the app trades testnet only,
                so the chip is disabled and leads nowhere, like the lobby's
                menu entry. The line under it says what it is. */}
            <View style={{ flex: 1 }}>
              <Chip label="Mainnet" center disabled testID="network-mainnet" />
            </View>
          </View>
          {/* Both in one line each: which money it is, and whose it is. */}
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
            Testnet · practice money on Monad, nothing to lose.
          </Text>
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
            Mainnet · your own money, its own account and balance. Not open yet.
          </Text>
        </Card>

        {/* A row with a chevron reads as a label with a mark after it. This
            one has to read as something to press, so it carries the accent
            and an arrow in a circle of its own. */}
        <Pressable
          testID="invite-row"
          accessibilityRole="button"
          accessibilityLabel="Invite friends"
          onPress={() => router.push('/invite')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.space.s3,
            paddingVertical: theme.space.s3,
            paddingHorizontal: theme.space.s4,
            borderRadius: theme.radius.rLg,
            borderWidth: theme.size.bw,
            borderColor: theme.color.accent,
            backgroundColor: theme.color.soft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm, color: theme.color.accent }}>Invite friends</Text>
            <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>A share of the fees on every trade they make</Text>
          </View>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: theme.color.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm, color: theme.color.onAccent }}>›</Text>
          </View>
        </Pressable>

        <View style={{ flex: 1 }} />

        <View style={{ alignItems: 'center', gap: theme.space.s2 }}>
          <Text
            variant="small"
            testID="sign-out"
            onPress={() => {
              void account.signOut().then(() => router.replace('/'));
            }}
            style={{ color: theme.color.accent, paddingVertical: theme.space.s2 }}
          >
            Sign out
          </Text>
          <Text variant="small" style={{ fontSize: theme.type.t2xs, textAlign: 'center' }}>
            The passkey stays on this device. Face ID brings everything back.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
