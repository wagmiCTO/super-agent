/**
 * Fund the wallet from any chain, through Aurora Intents.
 *
 * Pick what you hold and where, say how much, and the platform quotes:
 * a one-time deposit address on that chain and what arrives in this
 * wallet on Monad. Send from wherever the asset is — an exchange, another
 * wallet — and the screen follows the deposit until it lands. Aurora runs
 * the swap and the bridge; nothing here holds funds, and refunds go back
 * to this wallet's address on the origin chain.
 */
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, describeError, type DepositOptions, type DepositQuote, type DepositStatus } from '@/api/client';
import { AccountSection } from '@/components/account';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NoticeBox, PresetRow, ScreenHeader, SmallButton, styles } from '@/components/trading';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Notice } from '@/trading/useTrading';

const STATUS_TEXT: Record<DepositStatus['status'], string> = {
  PENDING_DEPOSIT: 'Waiting for your transfer to arrive',
  KNOWN_DEPOSIT_TX: 'Transfer seen, waiting for confirmations',
  INCOMPLETE_DEPOSIT: 'Less arrived than quoted — send the rest, or it will be refunded',
  PROCESSING: 'Swapping and bridging to Monad',
  SUCCESS: 'Landed in your wallet on Monad',
  REFUNDED: 'Refunded to your address on the origin chain',
  FAILED: 'Failed — funds are refunded to the origin address',
};

const STATUS_POLL_MS = 10_000;

export default function DepositScreen() {
  const account = useAccount();
  const theme = useTheme();
  const [options, setOptions] = useState<DepositOptions | null | 'unavailable'>(null);
  const [chain, setChain] = useState<string>('');
  const [assetId, setAssetId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [status, setStatus] = useState<DepositStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const unlocked = account.state.status === 'unlocked';

  useEffect(() => {
    api
      .depositOptions()
      .then((o) => {
        setOptions(o);
        const first = o.options[0];
        if (first) {
          setChain(first.chain);
          setAssetId(first.asset_id);
        }
      })
      .catch(() => setOptions('unavailable'));
  }, []);

  const chains = useMemo(() => {
    if (!options || options === 'unavailable') return [];
    const seen = new Map<string, string>();
    for (const o of options.options) seen.set(o.chain, o.chain_name);
    return [...seen.entries()];
  }, [options]);
  const assets = useMemo(
    () => (options && options !== 'unavailable' ? options.options.filter((o) => o.chain === chain) : []),
    [options, chain],
  );
  const asset = assets.find((a) => a.asset_id === assetId) ?? assets[0] ?? null;

  const pickChain = (c: string) => {
    setChain(c);
    setQuote(null);
    setStatus(null);
  };

  const getQuote = useCallback(async () => {
    if (!asset || !unlocked) return;
    setBusy(true);
    setNotice(null);
    setStatus(null);
    try {
      const raw = toUnits(amount, asset.decimals);
      const q = await api.depositQuote({ origin_asset: asset.asset_id, amount: raw });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setNotice({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [amount, asset, unlocked]);

  // Once an address is out, follow the deposit until it ends one way or another.
  const depositAddress = quote?.deposit_address;
  useEffect(() => {
    if (!depositAddress) return;
    let alive = true;
    const read = () =>
      api
        .depositStatus(depositAddress)
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [depositAddress]);
  const done = status && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="DEPOSIT FROM ANY CHAIN" state={null} offline={false} />
          <AccountSection account={account} state={null} onChange={() => undefined} />

          {options === 'unavailable' ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
              Any-chain deposits are not available on this platform.
            </ThemedText>
          ) : !options ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
              Loading what you can send…
            </ThemedText>
          ) : (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: Spacing.two }]} testID="deposit">
              <ThemedText type="small" themeColor="textSecondary">
                Arrives as {options.destination.symbol} on {options.destination.chain === 'monad' ? 'Monad' : options.destination.chain} in
                this wallet. Refunds go to the same address on the chain you send from.
              </ThemedText>
              <ThemedText type="smallBold">From</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <PresetRow label="Chain" options={chains.map(([c]) => c)} value={chain} onChange={pickChain} />
              </ScrollView>
              <PresetRow label="Asset" options={assets.map((a) => a.symbol)} value={asset?.symbol ?? ''} onChange={(sym) => setAssetId(assets.find((a) => a.symbol === sym)?.asset_id ?? '')} />
              <ThemedText type="smallBold">Amount{asset ? ` (${asset.symbol})` : ''}</ThemedText>
              <TextInput
                accessibilityLabel="Amount"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder={asset ? minimumHint(asset.price_usd) : '0'}
                placeholderTextColor={theme.textSecondary}
                style={{ color: theme.text, borderColor: theme.backgroundSelected, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 }}
              />
              {!unlocked ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Sign in with your passkey first — the deposit lands in your wallet.
                </ThemedText>
              ) : null}
              <SmallButton label="Get deposit address" onPress={() => void getQuote()} busy={busy} />
              <NoticeBox notice={notice} />
              {quote ? (
                <View style={{ gap: Spacing.one }} testID="deposit-quote">
                  <ThemedText type="small">
                    Send {quote.amount_in} {asset?.symbol} (${Number(quote.amount_in_usd).toFixed(2)}) · you get {quote.amount_out}{' '}
                    {options.destination.symbol} · about {Math.max(1, Math.round(quote.time_estimate_seconds / 60))} min
                  </ThemedText>
                  <ThemedText type="smallBold">To this address on {chains.find(([c]) => c === chain)?.[1] ?? chain}:</ThemedText>
                  <ThemedText type="code" selectable testID="deposit-address">
                    {quote.deposit_address}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    select to copy · valid until {new Date(quote.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: done ? (status?.status === 'SUCCESS' ? '#16a34a' : '#dc2626') : theme.textSecondary }} testID="deposit-status">
                    {status ? STATUS_TEXT[status.status] ?? status.status : 'Waiting for your transfer…'}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                Powered by Aurora Intents. Aurora currently asks for at least $1,000 per deposit.
              </ThemedText>
            </View>
          )}

          <Link href="/" style={styles.link} accessibilityRole="link">
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Lobby
            </ThemedText>
          </Link>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** "1100" with 6 decimals → "1100000000"; no floats, so no rounding surprises. */
export function toUnits(amount: string, decimals: number): string {
  const s = amount.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new Error('Enter an amount');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimals for this asset`);
  const raw = (whole || '0') + frac.padEnd(decimals, '0');
  const trimmed = raw.replace(/^0+(?=\d)/, '');
  if (!/[1-9]/.test(trimmed)) throw new Error('Enter an amount above zero');
  return trimmed;
}

function minimumHint(priceUSD: string): string {
  const p = Number(priceUSD);
  if (!p) return '0';
  const min = 1000 / p;
  return `min ≈ ${min >= 100 ? Math.ceil(min) : min.toPrecision(3)}`;
}
