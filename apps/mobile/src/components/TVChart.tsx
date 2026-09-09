/**
 * The TradingView chart on iOS and Android: the chart page in a WebView,
 * served by the same host as the web build (Metro in development, the site
 * in production), driven by injected messages.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { chartPageUrl, type ChartMessage, type TVChartProps } from '@/chart/page';

export function TVChart({ symbol, theme, background, chartType, trend, height }: TVChartProps) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const url = chartPageUrl({ symbol, theme, background });

  const send = (msg: ChartMessage) =>
    web.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify(msg))} })); true;`);
  useEffect(() => {
    if (ready) send({ type: 'chartType', value: chartType });
  }, [ready, chartType]);
  useEffect(() => {
    if (ready) send({ type: 'trend', value: trend });
  }, [ready, trend]);

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
