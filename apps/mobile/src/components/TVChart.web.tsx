/**
 * The TradingView chart on web: the chart page in an iframe on the same
 * origin, driven by postMessage.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { chartPageUrl, type ChartMessage, type TVChartProps } from '@/chart/page';

/** No subscription: the only transition is server-rendered → hydrated. */
const neverChanges = () => () => undefined;
const onClient = () => true;
const onServer = () => false;

export function TVChart({ symbol, theme, background, chartType, trend, ma, study, box, trades, position, height }: TVChartProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  // The page is exported statically, with no window to read an origin from,
  // so the URL baked into the HTML points at the development host. React does
  // not repair an attribute mismatch on hydration, and the chart would stay on
  // that address for ever. Mounting the frame after the first paint is what
  // makes its src the browser's answer rather than the build's.
  const mounted = useSyncExternalStore(neverChanges, onClient, onServer);
  const url = mounted ? chartPageUrl({ symbol, theme, background, ma, study }) : null;
  const boxKey = JSON.stringify(box ?? null);
  const tradesKey = JSON.stringify(trades ?? []);
  const positionKey = JSON.stringify(position ?? null);

  const send = (msg: ChartMessage) => frame.current?.contentWindow?.postMessage(msg, '*');
  useEffect(() => {
    send({ type: 'chartType', value: chartType });
  }, [chartType, url]);
  useEffect(() => {
    send({ type: 'trend', value: trend });
  }, [trend, url]);
  useEffect(() => {
    send({ type: 'box', value: box ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxKey, url]);
  useEffect(() => {
    send({ type: 'trades', value: trades ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradesKey, url]);
  useEffect(() => {
    send({ type: 'position', value: position ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, url]);

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }} testID="signal-chart">
      {url === null ? null : (
      <iframe
        ref={frame}
        title="chart"
        src={url}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background }}
        onLoad={() => {
          send({ type: 'chartType', value: chartType });
          send({ type: 'trend', value: trend });
          send({ type: 'box', value: box ?? null });
          send({ type: 'trades', value: trades ?? [] });
          send({ type: 'position', value: position ?? null });
        }}
      />
      )}
    </View>
  );
}
