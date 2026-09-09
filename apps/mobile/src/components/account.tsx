/**
 * The account layer on a strategy screen: the passkey row, the exchange
 * connection, and the activation card for a wallet whose exchange account
 * does not exist yet. Identical on every screen.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Wallet } from '@/account/derive';
import type { useAccount } from '@/account/useAccount';
import type { State } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCollateral, formatNative, STEP_LABEL } from '@/exchange/activate';
import { useActivation, type PendingStatus } from '@/exchange/useActivation';
import { useExchange } from '@/exchange/useExchange';
import { useTheme } from '@/hooks/use-theme';
import { SmallButton, styles as trading } from './trading';

/** What stands between this wallet and its first order, in the user's words. */
const ACCOUNT_STATUS_HINT: Record<State['account']['status'], string> = {
  no_exchange_account: 'Exchange account not activated yet — fund the wallet with MON and AUSD, then activate trading',
  forwarding_disabled: 'Exchange account exists but API trading is not authorized yet',
  frozen: 'The exchange has frozen this account',
  active: '',
};

const isPending = (s: State['account']['status']): s is PendingStatus => s === 'no_exchange_account' || s === 'forwarding_disabled';

/**
 * Everything about the account, in order: the passkey row, the status hint
 * when the wallet cannot trade yet, and the activation card that fixes it.
 */
export function AccountSection({
  account,
  state,
  onChange,
}: {
  account: ReturnType<typeof useAccount>;
  state: State | null;
  onChange: () => void;
}) {
  return (
    <>
      <AccountRow account={account} onExchangeChange={onChange} />
      {state && state.account.status !== 'active' ? (
        <ThemedText type="small" themeColor="textSecondary" testID="account-status">
          {ACCOUNT_STATUS_HINT[state.account.status]}
        </ThemedText>
      ) : null}
      {state && account.state.status === 'unlocked' && isPending(state.account.status) ? (
        <ActivationCard wallet={account.state.wallet} status={state.account.status} onActivated={onChange} />
      ) : null}
    </>
  );
}

/**
 * The account layer, in one row: a passkey creates or unlocks the wallet, and
 * the address is the proof. No seed phrase, no extension, nothing custodial.
 */
function AccountRow({ account, onExchangeChange }: { account: ReturnType<typeof useAccount>; onExchangeChange: () => void }) {
  const theme = useTheme();
  const { state, busy, error } = account;
  const address = state.status === 'unlocked' || state.status === 'remembered' ? state.stored.address : null;
  const exchange = useExchange(state.status === 'unlocked' ? state.wallet : null);
  // The request header now names a different account: re-read its state at once.
  const exchangeStatus = exchange.state.status;
  useEffect(() => {
    onExchangeChange();
  }, [exchangeStatus, onExchangeChange]);
  return (
    <View style={[styles.accountRow, { backgroundColor: theme.backgroundElement }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="small" themeColor="textSecondary">
          {state.status === 'unlocked' ? 'Signed in with passkey' : state.status === 'remembered' ? 'Locked · passkey to unlock' : 'No account'}
        </ThemedText>
        {address ? (
          <ThemedText type="code" testID="account-address" selectable>
            {address}
          </ThemedText>
        ) : (
          <ThemedText type="small">Create one with a passkey — no seed phrase</ThemedText>
        )}
        {error ? (
          <ThemedText type="small" style={{ color: '#991b1b' }} testID="account-error">
            {error}
          </ThemedText>
        ) : null}
        {state.status === 'unlocked' && exchange.state.status === 'connected' ? (
          <ThemedText type="small" themeColor="textSecondary" testID="exchange-status">
            Exchange connected · builder {exchange.state.key.builder_id} · fee up to {exchange.state.key.max_builder_fee_pct}
          </ThemedText>
        ) : null}
        {exchange.error ? (
          <ThemedText type="small" style={{ color: '#991b1b' }} testID="exchange-error">
            {exchange.error}
          </ThemedText>
        ) : null}
      </View>
      <View style={{ gap: Spacing.one }}>
        {state.status === 'none' || state.status === 'loading' ? (
          <SmallButton label="Create account" onPress={() => void account.create()} busy={busy} />
        ) : null}
        {state.status !== 'unlocked' ? (
          <SmallButton label="Sign in" onPress={() => void account.signIn()} busy={busy} />
        ) : (
          <>
            {exchange.state.status === 'not-connected' ? (
              <SmallButton label="Connect exchange" onPress={() => void exchange.connect()} busy={exchange.busy} />
            ) : null}
            <SmallButton label="Sign out" onPress={() => void account.signOut()} busy={busy} />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Funding and activation of the wallet's exchange account. Reads balances
 * from the chain, says what is still missing, and runs the transactions once
 * the wallet holds enough.
 */
function ActivationCard({ wallet, status, onActivated }: { wallet: Wallet; status: PendingStatus; onActivated: () => void }) {
  const theme = useTheme();
  const a = useActivation(wallet, status);
  const net = a.network;
  const run = async () => {
    await a.activate();
    onActivated();
  };
  return (
    <View style={[styles.activation, { backgroundColor: theme.backgroundElement }]} testID="activation">
      <ThemedText type="smallBold">{status === 'forwarding_disabled' ? 'Enable API trading' : 'Activate trading'}</ThemedText>
      {net && a.funding ? (
        <ThemedText type="small" themeColor="textSecondary" testID="activation-funding">
          {status === 'no_exchange_account'
            ? `${net.collateral_symbol} ${formatCollateral(net, a.funding.collateral)} of ${net.min_account_open_amount} · `
            : ''}
          MON {formatNative(a.funding.native)} for gas{a.shortfall && a.shortfall.native > 0n ? ' (need 0.1)' : ''}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {a.error ? '' : 'Reading balances…'}
        </ThemedText>
      )}
      {!a.funded && net ? (
        <ThemedText type="small" themeColor="textSecondary">
          Send {status === 'no_exchange_account' ? `${net.min_account_open_amount} ${net.collateral_symbol} and ` : ''}
          some MON to the address above ({net.network})
        </ThemedText>
      ) : null}
      {a.progress ? (
        <ThemedText type="small" themeColor="textSecondary" testID="activation-progress">
          {STEP_LABEL[a.progress.step]}
          {a.progress.hash ? '…' : ''}
        </ThemedText>
      ) : null}
      {a.error ? (
        <ThemedText type="small" style={{ color: '#991b1b' }} testID="activation-error">
          {a.error}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Activate"
        onPress={() => void run()}
        disabled={!a.funded || a.busy}
        style={({ pressed }) => [
          trading.smallButton,
          { backgroundColor: theme.backgroundSelected, opacity: !a.funded || a.busy || pressed ? 0.5 : 1 },
        ]}>
        {a.busy ? <ActivityIndicator /> : <ThemedText type="smallBold">Activate</ThemedText>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.two },
  activation: { borderRadius: 12, padding: Spacing.two, gap: Spacing.one },
});
