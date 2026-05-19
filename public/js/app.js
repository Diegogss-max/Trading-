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
    // Loading screen greetings
    const greetings = [
      'Bienvenido una vez más, Diego 👑',
      '¿Listo para ganar dinero, Diego? 💰',
      'El mercado te espera, Diego 🦁',
      'Hoy es tu día, Diego 🚀',
      'A por todas, Diego 🔥',
      'Los millonarios no descansan, Diego ⚡',
      'Tu imperio crece, Diego 🏦',
      'Vamos a cobrar, Diego 💎'
    ];

    const greetEl = document.getElementById('loadingGreeting');
    if (greetEl) {
      greetEl.textContent = greetings[Math.floor(Math.random() * greetings.length)];
    }

    const statuses = [
      'Conectando con el mercado...',
      'Analizando estructura...',
      'Cargando datos en vivo...',
      'Preparando señales...',
      'Todo listo. A operar.'
    ];

    let statusIdx = 0;
    const statusEl = document.getElementById('loadingStatus');
    const statusInterval = setInterval(() => {
      statusIdx++;
      if (statusIdx < statuses.length && statusEl) {
        statusEl.textContent = statuses[statusIdx];
      } else {
        clearInterval(statusInterval);
      }
    }, 700);

    // Show app after loading
    setTimeout(() => {
      const loading = document.getElementById('loadingScreen');
      const app = document.getElementById('appContainer');
      if (loading) loading.style.display = 'none';
      if (app) app.style.display = 'flex';
      createChart();
      setupEventListeners();
      loadAllData();
      renderTracker();
      renderMyTrades();
    }, 4000);
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
    loadMacroNews(); // Cargar noticias macroeconómicas del servidor
  }

  async function loadMacroNews() {
    const listEl = document.getElementById('macroNewsList');
    const warningEl = document.getElementById('macroWarningBanner');
    const warningTextEl = document.getElementById('macroWarningText');

    try {
      let news = null;

      // Intentar primero obtener las noticias del servidor local
      try {
        const resp = await fetch('/api/news');
        if (resp.ok) {
          news = await resp.json();
        } else {
          console.log('Local API news not available (status ' + resp.status + '). Trying direct feed fallback...');
        }
      } catch (apiErr) {
        console.log('Local API news connection failed. Trying direct feed fallback...');
      }

      // Si falló el servidor local (ej. desplegado estático en Vercel), obtenemos el feed directo desde el CDN
      if (!news || news.length === 0) {
        const directResp = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
        if (!directResp.ok) {
          throw new Error(`Direct CDN feed returned status ${directResp.status}`);
        }
        const rawNews = await directResp.json();

        // Mapeo auxiliar de estrellas
        const getStarRating = (impact) => {
          switch (String(impact).toLowerCase()) {
            case 'high': return 3;
            case 'medium': return 2;
            case 'low': return 1;
            default: return 0;
          }
        };

        // Filtrar solo las noticias de USD y estructurarlas igual que el backend
        news = rawNews
          .filter(e => e.country === 'USD')
          .map(e => ({
            title: e.title,
            country: e.country,
            date: e.date,
            impact: e.impact,
            stars: getStarRating(e.impact),
            forecast: e.forecast || '--',
            previous: e.previous || '--'
          }));
      }

      if (!news || news.length === 0) {
        if (listEl) listEl.innerHTML = '<div class="no-signals">Sin noticias esta semana</div>';
        if (warningEl) warningEl.style.display = 'none';
        return;
      }

      // Helper para verificar si un evento es el día de hoy
      const today = new Date();
      const isEventToday = (dateStr) => {
        const d = new Date(dateStr);
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear();
      };

      // Filtrar noticias de alto impacto (3 estrellas) que sucedan hoy
      const todayHighEvents = news.filter(e => isEventToday(e.date) && e.stars === 3);

      if (todayHighEvents.length > 0) {
        if (warningEl && warningTextEl) {
          const eventDetails = todayHighEvents.map(e => {
            const time = new Date(e.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            return `<b>${e.title}</b> (${time})`;
          }).join(', ');
          
          warningTextEl.innerHTML = `⚠️ <b>ALERTA DE VOLATILIDAD:</b> Hoy hay noticias de alto impacto (3★): ${eventDetails}. ¡Se recomienda NO OPERAR hoy!`;
          warningEl.style.display = 'flex';
        }
      } else {
        if (warningEl) warningEl.style.display = 'none';
      }

      // Renderizar listado de noticias en la barra lateral (filtrado solo para el día actual)
      if (listEl) {
        const todayNews = news.filter(e => isEventToday(e.date));

        if (todayNews.length === 0) {
          listEl.innerHTML = '<div class="no-signals" style="text-align: center; padding: 15px 10px;">☕ Sin noticias de USD programadas para hoy</div>';
        } else {
          listEl.innerHTML = todayNews.map(e => {
            const eDate = new Date(e.date);
            const timeLabel = eDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            const displayTime = `Hoy · ${timeLabel}`;

            // Formateo de estrellas físicas y clase de color
            let starsStr = '';
            let starsClass = '';
            if (e.stars === 3) {
              starsStr = '★★★';
              starsClass = 'high';
            } else if (e.stars === 2) {
              starsStr = '★★☆';
              starsClass = 'medium';
            } else if (e.stars === 1) {
              starsStr = '★☆☆';
              starsClass = 'low';
            } else {
              starsStr = 'Holiday';
              starsClass = 'holiday';
            }

            const impactClass = e.impact ? `impact-${e.impact.toLowerCase()}` : '';

            return `
              <div class="news-card ${impactClass}">
                <div class="news-card-header">
                  <span class="news-time-badge">${displayTime}</span>
                  <span class="news-stars ${starsClass}">${starsStr}</span>
                </div>
                <div class="news-title">${e.title}</div>
                <div class="news-details">
                  <div class="news-detail">
                    <span class="news-detail-label">Previsión</span>
                    <span class="news-detail-value">${e.forecast}</span>
                  </div>
                  <div class="news-detail">
                    <span class="news-detail-label">Previo</span>
                    <span class="news-detail-value">${e.previous}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }
      }

    } catch (err) {
      console.warn('Error loading macroeconomic news (falling back silently):', err.message);
      if (listEl) {
        listEl.innerHTML = '<div class="no-signals" style="color:var(--accent-red)">⚠️ Error al cargar noticias macro.</div>';
      }
      if (warningEl) warningEl.style.display = 'none';
    }
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

      // Always run 15m analysis for signal generation (priority TF)
      if (tf !== currentTimeframe && tf === '15m') {
        runAnalysis('15m');
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

    const signals = SMC.generateICTSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend, candleData['5m'] || candleData['1m']);

    // If outside killzone, show status message
    if (signals.outsideKZ) {
      const sc = document.getElementById('signalsList');
      sc.innerHTML = `<div class="no-signals" style="color:#d29922">⏰ ${signals.killzoneStatus}<br><small style="color:#484f58">${signals.nextKZ || ''}</small></div>`;
    }

    const refinedSignals = [];
    for (const signal of (signals.signals || [])) {
      // Try to refine with 5m first, then 1m
      let refined = null;
      if (tf !== '1m' && candleData['5m'] && candleData['5m'].length > 50) {
        refined = SMC.refineEntry(signal, candleData['5m']);
      }
      if (!refined && tf !== '1m' && candleData['1m'] && candleData['1m'].length > 50) {
        refined = SMC.refineEntry(signal, candleData['1m']);
      }

      if (refined) {
        refinedSignals.push({
          ...signal,
          refined: refined,
          hasRefinedEntry: true
        });
      } else {
        refinedSignals.push({ ...signal, hasRefinedEntry: false });
      }
    }

    // Track new signals
    const now = Date.now();
    if (refinedSignals.length > 0 && now - lastSignalTime > 30000) {
      for (const s of refinedSignals) {
        SignalTracker.addSignal({ ...s, timeframe: tf });
      }
      lastSignalTime = now;
      renderTracker();
    }

    drawAnalysis(structure, obs, fvgs, liquidity, pd, refinedSignals);
    updatePanel(structure, obs, fvgs, liquidity, pd, refinedSignals, volume, session, htfTrend, signals);
  }

  function drawAnalysis(structure, obs, fvgs, liquidity, pd, signals) {
    markers = [];
    clearDrawnObjects();

    // BOS markers (blue arrows)
    for (const b of (structure.bos || []).slice(-8)) markers.push({ time: b.time, position: b.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#42a5f5', shape: b.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'BOS' });
    // CHoCH markers (orange, more visible)
    for (const c of (structure.choch || []).slice(-4)) markers.push({ time: c.time, position: c.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#ffa726', shape: c.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'CHoCH' });

    // ORDER BLOCKS - Solid thick lines, bright colors
    for (const ob of obs.slice(-5)) {
      const isBull = ob.type === 'ob_bullish';
      const color = isBull ? '#00e676' : '#ff1744'; // Bright green / bright red
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.top, color, lineWidth: 3, lineStyle: 0, axisLabelVisible: true, title: isBull ? '── OB Bull ──' : '── OB Bear ──' }));
      drawnObjects.obs.push(candleSeries.createPriceLine({ price: ob.bottom, color, lineWidth: 3, lineStyle: 0, axisLabelVisible: false, title: '' }));
    }

    // FVGs - Dashed lines, purple/orange distinct from OBs
    for (const fvg of fvgs.slice(-5)) {
      const isBull = fvg.type === 'fvg_bullish';
      const color = isBull ? '#ce93d8' : '#ffb74d'; // Light purple / light orange
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.top, color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: isBull ? '┄ FVG Bull ┄' : '┄ FVG Bear ┄' }));
      drawnObjects.fvgs.push(candleSeries.createPriceLine({ price: fvg.bottom, color, lineWidth: 2, lineStyle: 2, axisLabelVisible: false, title: '' }));
    }

    // LIQUIDITY - Dotted yellow lines, clearly labeled
    for (const liq of liquidity.slice(-6)) {
      const isHigh = liq.type.includes('high');
      drawnObjects.liquidity.push(candleSeries.createPriceLine({ price: liq.price, color: '#ffd600', lineWidth: 2, lineStyle: 3, axisLabelVisible: true, title: isHigh ? '$$$ LIQ High' : '$$$ LIQ Low' }));
    }

    // PREMIUM / DISCOUNT - Subtle zone markers
    if (pd) {
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.equilibrium, color: '#90a4ae', lineWidth: 2, lineStyle: 4, axisLabelVisible: true, title: '═══ EQUILIBRIO ═══' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeHigh, color: '#ef5350', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '▲ PREMIUM' }));
      drawnObjects.pd.push(candleSeries.createPriceLine({ price: pd.rangeLow, color: '#26a69a', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '▼ DISCOUNT' }));
    }

    // SIGNALS - Entry, SL, TP clearly marked
    for (const s of signals.slice(-3)) {
      markers.push({ time: s.time, position: s.type === 'long' ? 'belowBar' : 'aboveBar', color: s.type === 'long' ? '#00e676' : '#ff1744', shape: s.type === 'long' ? 'arrowUp' : 'arrowDown', text: s.type === 'long' ? '▲ LONG' : '▼ SHORT' });
      if (s.sl) drawnObjects.obs.push(candleSeries.createPriceLine({ price: s.sl, color: '#ff1744', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '✗ SL' }));
      if (s.tp) drawnObjects.obs.push(candleSeries.createPriceLine({ price: s.tp, color: '#00e676', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '✓ TP' }));
    }

    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers.length > 0 ? markers : []);
  }

  function clearDrawnObjects() {
    for (const lines of Object.values(drawnObjects)) { for (const l of lines) { try { candleSeries.removePriceLine(l); } catch (e) {} } }
    drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [] };
  }

  function updatePanel(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend, ictData) {
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

    // Session - use ICT killzone
    if (session) {
      const ictKZ = SMC.getICTKillzone();
      document.getElementById('sessionLabel').textContent = session.sessionLabel;
      document.getElementById('sessionDot').className = `session-dot ${ictKZ.isActive ? 'active' : ''}`;
      document.getElementById('killzoneLabel').textContent = ictKZ.isActive ? ictKZ.killzone : 'Sin Killzone';
      document.getElementById('killzoneBadge').className = `killzone-badge ${ictKZ.isActive ? 'active' : ''}`;
      document.getElementById('ctxSession').textContent = session.sessionLabel;
      document.getElementById('ctxKillzone').textContent = ictKZ.isActive ? ictKZ.killzone : (ictData && ictData.killzoneStatus ? ictData.killzoneStatus : 'Ninguna');
      document.getElementById('ctxKillzone').style.color = ictKZ.isActive ? '#d29922' : '#484f58';
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
    const myStats = MyTrades.getStats();
    document.getElementById('simWinRate').textContent = myStats.winRate;
    document.getElementById('simWins').textContent = myStats.wins;
    document.getElementById('simLosses').textContent = myStats.losses;
    document.getElementById('simActive').textContent = MyTrades.getOpen().length;

    // Active signals with feasibility (newest first, 15m prioritized)
    const active = [...SignalTracker.getActive()].sort((a, b) => {
      // 15m signals always on top
      if (a.timeframe === '15m' && b.timeframe !== '15m') return -1;
      if (b.timeframe === '15m' && a.timeframe !== '15m') return 1;
      // Then by creation time (newest first)
      return b.createdAt - a.createdAt;
    });
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
            ${s.refined ? `
            <div class="refined-entry-badge">
              <div class="refined-header">🎯 ENTRADA REFINADA (LTF)</div>
              <div class="refined-details">
                <div class="refined-detail"><span>Entry:</span><span>${fp(s.refined.entry)}</span></div>
                <div class="refined-detail"><span>SL:</span><span style="color:#ef5350">${fp(s.refined.sl)}</span></div>
                <div class="refined-detail"><span>R:R:</span><span style="color:#00e676">1:${s.refined.rr}</span></div>
              </div>
              <div class="refined-improvement">SL reducido ${s.refined.improvement.slReductionPercent}% · R:R +${s.refined.improvement.rrImprovement}</div>
            </div>` : ''}
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

    // Guide modal
    document.getElementById('guideBtn').addEventListener('click', () => {
      document.getElementById('guideOverlay').classList.add('visible');
    });
    document.getElementById('guideClose').addEventListener('click', () => {
      document.getElementById('guideOverlay').classList.remove('visible');
    });
    document.getElementById('guideOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('guideOverlay').classList.remove('visible');
      }
    });

    // Configurar paneles colapsables en la barra lateral
    document.querySelectorAll('.panel-section h3').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('collapsed');
      });
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

  // Motivational phrases
  const PHRASES = [
    '💎 El mercado recompensa a los pacientes. Tu momento es ahora.',
    '🦁 Piensa como millonario, opera como millonario, SÉ millonario.',
    '🚀 Cada operación ganadora te acerca más a tu libertad financiera.',
    '👑 Los ricos no trabajan por dinero. El dinero trabaja para ellos.',
    '🔥 La disciplina de hoy es la riqueza de mañana. Sigue el plan.',
    '💰 No estás aquí por suerte. Estás aquí porque eres imparable.',
    '⚡ Un millonario no nace, se construye operación tras operación.',
    '🏆 El 1% no duda. Analiza, ejecuta y cobra. Ese eres tú.',
    '🌟 Tu cuenta bancaria es un reflejo de tu mentalidad. Piensa en grande.',
    '🦈 Los tiburones no miran atrás. Siguiente trade, siguiente victoria.',
    '🏦 Mientras otros duermen, tú construyes un imperio. No pares.',
    '💵 El dinero fluye hacia quien tiene la disciplina de esperarlo.',
    '🎯 Precisión sobre cantidad. Un buen trade vale más que cien malos.',
    '🧠 Tu mente es tu mejor activo. Entrénala como un atleta de élite.',
    '🌊 Las olas del mercado no te tumban, te elevan. Surfea con confianza.',
    '🔑 La clave no es cuánto ganas, es cuánto conservas. Gestiona el riesgo.',
    '💪 Los perdedores buscan excusas. Los ganadores buscan entradas. Tú ganas.',
    '🏔️ La cima es solitaria, pero la vista es millonaria. Sigue subiendo.',
    '⭐ Hoy es el día que tu futuro yo te agradecerá. Opera con convicción.',
    '🐺 No sigues al rebaño. Tú eres el que mueve el mercado.'
  ];

  function rotatePhrase() {
    const el = document.getElementById('motivText');
    if (!el) return;
    const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    el.style.animation = 'none';
    el.offsetHeight; // trigger reflow
    el.style.animation = 'fadeMotiv 1s ease';
    el.textContent = phrase;
  }

  setInterval(rotatePhrase, 15000); // Change every 15 seconds

  document.addEventListener('DOMContentLoaded', init);
})();
