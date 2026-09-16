/**
 * The lobby: the list of strategies, each with this week's board — what it
 * made for everyone, who is up, how many are in right now. The number people
 * argue about is the strategy's total, not any one trader's.
 *
 * Laid out as the design has it: the mark, the network, the balance and the
 * day's risk in one row; a prize to claim when there is one; the strategies;
 * the promise of your own; and, pinned to the bottom, the way to everything
 * else. Screens the design names and the app has not built yet open as
 * stubs, so no link here leads nowhere.
 */
import { Link, router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import type { Board } from '@/api/client';
import { APP_NAME } from '@/config';
import { unclaimedTotal, useMyPrizes } from '@/components/prizes';
import { equity } from '@/trading/equity';
import { useRiskReport } from '@/trading/useRiskReport';
import { useLeaderboard } from '@/trading/useLeaderboard';
import { useTrading } from '@/trading/useTrading';
import { nextStep, useOnboarding } from '@/onboarding/useOnboarding';
import { Mark, RiskDial } from '@/ui/mark';
import { StrategyTile, type GlyphId } from '@/ui/glyph';
import { Splash } from '@/ui/splash';
import { Badge, Screen } from '@/ui/surface';
import { riskPercent, riskPercentOf } from '@/strategy/risk';
import { Text, money } from '@/ui/text';
import { face, useTheme } from '@/theme';

const ROUTES: Record<string, Href> = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' };

/** The week's argument: which strategy made the most for its traders. */
function factionLine(boards: Board[]): string | null {
  const played = boards.filter((b) => b.trades > 0);
  if (played.length === 0) return null;
  const sorted = [...played].sort((a, b) => Number(b.pnl) - Number(a.pnl));
  const lead = sorted[0];
  const rest = sorted.slice(1).map((b) => `${b.name} ${money(Number(b.pnl))}`);
  return `${lead.name} leads this week with ${money(Number(lead.pnl))}${rest.length ? ` · ${rest.join(' · ')}` : ''}`;
}

/**
 * The entry point decides whether this is a first visit.
 *
 * The onboarding is linear, so the question is asked here rather than in a
 * router of its own: a cold start or a reload lands wherever the visit had got
 * to instead of replaying the promo. Once there is a passkey — remembered or
 * unlocked — the first visit is over for good, even if the stored preferences
 * were cleared.
 */
export default function Entry() {
  const account = useAccount();
  const { ready, prefs } = useOnboarding();
  const hasAccount = account.state.status === 'unlocked' || account.state.status === 'remembered';
  // The exchange side is a separate fact from the passkey: an account can
  // exist on the device while its activation transactions have not run.
  const gateTrading = useTrading('MON', 'direction');

  // A splash that waits for an answer can wait for ever — the platform may be
  // unreachable, which is exactly the case on a deployment with no API behind
  // it. After this the gate proceeds on what it knows.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Only an answer asked in this wallet's name says anything about it. A
  // request without the wallet header is answered for the platform's own
  // account, which is always open — reading that as the user's is how the
  // activation step went missing.
  const wallet = account.state.status === 'unlocked' ? account.state.wallet.address.toLowerCase() : null;
  const heard = gateTrading.state !== null && gateTrading.stateFor?.toLowerCase() === wallet;
  // A wallet with no strategy key cannot trade at all: the platform answers
  // `no_key` rather than an account status, so `locked` is what says the
  // account still has to be opened.
  const keyless = Boolean(wallet) && gateTrading.locked;
  // Not knowing is not the same as knowing the account is unopened: without an
  // answer the gate must not send anyone to the activation screen.
  const exchangeReady =
    !heard ||
    (gateTrading.state!.account.status !== 'no_exchange_account' &&
      gateTrading.state!.account.status !== 'forwarding_disabled');
  // The account layer starts at 'loading' and only then reads storage. Acting
  // before it answers is how the entry point used to throw a signed-in user at
  // the passkey screen: every route back to the lobby bounced off it.
  const accountKnown = account.state.status !== 'loading';
  const settled = ready && accountKnown && (!hasAccount || heard || gateTrading.offline || waited);
  const step = settled ? nextStep(prefs, hasAccount, exchangeReady && !keyless) : null;

  useEffect(() => {
    if (step) router.replace(step);
  }, [step]);

  // A1: the app's own ground while the answer is being worked out, so the
  // first frame is the app rather than a spinner on a foreign background.
  if (!settled || step) return <Splash />;
  return <LobbyScreen />;
}

/** Where the header row sits, so the menu can hang under its badge. */
const HEADER_TOP = 52;

function LobbyScreen() {
  const account = useAccount();
  const { taught } = useOnboarding();
  const theme = useTheme();
  // The lobby trades nothing itself; it reads the state for the balance, the
  // risk dial and whether a strategy has a position open right now.
  const t = useTrading('MON', 'direction');
  const lb = useLeaderboard();
  const boards = lb?.boards ?? null;
  const open = (id: string) => t.state?.positions.find(() => id === 'direction') ?? null;
  const address = account.state.status === 'unlocked' || account.state.status === 'remembered' ? account.state.stored.address.toLowerCase() : null;
  // Only a real prize: the banner leads to a claim, and a banner over
  // nothing to claim is a promise the leaderboard cannot keep.
  const prize = unclaimedTotal(useMyPrizes(lb?.prize && address ? address : null).mine);
  const [menu, setMenu] = useState(false);
  // The same dial as every strategy screen: the wallet's report first.
  const report = useRiskReport(Boolean(address));
  const risk = riskPercentOf(report) ?? riskPercent(t.state);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: HEADER_TOP, paddingBottom: theme.space.s4, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
          <Mark size={28} />
          {/* The name never truncates: on a narrow phone the balance is what gives way. */}
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tSm, flexShrink: 0 }} testID="app-name">{APP_NAME}</Text>
          <NetworkBadge onPress={() => setMenu((m) => !m)} />
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
            <Text variant="num" numberOfLines={1} style={{ fontSize: theme.type.tXs, color: theme.color.muted, flexShrink: 1 }} testID="balance">
              {t.state ? `${equity(t.state).toFixed(2)} AUSD` : t.offline ? 'offline' : '…'}
            </Text>
            <Pressable onPress={() => router.push('/risk')} testID="risk-dial" accessibilityRole="button" accessibilityLabel="Risk and performance">
              <RiskDial percent={risk} />
            </Pressable>
          </View>
        </View>

        {prize !== null ? (
          <Pressable
            testID="prize-banner"
            accessibilityRole="button"
            accessibilityLabel="Claim the prize of the week"
            onPress={() => router.push('/leaderboard')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: theme.space.s4,
              paddingVertical: theme.space.s3,
              borderRadius: theme.radius.rLg,
              backgroundColor: theme.color.accent,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm, color: theme.color.onAccent }}>{`Prize of the week: ${prize.toFixed(2)} AUSD`}</Text>
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm, color: theme.color.onAccent }}>Claim</Text>
          </Pressable>
        ) : null}

        <View style={{ gap: 2 }}>
          <Text variant="h1" style={{ fontSize: theme.type.tXl, lineHeight: theme.type.tXl * 1.2, letterSpacing: theme.type.tXl * theme.heading.tracking }}>Choose a strategy</Text>
          {boards && factionLine(boards) ? (
            <Text variant="small" testID="faction-line">{factionLine(boards)}</Text>
          ) : (
            <Text variant="small">One tap opens a position. The platform closes it for you.</Text>
          )}
        </View>

        {boards === null ? (
          <Text variant="small">Loading strategies…</Text>
        ) : (
          boards.map((b, i) => (
            <StrategyCard
              key={b.id}
              board={b}
              lead={i === 0 && !taught(b.id)}
              openPnl={open(b.id)?.unrealized_pnl ?? null}
              href={taught(b.id) ? (ROUTES[b.id] ?? '/') : { pathname: '/lesson', params: { strategy: b.id } }}
              pool={poolOf(lb?.prize?.pools.find((p) => p.strategy === b.id))}
              rank={rankOf(b, address)}
            />
          ))
        )}

        <Link href="/own" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Build your own strategy" testID="own-link">
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.s3,
                  paddingHorizontal: theme.space.s4,
                  paddingVertical: theme.space.s3,
                  borderRadius: theme.radius.rLg,
                  borderWidth: theme.size.bw,
                  borderColor: theme.color.line,
                  backgroundColor: theme.color.cardBg,
                  opacity: pressed ? 0.7 : 1,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: theme.radius.rSm,
                    borderWidth: theme.size.bw,
                    borderStyle: 'dashed',
                    borderColor: theme.color.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="body" style={{ color: theme.color.muted }}>+</Text>
                </View>
                <Text variant="body" numberOfLines={1} style={{ flex: 1, fontSize: theme.type.tSm }}>Build your own strategy</Text>
                <Text variant="small" numberOfLines={1}>coming soon</Text>
              </View>
            )}
          </Pressable>
        </Link>

      </ScrollView>

      {/* Pinned under the scroll rather than at the end of it: on a short
          screen the way to everything else must not need a scroll to find. */}
      <Footer />

      {menu ? <NetworkMenu onClose={() => setMenu(false)} /> : null}
    </Screen>
  );
}

/**
 * The way to everything that is not a strategy, pinned under the fold. Two
 * groups, as the design draws them: the boards and the invite on the left,
 * the ledger on the right.
 */
function Footer() {
  const theme = useTheme();
  const link = (title: string, href: Href, testID: string) => (
    <Text variant="small" testID={testID} onPress={() => router.push(href)} style={{ paddingVertical: theme.space.s2 }}>
      {title}
    </Text>
  );
  return (
    <View style={{ paddingBottom: theme.space.s6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.color.paper }}>
      <View style={{ flexDirection: 'row', gap: theme.space.s4 }}>
        {link('Leaderboard', '/leaderboard', 'leaderboard-link')}
        {link('Invite', '/invite', 'invite-link')}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.s4 }}>
        {link('History', '/history', 'history-link')}
        {link('Risk', '/risk', 'risk-link')}
        {link('Account', '/account', 'account-link')}
      </View>
    </View>
  );
}

/**
 * The network menu, hung under the badge as the design draws it. Testnet is
 * where the app lives; the other entry says what mainnet would mean and leads
 * to the screen that says it is not here yet. A tap anywhere else closes it.
 */
function NetworkMenu({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const entry = (name: string, note: string, current: boolean, onPress: (() => void) | null, testID: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: onPress === null }}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      style={({ pressed }) => ({
        padding: theme.space.s3,
        borderRadius: theme.radius.rMd,
        backgroundColor: current ? theme.color.soft : theme.color.paper,
        gap: 2,
        // The design's `.dim`: there, but not a choice yet.
        opacity: onPress === null ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.s2 }}>
        <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tLg, lineHeight: theme.type.tLg * 1.3, letterSpacing: theme.type.tLg * theme.tracking, color: theme.color.ink }}>{name}</Text>
        {current ? <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tMd, color: theme.color.accent }}>✓</Text> : null}
      </View>
      <Text variant="small" style={{ fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.4 }}>{note}</Text>
    </Pressable>
  );
  return (
    <>
      <Pressable testID="network-scrim" accessibilityLabel="Close the menu" onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <View
        testID="network-menu"
        style={{
          position: 'absolute',
          top: HEADER_TOP + 36,
          left: theme.space.s5 + 38,
          width: 250,
          borderRadius: theme.radius.rLg,
          backgroundColor: theme.color.paper,
          borderWidth: 1,
          borderColor: theme.color.line,
          padding: theme.space.s2,
          gap: 2,
          shadowColor: theme.color.shadowMenu,
          shadowOpacity: 1,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 12 },
          elevation: 8,
        }}
      >
        {entry('TESTNET', 'Practice money · nothing to lose', true, onClose, 'network-testnet')}
        {entry('MAINNET', 'Your own money · every win and loss is real', false, null, 'network-mainnet')}
      </View>
    </>
  );
}

/** The design's badge with the caret that says it opens something. */
function NetworkBadge({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID="network-badge"
      accessibilityRole="button"
      accessibilityLabel="Network"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.s2,
        paddingVertical: theme.space.s1,
        paddingHorizontal: theme.space.s2,
        borderRadius: theme.radius.rSm,
        borderWidth: theme.size.bw,
        borderColor: theme.color.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="caps" style={{ fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.3, color: theme.color.text2 }}>TESTNET</Text>
      <Text style={{ fontFamily: face(theme, 'display', 600), fontSize: theme.type.t2xs, color: theme.color.text2 }}>▼</Text>
    </Pressable>
  );
}

/** Where this wallet stands on the strategy's board, if it is on it at all. */
function rankOf(board: Board, address: string | null): number | null {
  if (!address) return null;
  const i = board.top.findIndex((w) => w.wallet.toLowerCase() === address);
  return i === -1 ? null : i + 1;
}

/**
 * One strategy: its sign, its name, what the week has in it, and one line of
 * what the strategy actually asks of you.
 *
 * The first card a new trader sees carries START HERE; a card with a position
 * open says so instead — that is the one thing more urgent than starting.
 */
/**
 * The pool as the card names it: what is on the contract once the week's
 * fees are in, or, during the week, what the fees have earned "so far".
 */
function poolOf(p: { pool: string; accrued: string } | undefined): { amount: string; soFar: boolean } | null {
  if (!p) return null;
  if (Number(p.pool) > 0) return { amount: p.pool, soFar: false };
  if (Number(p.accrued) > 0) return { amount: p.accrued, soFar: true };
  return null;
}

function StrategyCard({ board, href, pool, lead, openPnl, rank }: { board: Board; href: Href; pool: { amount: string; soFar: boolean } | null; lead: boolean; openPnl: string | null; rank: number | null }) {
  const theme = useTheme();
  const sub = [
    pool !== null ? `Pool ${Number(pool.amount).toFixed(2)} AUSD${pool.soFar ? ' so far' : ''}` : 'No pool yet',
    `${board.players} ${board.players === 1 ? 'trader' : 'traders'}`,
    rank !== null ? `you #${rank}` : null,
    board.active_now > 0 ? `${board.active_now} in now` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${board.name}`} testID={`strategy-${board.id}`}>
        {({ pressed }) => (
          <View
            style={{
              gap: theme.space.s2,
              paddingHorizontal: theme.space.s4,
              paddingVertical: theme.space.s3,
              borderRadius: theme.radius.rLg,
              borderWidth: lead ? 2 : theme.size.bw,
              borderColor: lead ? theme.color.accent : theme.color.hair,
              backgroundColor: theme.color.raised,
              opacity: pressed ? 0.7 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
              <StrategyTile id={glyphOf(board.id)} size={56} />
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tLg }}>{board.name}</Text>
                <Text variant="small" numberOfLines={1} testID={`prize-pool-${board.id}`}>{sub}</Text>
              </View>
              {openPnl !== null ? (
                <Badge strong>{`OPEN · ${money(Number(openPnl))}`}</Badge>
              ) : lead ? (
                <Badge strong>START HERE</Badge>
              ) : null}
            </View>
            <Text variant="body" style={{ fontSize: theme.type.tSm, lineHeight: theme.type.tSm * 1.4, color: theme.color.body }}>{board.tagline}</Text>
            <Text variant="num" signOf={Number(board.pnl)} style={{ fontSize: theme.type.tXs }} testID={`board-pnl-${board.id}`}>
              {`${money(Number(board.pnl))} this week · ${board.trades} ${board.trades === 1 ? 'trade' : 'trades'}`}
            </Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

/** The board ids the platform uses, as the three signs the lobby draws. */
function glyphOf(id: string): GlyphId {
  return id === 'ma-cross' || id === 'rsi' ? id : 'direction';
}
