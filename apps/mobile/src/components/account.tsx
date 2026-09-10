/**
 * The account layer on a strategy screen: the passkey row, the strategy's
 * key, and the activation card for a wallet whose exchange account does
 * not exist yet. Identical on every screen; the lobby shows it without a
 * strategy.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { KeyFamily, Wallet } from '@/account/derive';
import type { useAccount } from '@/account/useAccount';
import type { State } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCollateral, formatNative, STEP_LABEL } from '@/exchange/activate';
import { useActivation, type PendingStatus } from '@/exchange/useActivation';
import { useEnabledStrategies, useStrategyKey } from '@/exchange/useStrategyKey';
import { STRATEGY_NAMES } from '@/config';
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
  strategy,
}: {
  account: ReturnType<typeof useAccount>;
  state: State | null;
  onChange: () => void;
  /** The strategy this screen trades; the lobby passes none. */
  strategy?: string;
}) {
  const [keysVersion, setKeysVersion] = useState(0);
  const onKeysChange = () => {
    setKeysVersion((v) => v + 1);
    onChange();
  };
  return (
    <>
      <AccountRow account={account} keysVersion={keysVersion} />
      {strategy && account.state.status === 'unlocked' ? (
        <StrategyKeyCard keys={account.state.keys} strategy={strategy} onChange={onKeysChange} />
      ) : null}
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
 * Under the address: which strategies have their own key.
 */
function AccountRow({ account, keysVersion }: { account: ReturnType<typeof useAccount>; keysVersion: number }) {
  const theme = useTheme();
  const { state, busy, error } = account;
  const address = state.status === 'unlocked' || state.status === 'remembered' ? state.stored.address : null;
  const enabled = useEnabledStrategies(state.status === 'unlocked' ? state.wallet.address : null, keysVersion);
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
        {state.status === 'unlocked' && enabled ? (
          <ThemedText type="small" themeColor="textSecondary" testID="enabled-strategies">
            {enabled.length === 0
              ? 'No strategy keys yet — one passkey, a key per strategy'
              : `Keys: ${enabled.map((k) => (k.strategy ? STRATEGY_NAMES[k.strategy] ?? k.strategy : 'all strategies')).join(' · ')}`}
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
          <SmallButton label="Sign out" onPress={() => void account.signOut()} busy={busy} />
        )}
      </View>
    </View>
  );
}

/**
 * The strategy's own key: enrolled, or one tap from it. The tap enrolls the
 * key the passkey derived for this strategy, labelled after it on the
 * venue's key page, under this strategy's limits.
 */
function StrategyKeyCard({ keys, strategy, onChange }: { keys: KeyFamily; strategy: string; onChange: () => void }) {
  const theme = useTheme();
  const k = useStrategyKey(keys, strategy);
  const status = k.state.status;
  // The platform now routes this strategy to its own key: re-read state at once.
  useEffect(() => {
    if (status !== 'unknown') onChange();
  }, [status]);
  const name = STRATEGY_NAMES[strategy] ?? strategy;
  if (status === 'unknown') return null;
  if (status === 'enabled') {
    return (
      <ThemedText type="small" themeColor="textSecondary" testID="strategy-key-status">
        {name} key enrolled · builder {k.state.key.builder_id} · fee up to {k.state.key.max_builder_fee_pct}
        {k.state.key.derived ? ' · derived from your passkey' : ''}
      </ThemedText>
    );
  }
  return (
    <View style={[styles.activation, { backgroundColor: theme.backgroundElement }]} testID="strategy-key">
      <ThemedText type="smallBold">Enable {name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {name} trades with its own exchange key, derived from your passkey and enrolled with the platform&apos;s builder terms. Revoke it on the
        exchange any time; the other strategies keep theirs.
      </ThemedText>
      {k.error ? (
        <ThemedText type="small" style={{ color: '#991b1b' }} testID="strategy-key-error">
          {k.error}
        </ThemedText>
      ) : null}
      <SmallButton label={`Enable ${name}`} onPress={() => void k.enable()} busy={k.busy} />
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
