/**
 * The signal chart on web: Lightweight Charts mounted straight into a div,
 * driven by the same script the native WebView runs.
 */
import * as lib from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import type { ChartPayload, ChartTheme } from '@/chart/script';
import { MOUNT_SCRIPT } from '@/chart/script';

type Handle = { update: (p: ChartPayload) => void; destroy: () => void };

// The mount function is plain JavaScript shared with the WebView; here it is
// evaluated once against the imported library.
const mount = new Function('lib', 'container', 'theme', `${MOUNT_SCRIPT}; return mount(lib, container, theme);`) as (
  l: typeof lib,
  c: HTMLElement,
  t: ChartTheme,
) => Handle;

export function SignalChart({ payload, theme, height }: { payload: ChartPayload | null; theme: ChartTheme; height: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const handle = useRef<Handle | null>(null);
  const themeKey = JSON.stringify(theme);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = mount(lib, ref.current, theme);
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    // The theme is compared by value: a new object with the same colors must not remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  useEffect(() => {
    if (payload && handle.current) handle.current.update(payload);
  }, [payload, themeKey]);

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }} testID="signal-chart">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}
