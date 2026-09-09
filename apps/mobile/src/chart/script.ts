/**
 * The signal chart, written once as plain JavaScript so the same code runs
 * in two places: straight in the page on web, and inside a WebView on iOS
 * and Android, where the chart library (TradingView's Lightweight Charts)
 * has to live in a web context. Nothing here may reference module scope.
 *
 * `mount(lib, container, theme)` returns `{ update, destroy }`; `update`
 * takes a ChartPayload. Candles, a line, both averages, and a marker on the
 * last cross.
 */

export type ChartTheme = {
  background: string;
  text: string;
  grid: string;
  up: string;
  down: string;
  fast: string;
  slow: string;
};

export type ChartPoint = { at: string; open: string; high: string; low: string; close: string; fast?: string; slow?: string };

export type ChartPayload = {
  mode: 'candles' | 'line';
  points: ChartPoint[];
  trend: 'up' | 'down' | 'flat';
  cross: { side: 'long' | 'short'; at: string } | null;
};

export const MOUNT_SCRIPT = `
function mount(lib, container, theme) {
  var chart = lib.createChart(container, {
    autoSize: true,
    layout: { background: { type: 'solid', color: theme.background }, textColor: theme.text, attributionLogo: false, fontSize: 11 },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, barSpacing: 7 },
    crosshair: { mode: 1 },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
  });
  var candles = chart.addSeries(lib.CandlestickSeries, {
    upColor: theme.up, downColor: theme.down, borderVisible: false, wickUpColor: theme.up, wickDownColor: theme.down,
  });
  var line = chart.addSeries(lib.LineSeries, { color: theme.text, lineWidth: 1, visible: false, lastValueVisible: true, priceLineVisible: true });
  var fast = chart.addSeries(lib.LineSeries, { color: theme.fast, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  var slow = chart.addSeries(lib.LineSeries, { color: theme.slow, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  var markers = lib.createSeriesMarkers(candles, []);
  var lineMarkers = lib.createSeriesMarkers(line, []);
  var precisionSet = false;
  var lastCount = 0;

  // The library labels the axis in UTC; shifting the timestamps by the
  // device's offset makes it read in local time, like the rest of the screen.
  var tz = new Date().getTimezoneOffset() * 60;
  function t(iso) { return Math.floor(Date.parse(iso) / 1000) - tz; }
  function n(s) { return Number(s); }
  function decimals(points) {
    var d = 2;
    for (var i = Math.max(0, points.length - 30); i < points.length; i++) {
      var m = String(points[i].close).split('.')[1];
      if (m && m.length > d) d = m.length;
    }
    return Math.min(d, 8);
  }

  function update(p) {
    var points = p.points || [];
    if (!precisionSet && points.length) {
      var d = decimals(points);
      var fmt = { type: 'price', precision: d, minMove: Math.pow(10, -d) };
      candles.applyOptions({ priceFormat: fmt }); line.applyOptions({ priceFormat: fmt });
      fast.applyOptions({ priceFormat: fmt }); slow.applyOptions({ priceFormat: fmt });
      precisionSet = true;
    }
    var c = [], l = [], f = [], s = [];
    for (var i = 0; i < points.length; i++) {
      var q = points[i], time = t(q.at);
      c.push({ time: time, open: n(q.open), high: n(q.high), low: n(q.low), close: n(q.close) });
      l.push({ time: time, value: n(q.close) });
      if (q.fast) f.push({ time: time, value: n(q.fast) });
      if (q.slow) s.push({ time: time, value: n(q.slow) });
    }
    candles.setData(c); line.setData(l); fast.setData(f); slow.setData(s);
    var showCandles = p.mode !== 'line';
    candles.applyOptions({ visible: showCandles }); line.applyOptions({ visible: !showCandles });
    var trendColor = p.trend === 'up' ? theme.up : p.trend === 'down' ? theme.down : theme.slow;
    slow.applyOptions({ color: trendColor });
    var ms = [];
    if (p.cross) {
      var up = p.cross.side === 'long';
      // The cross is stamped when its bar closed; the marker sits on that bar.
      ms.push({ time: t(p.cross.at) - 60, position: up ? 'belowBar' : 'aboveBar', color: up ? theme.up : theme.down, shape: up ? 'arrowUp' : 'arrowDown', text: up ? 'cross ↑' : 'cross ↓' });
    }
    markers.setMarkers(showCandles ? ms : []); lineMarkers.setMarkers(showCandles ? [] : ms);
    if (points.length !== lastCount) { chart.timeScale().scrollToRealTime(); lastCount = points.length; }
  }
  function destroy() { chart.remove(); }
  return { update: update, destroy: destroy };
}
`;

/** The document a WebView loads: the library, the mount script, a bridge. */
export function chartDocument(vendorSource: string, theme: ChartTheme): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:${theme.background};overflow:hidden;height:100%}#c{position:absolute;inset:0}</style>
</head><body><div id="c"></div>
<script>${vendorSource}</script>
<script>
${MOUNT_SCRIPT}
var handle = mount(window.LightweightCharts, document.getElementById('c'), ${JSON.stringify(theme)});
window.__update = function (json) { try { handle.update(JSON.parse(json)); } catch (e) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('error: ' + e.message); } };
if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;
}
