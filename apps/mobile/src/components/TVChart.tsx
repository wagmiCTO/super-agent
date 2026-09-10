/**
 * The TradingView chart on iOS and Android: the chart page in a WebView,
 * served by the same host as the web build (Metro in development, the site
 * in production), driven by injected messages.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { chartPageUrl, type ChartMessage, type TVChartProps } from '@/chart/page';

export function TVChart({ symbol, theme, background, chartType, trend, ma, box, trades, position, height }: TVChartProps) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const url = chartPageUrl({ symbol, theme, background, ma });
  const boxKey = JSON.stringify(box ?? null);
  const tradesKey = JSON.stringify(trades ?? []);
  const positionKey = JSON.stringify(position ?? null);

  const send = (msg: ChartMessage) =>
    web.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify(msg))} })); true;`);
  useEffect(() => {
    if (ready) send({ type: 'chartType', value: chartType });
  }, [ready, chartType]);
  useEffect(() => {
    if (ready) send({ type: 'trend', value: trend });
  }, [ready, trend]);
  useEffect(() => {
    if (ready) send({ type: 'box', value: box ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, boxKey]);
  useEffect(() => {
    if (ready) send({ type: 'trades', value: trades ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tradesKey]);
  useEffect(() => {
    if (ready) send({ type: 'position', value: position ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, positionKey]);

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }} testID="signal-chart">
      <WebView
        ref={web}
        source={{ uri: url }}
        onMessage={(e) => {
          try {
            if (JSON.parse(e.nativeEvent.data).type === 'ready') setReady(true);
          } catch {
            // not ours
          }
        }}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        style={{ backgroundColor: background }}
      />
    </View>
  );
}
