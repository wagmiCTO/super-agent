/**
 * The strategy chart page: TradingView's Charting Library with a datafeed
 * on the platform's candles, and one moving average drawn on top.
 *
 * Loaded at /tv.html by the app — inside an iframe on web, a WebView on the
 * phone — with the platform and the market in the query string:
 *
 *   /tv.html?api=http://host:8080&symbol=MON&theme=light&ma=20&bg=%23F0F0F3
 *
 * The app talks to the page with postMessage: { type: 'chartType', value:
 * 'candles' | 'line' } and { type: 'trend', value: 'up' | 'down' | 'flat' }.
 * The page answers { type: 'ready' } once the chart is drawn.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var API = (params.get('api') || '').replace(/\/$/, '');
  var SYMBOL = (params.get('symbol') || 'MON').toUpperCase();
  var THEME = params.get('theme') === 'dark' ? 'dark' : 'light';
  var MA_LENGTH = Number(params.get('ma') || 20);
  var BG = params.get('bg') || (THEME === 'dark' ? '#212225' : '#F0F0F3');
  var UP = '#16a34a', DOWN = '#dc2626', MA = '#2563eb';
  var TEXT = THEME === 'dark' ? '#9ca3af' : '#6b7280';
  var GRID = THEME === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  var PERIOD = 60; // the strategies work on one-minute bars

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }

  function fetchBars(from, to) {
    var url = API + '/v1/candles?symbol=' + encodeURIComponent(SYMBOL) + '&period_seconds=' + PERIOD + '&from=' + from + '&to=' + to;
    // A localtunnel in front of the platform shows browsers a reminder page
    // unless asked not to; only relevant when testing a phone against a laptop.
    var headers = /\.loca\.lt$/.test(new URL(API).hostname) ? { 'Bypass-Tunnel-Reminder': '1' } : {};
    return fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('candles ' + r.status);
      return r.json();
    }).then(function (rows) {
      return rows.map(function (b) {
        return { time: b.t * 1000, open: +b.o, high: +b.h, low: +b.l, close: +b.c, volume: +b.v };
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

  // --- datafeed (TradingView JS API) ---
  var subscribers = {};
  var pricescale = 100000;
  var datafeed = {
    onReady: function (cb) {
      setTimeout(function () { cb({ supported_resolutions: ['1'], supports_marks: false, supports_timescale_marks: false, supports_time: true }); }, 0);
    },
    searchSymbols: function (_q, _e, _t, cb) { cb([]); },
    resolveSymbol: function (name, onResolve, onError) {
      // Read a little history first so the price scale matches the market.
      var now = Math.floor(Date.now() / 1000);
      fetchBars(now - 3600, now).then(function (bars) {
        if (bars.length) pricescale = pricescaleFor(bars);
      }).catch(function () {}).then(function () {
        onResolve({
          ticker: SYMBOL, name: SYMBOL, description: SYMBOL + ' perpetual', type: 'crypto',
          session: '24x7', timezone: 'Etc/UTC', exchange: 'Perpl', listed_exchange: 'Perpl', format: 'price',
          minmov: 1, pricescale: pricescale, has_intraday: true, has_daily: false, has_weekly_and_monthly: false,
          intraday_multipliers: ['1'], supported_resolutions: ['1'], volume_precision: 2, data_status: 'streaming',
        });
      });
    },
    getBars: function (_symbol, _res, range, onResult, onError) {
      fetchBars(range.from, range.to).then(function (bars) {
        onResult(bars, { noData: bars.length === 0 });
      }).catch(function (e) { onError(String(e)); });
    },
    subscribeBars: function (_symbol, _res, onTick, uid) {
      var lastTime = 0;
      var timer = setInterval(function () {
        var now = Math.floor(Date.now() / 1000);
        fetchBars(now - 3 * PERIOD, now).then(function (bars) {
          for (var i = 0; i < bars.length; i++) {
            if (bars[i].time >= lastTime) { onTick(bars[i]); lastTime = bars[i].time; }
          }
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
    enabled_features: ['hide_left_toolbar_by_default', 'seconds_resolution'],
    overrides: {
      'paneProperties.background': BG,
      'paneProperties.backgroundType': 'solid',
      'paneProperties.backgroundGradientStartColor': BG,
      'paneProperties.backgroundGradientEndColor': BG,
      'paneProperties.vertGridProperties.color': GRID,
      'paneProperties.horzGridProperties.color': GRID,
      'paneProperties.topMargin': 12,
      'paneProperties.bottomMargin': 8,
      'paneProperties.legendProperties.showLegend': false,
      'scalesProperties.textColor': TEXT,
      'scalesProperties.lineColor': GRID,
      'scalesProperties.fontSize': 11,
      'symbolWatermarkProperties.visibility': false,
      'mainSeriesProperties.candleStyle.upColor': UP,
      'mainSeriesProperties.candleStyle.downColor': DOWN,
      'mainSeriesProperties.candleStyle.borderUpColor': UP,
      'mainSeriesProperties.candleStyle.borderDownColor': DOWN,
      'mainSeriesProperties.candleStyle.wickUpColor': UP,
      'mainSeriesProperties.candleStyle.wickDownColor': DOWN,
      'mainSeriesProperties.lineStyle.color': TEXT,
      'mainSeriesProperties.lineStyle.linewidth': 2,
      'mainSeriesProperties.priceLineColor': TEXT,
      'crosshairProperties.color': TEXT,
    },
    loading_screen: { backgroundColor: BG, foregroundColor: TEXT },
  });

  var ma = null;
  var pendingTrend = null;
  var chartReady = false;
  // Drawn lines: the box (two solid lines) and the dead zone (two dashed).
  // Every redraw clears all shapes first — the chart draws nothing else —
  // so a burst of messages can never stack duplicate lines.
  var drawn = { box: null, zone: null };
  function redraw() {
    if (!chartReady) return;
    var chart = widget.activeChart();
    chart.getAllShapes().forEach(function (sh) { try { chart.removeEntity(sh.id); } catch (e) {} });
    var now = Math.floor(Date.now() / 1000);
    function line(price, color, style) {
      chart.createShape({ time: now, price: price }, {
        shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true,
        overrides: { linecolor: color, linewidth: 1, linestyle: style, showLabel: false, showPrice: false },
      });
    }
    if (drawn.box) { line(Number(drawn.box.top), MA, 0); line(Number(drawn.box.bottom), MA, 0); }
    if (drawn.zone) {
      var p = Number(drawn.zone.price), k = drawn.zone.bps / 10000;
      line(p * (1 + k), TEXT, 2); line(p * (1 - k), TEXT, 2);
    }
  }
  function paintTrend(value) {
    if (!ma) { pendingTrend = value; return; }
    var color = value === 'up' ? UP : value === 'down' ? DOWN : MA;
    widget.activeChart().getStudyById(ma).applyOverrides({ 'plot.color': color });
  }
  widget.onChartReady(function () {
    var chart = widget.activeChart();
    var now = Math.floor(Date.now() / 1000);
    chart.setVisibleRange({ from: now - 90 * 60, to: now + 5 * 60 });
    chartReady = true;
    redraw();
    if (!MA_LENGTH) { post({ type: 'ready' }); return; }
    // One average, drawn well: the strategy's slow line.
    chart.createStudy('Moving Average', false, false, { length: MA_LENGTH, source: 'close' }, {
      'plot.color': MA, 'plot.linewidth': 2, 'plot.linestyle': 0, 'plot.transparency': 0,
    }).then(function (id) { ma = id; if (pendingTrend) paintTrend(pendingTrend); post({ type: 'ready' }); });
  });

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (err) { return; } }
    if (!msg || !msg.type) return;
    widget.onChartReady(function () {
      var chart = widget.activeChart();
      if (msg.type === 'chartType') chart.setChartType(msg.value === 'line' ? 2 : 1);
      if (msg.type === 'trend') paintTrend(msg.value);
      if (msg.type === 'box') { drawn.box = msg.value || null; redraw(); }
      // The fee band: entry (or last price) ± the round-trip cost.
      if (msg.type === 'deadZone') { drawn.zone = msg.value || null; redraw(); }
    });
  });
  // React Native's WebView delivers injected messages through the same event.
  document.addEventListener('message', function (e) { window.dispatchEvent(new MessageEvent('message', { data: e.data })); });
})();
