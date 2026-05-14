// SMC Trading App - Main Application
(function () {
  'use strict';

  // State
  let chart = null;
  let candleSeries = null;
  let ws = null;
  let currentTimeframe = '15m';
  let currentAnalysis = null;
  let markers = [];
  let drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [] };

  // Initialize
  function init() {
    createChart();
    connectWebSocket();
    setupEventListeners();
  }

  // Create Lightweight Chart
  function createChart() {
    const container = document.getElementById('chartContainer');

    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#4c525e', width: 1, style: 2 },
        horzLine: { color: '#4c525e', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);
  }

  // WebSocket Connection
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      console.log('Connected to server');
      subscribe(currentTimeframe);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        handleInit(data);
      } else if (data.type === 'update') {
        handleUpdate(data);
      } else if (data.type === 'history_update') {
        handleHistoryUpdate(data);
      } else if (data.type === 'simulator_update') {
        handleSimulatorUpdate(data);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected, reconnecting...');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  function subscribe(timeframe) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', timeframe }));
    }
  }

  // Handle initial data
  function handleInit(data) {
    const { candles, analysis } = data;

    if (candles && candles.length > 0) {
      candleSeries.setData(candles);
      chart.timeScale().fitContent();
      const lastCandle = candles[candles.length - 1];
      updatePriceDisplay(lastCandle);
    }

    if (analysis) {
      currentAnalysis = analysis;
      drawAnalysis(analysis);
      updatePanel(analysis);
    }
  }

  // Handle real-time updates
  function handleUpdate(data) {
    const { candle, analysis } = data;

    if (candle) {
      candleSeries.update(candle);
      updatePriceDisplay(candle);
    }

    if (analysis) {
      currentAnalysis = analysis;
      drawAnalysis(analysis);
      updatePanel(analysis);
    }
  }

  // Handle signal history updates
  function handleHistoryUpdate(data) {
    // History is now shown via simulator trades
  }

  // Handle simulator updates
  function handleSimulatorUpdate(data) {
    const { stats, openPositions, closedTrades } = data;
    renderSimulatorStats(stats);
    renderOpenPositions(openPositions);
    renderClosedTrades(closedTrades);
  }

  // Draw SMC analysis on chart
  function drawAnalysis(analysis) {
    if (!analysis) return;

    markers = [];
    clearDrawnObjects();

    const { structure, obs, fvgs, liquidity, pd, signals } = analysis;

    if (structure) drawStructure(structure);
    if (obs && obs.length > 0) drawOrderBlocks(obs);
    if (fvgs && fvgs.length > 0) drawFVGs(fvgs);
    if (liquidity && liquidity.length > 0) drawLiquidity(liquidity);
    if (pd) drawPremiumDiscount(pd);
    if (signals && signals.length > 0) drawSignals(signals);

    if (markers.length > 0) {
      markers.sort((a, b) => a.time - b.time);
      candleSeries.setMarkers(markers);
    } else {
      candleSeries.setMarkers([]);
    }
  }

  function clearDrawnObjects() {
    for (const lines of Object.values(drawnObjects)) {
      for (const line of lines) {
        try { candleSeries.removePriceLine(line); } catch (e) { /* ignore */ }
      }
    }
    drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [] };
  }

  function drawStructure(structure) {
    const { bos, choch } = structure;

    for (const b of (bos || []).slice(-8)) {
      markers.push({
        time: b.time,
        position: b.type.includes('bullish') ? 'belowBar' : 'aboveBar',
        color: '#2196f3',
        shape: b.type.includes('bullish') ? 'arrowUp' : 'arrowDown',
        text: 'BOS',
      });
    }

    for (const c of (choch || []).slice(-4)) {
      markers.push({
        time: c.time,
        position: c.type.includes('bullish') ? 'belowBar' : 'aboveBar',
        color: '#ff9800',
        shape: c.type.includes('bullish') ? 'arrowUp' : 'arrowDown',
        text: 'CHoCH',
      });
    }
  }

  function drawOrderBlocks(obs) {
    for (const ob of obs.slice(-5)) {
      const isBullish = ob.type === 'ob_bullish';
      const color = isBullish ? '#26a69a' : '#ef5350';

      const topLine = candleSeries.createPriceLine({
        price: ob.top,
        color: color,
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: false,
        title: isBullish ? 'OB↑' : 'OB↓',
      });
      drawnObjects.obs.push(topLine);

      const bottomLine = candleSeries.createPriceLine({
        price: ob.bottom,
        color: color,
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: false,
        title: '',
      });
      drawnObjects.obs.push(bottomLine);
    }
  }

  function drawFVGs(fvgs) {
    for (const fvg of fvgs.slice(-5)) {
      const isBullish = fvg.type === 'fvg_bullish';
      const color = isBullish ? 'rgba(171, 71, 188, 0.6)' : 'rgba(255, 152, 0, 0.6)';

      const topLine = candleSeries.createPriceLine({
        price: fvg.top,
        color: color,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
        title: isBullish ? 'FVG↑' : 'FVG↓',
      });
      drawnObjects.fvgs.push(topLine);

      const bottomLine = candleSeries.createPriceLine({
        price: fvg.bottom,
        color: color,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });
      drawnObjects.fvgs.push(bottomLine);
    }
  }

  function drawLiquidity(liquidity) {
    for (const liq of liquidity.slice(-6)) {
      const isHigh = liq.type.includes('high');
      const line = candleSeries.createPriceLine({
        price: liq.price,
        color: '#ffeb3b',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: false,
        title: isHigh ? 'LIQ$↑' : 'LIQ$↓',
      });
      drawnObjects.liquidity.push(line);
    }
  }

  function drawPremiumDiscount(pd) {
    if (!pd) return;

    const eqLine = candleSeries.createPriceLine({
      price: pd.equilibrium,
      color: '#787b86',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.LargeDashed,
      axisLabelVisible: true,
      title: 'EQ',
    });
    drawnObjects.pd.push(eqLine);

    const highLine = candleSeries.createPriceLine({
      price: pd.rangeHigh,
      color: 'rgba(239, 83, 80, 0.35)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: false,
      title: 'Premium',
    });
    drawnObjects.pd.push(highLine);

    const lowLine = candleSeries.createPriceLine({
      price: pd.rangeLow,
      color: 'rgba(38, 166, 154, 0.35)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: false,
      title: 'Discount',
    });
    drawnObjects.pd.push(lowLine);
  }

  function drawSignals(signals) {
    for (const signal of signals.slice(-3)) {
      markers.push({
        time: signal.time,
        position: signal.type === 'long' ? 'belowBar' : 'aboveBar',
        color: signal.type === 'long' ? '#26a69a' : '#ef5350',
        shape: signal.type === 'long' ? 'arrowUp' : 'arrowDown',
        text: signal.type === 'long' ? 'LONG' : 'SHORT',
      });

      if (signal.sl) {
        const slLine = candleSeries.createPriceLine({
          price: signal.sl,
          color: '#ef5350',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'SL',
        });
        drawnObjects.obs.push(slLine);
      }

      if (signal.tp) {
        const tpLine = candleSeries.createPriceLine({
          price: signal.tp,
          color: '#26a69a',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'TP',
        });
        drawnObjects.obs.push(tpLine);
      }
    }
  }

  // Update panel sidebar
  function updatePanel(analysis) {
    if (!analysis) return;

    const { structure, obs, fvgs, liquidity, pd, signals, session, volume, mtfSummary } = analysis;

    if (mtfSummary) updateMTFGrid(mtfSummary);
    if (volume) updateVolumePanel(volume);
    if (session) updateSessionInfo(session);

    if (pd) {
      const pdZone = document.getElementById('pdZone');
      pdZone.textContent = pd.position === 'premium' ? '⬆ Premium' :
                           pd.position === 'discount' ? '⬇ Descuento' : '↔ Equilibrio';
      pdZone.style.color = pd.position === 'premium' ? '#ef5350' :
                           pd.position === 'discount' ? '#26a69a' : '#787b86';
    }

    document.getElementById('obCount').textContent = obs ? obs.length : 0;
    document.getElementById('fvgCount').textContent = fvgs ? fvgs.length : 0;
    document.getElementById('liqCount').textContent = liquidity ? liquidity.length : 0;
    document.getElementById('bosCount').textContent = structure ?
      (structure.bos || []).length + (structure.choch || []).length : 0;

    updateSignalsList(signals, session);
  }

  function updateMTFGrid(mtfSummary) {
    for (const [tf, data] of Object.entries(mtfSummary)) {
      const el = document.getElementById(`mtf-${tf}`);
      if (el) {
        const trend = data.trend;
        el.textContent = trend === 'bullish' ? '↑' : trend === 'bearish' ? '↓' : '→';
        el.className = `mtf-trend ${trend}`;

        const item = el.closest('.mtf-item');
        if (item) {
          item.classList.toggle('current', tf === currentTimeframe);
        }
      }
    }
  }

  function updateVolumePanel(volume) {
    const relEl = document.getElementById('volRelative');
    relEl.textContent = `${volume.relativeVolume}x (${volume.label})`;
    relEl.className = `vol-value ${volume.isHighVolume ? 'high' : 'low'}`;

    const trendEl = document.getElementById('volTrend');
    const trendLabels = { increasing: '↑ Creciente', decreasing: '↓ Decreciente', stable: '→ Estable' };
    trendEl.textContent = trendLabels[volume.volumeTrend] || '→ Estable';

    if (volume.pressure) {
      document.getElementById('pressureBuy').style.width = `${volume.pressure.buyPercent}%`;
      document.getElementById('pressureSell').style.width = `${volume.pressure.sellPercent}%`;
      document.getElementById('buyPercent').textContent = `${volume.pressure.buyPercent}%`;
      document.getElementById('sellPercent').textContent = `${volume.pressure.sellPercent}%`;
    }
  }

  function updateSessionInfo(session) {
    const dot = document.getElementById('sessionDot');
    const label = document.getElementById('sessionLabel');
    const kzBadge = document.getElementById('killzoneBadge');
    const kzLabel = document.getElementById('killzoneLabel');

    label.textContent = session.sessionLabel;
    dot.className = `session-dot ${session.isKillzoneActive ? 'active' : ''}`;

    kzLabel.textContent = session.isKillzoneActive ? session.killzoneLabel : 'Sin Killzone';
    kzBadge.className = `killzone-badge ${session.isKillzoneActive ? 'active' : ''}`;

    document.getElementById('ctxSession').textContent = session.sessionLabel;
    document.getElementById('ctxKillzone').textContent = session.isKillzoneActive ? session.killzoneLabel : 'Ninguna';
    document.getElementById('ctxKillzone').style.color = session.isKillzoneActive ? '#ff9800' : '#787b86';
  }

  function updateSignalsList(signals, session) {
    const container = document.getElementById('signalsList');

    if (!signals || signals.length === 0) {
      container.innerHTML = '<div class="no-signals">Sin señales activas</div>';
      return;
    }

    container.innerHTML = signals.map(signal => `
      <div class="signal-card ${signal.type}">
        <div class="signal-header">
          <span class="signal-type ${signal.type}">${signal.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span>
          <span class="signal-confidence ${signal.confidence}">${signal.confidence}</span>
        </div>
        <div class="signal-details">
          <div class="signal-detail">
            <span class="signal-detail-label">Entrada</span>
            <span class="signal-detail-value">${formatPrice(signal.entry)}</span>
          </div>
          <div class="signal-detail">
            <span class="signal-detail-label">SL</span>
            <span class="signal-detail-value" style="color:#ef5350">${formatPrice(signal.sl)}</span>
          </div>
          <div class="signal-detail">
            <span class="signal-detail-label">TP</span>
            <span class="signal-detail-value" style="color:#26a69a">${formatPrice(signal.tp)}</span>
          </div>
        </div>
        <div class="signal-details">
          <div class="signal-detail">
            <span class="signal-detail-label">R:R</span>
            <span class="signal-detail-value">1:${signal.rr}</span>
          </div>
          <div class="signal-detail">
            <span class="signal-detail-label">TF</span>
            <span class="signal-detail-value">${signal.timeframe || currentTimeframe}</span>
          </div>
          <div class="signal-detail">
            <span class="signal-detail-label">Tamaño</span>
            <span class="signal-detail-value">$600</span>
          </div>
        </div>
        ${session && session.isKillzoneActive ? `<span class="signal-killzone-tag">⚡ ${session.killzoneLabel}</span>` : ''}
        <div class="signal-reason">${signal.reason}</div>
      </div>
    `).join('');
  }

  // Simulator rendering
  function renderSimulatorStats(stats) {
    if (!stats) return;

    const balanceEl = document.getElementById('simBalance');
    const balance = parseFloat(stats.balance);
    balanceEl.textContent = `$${stats.balance}`;
    balanceEl.className = `sim-balance-value ${balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'neutral'}`;

    const roiEl = document.getElementById('simRoi');
    const roi = parseFloat(stats.roi);
    roiEl.textContent = `${stats.roi}%`;
    roiEl.className = `sim-balance-value ${roi > 0 ? 'positive' : roi < 0 ? 'negative' : 'neutral'}`;

    document.getElementById('simWinRate').textContent = stats.winRate;
    document.getElementById('simWins').textContent = stats.wins;
    document.getElementById('simLosses').textContent = stats.losses;
    document.getElementById('simPF').textContent = stats.profitFactor;
    document.getElementById('simAvgWin').textContent = `$${stats.avgWin}`;
    document.getElementById('simAvgLoss').textContent = `$${stats.avgLoss}`;
    document.getElementById('simMaxDD').textContent = `$${stats.maxDrawdown}`;
    document.getElementById('simMaxStreak').textContent = stats.maxConsecLosses;
  }

  function renderOpenPositions(positions) {
    const container = document.getElementById('positionsList');

    if (!positions || positions.length === 0) {
      container.innerHTML = '<div class="no-signals">Sin posiciones abiertas</div>';
      return;
    }

    container.innerHTML = positions.map(pos => {
      const pnl = pos.currentPnl || 0;
      const pnlClass = pnl >= 0 ? 'positive' : 'negative';

      return `
        <div class="position-card ${pos.type}">
          <div class="position-header">
            <span class="position-type ${pos.type}">${pos.type === 'long' ? '↑ LONG' : '↓ SHORT'}</span>
            <span class="position-pnl ${pnlClass}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pos.currentPnlPercent}%)</span>
          </div>
          <div class="position-details">
            <div class="position-detail">
              <span class="position-detail-label">Entrada</span>
              <span class="position-detail-value">${formatPrice(pos.entry)}</span>
            </div>
            <div class="position-detail">
              <span class="position-detail-label">SL</span>
              <span class="position-detail-value" style="color:#ef5350">${formatPrice(pos.sl)}</span>
            </div>
            <div class="position-detail">
              <span class="position-detail-label">TP</span>
              <span class="position-detail-value" style="color:#26a69a">${formatPrice(pos.tp)}</span>
            </div>
            <div class="position-detail">
              <span class="position-detail-label">Tamaño</span>
              <span class="position-detail-value">$${pos.positionSize}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderClosedTrades(trades) {
    const container = document.getElementById('tradesHistory');

    if (!trades || trades.length === 0) {
      container.innerHTML = '<div class="no-signals">Sin trades cerrados</div>';
      return;
    }

    container.innerHTML = trades.slice(0, 20).map(trade => {
      const date = new Date(trade.closedAt);
      const timeStr = date.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const pnl = parseFloat(trade.netPnl);
      const pnlClass = pnl >= 0 ? 'positive' : 'negative';
      const resultEmoji = trade.result === 'win' ? '✅' : '❌';
      const reasonLabel = trade.closeReason === 'tp' ? 'TP Hit' :
                          trade.closeReason === 'sl' ? 'SL Hit' : 'Liquidado';

      return `
        <div class="history-item ${trade.type} ${trade.result}">
          <div class="history-item-header">
            <span class="history-type ${trade.type}">${resultEmoji} ${trade.type === 'long' ? 'LONG' : 'SHORT'}</span>
            <span class="history-time">${timeStr}</span>
            <span class="history-pnl ${pnlClass}">${pnl >= 0 ? '+' : ''}$${trade.netPnl}</span>
          </div>
          <div class="history-risk">
            <div class="history-risk-item">
              <span class="history-risk-label">Entrada</span>
              <span class="history-risk-value">${formatPrice(trade.entry)}</span>
            </div>
            <div class="history-risk-item">
              <span class="history-risk-label">Cierre</span>
              <span class="history-risk-value">${formatPrice(trade.closePrice)}</span>
            </div>
            <div class="history-risk-item">
              <span class="history-risk-label">Razón</span>
              <span class="history-risk-value">${reasonLabel}</span>
            </div>
            <div class="history-risk-item">
              <span class="history-risk-label">R:R</span>
              <span class="history-risk-value">1:${trade.rr}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Update price display
  function updatePriceDisplay(candle) {
    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');

    priceEl.textContent = formatPrice(candle.close);

    const change = ((candle.close - candle.open) / candle.open * 100).toFixed(2);
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change}%`;
    changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
  }

  // Event Listeners
  function setupEventListeners() {
    const tfButtons = document.querySelectorAll('.timeframe-selector button');
    tfButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tfButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTimeframe = btn.dataset.tf;
        clearDrawnObjects();
        candleSeries.setMarkers([]);
        subscribe(currentTimeframe);
      });
    });

    const panelToggle = document.getElementById('panelToggle');
    const sidebar = document.getElementById('panelSidebar');
    panelToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      panelToggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
      setTimeout(() => {
        chart.applyOptions({
          width: document.getElementById('chartContainer').clientWidth,
        });
      }, 350);
    });
  }

  // Utility
  function formatPrice(price) {
    if (!price) return '--';
    return Number(price).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();
