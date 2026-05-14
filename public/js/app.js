// SMC Trading App - Client-side (Vercel compatible)
(function () {
  'use strict';

  let chart = null;
  let candleSeries = null;
  let currentTimeframe = '15m';
  let candleData = {};
  let htfAnalysis = {};
  let binanceWs = null;
  let drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [] };
  let markers = [];
  let lastSignalTime = 0;

  const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const MAX_CANDLES = 500;

  function init() {
    createChart();
    setupEventListeners();
    loadAllData();
    renderSimulator();
  }

  function createChart() {
    const container = document.getElementById('chartContainer');
    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: '#4c525e', width: 1, style: 2 }, horzLine: { color: '#4c525e', width: 1, style: 2 } },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false }
    });
    candleSeries = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
    new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })).observe(container);
  }

  // Load historical data from Binance REST API
  async function loadAllData() {
    for (const tf of TIMEFRAMES) {
      try {
        const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${MAX_CANDLES}`);
        const data = await resp.json();
        candleData[tf] = data.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      } catch (e) { candleData[tf] = []; }
    }

    // HTF analysis
    for (const tf of ['4h', '1d']) {
      if (candleData[tf] && candleData[tf].length > 50) {
        htfAnalysis[tf] = { structure: SMC.analyzeStructure(candleData[tf]) };
      }
    }

    // Display current timeframe
    displayTimeframe(currentTimeframe);
    connectBinanceWS();
  }

  function displayTimeframe(tf) {
    const candles = candleData[tf];
    if (!candles || candles.length === 0) return;
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
    updatePriceDisplay(candles[candles.length - 1]);
    runAnalysis(tf);
  }

  function connectBinanceWS() {
    if (binanceWs) binanceWs.close();

    const streams = TIMEFRAMES.map(tf => `btcusdt@kline_${tf}`).join('/');
    binanceWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    binanceWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const k = msg.data.k;
      const tf = k.i;
      const candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };

      const candles = candleData[tf];
      if (!candles) return;

      if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
        candles[candles.length - 1] = candle;
      } else {
        candles.push(candle);
        if (candles.length > MAX_CANDLES) candles.shift();
      }

      // Update HTF analysis
      if (tf === '4h' || tf === '1d') {
        if (candles.length > 50) htfAnalysis[tf] = { structure: SMC.analyzeStructure(candles) };
      }

      // Update chart if viewing this timeframe
      if (tf === currentTimeframe) {
        candleSeries.update(candle);
        updatePriceDisplay(candle);
        runAnalysis(tf);
      }

      // Update simulator with current price
      Simulator.updatePositions(candle.close);
      renderSimulator();
    };

    binanceWs.onclose = () => setTimeout(connectBinanceWS, 3000);
  }

  function runAnalysis(tf) {
    const candles = candleData[tf];
    if (!candles || candles.length < 50) return;

    const structure = SMC.analyzeStructure(candles);
    const obs = SMC.detectOrderBlocks(candles, structure);
    const fvgs = SMC.detectFVG(candles);
    const liquidity = SMC.detectLiquidity(candles, structure);
    const pd = SMC.calculatePremiumDiscount(candles, structure);
    const volume = SMC.analyzeVolume(candles);
    const session = SMC.getCurrentSession();

    // HTF trend
    const t4h = htfAnalysis['4h'] ? htfAnalysis['4h'].structure.trend : 'neutral';
    const t1d = htfAnalysis['1d'] ? htfAnalysis['1d'].structure.trend : 'neutral';
    const htfTrend = t4h === t1d ? t4h : t4h;

    const signals = SMC.generateSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend);

    // Open simulator positions for new signals
    const now = Date.now();
    if (signals.length > 0 && now - lastSignalTime > 30000) {
      for (const s of signals) {
        Simulator.openPosition({ ...s, timeframe: tf });
      }
      lastSignalTime = now;
      renderSimulator();
    }

    // Draw on chart
    drawAnalysis(structure, obs, fvgs, liquidity, pd, signals);

    // Update panel
    updatePanel(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend);
  }

  function drawAnalysis(structure, obs, fvgs, liquidity, pd, signals) {
    markers = [];
    clearDrawnObjects();

    // BOS/CHoCH
    for (const b of (structure.bos || []).slice(-8)) markers.push({ time: b.time, position: b.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#2196f3', shape: b.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'BOS' });
    for (const c of (structure.choch || []).slice(-4)) markers.push({ time: c.time, position: c.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#ff9800', shape: c.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'CHoCH' });

    // OBs
    for (const ob of obs.slice(-5)) {
      const color = ob.type === 'ob_bullish' ? '#26a69a' : '#ef5350';
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.top, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: false, title: ob.type === 'ob_bullish' ? 'OB↑' : 'OB↓' }));
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.bottom, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: false, title: '' }));
    }

    // FVGs
    for (const fvg of fvgs.slice(-5)) {
      const color = fvg.type === 'fvg_bullish' ? 'rgba(171,71,188,0.6)' : 'rgba(255,152,0,0.6)';
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.top, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: fvg.type === 'fvg_bullish' ? 'FVG↑' : 'FVG↓' }));
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.bottom, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
    }

    // Liquidity
    for (const liq of liquidity.slice(-6)) {
      drawnObjects.liquidity.push(candleSeries.createPriceLine({ price: liq.price, color: '#ffeb3b', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: liq.type.includes('high') ? 'LIQ$↑' : 'LIQ$↓' }));
    }

    // P/D
    if (pd) {
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.equilibrium, color: '#787b86', lineWidth: 1, lineStyle: 4, axisLabelVisible: true, title: 'EQ' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeHigh, color: 'rgba(239,83,80,0.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'Premium' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeLow, color: 'rgba(38,166,154,0.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'Discount' }));
    }

    // Signals
    for (const s of signals.slice(-3)) {
      markers.push({ time: s.time, position: s.type === 'long' ? 'belowBar' : 'aboveBar', color: s.type === 'long' ? '#26a69a' : '#ef5350', shape: s.type === 'long' ? 'arrowUp' : 'arrowDown', text: s.type === 'long' ? 'LONG' : 'SHORT' });
      if (s.sl) drawnObjects.obs.push(candleSeries.createPriceLine({ price: s.sl, color: '#ef5350', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'SL' }));
      if (s.tp) drawnObjects.obs.push(candleSeries.createPriceLine({ price: s.tp, color: '#26a69a', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'TP' }));
    }

    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers.length > 0 ? markers : []);
  }

  function clearDrawnObjects() {
    for (const lines of Object.values(drawnObjects)) { for (const l of lines) { try { candleSeries.removePriceLine(l); } catch (e) {} } }
    drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [] };
  }

  function updatePanel(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend) {
    // MTF
    for (const tf of TIMEFRAMES) {
      const el = document.getElementById(`mtf-${tf}`);
      if (el && candleData[tf] && candleData[tf].length > 50) {
        const s = SMC.analyzeStructure(candleData[tf]);
        el.textContent = s.trend === 'bullish' ? '↑' : s.trend === 'bearish' ? '↓' : '→';
        el.className = `mtf-trend ${s.trend}`;
        const item = el.closest('.mtf-item');
        if (item) item.classList.toggle('current', tf === currentTimeframe);
      }
    }

    // Volume
    if (volume) {
      const relEl = document.getElementById('volRelative');
      relEl.textContent = `${volume.relativeVolume}x (${volume.label})`;
      relEl.className = `vol-value ${volume.isHighVolume ? 'high' : 'low'}`;
      document.getElementById('volTrend').textContent = volume.volumeTrend === 'increasing' ? '↑ Creciente' : volume.volumeTrend === 'decreasing' ? '↓ Decreciente' : '→ Estable';
      document.getElementById('pressureBuy').style.width = `${volume.pressure.buyPercent}%`;
      document.getElementById('pressureSell').style.width = `${volume.pressure.sellPercent}%`;
      document.getElementById('buyPercent').textContent = `${volume.pressure.buyPercent}%`;
      document.getElementById('sellPercent').textContent = `${volume.pressure.sellPercent}%`;
    }

    // Session
    if (session) {
      document.getElementById('sessionLabel').textContent = session.sessionLabel;
      document.getElementById('sessionDot').className = `session-dot ${session.isKillzoneActive ? 'active' : ''}`;
      document.getElementById('killzoneLabel').textContent = session.isKillzoneActive ? session.killzoneLabel : 'Sin Killzone';
      document.getElementById('killzoneBadge').className = `killzone-badge ${session.isKillzoneActive ? 'active' : ''}`;
      document.getElementById('ctxSession').textContent = session.sessionLabel;
      document.getElementById('ctxKillzone').textContent = session.isKillzoneActive ? session.killzoneLabel : 'Ninguna';
      document.getElementById('ctxKillzone').style.color = session.isKillzoneActive ? '#ff9800' : '#787b86';
    }

    // P/D
    if (pd) {
      const el = document.getElementById('pdZone');
      el.textContent = pd.position === 'premium' ? '⬆ Premium' : pd.position === 'discount' ? '⬇ Descuento' : '↔ Equilibrio';
      el.style.color = pd.position === 'premium' ? '#ef5350' : pd.position === 'discount' ? '#26a69a' : '#787b86';
    }

    // Counts
    document.getElementById('obCount').textContent = obs.length;
    document.getElementById('fvgCount').textContent = fvgs.length;
    document.getElementById('liqCount').textContent = liquidity.length;
    document.getElementById('bosCount').textContent = (structure.bos || []).length + (structure.choch || []).length;

    // Signals
    const sc = document.getElementById('signalsList');
    if (!signals || signals.length === 0) { sc.innerHTML = '<div class="no-signals">Sin señales activas</div>'; }
    else {
      sc.innerHTML = signals.map(s => `
        <div class="signal-card ${s.type}">
          <div class="signal-header"><span class="signal-type ${s.type}">${s.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span><span class="signal-confidence ${s.confidence}">${s.confidence}</span></div>
          <div class="signal-details">
            <div class="signal-detail"><span class="signal-detail-label">Entrada</span><span class="signal-detail-value">${fp(s.entry)}</span></div>
            <div class="signal-detail"><span class="signal-detail-label">SL</span><span class="signal-detail-value" style="color:#ef5350">${fp(s.sl)}</span></div>
            <div class="signal-detail"><span class="signal-detail-label">TP</span><span class="signal-detail-value" style="color:#26a69a">${fp(s.tp)}</span></div>
          </div>
          <div class="signal-details">
            <div class="signal-detail"><span class="signal-detail-label">R:R</span><span class="signal-detail-value">1:${s.rr}</span></div>
            <div class="signal-detail"><span class="signal-detail-label">Tamaño</span><span class="signal-detail-value">$600</span></div>
            <div class="signal-detail"><span class="signal-detail-label">Conf.</span><span class="signal-detail-value">${s.confidence}</span></div>
          </div>
          <div class="signal-reason">${s.reason}</div>
        </div>`).join('');
    }
  }

  function renderSimulator() {
    const stats = Simulator.getStats();
    const bal = parseFloat(stats.balance);
    const balEl = document.getElementById('simBalance');
    balEl.textContent = `$${stats.balance}`;
    balEl.className = `sim-balance-value ${bal > 0 ? 'positive' : bal < 0 ? 'negative' : 'neutral'}`;

    const roi = stats.totalTrades > 0 ? ((bal / (stats.totalTrades * 20)) * 100).toFixed(2) : '0.00';
    const roiEl = document.getElementById('simRoi');
    roiEl.textContent = `${roi}%`;
    roiEl.className = `sim-balance-value ${parseFloat(roi) > 0 ? 'positive' : parseFloat(roi) < 0 ? 'negative' : 'neutral'}`;

    document.getElementById('simWinRate').textContent = stats.winRate;
    document.getElementById('simWins').textContent = stats.wins;
    document.getElementById('simLosses').textContent = stats.losses;
    document.getElementById('simPF').textContent = stats.profitFactor;
    document.getElementById('simAvgWin').textContent = `$${stats.avgWin}`;
    document.getElementById('simAvgLoss').textContent = `$${stats.avgLoss}`;
    document.getElementById('simMaxDD').textContent = `$${stats.maxDrawdown}`;
    document.getElementById('simMaxStreak').textContent = stats.maxConsecLosses;

    // Open positions
    const positions = Simulator.getOpenPositions();
    const pc = document.getElementById('positionsList');
    if (positions.length === 0) { pc.innerHTML = '<div class="no-signals">Sin posiciones abiertas</div>'; }
    else {
      pc.innerHTML = positions.map(p => {
        const pnl = p.currentPnl || 0;
        return `<div class="position-card ${p.type}">
          <div class="position-header"><span class="position-type ${p.type}">${p.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span><span class="position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${p.currentPnlPercent}%)</span></div>
          <div class="position-details">
            <div class="position-detail"><span class="position-detail-label">Entrada</span><span class="position-detail-value">${fp(p.entry)}</span></div>
            <div class="position-detail"><span class="position-detail-label">SL</span><span class="position-detail-value" style="color:#ef5350">${fp(p.sl)}</span></div>
            <div class="position-detail"><span class="position-detail-label">TP</span><span class="position-detail-value" style="color:#26a69a">${fp(p.tp)}</span></div>
            <div class="position-detail"><span class="position-detail-label">Tamaño</span><span class="position-detail-value">$${p.positionSize}</span></div>
          </div></div>`;
      }).join('');
    }

    // Closed trades
    const trades = Simulator.getClosedTrades(20);
    const tc = document.getElementById('tradesHistory');
    if (trades.length === 0) { tc.innerHTML = '<div class="no-signals">Sin trades cerrados</div>'; }
    else {
      tc.innerHTML = trades.map(t => {
        const pnl = parseFloat(t.netPnl);
        const time = new Date(t.closedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="history-item ${t.type} ${t.result}">
          <div class="history-item-header"><span class="history-type ${t.type}">${t.result === 'win' ? '✅' : '❌'} ${t.type.toUpperCase()}</span><span class="history-time">${time}</span><span class="history-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}$${t.netPnl}</span></div>
          <div class="history-risk">
            <div class="history-risk-item"><span class="history-risk-label">Entrada</span><span class="history-risk-value">${fp(t.entry)}</span></div>
            <div class="history-risk-item"><span class="history-risk-label">Cierre</span><span class="history-risk-value">${fp(t.closePrice)}</span></div>
            <div class="history-risk-item"><span class="history-risk-label">Razón</span><span class="history-risk-value">${t.closeReason === 'tp' ? 'TP' : t.closeReason === 'sl' ? 'SL' : 'LIQ'}</span></div>
            <div class="history-risk-item"><span class="history-risk-label">R:R</span><span class="history-risk-value">1:${t.rr}</span></div>
          </div></div>`;
      }).join('');
    }
  }

  function updatePriceDisplay(candle) {
    document.getElementById('currentPrice').textContent = fp(candle.close);
    const change = ((candle.close - candle.open) / candle.open * 100).toFixed(2);
    const el = document.getElementById('priceChange');
    el.textContent = `${change >= 0 ? '+' : ''}${change}%`;
    el.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
  }

  function setupEventListeners() {
    document.querySelectorAll('.timeframe-selector button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.timeframe-selector button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTimeframe = btn.dataset.tf;
        clearDrawnObjects();
        candleSeries.setMarkers([]);
        displayTimeframe(currentTimeframe);
      });
    });

    document.getElementById('panelToggle').addEventListener('click', () => {
      const sb = document.getElementById('panelSidebar');
      sb.classList.toggle('collapsed');
      document.getElementById('panelToggle').textContent = sb.classList.contains('collapsed') ? '▶' : '◀';
      setTimeout(() => chart.applyOptions({ width: document.getElementById('chartContainer').clientWidth }), 350);
    });
  }

  function fp(price) { return price ? Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'; }

  document.addEventListener('DOMContentLoaded', init);
})();
