/**
 * Invite friends — the offer, the link, and what it has brought so far.
 *
 * The share is of the builder fee, which is the only fee that is ours: the
 * venue's own cut never was. On testnet we charge none, so the screen says
 * that plainly rather than showing a promising zero — the invites still
 * count, and the volume they bring is real.
 *
 * Everything on it comes from `/v1/referral`: the code is minted on the
 * first read and kept, and a friend is on the list from the moment their
 * wallet claimed the code, whether or not they have traded yet.
 */
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Referral } from '@/api/client';
import { APP_NAME, LEADERBOARD_POLL_MS, WEB_URL } from '@/config';
import { shortAddress } from '@/components/prizes';
import { Bone, FadeIn } from '@/ui/anim';
import { Button } from '@/ui/button';
import { copy } from '@/ui/clipboard';
import { ReferralScene } from '@/ui/illustration';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

export default function InviteScreen() {
  const theme = useTheme();
  const top = useTop();
  // Not before the account layer has read the device: a request that leaves
  // without the wallet on it is answered "sign in", and this screen would
  // then say so to someone who is signed in.
  const knows = useAccount().state.status !== 'loading';
  const { invite, problem } = useInvite(knows);
  const [notice, setNotice] = useState<string | null>(null);
  const share = Math.round(invite?.share_pct ?? 30);
  // The link is this build's own address with the platform's code on it: the
  // platform names one site, and a link from a preview or a laptop that sent
  // people to the production one would attribute them to nothing they could
  // see. The platform's own link stays the fallback, for clients with no
  // origin of their own.
  const link = invite ? (WEB_URL ? `${WEB_URL}/i/${invite.code}` : invite.link) : '';
  const earns = Number(invite?.fee_bps ?? 0) > 0;

  const take = async () => {
    if (!invite) return;
    const what = await copy(link);
    setNotice(what === 'failed' ? 'Could not copy' : what === 'copied' ? 'Link copied' : 'Shared');
  };

  const sheet = async () => {
    if (!invite) return;
    try {
      await Share.share({ message: `Trade with me on ${APP_NAME}: ${link}` });
    } catch {
      await take();
    }
  };

  return (
    <Screen testID="invite">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="lobby-link" onPress={back}>‹ Back</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="invite-title">Invite friends</Text>
        </View>

        <ReferralScene sharePct={share} />

        <Text variant="h1" style={{ fontSize: theme.type.t2xl }}>Trade together, earn together</Text>
        <Text variant="body">
          {`You get ${share}% of the fees we earn on every trade your friends make, for a year. It starts the moment they open the app on your link — no code to type, nothing for them to remember.`}
        </Text>

        {problem ? (
          <Text variant="small" testID="invite-problem">
            {problem === 'locked' ? 'Sign in with your passkey to get your link.' : 'Server unreachable'}
          </Text>
        ) : !invite ? (
          <View style={{ gap: theme.space.s3 }}>
            <Bone width="100%" height={56} radius={theme.radius.rLg} />
            <Bone width="100%" height={48} radius={theme.radius.rLg} />
          </View>
        ) : (
          <FadeIn style={{ gap: theme.space.s4 }}>
            <Card style={{ gap: theme.space.s2 }} testID="invite-link-card">
              <Text variant="small" style={{ fontSize: theme.type.t2xs }}>Your link</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.s3 }}>
                <Text variant="num" numberOfLines={1} style={{ flexShrink: 1 }} testID="invite-link">{plain(link)}</Text>
                <Chip label={notice ?? 'Copy'} small onPress={() => void take()} testID="invite-copy" />
              </View>
            </Card>

            <Button testID="invite-share" title="Share the link" onPress={() => void sheet()} />

            <View style={{ flexDirection: 'row', gap: theme.space.s2 }} testID="invite-totals">
              <Tile value={String(invite.totals.invited)} label="invited" />
              <Tile value={round(invite.totals.volume)} label="AUSD traded" />
              <Tile value={Number(invite.totals.earned).toFixed(2)} label="AUSD earned" />
            </View>

            {!earns ? (
              <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="invite-nofee">
                Practice money pays no fee, so nothing is earned here yet. Everyone you bring is counted, and what they trade with it too.
              </Text>
            ) : null}

            {invite.friends.length > 0 ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="caps">Friend</Text>
                  <View style={{ flexDirection: 'row', gap: theme.space.s4 }}>
                    <Text variant="caps" style={{ width: 84, textAlign: 'right' }}>Volume · AUSD</Text>
                    <Text variant="caps" style={{ width: 56, textAlign: 'right' }}>Earned</Text>
                  </View>
                </View>
                {invite.friends.map((f) => (
                  <View
                    key={f.wallet}
                    testID="invite-friend"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: theme.space.s3,
                      paddingVertical: theme.space.s2,
                      borderTopWidth: theme.size.bw,
                      borderTopColor: theme.color.hair,
                    }}
                  >
                    <View style={{ gap: 2, flexShrink: 1 }}>
                      <Text variant="num" numberOfLines={1} style={{ fontSize: theme.type.tSm }}>{shortAddress(f.wallet)}</Text>
                      <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>
                        {f.trades > 0 ? `trading · ${f.trades} ${f.trades === 1 ? 'trade' : 'trades'}` : 'joined, no trade yet'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: theme.space.s4 }}>
                      {/* No unit in the rows: the column says what it is,
                          and a wrapped number is harder to compare. */}
                      <Text variant="num" numberOfLines={1} style={{ width: 84, textAlign: 'right', fontSize: theme.type.tSm }}>{round(f.volume)}</Text>
                      <Text variant="num" numberOfLines={1} style={{ width: 56, textAlign: 'right', fontSize: theme.type.tSm, color: Number(f.earned) > 0 ? theme.color.ink : theme.color.dim }}>
                        {Number(f.earned) > 0 ? `+${Number(f.earned).toFixed(2)}` : '—'}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <Text variant="small" testID="invite-empty">
                Nobody yet. The first friend who opens the app on your link shows up here, before they have traded anything.
              </Text>
            )}

            {invite.referred_by ? (
              <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="invite-referred-by">
                {`You came in on ${shortAddress(invite.referred_by)}'s link.`}
              </Text>
            ) : null}
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
  );
}

/** One of the three numbers, in a box of its own. */
function Tile({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: 2,
        paddingVertical: theme.space.s3,
        paddingHorizontal: theme.space.s3,
        borderRadius: theme.radius.rLg,
        borderWidth: theme.size.bw,
        borderColor: theme.color.hair,
      }}
    >
      <Text variant="num" numberOfLines={1} style={{ fontSize: theme.type.tLg }}>{value}</Text>
      <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.tXs }}>{label}</Text>
    </View>
  );
}

/** The link as people read it out: no scheme, no www. */
function plain(link: string): string {
  return link.replace(/^https?:\/\//, '');
}

/** Volume in whole units, grouped — nobody reads eight decimals of it. */
function round(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n >= 100 ? Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') : n.toFixed(2);
}

/**
 * The invite, polled.
 *
 * Read once was not enough twice over. A friend who has just signed in asks
 * for this screen in the same breath as the app claims their code, and read
 * once they are told nobody brought them; and a screen left open while a
 * friend joins should say so — which, on the day this ships, is exactly what
 * it will be asked to do.
 */
function useInvite(ready: boolean): { invite: Referral | null; problem: 'locked' | 'offline' | null } {
  const [invite, setInvite] = useState<Referral | null>(null);
  const [problem, setProblem] = useState<'locked' | 'offline' | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const read = () =>
      api
        .referral()
        .then((r) => {
          if (!alive) return;
          setInvite(r);
          setProblem(null);
        })
        .catch((e) => {
          if (!alive) return;
          setProblem(e instanceof ApiError && e.code === 'network' ? 'offline' : 'locked');
        });
    const first = setTimeout(read, 0);
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ready]);
  return { invite, problem };
}
