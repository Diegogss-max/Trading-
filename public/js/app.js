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
    renderTracker();
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

  async function loadAllData() {
    for (const tf of TIMEFRAMES) {
      try {
        const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${MAX_CANDLES}`);
        const data = await resp.json();
        candleData[tf] = data.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      } catch (e) { candleData[tf] = []; }
    }

    for (const tf of ['4h', '1d']) {
      if (candleData[tf] && candleData[tf].length > 50) {
        htfAnalysis[tf] = { structure: SMC.analyzeStructure(candleData[tf]) };
      }
    }

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

    let connected = false;

    binanceWs.onopen = () => {
      connected = true;
      console.log('Binance WS connected');
    };

    binanceWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.data || !msg.data.k) return;
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

      if (tf === '4h' || tf === '1d') {
        if (candles.length > 50) htfAnalysis[tf] = { structure: SMC.analyzeStructure(candles) };
      }

      if (tf === currentTimeframe) {
        candleSeries.update(candle);
        updatePriceDisplay(candle);
        runAnalysis(tf);
      }

      SignalTracker.updateWithPrice(candle.close);
      renderTracker();
      renderMyTrades();
    };

    binanceWs.onerror = (err) => {
      console.log('Binance WS error, falling back to polling');
      if (!connected) startPolling();
    };

    binanceWs.onclose = () => {
      console.log('Binance WS closed');
      setTimeout(connectBinanceWS, 5000);
    };

    // If not connected after 5s, start polling as fallback
    setTimeout(() => { if (!connected) startPolling(); }, 5000);
  }

  let pollingInterval = null;
  function startPolling() {
    if (pollingInterval) return;
    console.log('Starting polling fallback');
    pollingInterval = setInterval(async () => {
      try {
        const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${currentTimeframe}&limit=2`);
        const data = await resp.json();
        if (!data || data.length === 0) return;

        const latest = data[data.length - 1];
        const candle = { time: Math.floor(latest[0] / 1000), open: +latest[1], high: +latest[2], low: +latest[3], close: +latest[4], volume: +latest[5] };

        const candles = candleData[currentTimeframe];
        if (!candles) return;

        if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
          candles[candles.length - 1] = candle;
        } else {
          candles.push(candle);
          if (candles.length > MAX_CANDLES) candles.shift();
        }

        candleSeries.update(candle);
        updatePriceDisplay(candle);
        runAnalysis(currentTimeframe);
        SignalTracker.updateWithPrice(candle.close);
        renderTracker();
        renderMyTrades();
      } catch (e) { /* ignore */ }
    }, 3000);
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

    const t4h = htfAnalysis['4h'] ? htfAnalysis['4h'].structure.trend : 'neutral';
    const t1d = htfAnalysis['1d'] ? htfAnalysis['1d'].structure.trend : 'neutral';
    const htfTrend = t4h === t1d ? t4h : t4h;

    const signals = SMC.generateSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend);

    // Track new signals
    const now = Date.now();
    if (signals.length > 0 && now - lastSignalTime > 30000) {
      for (const s of signals) {
        SignalTracker.addSignal({ ...s, timeframe: tf });
      }
      lastSignalTime = now;
      renderTracker();
    }

    drawAnalysis(structure, obs, fvgs, liquidity, pd, signals);
    updatePanel(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend);
  }

  function drawAnalysis(structure, obs, fvgs, liquidity, pd, signals) {
    markers = [];
    clearDrawnObjects();

    for (const b of (structure.bos || []).slice(-8)) markers.push({ time: b.time, position: b.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#2196f3', shape: b.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'BOS' });
    for (const c of (structure.choch || []).slice(-4)) markers.push({ time: c.time, position: c.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#ff9800', shape: c.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'CHoCH' });

    for (const ob of obs.slice(-5)) {
      const color = ob.type === 'ob_bullish' ? '#26a69a' : '#ef5350';
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.top, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: false, title: ob.type === 'ob_bullish' ? 'OB↑' : 'OB↓' }));
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.bottom, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: false, title: '' }));
    }

    for (const fvg of fvgs.slice(-5)) {
      const color = fvg.type === 'fvg_bullish' ? 'rgba(171,71,188,0.6)' : 'rgba(255,152,0,0.6)';
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.top, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: fvg.type === 'fvg_bullish' ? 'FVG↑' : 'FVG↓' }));
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.bottom, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
    }

    for (const liq of liquidity.slice(-6)) {
      drawnObjects.liquidity.push(candleSeries.createPriceLine({ price: liq.price, color: '#ffeb3b', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: liq.type.includes('high') ? 'LIQ$↑' : 'LIQ$↓' }));
    }

    if (pd) {
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.equilibrium, color: '#787b86', lineWidth: 1, lineStyle: 4, axisLabelVisible: true, title: 'EQ' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeHigh, color: 'rgba(239,83,80,0.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'Premium' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeLow, color: 'rgba(38,166,154,0.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'Discount' }));
    }

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
  }

  function renderTracker() {
    const stats = SignalTracker.getStats();
    document.getElementById('simWinRate').textContent = stats.winRate;
    document.getElementById('simWins').textContent = stats.wins;
    document.getElementById('simLosses').textContent = stats.losses;
    document.getElementById('simActive').textContent = stats.active;

    // Active signals with feasibility
    const active = SignalTracker.getActive();
    const sc = document.getElementById('signalsList');
    if (active.length === 0) {
      sc.innerHTML = '<div class="no-signals">Sin señales activas</div>';
    } else {
      sc.innerHTML = active.map(s => {
        const age = Math.floor((Date.now() - s.createdAt) / 60000);
        const ageStr = age < 60 ? `${age}m` : `${Math.floor(age / 60)}h ${age % 60}m`;
        const feasibleClass = s.feasible ? 'feasible-yes' : 'feasible-no';
        const feasibleIcon = s.feasible ? '✅' : '⛔';

        return `
          <div class="signal-card ${s.type}">
            <div class="signal-header">
              <span class="signal-type ${s.type}">${s.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span>
              <span class="signal-confidence ${s.confidence}">${s.confidence}</span>
            </div>
            <div class="signal-details">
              <div class="signal-detail"><span class="signal-detail-label">Entrada</span><span class="signal-detail-value">${fp(s.entry)}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">SL</span><span class="signal-detail-value" style="color:#ef5350">${fp(s.sl)}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">TP</span><span class="signal-detail-value" style="color:#26a69a">${fp(s.tp)}</span></div>
            </div>
            <div class="signal-details">
              <div class="signal-detail"><span class="signal-detail-label">R:R</span><span class="signal-detail-value">1:${s.rr}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">TF</span><span class="signal-detail-value">${s.timeframe}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">Hace</span><span class="signal-detail-value">${ageStr}</span></div>
            </div>
            <div class="feasibility-badge ${feasibleClass}">
              ${feasibleIcon} ${s.feasible ? 'ENTRAR' : 'NO ENTRAR'} — ${s.feasibleReason}
            </div>
            <div class="signal-actions">
              <button class="btn-entered" onclick="handleEntry('${s.id}')">📍 Entré</button>
            </div>
            <div class="signal-reason">${s.reason}</div>
          </div>`;
      }).join('');
    }

    // History
    const history = SignalTracker.getHistory(20);
    const hc = document.getElementById('tradesHistory');
    if (history.length === 0) {
      hc.innerHTML = '<div class="no-signals">Sin historial</div>';
    } else {
      hc.innerHTML = history.map(s => {
        const time = new Date(s.closedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const emoji = s.result === 'win' ? '✅' : s.result === 'loss' ? '❌' : '⏰';
        const label = s.result === 'win' ? 'TP Hit' : s.result === 'loss' ? 'SL Hit' : 'Expirada';

        return `
          <div class="history-item ${s.type} ${s.result}">
            <div class="history-item-header">
              <span class="history-type ${s.type}">${emoji} ${s.type.toUpperCase()}</span>
              <span class="history-time">${time}</span>
              <span class="history-pnl ${s.result === 'win' ? 'positive' : s.result === 'loss' ? 'negative' : ''}">${label} (${s.pnlPercent}%)</span>
            </div>
            <div class="history-risk">
              <div class="history-risk-item"><span class="history-risk-label">Entrada</span><span class="history-risk-value">${fp(s.entry)}</span></div>
              <div class="history-risk-item"><span class="history-risk-label">SL</span><span class="history-risk-value">${fp(s.sl)}</span></div>
              <div class="history-risk-item"><span class="history-risk-label">TP</span><span class="history-risk-value">${fp(s.tp)}</span></div>
              <div class="history-risk-item"><span class="history-risk-label">R:R</span><span class="history-risk-value">1:${s.rr}</span></div>
            </div>
          </div>`;
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

  // Handle user entry
  window.handleEntry = function (signalId) {
    const signal = SignalTracker.getActive().find(s => s.id === signalId);
    if (!signal) return;

    const priceInput = prompt(`¿A qué precio entraste? (${signal.type.toUpperCase()})\nPrecio sugerido: ${signal.entry.toFixed(2)}`);
    if (!priceInput) return;

    const entryPrice = parseFloat(priceInput.replace(',', ''));
    if (isNaN(entryPrice) || entryPrice <= 0) {
      alert('Precio inválido');
      return;
    }

    MyTrades.addTrade(signal, entryPrice);
    renderMyTrades();
  };

  window.closeMyTrade = function (tradeId, reason) {
    const priceInput = prompt('¿A qué precio cerraste?');
    if (!priceInput) return;
    const closePrice = parseFloat(priceInput.replace(',', ''));
    if (isNaN(closePrice) || closePrice <= 0) return;

    MyTrades.closeTrade(tradeId, closePrice, reason);
    renderMyTrades();
  };

  function renderMyTrades() {
    const trades = MyTrades.getOpen();
    const container = document.getElementById('myTradesList');
    if (!container) return;

    if (trades.length === 0) {
      container.innerHTML = '<div class="no-signals">Sin operaciones activas</div>';
    } else {
      const currentPrice = candleData[currentTimeframe] && candleData[currentTimeframe].length > 0
        ? candleData[currentTimeframe][candleData[currentTimeframe].length - 1].close : 0;

      container.innerHTML = trades.map(t => {
        const pnlToTP = t.type === 'long'
          ? ((t.tp - t.entryPrice) / t.entryPrice * 100).toFixed(2)
          : ((t.entryPrice - t.tp) / t.entryPrice * 100).toFixed(2);
        const pnlToSL = t.type === 'long'
          ? ((t.sl - t.entryPrice) / t.entryPrice * 100).toFixed(2)
          : ((t.entryPrice - t.sl) / t.entryPrice * 100).toFixed(2);

        let currentPnl = 0;
        if (currentPrice > 0) {
          currentPnl = t.type === 'long'
            ? ((currentPrice - t.entryPrice) / t.entryPrice * 100).toFixed(2)
            : ((t.entryPrice - currentPrice) / t.entryPrice * 100).toFixed(2);
        }

        const pnlClass = parseFloat(currentPnl) >= 0 ? 'positive' : 'negative';
        const time = new Date(t.enteredAt).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="signal-card ${t.type}">
            <div class="signal-header">
              <span class="signal-type ${t.type}">${t.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span>
              <span class="position-pnl ${pnlClass}">${currentPnl >= 0 ? '+' : ''}${currentPnl}%</span>
            </div>
            <div class="signal-details">
              <div class="signal-detail"><span class="signal-detail-label">Mi Entrada</span><span class="signal-detail-value">${fp(t.entryPrice)}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">Precio Actual</span><span class="signal-detail-value">${fp(currentPrice)}</span></div>
              <div class="signal-detail"><span class="signal-detail-label">Hora</span><span class="signal-detail-value">${time}</span></div>
            </div>
            <div class="trade-targets">
              <div class="trade-target tp">
                <span class="target-label">TP: ${fp(t.tp)}</span>
                <span class="target-pnl">+${pnlToTP}%</span>
              </div>
              <div class="trade-target sl">
                <span class="target-label">SL: ${fp(t.sl)}</span>
                <span class="target-pnl">${pnlToSL}%</span>
              </div>
            </div>
            <div class="trade-actions">
              <button class="btn-close-tp" onclick="closeMyTrade('${t.id}', 'tp')">✅ Cerré en TP</button>
              <button class="btn-close-sl" onclick="closeMyTrade('${t.id}', 'sl')">❌ Cerré en SL</button>
              <button class="btn-close-manual" onclick="closeMyTrade('${t.id}', 'manual')">📍 Cerré manual</button>
            </div>
          </div>`;
      }).join('');
    }

    // Closed trades
    const closed = MyTrades.getClosed(15);
    const hc = document.getElementById('myTradesHistory');
    if (!hc) return;

    if (closed.length === 0) {
      hc.innerHTML = '<div class="no-signals">Sin operaciones cerradas</div>';
    } else {
      const stats = MyTrades.getStats();
      hc.innerHTML = `
        <div class="my-stats">
          <span class="my-stat">WR: <b>${stats.winRate}</b></span>
          <span class="my-stat win">G: <b>${stats.wins}</b></span>
          <span class="my-stat loss">P: <b>${stats.losses}</b></span>
        </div>` +
        closed.map(t => {
          const time = new Date(t.closedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          const pnl = t.pnlPercent;
          const emoji = parseFloat(pnl) >= 0 ? '✅' : '❌';
          return `
            <div class="history-item ${t.type} ${parseFloat(pnl) >= 0 ? 'win' : 'loss'}">
              <div class="history-item-header">
                <span class="history-type ${t.type}">${emoji} ${t.type.toUpperCase()}</span>
                <span class="history-time">${time}</span>
                <span class="history-pnl ${parseFloat(pnl) >= 0 ? 'positive' : 'negative'}">${pnl}%</span>
              </div>
              <div class="history-risk">
                <div class="history-risk-item"><span class="history-risk-label">Entrada</span><span class="history-risk-value">${fp(t.entryPrice)}</span></div>
                <div class="history-risk-item"><span class="history-risk-label">Cierre</span><span class="history-risk-value">${fp(t.closePrice)}</span></div>
                <div class="history-risk-item"><span class="history-risk-label">Razón</span><span class="history-risk-value">${t.closeReason === 'tp' ? 'TP' : t.closeReason === 'sl' ? 'SL' : 'Manual'}</span></div>
                <div class="history-risk-item"><span class="history-risk-label">R:R</span><span class="history-risk-value">1:${t.rr}</span></div>
              </div>
            </div>`;
        }).join('');
    }
  }

  // Update my trades PnL periodically
  setInterval(renderMyTrades, 3000);

  document.addEventListener('DOMContentLoaded', init);
})();
