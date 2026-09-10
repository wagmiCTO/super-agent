/**
 * The TradingView chart on web: the chart page in an iframe on the same
 * origin, driven by postMessage.
 */
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { chartPageUrl, type ChartMessage, type TVChartProps } from '@/chart/page';

export function TVChart({ symbol, theme, background, chartType, trend, ma, box, trades, position, height }: TVChartProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const url = chartPageUrl({ symbol, theme, background, ma });
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
    </View>
  );
}
