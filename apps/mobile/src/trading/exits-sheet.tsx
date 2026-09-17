/**
 * A running position's exits, in a sheet: the stop, the target and the
 * time it has left. The design keeps the position screen to one number
 * and one button; everything that can still be changed about the trade
 * lives here, one tap away, and comes back as the same three lines the
 * position card already reads.
 *
 * The stop and the target are shares of your own stake, as the settings
 * form has them, and each is also said as the price it fires at — the
 * chart draws that line the moment it is applied.
 */
import { useState } from 'react';
import { View } from 'react-native';

import type { Position } from '@/api/client';
import { trim } from '@/components/format';
import { Button } from '@/ui/button';
import { useCountdown } from '@/ui/countdown';
import { Sheet } from '@/ui/sheet';
import { Chip } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { face, useTheme } from '@/theme';

const STOP_PRESETS = [10, 25, 50, 75];
const TAKE_PRESETS = [25, 50, 100, 200];
const EXTEND_PRESETS: { label: string; seconds: number }[] = [
  { label: '+15 min', seconds: 15 * 60 },
  { label: '+1 h', seconds: 60 * 60 },
  { label: '+4 h', seconds: 4 * 60 * 60 },
];

export type ExitsChange = { max_loss?: string; take_profit?: string; extend_seconds?: number };

/** A fraction of collateral as the whole percent the chips are labelled with. */
function percentOf(fraction: string | undefined): number {
  const n = Number(fraction);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

type ExitsProps = {
  position: Position;
  busy: boolean;
  onApply: (change: ExitsChange) => Promise<boolean>;
  onClose: () => void;
};

export function ExitsSheet({ open, ...rest }: ExitsProps & { open: boolean }) {
  return (
    <Sheet open={open} title="This trade's exits" onClose={rest.onClose} testID="exits">
      {/* Mounted afresh each time it opens, so it opens on what the
          position has now rather than on what it had last time. */}
      {open ? <Exits {...rest} /> : null}
    </Sheet>
  );
}

function Exits({ position, busy, onApply, onClose }: ExitsProps) {
  const theme = useTheme();
  const [stop, setStop] = useState(percentOf(position.max_loss));
  const [take, setTake] = useState(percentOf(position.take_profit));
  const [extend, setExtend] = useState(0);
  const left = useCountdown(position.closes_at ?? null);

  const collateral = Number(position.collateral);
  const size = Number(position.size);
  const entry = Number(position.entry_price);
  const sign = position.side === 'long' ? 1 : -1;
  const decimals = (position.entry_price.split('.')[1] ?? '').length;
  // Where a share of the stake is reached on the price, the chart's way.
  const priceAt = (pnl: number) => (size > 0 ? (entry + (sign * pnl) / size).toFixed(decimals) : '—');

  const changed: ExitsChange = {};
  if (stop !== percentOf(position.max_loss)) changed.max_loss = (stop / 100).toFixed(4);
  if (take !== percentOf(position.take_profit)) changed.take_profit = (take / 100).toFixed(4);
  if (extend > 0) changed.extend_seconds = extend;
  const dirty = Object.keys(changed).length > 0;

  const apply = async () => {
    if (await onApply(changed)) onClose();
  };

  return (
    <>
      <Section
        title="Stop"
        note={stop > 0 ? `−${stop}% · ${money(-(collateral * stop) / 100)} AUSD · at ${trim(priceAt(-(collateral * stop) / 100))}` : 'off · the time limit is the exit'}
      >
        <Chip label="Off" small on={stop === 0} onPress={() => setStop(0)} testID="exits-stop-off" />
        {STOP_PRESETS.map((p) => (
          <Chip key={p} label={`−${p}%`} small on={stop === p} onPress={() => setStop(p)} testID={`exits-stop-${p}`} />
        ))}
      </Section>

      <Section
        title="Take profit"
        note={take > 0 ? `+${take}% · ${money((collateral * take) / 100)} AUSD · at ${trim(priceAt((collateral * take) / 100))}` : 'off · runs to the time limit'}
      >
        <Chip label="Off" small on={take === 0} onPress={() => setTake(0)} testID="exits-take-off" />
        {TAKE_PRESETS.map((p) => (
          <Chip key={p} label={`+${p}%`} small on={take === p} onPress={() => setTake(p)} testID={`exits-take-${p}`} />
        ))}
      </Section>

      <Section
        title="Time"
        note={
          position.closes_at
            ? `closes in ${left ?? '—'}${extend ? ` · ${EXTEND_PRESETS.find((e) => e.seconds === extend)?.label ?? ''} more` : ''}`
            : extend
              ? `a limit of ${EXTEND_PRESETS.find((e) => e.seconds === extend)?.label.replace('+', '') ?? ''} from now`
              : 'no time limit'
        }
      >
        <Chip label="As is" small on={extend === 0} onPress={() => setExtend(0)} testID="exits-extend-0" />
        {EXTEND_PRESETS.map((e) => (
          <Chip key={e.seconds} label={e.label} small on={extend === e.seconds} onPress={() => setExtend(e.seconds)} testID={`exits-extend-${e.seconds}`} />
        ))}
      </Section>

      <Text variant="small" style={{ fontSize: theme.type.tXs }}>
        Stops and targets are the platform watching the exchange&apos;s own mark, not resting orders at the exchange. Time can be added, never taken away — close now to end it sooner.
      </Text>

      <Button testID="exits-apply" title={dirty ? 'Apply' : 'Nothing changed'} busy={busy} disabled={!dirty || busy} onPress={() => void apply()} />
    </>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.s2, flexWrap: 'wrap' }}>
        <Text variant="bodyStrong" style={{ fontFamily: face(theme, 'display', 700) }}>{title}</Text>
        <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{note}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.s2, flexWrap: 'wrap' }}>{children}</View>
    </View>
  );
}
