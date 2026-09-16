/**
 * A page at a time.
 *
 * Every list in the app that can grow — the history, the boards — shows a
 * fixed number of rows and the way to the next few, rather than filling in
 * under a thumb that is scrolling for something else. `pages` is given
 * when the whole count is known and left out when only the next page is.
 */
import { Pressable, View } from 'react-native';

import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export function Pager({
  page,
  pages,
  hasNext,
  onPrev,
  onNext,
  busy,
  testID = 'pager',
}: {
  /** 1-based. */
  page: number;
  pages?: number | null;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const hasPrev = page > 1;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.s3 }}>
      <Arrow label="‹" enabled={hasPrev} onPress={onPrev} testID={`${testID}-prev`} />
      <Text variant="small" testID={`${testID}-label`} style={{ fontSize: theme.type.tXs, minWidth: 80, textAlign: 'center' }}>
        {busy ? 'Loading…' : pages ? `Page ${page} of ${pages}` : `Page ${page}`}
      </Text>
      <Arrow label="›" enabled={hasNext} onPress={onNext} testID={`${testID}-next`} />
    </View>
  );
}

function Arrow({ label, enabled, onPress, testID }: { label: string; enabled: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 32,
        borderRadius: theme.radius.rMd,
        borderWidth: theme.size.bw,
        borderColor: theme.color.line,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: !enabled ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      <Text variant="bodyStrong" style={{ fontSize: theme.type.tMd, lineHeight: theme.type.tMd * 1.2 }}>{label}</Text>
    </Pressable>
  );
}

/** Which slice of a list a page shows. */
export function slice<T>(rows: T[], page: number, size: number): T[] {
  return rows.slice((page - 1) * size, page * size);
}
