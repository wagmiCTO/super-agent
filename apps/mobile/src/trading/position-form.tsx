/**
 * The standard position, as a form.
 *
 * The design puts the same block in two places: the settings screen, and the
 * fourth step of every lesson ("Your standard position"). It is the same
 * numbers in both, so it is one component — a lesson that taught a different
 * form from the one the taps use would be teaching the wrong thing.
 *
 * A rule that is switched off collapses to a quiet line. Off should look off:
 * an inactive control that still occupies a card reads as something you have
 * failed to fill in.
 */

import { useEffect } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { atRisk, maxSizeFor, ownStake, possibleWin, usePositionSettings } from '@/trading/useSettings';
import { Slider } from '@/ui/slider';
import { Card, Chip, Toggle } from '@/ui/surface';
import { Text, grouped } from '@/ui/text';
import { face, useTheme } from '@/theme';

const STOP_PRESETS = [10, 25, 50, 75];
const TAKE_PRESETS = [25, 50, 100, 200];
const SIZE_SHARES = [25, 50, 75, 100];

/** Four readable stops along the leverage track, inside what policy allows. */
function ticksTo(maxLeverage: number): number[] {
  const wanted = [1, Math.round(maxLeverage / 3), Math.round((maxLeverage * 2) / 3), maxLeverage];
  return [...new Set(wanted.map((v) => Math.min(maxLeverage, Math.max(1, v))))];
}

export function PositionForm({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const { settings, update, bounds, refresh } = usePositionSettings();
  // The ceiling is the balance's, so it is only as good as the last read of
  // it: a round trip or a deposit between two visits moves it.
  useEffect(refresh, [refresh]);
  const max = maxSizeFor(bounds, settings.leverage);
  const step = max > 200 ? 5 : 1;
  const win = possibleWin(settings);

  return (
    <View style={{ gap: compact ? theme.space.s3 : theme.space.s4 }}>
      {/* Size */}
      <View style={{ gap: theme.space.s2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caps">Position size</Text>
          <Text variant="num" style={{ fontSize: theme.type.tXs }} testID="settings-max">{`max ${grouped(max)}`}</Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.s3,
            paddingHorizontal: theme.space.s4,
            paddingVertical: theme.space.s3,
            borderRadius: theme.radius.rLg,
            backgroundColor: theme.color.cardBg,
            borderWidth: theme.size.bw,
            borderColor: theme.color.line,
          }}
        >
          <TextInput
            testID="settings-size"
            value={String(settings.size)}
            onChangeText={(text) => {
              const n = Number(text.replace(/[^0-9]/g, ''));
              update({ size: Number.isFinite(n) ? n : bounds.minSize });
            }}
            inputMode="numeric"
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: face(theme, 'num', 700),
              fontSize: compact ? theme.type.t2xl : theme.type.t3xl,
              color: theme.color.ink,
              padding: 0,
            }}
          />
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tMd, color: theme.color.muted }}>AUSD</Text>
        </View>

        <Slider
          testID="settings-size-slider"
          value={Math.min(settings.size, max)}
          min={bounds.minSize}
          max={max}
          step={step}
          onChange={(size) => update({ size })}
        />

        <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
          {SIZE_SHARES.map((share) => {
            const v = Math.max(bounds.minSize, Math.round((max * share) / 100 / step) * step);
            return (
              <Chip
                key={share}
                testID={`settings-size-${share}`}
                label={share === 100 ? 'Max' : `${share}%`}
                on={settings.size === v}
                onPress={() => update({ size: v })}
              />
            );
          })}
        </View>

        <Text variant="small">{`${ownStake(settings).toFixed(0)} AUSD of yours at ${settings.leverage}x`}</Text>
      </View>

      {/* Leverage */}
      <View style={{ gap: theme.space.s2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="caps">Leverage</Text>
          <Text variant="num" style={{ fontSize: theme.type.tLg, fontFamily: face(theme, 'num', 700) }}>
            {`${settings.leverage}x`}
          </Text>
        </View>
        <Slider
          testID="settings-leverage"
          value={settings.leverage}
          min={1}
          max={bounds.maxLeverage}
          onChange={(leverage) => update({ leverage })}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {ticksTo(bounds.maxLeverage).map((v) => (
            <Text
              key={v}
              variant="num"
              style={{
                fontSize: theme.type.t2xs,
                color: settings.leverage === v ? theme.color.accent : theme.color.dim,
              }}
              onPress={() => update({ leverage: v })}
            >
              {`${v}x`}
            </Text>
          ))}
        </View>
      </View>

      <Rule
        title="Stop"
        testID="settings-stop"
        on={settings.stopOn}
        note={`−${settings.stopPercent}% · ${atRisk(settings).toFixed(2)} AUSD`}
        sign="−"
        presets={STOP_PRESETS}
        value={settings.stopPercent}
        onToggle={() => update({ stopOn: !settings.stopOn })}
        onPick={(stopPercent) => update({ stopPercent })}
      />

      <Rule
        title="Take profit"
        testID="settings-tp"
        on={settings.takeProfitOn}
        note={`+${settings.takeProfitPercent}% · ${(win ?? 0).toFixed(2)} AUSD`}
        sign="+"
        presets={TAKE_PRESETS}
        value={settings.takeProfitPercent}
        onToggle={() => update({ takeProfitOn: !settings.takeProfitOn })}
        onPick={(takeProfitPercent) => update({ takeProfitPercent })}
      />
    </View>
  );
}

/** The two numbers the form exists for: what a tap can win, what it can lose. */
export function PossibleOutcomes() {
  const theme = useTheme();
  const { settings } = usePositionSettings();
  const win = possibleWin(settings);
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.s2 }} testID="possible">
      <Outcome
        label="Possible win"
        value={
          win === null
            ? `+${(settings.size / 100).toFixed(2)} per 1%, no cap`
            : `+${win.toFixed(2)} at +${settings.takeProfitPercent}%`
        }
      />
      <Outcome label="Possible loss" value={`−${atRisk(settings).toFixed(2)} at most`} />
    </View>
  );
}

/** A rule that is off takes one quiet line; on, it opens into its choices. */
function Rule({
  title, testID, on, note, sign, presets, value, onToggle, onPick,
}: {
  title: string;
  testID: string;
  on: boolean;
  note: string;
  sign: string;
  presets: number[];
  value: number;
  onToggle: () => void;
  onPick: (value: number) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: theme.radius.rLg,
        paddingHorizontal: theme.space.s4,
        paddingVertical: theme.space.s3,
        backgroundColor: on ? theme.color.cardBg : 'transparent',
        borderWidth: theme.size.bw,
        borderColor: on && theme.color.cardLine !== 'transparent' ? theme.color.cardLine : 'transparent',
        gap: theme.space.s2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2, opacity: on ? 1 : 0.55 }}>
        <Text variant="bodyStrong" style={{ color: on ? theme.color.ink : theme.color.muted }}>{title}</Text>
        <Text variant="small">{on ? note : 'off'}</Text>
        <View style={{ flex: 1 }} />
        <Toggle testID={`${testID}-toggle`} on={on} onPress={onToggle} />
      </View>
      {on ? (
        <View style={{ flexDirection: 'row', gap: theme.space.s2, flexWrap: 'wrap' }}>
          {presets.map((p) => (
            <Chip key={p} testID={`${testID}-${p}`} label={`${sign}${p}%`} on={value === p} onPress={() => onPick(p)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Outcome({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Card style={{ flex: 1, gap: 2, paddingVertical: theme.space.s3 }}>
      <Text variant="caps">{label}</Text>
      <Text variant="num" style={{ fontSize: theme.type.tSm, fontFamily: face(theme, 'num', 700) }}>{value}</Text>
    </Card>
  );
}

/**
 * The standard position as one line on a trading screen: what a tap opens,
 * and the number it can cost. Tapping it opens the form.
 */
export function SettingsChip({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { settings } = usePositionSettings();
  return (
    <Pressable onPress={onPress} testID="settings-chip">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.s3,
          paddingHorizontal: theme.space.s4,
          paddingVertical: theme.space.s3,
          borderRadius: theme.radius.rLg,
          backgroundColor: theme.color.cardBg,
          borderWidth: theme.size.bw,
          borderColor: theme.color.line,
        }}
      >
        <View style={{ gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.s2 }}>
            <Text variant="num" style={{ fontSize: theme.type.tXl, fontFamily: face(theme, 'num', 700) }}>
              {String(settings.size)}
            </Text>
            <Text variant="small" style={{ fontSize: theme.type.tXs }}>AUSD</Text>
            <Text variant="num" style={{ fontSize: theme.type.tMd, fontFamily: face(theme, 'num', 700), color: theme.color.accent }}>
              {`${settings.leverage}x`}
            </Text>
          </View>
          <Text variant="small" style={{ fontSize: theme.type.tXs }}>
            {`${settings.stopOn ? `stop −${settings.stopPercent}%` : 'no stop'} · ${
              settings.takeProfitOn ? `TP +${settings.takeProfitPercent}%` : 'no TP'
            }`}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="caps">At risk</Text>
          <Text variant="num" style={{ fontSize: theme.type.tLg, fontFamily: face(theme, 'num', 700), color: theme.color.down }}>
            {`−${atRisk(settings).toFixed(2)}`}
          </Text>
        </View>
        <Text variant="small" style={{ color: theme.color.muted }}>›</Text>
      </View>
    </Pressable>
  );
}
