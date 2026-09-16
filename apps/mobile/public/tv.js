/**
 * The strategy chart page: TradingView's Charting Library with a datafeed
 * on the platform's candles, and one moving average drawn on top.
 *
 * Loaded at /tv.html by the app — inside an iframe on web, a WebView on the
 * phone — with the platform, the market and the skin's colours in the query:
 *
 *   /tv.html?api=http://host:8080&symbol=MON&theme=light&fast=5&slow=20&bg=%23F0F0F3
 *          &up=%231C9A6B&down=%23DC5546&accent=%23836EF9&text=%236E6862&grid=%23E8E4DE
 *
 * The app talks to the page with postMessage: chartType (candles | line),
 * interval ('1' | '5' | '15' | '30' | '60' minutes), trend (up | down | flat),
 * box ({top, bottom} | null), trades (the round trips to mark) and position
 * (the open one with the levels that end it, or null). The page answers { type: 'ready' } once the chart
 * is drawn and { type: 'price', price, change } with the last close and its
 * move since the day opened, on every bar it receives.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var API = (params.get('api') || '').replace(/\/$/, '');
  var SYMBOL = (params.get('symbol') || 'MON').toUpperCase();
  var THEME = params.get('theme') === 'dark' ? 'dark' : 'light';
  // The two averages MA Cross reads; 0 draws none.
  var FAST = Number(params.get('fast') || 0), SLOW = Number(params.get('slow') || 0);
  var STUDY = params.get('study') || '';
  var BG = params.get('bg') || (THEME === 'dark' ? '#212225' : '#F0F0F3');
  var UP = params.get('up') || '#16a34a', DOWN = params.get('down') || '#dc2626', MA = params.get('accent') || '#2563eb';
  var TEXT = params.get('text') || (THEME === 'dark' ? '#9ca3af' : '#6b7280');
  var GRID = params.get('grid') || (THEME === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
  var LINE = params.get('line') || TEXT;
  // The bars the venue serves, by the library's resolution name.
  var PERIODS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 };
  var RESOLUTIONS = Object.keys(PERIODS);
  var VISIBLE_BARS = 90; // what the first view shows, whatever the resolution
  // ?debug=1 narrates the datafeed in the console, for a chart that stays blank.
  var DEBUG = params.get('debug') === '1';
  function log() { if (DEBUG) console.log.apply(console, ['tv:'].concat([].slice.call(arguments))); }

  // The library is licensed and not in the repository, so a deployment that
  // was never given a copy has no chart to draw. Say so in a line of text: a
  // blank rectangle reads as a bug in the app, which it is not.
  if (typeof TradingView === 'undefined') {
    document.body.style.background = BG;
    var note = document.createElement('div');
    note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:' + TEXT;
    note.textContent = 'Chart unavailable on this build';
    document.body.appendChild(note);
    return;
  }

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }

  function fetchBars(period, from, to) {
    var url = API + '/v1/candles?symbol=' + encodeURIComponent(SYMBOL) + '&period_seconds=' + period + '&from=' + from + '&to=' + to;
    // A localtunnel in front of the platform shows browsers a reminder page
    // unless asked not to; only relevant when testing a phone against a laptop.
    var headers = /\.loca\.lt$/.test(new URL(API).hostname) ? { 'Bypass-Tunnel-Reminder': '1' } : {};
    return fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('candles ' + r.status);
      return r.json();
    }).then(function (rows) {
      return rows.map(function (b) {
        // `text` keeps the venue's own decimals for the price the app shows.
        return { time: b.t * 1000, open: +b.o, high: +b.h, low: +b.l, close: +b.c, volume: +b.v, text: b.c };
      });
    });
  }

  function pricescaleFor(bars) {
    var d = 2;
    for (var i = Math.max(0, bars.length - 50); i < bars.length; i++) {
      var s = String(bars[i].close), m = s.indexOf('.') >= 0 ? s.split('.')[1].length : 0;
      if (m > d) d = m;
    }
    return Math.pow(10, Math.min(d, 8));
  }

  // --- the price the app shows above the chart ---
  // The last close, and where the day opened: the first minute bar after
  // local midnight, or, before there is one, the oldest bar the chart has.
  var last = null, dayOpen = null, oldest = null;
  function tell() {
    if (!last) return;
    var ref = dayOpen || oldest;
    post({ type: 'price', price: last.text, change: ref ? (last.close / ref - 1) * 100 : null });
  }
  function saw(bar) {
    if (!last || bar.time >= last.time) { last = bar; }
    if (oldest === null || bar.time < oldest.time) { oldest = bar; }
    bars[bar.time] = bar;
  }
  (function findDayOpen() {
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var from = Math.floor(midnight.getTime() / 1000);
    fetchBars(60, from, from + 15 * 60).then(function (bars) {
      bars.sort(function (a, b) { return a.time - b.time; });
      if (bars.length) { dayOpen = bars[0].open; tell(); }
    }).catch(function () {});
  })();

  // --- datafeed (TradingView JS API) ---
  var subscribers = {};
  var newest = {}; // the last bar time the chart has, by resolution
  var pricescale = 100000;
  var datafeed = {
    onReady: function (cb) {
      setTimeout(function () { cb({ supported_resolutions: RESOLUTIONS, supports_marks: false, supports_timescale_marks: false, supports_time: false }); }, 0);
    },
    searchSymbols: function (_q, _e, _t, cb) { cb([]); },
    resolveSymbol: function (name, onResolve, onError) {
      log('resolveSymbol', name);
      // Read a little history first so the price scale matches the market.
      var now = Math.floor(Date.now() / 1000);
      fetchBars(60, now - 3600, now).then(function (bars) {
        if (bars.length) pricescale = pricescaleFor(bars);
      }).catch(function (e) { log('resolveSymbol: history', e && e.message); }).then(function () {
        log('resolveSymbol: pricescale', pricescale);
        onResolve({
          ticker: SYMBOL, name: SYMBOL, description: SYMBOL + ' perpetual', type: 'crypto',
          session: '24x7', timezone: 'Etc/UTC', exchange: 'Perpl', listed_exchange: 'Perpl', format: 'price',
          minmov: 1, pricescale: pricescale, has_intraday: true, has_daily: false, has_weekly_and_monthly: false,
          intraday_multipliers: RESOLUTIONS, supported_resolutions: RESOLUTIONS, volume_precision: 2, data_status: 'streaming',
        });
      });
    },
    getBars: function (_symbol, resolution, range, onResult, onError) {
      var period = PERIODS[resolution] || 60;
      log('getBars', resolution, range.from, range.to);
      fetchBars(period, range.from, range.to).then(function (bars) {
        bars.sort(function (a, b) { return a.time - b.time; });
        bars.forEach(saw);
        // The chart refuses a live bar older than the last one history gave it.
        if (bars.length && bars[bars.length - 1].time > (newest[resolution] || 0)) newest[resolution] = bars[bars.length - 1].time;
        log('getBars: bars', bars.length);
        onResult(bars, { noData: bars.length === 0 });
        tell();
      }).catch(function (e) { log('getBars: failed', e && e.message); onError(String(e)); });
    },
    subscribeBars: function (_symbol, resolution, onTick, uid) {
      var period = PERIODS[resolution] || 60;
      log('subscribeBars', resolution, uid);
      var timer = setInterval(function () {
        var now = Math.floor(Date.now() / 1000);
        fetchBars(period, now - 3 * period, now).then(function (bars) {
          bars.sort(function (a, b) { return a.time - b.time; });
          for (var i = 0; i < bars.length; i++) {
            if (bars[i].time >= (newest[resolution] || 0)) { onTick(bars[i]); newest[resolution] = bars[i].time; saw(bars[i]); }
          }
          tell();
        }).catch(function () {});
      }, 3000);
      subscribers[uid] = timer;
    },
    unsubscribeBars: function (uid) { clearInterval(subscribers[uid]); delete subscribers[uid]; },
  };

  // --- widget ---
  var widget = new TradingView.widget({
    container: 'tv',
    library_path: '/static/charting_library/',
    symbol: SYMBOL,
    interval: '1',
    datafeed: datafeed,
    locale: 'en',
    theme: THEME,
    autosize: true,
    fullscreen: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    custom_css_url: undefined,
    disabled_features: [
      'left_toolbar', 'header_widget', 'timeframes_toolbar', 'control_bar', 'context_menus', 'legend_widget',
      'symbol_search_hot_key', 'header_symbol_search', 'symbol_info', 'go_to_date', 'volume_force_overlay',
      'create_volume_indicator_by_default', 'edit_buttons_in_legend', 'border_around_the_chart', 'property_pages',
      'show_chart_property_page', 'header_saveload', 'save_chart_properties_to_local_storage', 'use_localstorage_for_settings',
      'study_templates', 'popup_hints', 'main_series_scale_menu', 'scales_context_menu', 'display_market_status',
    ],
    enabled_features: ['hide_left_toolbar_by_default'],
    overrides: {
      'paneProperties.background': BG,
      'paneProperties.backgroundType': 'solid',
      'paneProperties.backgroundGradientStartColor': BG,
      'paneProperties.backgroundGradientEndColor': BG,
      'paneProperties.vertGridProperties.color': GRID,
      'paneProperties.horzGridProperties.color': GRID,
      // The app draws the price and the timeframes over the top band of the
      // pane, so the bars start below it.
      'paneProperties.topMargin': 22,
      'paneProperties.bottomMargin': 8,
      'paneProperties.legendProperties.showLegend': false,
      'scalesProperties.textColor': TEXT,
      'scalesProperties.lineColor': GRID,
      'scalesProperties.fontSize': 11,
      // The averages' own values do not belong on the axis: the pane already
      // shows where they run, and the last price is the only number there.
      'scalesProperties.showStudyLastValue': false,
      'symbolWatermarkProperties.visibility': false,
      'mainSeriesProperties.candleStyle.upColor': UP,
      'mainSeriesProperties.candleStyle.downColor': DOWN,
      'mainSeriesProperties.candleStyle.borderUpColor': UP,
      'mainSeriesProperties.candleStyle.borderDownColor': DOWN,
      'mainSeriesProperties.candleStyle.wickUpColor': UP,
      'mainSeriesProperties.candleStyle.wickDownColor': DOWN,
      'mainSeriesProperties.lineStyle.color': LINE,
      'mainSeriesProperties.lineStyle.colorType': 'solid',
      'mainSeriesProperties.lineStyle.linewidth': 2,
      'mainSeriesProperties.priceLineColor': TEXT,
      'crosshairProperties.color': TEXT,
    },
    loading_screen: { backgroundColor: BG, foregroundColor: TEXT },
  });
  window.__tv = widget; // for a debugger in the console; the app never reads it

  var ma = null;
  var pendingTrend = null;
  var chartReady = false;
  // Drawn things: the box (two lines), the trades (a small mark at each
  // fill), and the open position (its entry, and the levels that end it:
  // the stop, the target and the liquidation). Every redraw clears and
  // draws from one state, so a burst of messages never stacks duplicates.
  var drawn = { box: null, trades: [], position: null, cross: null };
  // Every bar the chart has been given, by its time: the cross is marked at
  // the close of the bar it happened on.
  var bars = {};
  // A level across the pane, with its name and price at the right edge.
  // Dashed and thin: it is a line the position is measured against, not a
  // thing on the chart.
  function level(chart, time, price, color, text, width, solid) {
    var over = { linecolor: color, linewidth: width || 1, linestyle: solid ? 0 : 2, showPrice: false, showLabel: !!text };
    if (text) { over.text = text; over.textcolor = color; over.horzLabelsAlign = 'right'; over.vertLabelsAlign = 'top'; over.fontsize = 10; over.bold = true; }
    chart.createShape({ time: time, price: price }, {
      shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true, text: text || undefined, overrides: over,
    });
  }
  // One fill: a small triangle, up for a buy and down for a sell, in the
  // colour of what it did. Small on purpose — a chart of arrows is a chart
  // of arrows, and the bars are what the trader is here to read.
  function mark(chart, time, price, up, color) {
    chart.createShape({ time: time, price: price }, {
      shape: 'text', lock: true, disableSelection: true, disableSave: true, disableUndo: true, text: up ? '▲' : '▼',
      overrides: { color: color, fontsize: 9, bold: true, fillBackground: false, drawBorder: false, wordWrapWidth: 0 },
    });
  }
  function redraw() {
    if (!chartReady) return;
    var chart = widget.activeChart();
    chart.getAllShapes().forEach(function (sh) { try { chart.removeEntity(sh.id); } catch (e) {} });
    var now = Math.floor(Date.now() / 1000);
    if (drawn.box) { level(chart, now, Number(drawn.box.top), MA, '', 1, true); level(chart, now, Number(drawn.box.bottom), MA, '', 1, true); }
    // The last twenty round trips. Older ones would only pile up on the same bars.
    drawn.trades.slice(0, 20).forEach(function (t) {
      // Rows journaled before prices were kept have nothing to draw.
      if (!Number(t.entry_price)) return;
      var long = t.side === 'long';
      try {
        mark(chart, Math.floor(Date.parse(t.opened_at) / 1000), Number(t.entry_price), long, long ? UP : DOWN);
        if (t.closed_at && Number(t.exit_price)) {
          var won = Number(t.pnl || 0) >= 0;
          mark(chart, Math.floor(Date.parse(t.closed_at) / 1000), Number(t.exit_price), !long, won ? UP : DOWN);
        }
      } catch (e) { console.warn('tv: trade mark', e && e.message); }
    });
    if (drawn.cross) {
      var when = Date.parse(drawn.cross.at);
      // The bar the cross closed on, at the chart's own resolution.
      var period = (PERIODS[chart.resolution()] || 60) * 1000;
      var at = Math.floor(when / period) * period;
      var bar = bars[at];
      if (bar) {
        // As the design draws it: a dot where the lines crossed and a
        // dashed rule up from it. The legend under the pane says the rest.
        try {
          chart.createShape({ time: at / 1000 }, {
            shape: 'vertical_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true,
            overrides: { linecolor: MA, linewidth: 1, linestyle: 2, showTime: false },
          });
          chart.createShape({ time: at / 1000, price: bar.close }, {
            shape: 'text', lock: true, disableSelection: true, disableSave: true, disableUndo: true, text: '●',
            overrides: { color: MA, fontsize: 18, bold: true, fillBackground: false, drawBorder: false, wordWrapWidth: 0 },
          });
        } catch (e) { console.warn('tv: cross mark', e && e.message); }
      }
    }
    if (drawn.position) {
      var p = drawn.position;
      try {
        // The entry is the one line that matters: everything else is
        // measured from it. The levels that end the position are quieter.
        level(chart, now, Number(p.entry_price), LINE, 'IN ' + p.entry_price, 1.5, false);
        if (Number(p.stop_price)) level(chart, now, Number(p.stop_price), TEXT, 'STOP ' + p.stop_price, 1, false);
        if (Number(p.tp_price)) level(chart, now, Number(p.tp_price), TEXT, 'TP ' + p.tp_price, 1, false);
        if (Number(p.liquidation_price)) level(chart, now, Number(p.liquidation_price), DOWN, 'LIQ ' + p.liquidation_price, 1, false);
      } catch (e) { console.warn('tv: position levels', e && e.message); }
    }
  }
  // The averages keep their colours whatever the position: which line is
  // on top says the trend, and the entry level says the position.
  function paintTrend(value) { pendingTrend = value; }
  // The same stretch of bars whatever the resolution, with a little room
  // ahead of the last one.
  function frame(chart, resolution) {
    var period = PERIODS[resolution] || 60, now = Math.floor(Date.now() / 1000);
    chart.setVisibleRange({ from: now - VISIBLE_BARS * period, to: now + 5 * period }).catch(function () {});
  }
  widget.onChartReady(function () {
    var chart = widget.activeChart();
    log('chart ready', chart.resolution());
    frame(chart, chart.resolution());
    chartReady = true;
    redraw();
    tell();
    if (STUDY === 'rsi') {
      chart.createStudy('Relative Strength Index', false, false, { length: 14 }, {
        'plot.color': MA, 'plot.linewidth': 2, 'upper band.color': DOWN, 'lower band.color': UP, 'upper band.value': 70, 'lower band.value': 30,
      }).catch(function (e) { console.warn('tv: rsi study', e && e.message); });
    }
    if (!FAST || !SLOW) { post({ type: 'ready' }); return; }
    // The two lines the strategy reads: the fast one in the accent, the
    // slow one quieter, as the design draws them.
    Promise.all([
      chart.createStudy('Moving Average', false, false, { length: SLOW, source: 'close' }, { 'plot.color': TEXT, 'plot.linewidth': 2, 'plot.linestyle': 0, 'plot.transparency': 0 }),
      chart.createStudy('Moving Average', false, false, { length: FAST, source: 'close' }, { 'plot.color': MA, 'plot.linewidth': 3, 'plot.linestyle': 0, 'plot.transparency': 0 }),
    ]).then(function (ids) { ma = ids[1]; post({ type: 'ready' }); }).catch(function (e) { console.warn('tv: averages', e && e.message); post({ type: 'ready' }); });
  });

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (err) { return; } }
    if (!msg || !msg.type) return;
    widget.onChartReady(function () {
      var chart = widget.activeChart();
      if (msg.type === 'chartType') {
        chart.setChartType(msg.value === 'line' ? 2 : 1);
        // A style switched to after the first draw comes with the library's
        // own colours; the line is the skin's ink, as the candles are its up and down.
        chart.applyOverrides({ 'mainSeriesProperties.lineStyle.color': LINE, 'mainSeriesProperties.lineStyle.colorType': 'solid', 'mainSeriesProperties.lineStyle.linewidth': 2 });
      }
      if (msg.type === 'interval' && PERIODS[msg.value] && chart.resolution() !== msg.value) {
        chart.setResolution(msg.value, function () { frame(chart, msg.value); redraw(); });
      }
      if (msg.type === 'trend') paintTrend(msg.value);
      if (msg.type === 'box') { drawn.box = msg.value || null; redraw(); }
      if (msg.type === 'trades') { drawn.trades = msg.value || []; redraw(); }
      if (msg.type === 'position') { drawn.position = msg.value || null; redraw(); }
      if (msg.type === 'cross') { drawn.cross = msg.value || null; redraw(); }
    });
  });
  // React Native's WebView delivers injected messages through the same event.
  document.addEventListener('message', function (e) { window.dispatchEvent(new MessageEvent('message', { data: e.data })); });
})();
