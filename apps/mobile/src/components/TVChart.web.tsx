/**
 * The TradingView chart on web: the chart page in an iframe on the same
 * origin, driven by postMessage.
 */
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { chartPageUrl, type ChartMessage, type TVChartProps } from '@/chart/page';

export function TVChart({ symbol, theme, background, chartType, trend, height }: TVChartProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const url = chartPageUrl({ symbol, theme, background });

  const send = (msg: ChartMessage) => frame.current?.contentWindow?.postMessage(msg, '*');
  useEffect(() => {
    send({ type: 'chartType', value: chartType });
  }, [chartType, url]);
  useEffect(() => {
    send({ type: 'trend', value: trend });
  }, [trend, url]);

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
        }}
      />
    </View>
  );
}
