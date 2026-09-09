/**
 * The signal chart on iOS and Android: Lightweight Charts inside a WebView,
 * with the library embedded in the page so nothing is fetched at runtime.
 * Updates cross the bridge as JSON.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { chartDocument, type ChartPayload, type ChartTheme } from '@/chart/script';
import vendor from '@/chart/vendor.generated';

export function SignalChart({ payload, theme, height }: { payload: ChartPayload | null; theme: ChartTheme; height: number }) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const themeKey = JSON.stringify(theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => chartDocument(vendor, theme), [themeKey]);

  useEffect(() => {
    if (ready && payload) {
      web.current?.injectJavaScript(`window.__update(${JSON.stringify(JSON.stringify(payload))}); true;`);
    }
  }, [ready, payload]);

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }} testID="signal-chart">
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e) => {
          if (e.nativeEvent.data === 'ready') setReady(true);
        }}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled={false}
        allowsInlineMediaPlayback
        style={{ backgroundColor: theme.background }}
      />
    </View>
  );
}
