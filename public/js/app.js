// SMC Trading App - Client-side (Vercel compatible)
(function () {
  'use strict';

  let chart = null;
  let candleSeries = null;
  let currentTimeframe = '15m';
  let candleData = {};
  let htfAnalysis = {};
  let binanceWs = null;
  let drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [], bos: [], choch: [], kz: [] };
  let markers = [];
  let lastSignalTime = 0;
  let activeToggles = { bos: true, choch: true, ob: true, fvg: true, liq: true, kz: true };
  let tvWidget = null;
  // SMC Diagnostic Ticker — shared state (must be declared before use in loadMacroNews / updatePanel)
  let _tickerState = {
    trend: 'neutral', htf4h: 'neutral', htf1d: 'neutral',
    pdZone: 'equilibrium', killzoneActive: false, killzoneLabel: '',
    hasOB: false, obCount: 0, obType: '', hasFVG: false, fvgCount: 0, fvgType: '',
    hasBOS: false, bosType: '', hasCHoCH: false, chochType: '',
    volHigh: false, volTrend: 'stable', buyPressure: 50,
    signalCount: 0, signalType: '', signalConfidence: '', htfAligned: false,
    currentPrice: 0, liqCount: 0, macroRisk: false, session: '',
  };
  let _tickerMessages = [];
  let _tickerIndex    = 0;
  let _tickerTimer    = null;
  let _tickerInitialized = false;

  const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const MAX_CANDLES = 500;

  function init() {
    // Diego Bypass Backdoor (MVP Skip)
    const urlParams = new URLSearchParams(window.location.search);
    const bypassParam = urlParams.get('bypass') || urlParams.get('email');
    if (bypassParam) {
      const emailValue = bypassParam === 'true' ? 'diego-admin@forbessecrets.com' : (bypassParam.includes('@') ? bypassParam : `${bypassParam}@gmail.com`);
      localStorage.setItem('earlyAccessEmail', emailValue);
      // Clean up the URL query in the address bar
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Gate validation for MVP
    const email = localStorage.getItem('earlyAccessEmail');
    if (!email) {
      window.location.href = '/';
      return;
    }

    const emailName = email.split('@')[0];
    // Loading screen greetings (dynamic for the registered trader!)
    const greetings = [
      `Bienvenido una vez más, ${emailName} 👑`,
      `¿Listo para ganar dinero, ${emailName}? 💰`,
      `El mercado te espera, ${emailName} 🦁`,
      `Hoy es tu día, ${emailName} 🚀`,
      `A por todas, ${emailName} 🔥`,
      `Los millonarios no descansan, ${emailName} ⚡`,
      `Tu imperio crece, ${emailName} 🏦`,
      `Vamos a cobrar, ${emailName} 💎`
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

      // Auto onboarding: show guide on first visit
      if (!localStorage.getItem('guideShown')) {
        setTimeout(() => {
          const guideOverlay = document.getElementById('guideOverlay');
          if (guideOverlay) {
            guideOverlay.classList.add('visible');
            localStorage.setItem('guideShown', 'true');
          }
        }, 1200);
      }
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
      localization: {
        timeFormatter: (time) => {
          return new Intl.DateTimeFormat('es-CL', {
            timeZone: 'America/Santiago',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          }).format(new Date(time * 1000));
        }
      },
      timeScale: { 
        borderColor: '#2a2e39', 
        timeVisible: true, 
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const d = new Date(time * 1000);
          if (tickMarkType === LightweightCharts.TickMarkType.Year) {
             return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric' }).format(d);
          } else if (tickMarkType === LightweightCharts.TickMarkType.Month) {
             return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', month: 'short' }).format(d);
          } else if (tickMarkType === LightweightCharts.TickMarkType.DayOfMonth) {
             return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric' }).format(d);
          } else {
             return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }).format(d);
          }
        }
      }
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
        // Set macro risk flag for the diagnostic ticker
        if (typeof _tickerState !== 'undefined') {
          _tickerState.macroRisk = true;
        }
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
      // 💰 Money sound alert on new entry signal
      playMoneySound();
    }

    drawAnalysis(structure, obs, fvgs, liquidity, pd, refinedSignals);
    updatePanel(structure, obs, fvgs, liquidity, pd, refinedSignals, volume, session, htfTrend, signals);
  }

  function drawBoundedLine(startTime, endTime, price, color, width, style, title = '') {
    if (!chart) return null;
    const series = chart.addLineSeries({
      color: color,
      lineWidth: width,
      lineStyle: style,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: title
    });
    series.setData([
      { time: startTime, value: price },
      { time: endTime, value: price }
    ]);
    return series;
  }

  function drawAnalysis(structure, obs, fvgs, liquidity, pd, signals) {
    markers = [];
    clearDrawnObjects();

    const candles = candleData[currentTimeframe];
    if (!candles || candles.length === 0) return;
    const lastCandleTime = candles[candles.length - 1].time;

    // BOS markers & lines
    if (activeToggles.bos) {
      for (const b of (structure.bos || []).slice(-8)) {
        const endIdx = typeof b.index === 'number' ? Math.min(candles.length - 1, b.index + 8) : candles.length - 1;
        const endTime = candles[endIdx].time;
        const line = drawBoundedLine(b.time, endTime, b.price, '#42a5f5', 2, 2, 'BOS');
        if (line) drawnObjects.bos.push(line);
        markers.push({ time: b.time, position: b.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#42a5f5', shape: b.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'BOS' });
      }
    }

    // CHoCH markers & lines
    if (activeToggles.choch) {
      for (const c of (structure.choch || []).slice(-4)) {
        const endIdx = typeof c.index === 'number' ? Math.min(candles.length - 1, c.index + 8) : candles.length - 1;
        const endTime = candles[endIdx].time;
        const line = drawBoundedLine(c.time, endTime, c.price, '#ffa726', 2, 2, 'CHoCH');
        if (line) drawnObjects.choch.push(line);
        markers.push({ time: c.time, position: c.type.includes('bullish') ? 'belowBar' : 'aboveBar', color: '#ffa726', shape: c.type.includes('bullish') ? 'arrowUp' : 'arrowDown', text: 'CHoCH' });
      }
    }

    // ORDER BLOCKS - Solid thick lines, starting at ob.startTime
    if (activeToggles.ob) {
      for (const ob of obs.slice(-5)) {
        const isBull = ob.type === 'ob_bullish';
        const color = isBull ? '#00e676' : '#ff1744'; // Bright green / bright red
        const topLine = drawBoundedLine(ob.startTime, lastCandleTime, ob.top, color, 3, 0, isBull ? 'OB Bull' : 'OB Bear');
        const bottomLine = drawBoundedLine(ob.startTime, lastCandleTime, ob.bottom, color, 3, 0);
        if (topLine) drawnObjects.obs.push(topLine);
        if (bottomLine) drawnObjects.obs.push(bottomLine);
      }
    }

    // FVGs - Dashed lines, starting at fvg.endTime (or startTime fallback)
    if (activeToggles.fvg) {
      for (const fvg of fvgs.slice(-5)) {
        const isBull = fvg.type === 'fvg_bullish';
        const color = isBull ? '#ce93d8' : '#ffb74d'; // Light purple / light orange
        const start = fvg.endTime || fvg.startTime;
        const topLine = drawBoundedLine(start, lastCandleTime, fvg.top, color, 2, 2, isBull ? 'FVG Bull' : 'FVG Bear');
        const bottomLine = drawBoundedLine(start, lastCandleTime, fvg.bottom, color, 2, 2);
        if (topLine) drawnObjects.fvgs.push(topLine);
        if (bottomLine) drawnObjects.fvgs.push(bottomLine);
      }
    }

    // LIQUIDITY - Dotted yellow lines, starting at liq.time
    if (activeToggles.liq) {
      for (const liq of liquidity.slice(-6)) {
        const isHigh = liq.type.includes('high');
        const line = drawBoundedLine(liq.time, lastCandleTime, liq.price, '#ffd600', 2, 3, isHigh ? 'LIQ High' : 'LIQ Low');
        if (line) drawnObjects.liquidity.push(line);
      }
    }

    // KILLZONES - Shaded background areas for London Open, NY Open, London Close
    if (activeToggles.kz) {
      // ICT Killzone definitions in UTC hours
      const KZ_DEFS = [
        { startUTC: 0,  endUTC: 6,  label: 'Asian KZ',     color: 'rgba(0,188,212,0.06)',  borderColor: 'rgba(0,188,212,0.35)',  markerColor: '#00bcd4' },
        { startUTC: 7,  endUTC: 10, label: 'London Open',  color: 'rgba(33,150,243,0.06)', borderColor: 'rgba(33,150,243,0.35)', markerColor: '#2196f3' },
        { startUTC: 12, endUTC: 15, label: 'NY Open',      color: 'rgba(255,152,0,0.06)',  borderColor: 'rgba(255,152,0,0.35)',  markerColor: '#ff9800' },
        { startUTC: 15, endUTC: 17, label: 'London Close', color: 'rgba(171,71,188,0.06)', borderColor: 'rgba(171,71,188,0.35)', markerColor: '#ab47bc' }
      ];

      // Group candles by UTC day and find KZ ranges in the visible data
      const kzWindows = [];
      let prevDayKey = null;

      for (let i = 0; i < candles.length - 1; i++) {
        const c = candles[i];
        const date = new Date(c.time * 1000);
        const utcH = date.getUTCHours();
        const dayKey = date.toISOString().slice(0, 10);

        for (const kzDef of KZ_DEFS) {
          if (utcH >= kzDef.startUTC && utcH < kzDef.endUTC) {
            // Check if we already opened this window
            const existing = kzWindows.find(w => w.label === kzDef.label && w.dayKey === dayKey);
            if (!existing) {
              // Find the candle that starts and ends this killzone block
              let startTime = c.time;
              let endTime   = c.time;
              for (let j = i; j < candles.length; j++) {
                const d2 = new Date(candles[j].time * 1000);
                if (d2.toISOString().slice(0, 10) !== dayKey) break;
                if (d2.getUTCHours() < kzDef.startUTC || d2.getUTCHours() >= kzDef.endUTC) break;
                endTime = candles[j].time;
              }
              kzWindows.push({ ...kzDef, dayKey, startTime, endTime });
            }
          }
        }
      }

      // Draw each killzone window as a background shaded area using a thin line series trick
      // We use addHistogramSeries positioned well outside price to mimic background via markers
      // Better approach: draw two vertical price lines per window + label marker
      for (const w of kzWindows) {
        // Top & bottom reference lines at approximate price range
        const priceRange = candles.slice(-100);
        const pHigh = Math.max(...priceRange.map(c => c.high));
        const pLow  = Math.min(...priceRange.map(c => c.low));
        const pad   = (pHigh - pLow) * 0.05;

        // Draw top shading line
        const kzSeries = chart.addLineSeries({
          color: w.borderColor,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        kzSeries.setData([
          { time: w.startTime, value: pHigh + pad },
          { time: w.endTime,   value: pHigh + pad }
        ]);
        drawnObjects.kz.push(kzSeries);

        // Draw bottom shading line
        const kzSeriesBot = chart.addLineSeries({
          color: w.borderColor,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        kzSeriesBot.setData([
          { time: w.startTime, value: pLow - pad },
          { time: w.endTime,   value: pLow - pad }
        ]);
        drawnObjects.kz.push(kzSeriesBot);

        // Add a marker at the start of the killzone
        markers.push({
          time: w.startTime,
          position: 'aboveBar',
          color: w.markerColor,
          shape: 'square',
          text: `⏰ ${w.label}`
        });
      }
    }

    // PREMIUM / DISCOUNT - Subtle zone markers (global reference, keep full-screen)
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
    for (const lines of Object.values(drawnObjects)) {
      for (const l of lines) {
        try {
          // Check if it's a Lightweight Charts Series or a PriceLine
          if (l && typeof l.setData === 'function') {
            chart.removeSeries(l);
          } else {
            candleSeries.removePriceLine(l);
          }
        } catch (e) {
          try {
            chart.removeSeries(l);
          } catch (err) {
            try {
              candleSeries.removePriceLine(l);
            } catch (err2) {}
          }
        }
      }
    }
    drawnObjects = { obs: [], fvgs: [], liquidity: [], pd: [], bos: [], choch: [], kz: [] };
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

    // Feed the SMC Diagnostic Ticker with fresh market data
    updateTickerState(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend);
    rotateTicker();
  }

  function renderTracker() {
    const myStats = MyTrades.getStats();
    document.getElementById('simWinRate').textContent = myStats.total > 0 ? myStats.winRate : 'Nuevo';
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
      sc.innerHTML = '<div class="no-signals onboarding-state">☕ Esperando confluencia institucional en BTC/USDT. ¡Consulta las Reglas de Oro de la Guía SMC!</div>';
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

  function initTradingViewWidget() {
    if (tvWidget) return;
    tvWidget = new TradingView.widget({
      width: "100%",
      height: "100%",
      symbol: "AMEX:VOO",
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "es",
      toolbar_bg: "#131722",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      container_id: "tradingview_voo"
    });
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

    // Market tabs
    const tabBtc = document.getElementById('tab-btc');
    const tabVoo = document.getElementById('tab-voo');
    const containerBtc = document.getElementById('chartContainer');
    const containerVoo = document.getElementById('vooChartContainer');

    if (tabBtc && tabVoo) {
      tabBtc.addEventListener('click', () => {
        tabBtc.classList.add('active');
        tabVoo.classList.remove('active');
        containerBtc.style.display = 'block';
        containerVoo.style.display = 'none';
      });

      tabVoo.addEventListener('click', () => {
        tabVoo.classList.add('active');
        tabBtc.classList.remove('active');
        containerBtc.style.display = 'none';
        containerVoo.style.display = 'block';
        initTradingViewWidget();
      });
    }

    // Toggle checkboxes
    const toggleBos = document.getElementById('toggle-bos');
    const toggleChoch = document.getElementById('toggle-choch');
    const toggleOb = document.getElementById('toggle-ob');
    const toggleFvg = document.getElementById('toggle-fvg');

    if (toggleBos) {
      toggleBos.addEventListener('change', (e) => {
        activeToggles.bos = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }
    if (toggleChoch) {
      toggleChoch.addEventListener('change', (e) => {
        activeToggles.choch = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }
    if (toggleOb) {
      toggleOb.addEventListener('change', (e) => {
        activeToggles.ob = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }
    if (toggleFvg) {
      toggleFvg.addEventListener('change', (e) => {
        activeToggles.fvg = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }

    const toggleLiq = document.getElementById('toggle-liq');
    const toggleKz  = document.getElementById('toggle-kz');

    if (toggleLiq) {
      toggleLiq.addEventListener('change', (e) => {
        activeToggles.liq = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }
    if (toggleKz) {
      toggleKz.addEventListener('change', (e) => {
        activeToggles.kz = e.target.checked;
        runAnalysis(currentTimeframe);
      });
    }

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

    // Diagnostic modal
    const diagBtn = document.getElementById('diagOpenBtn');
    if (diagBtn) {
      diagBtn.addEventListener('click', () => {
        const diagBody = document.getElementById('diagBody');
        if (diagBody && typeof _tickerMessages !== 'undefined') {
          diagBody.innerHTML = _tickerMessages.map(msg => `
            <div style="padding: 12px; background: rgba(0,0,0,0.2); border-radius: 6px; border-left: 4px solid ${
              msg.type === 'valid' ? '#00e676' : msg.type === 'warning' ? '#ff9800' : msg.type === 'invalid' ? '#ef5350' : '#42a5f5'
            }">
              <div style="font-weight: bold; margin-bottom: 6px; font-size: 13px; color: rgba(255,255,255,0.7);">
                ${msg.icon} ${msg.category}
              </div>
              <div style="font-size: 14px; line-height: 1.4;">${msg.message}</div>
            </div>
          `).join('');
        }
        document.getElementById('diagOverlay').classList.add('visible');
      });
    }
    const diagClose = document.getElementById('diagClose');
    if (diagClose) {
      diagClose.addEventListener('click', () => {
        document.getElementById('diagOverlay').classList.remove('visible');
      });
    }
    const diagOverlay = document.getElementById('diagOverlay');
    if (diagOverlay) {
      diagOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          diagOverlay.classList.remove('visible');
        }
      });
    }

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
      container.innerHTML = '<div class="no-signals onboarding-state">📈 ¿Ejecutaste un trade? Presiona "📍 Entré" en una de las Señales Recomendadas abajo.</div>';
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
      hc.innerHTML = '<div class="no-signals onboarding-state">📋 Tu historial y estadísticas de acierto se calcularán una vez cierres tu primera operación.</div>';
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


  // =====================================================
  // SMC DIAGNOSTIC TICKER — Terminal de Diagnóstico
  // Lógica condicional: cero emociones, puro análisis.
  // _tickerState is declared at top of IIFE (shared scope).
  // =====================================================

  /**
   * Called by updatePanel() each analysis cycle to feed fresh data into the ticker state.
   */
  function updateTickerState(structure, obs, fvgs, liquidity, pd, signals, volume, session, htfTrend) {
    const htf4h = htfAnalysis['4h'] ? htfAnalysis['4h'].structure.trend : 'neutral';
    const htf1d = htfAnalysis['1d'] ? htfAnalysis['1d'].structure.trend : 'neutral';
    const ictKZ = SMC.getICTKillzone ? SMC.getICTKillzone() : { isActive: false, killzone: '' };

    // Dominant OB type (look at most recent one)
    const recentOB  = obs && obs.length > 0 ? obs[obs.length - 1] : null;
    const recentFVG = fvgs && fvgs.length > 0 ? fvgs[fvgs.length - 1] : null;
    const recentBOS = structure && structure.bos && structure.bos.length > 0 ? structure.bos[structure.bos.length - 1] : null;
    const recentCHoCH = structure && structure.choch && structure.choch.length > 0 ? structure.choch[structure.choch.length - 1] : null;
    const activeSignals = SignalTracker ? SignalTracker.getActive() : [];

    _tickerState = {
      trend:           structure ? structure.trend : 'neutral',
      htf4h,
      htf1d,
      pdZone:          pd ? pd.position : 'equilibrium',
      killzoneActive:  ictKZ.isActive,
      killzoneLabel:   ictKZ.killzone || '',
      hasOB:           obs && obs.length > 0,
      obCount:         obs ? obs.length : 0,
      obType:          recentOB ? (recentOB.type === 'ob_bullish' ? 'bullish' : 'bearish') : '',
      hasFVG:          fvgs && fvgs.length > 0,
      fvgCount:        fvgs ? fvgs.length : 0,
      fvgType:         recentFVG ? (recentFVG.type === 'fvg_bullish' ? 'bullish' : 'bearish') : '',
      hasBOS:          recentBOS != null,
      bosType:         recentBOS ? (recentBOS.type && recentBOS.type.includes('bullish') ? 'bullish' : 'bearish') : '',
      hasCHoCH:        recentCHoCH != null,
      chochType:       recentCHoCH ? (recentCHoCH.type && recentCHoCH.type.includes('bullish') ? 'bullish' : 'bearish') : '',
      volHigh:         volume ? volume.isHighVolume : false,
      volTrend:        volume ? volume.volumeTrend : 'stable',
      buyPressure:     volume ? volume.pressure.buyPercent : 50,
      signalCount:     activeSignals.length,
      signalType:      activeSignals.length > 0 ? activeSignals[0].type : '',
      signalConfidence: activeSignals.length > 0 ? activeSignals[0].confidence : '',
      htfAligned:      activeSignals.length > 0 && (
                         (activeSignals[0].type === 'long'  && htf4h === 'bullish' && htf1d === 'bullish') ||
                         (activeSignals[0].type === 'short' && htf4h === 'bearish' && htf1d === 'bearish')
                       ),
      liqCount:        liquidity ? liquidity.length : 0,
      session:         session ? session.sessionLabel : '',
      macroRisk:       _tickerState.macroRisk, // preserved from loadMacroNews
    };
  }

  /**
   * Builds an ordered priority queue of diagnostic messages from current market state.
   * Returns array of { type, category, message, icon, score } objects.
   * type: 'valid' | 'warning' | 'invalid' | 'neutral'
   */
  function buildDiagnosticMessages() {
    const s = _tickerState;
    const messages = [];

    // Helper shorthand
    const bullDir = s.trend === 'bullish';
    const bearDir = s.trend === 'bearish';
    const htfBull = s.htf4h === 'bullish' && s.htf1d === 'bullish';
    const htfBear = s.htf4h === 'bearish' && s.htf1d === 'bearish';
    const htfConflict = s.htf4h !== 'neutral' && s.htf1d !== 'neutral' && s.htf4h !== s.htf1d;
    const inDiscount = s.pdZone === 'discount';
    const inPremium  = s.pdZone === 'premium';
    const inEq       = s.pdZone === 'equilibrium';
    const obAligned  = s.hasOB && s.obType === s.trend;
    const fvgAligned = s.hasFVG && s.fvgType === s.trend;
    const bosAligned = s.hasBOS && s.bosType === s.trend;
    const kz = s.killzoneActive;

    // Count total active confluences for the current direction
    let score = 0;
    if (bosAligned || (s.hasCHoCH && s.chochType === s.trend)) score++;
    if (obAligned) score++;
    if (fvgAligned) score++;
    if (kz) score++;
    if (s.volHigh && s.volTrend === 'increasing') score++;
    if ((bullDir && inDiscount) || (bearDir && inPremium)) score++;
    if (s.htfAligned) score += 2;
    if (s.liqCount > 0) score++;

    // ──────────────────────────────────────────
    // 🔴 MÁXIMA PRIORIDAD: Macro Risk
    // ──────────────────────────────────────────
    if (s.macroRisk) {
      messages.push({
        type: 'invalid', category: 'RIESGO MACRO',
        icon: '⚠',
        message: 'ALERTA MACRO ACTIVA: Noticias de alto impacto hoy. Sistema en modo observación — NO OPERAR hasta resolución de volatilidad.',
        score: 0
      });
    }

    // ──────────────────────────────────────────
    // ✅ SEÑALES VÁLIDAS (HIGH confidence)
    // ──────────────────────────────────────────

    // Best case: full ICT setup — signal + aligned HTF + killzone + OB + discount/premium
    if (s.signalCount > 0 && s.signalConfidence === 'HIGH' && s.htfAligned && kz && obAligned) {
      const dir = s.signalType === 'long' ? 'LONG' : 'SHORT';
      const kzN = s.killzoneLabel || 'Killzone';
      const pd  = inDiscount ? 'Zona Descuento' : inPremium ? 'Zona Premium' : 'Zona Equilibrio';
      messages.push({
        type: 'valid', category: 'CONFLUENCIA ÓPTIMA',
        icon: '✔',
        message: `Confluencia institucional óptima ▸ BOS ${dir.toLowerCase()}ish + OB alineado + ${pd} + ${kzN} activa + HTF 4H/1D confirmados. SETUP ${dir} VÁLIDO.`,
        score
      });
    }

    // CHoCH + OB + HTF aligned + KZ = high probability reversal
    if (s.hasCHoCH && s.chochType === s.trend && obAligned && s.htfAligned && kz) {
      const dir = bullDir ? 'alcista' : 'bajista';
      messages.push({
        type: 'valid', category: 'REVERSIÓN VALIDADA',
        icon: '✔',
        message: `CHoCH ${dir} confirmado + OB ${dir} respetado + HTF alineado. Estructura de reversión institucional válida — Killzone ${s.killzoneLabel || 'activa'}.`,
        score
      });
    }

    // Valid signal with MEDIUM confidence + HTF aligned
    if (s.signalCount > 0 && s.signalConfidence === 'MEDIUM' && s.htfAligned && kz) {
      const dir = s.signalType === 'long' ? 'alcista' : 'bajista';
      messages.push({
        type: 'valid', category: 'SEÑAL ACTIVA',
        icon: '▲',
        message: `Señal ${dir} activa con confluencia MEDIA ▸ HTF alineado, Killzone ${s.killzoneLabel || 'activa'}. Confirmar con engulfing o pin bar antes de entrar.`,
        score
      });
    }

    // HIGH signal but no KZ — wait
    if (s.signalCount > 0 && s.signalConfidence === 'HIGH' && s.htfAligned && !kz) {
      messages.push({
        type: 'warning', category: 'ESPERAR KILLZONE',
        icon: '⏱',
        message: `Setup ${s.signalType === 'long' ? 'LONG' : 'SHORT'} HIGH CONFIDENCE — falta activación de Killzone. Londres y NY Open: ventanas institucionales óptimas.`,
        score
      });
    }

    // ──────────────────────────────────────────
    // 🟡 ALERTAS DE CONFLUENCIA PARCIAL
    // ──────────────────────────────────────────

    // Good structure but price in wrong P/D zone
    if (bullDir && inPremium && bosAligned && kz) {
      messages.push({
        type: 'warning', category: 'ZONA PREMIUM',
        icon: '◈',
        message: `BOS alcista confirmado, pero precio en Zona Premium (exceso). Mercado institucional compra en Descuento — esperar retroceso hacia OB o FVG.`,
        score: Math.max(0, score - 2)
      });
    }
    if (bearDir && inDiscount && bosAligned && kz) {
      messages.push({
        type: 'warning', category: 'ZONA DESCUENTO',
        icon: '◈',
        message: `BOS bajista detectado, pero precio en Zona Descuento (oversold). Short institucional se activa desde Premium — aguardar rebalanceo.`,
        score: Math.max(0, score - 2)
      });
    }

    // FVG present but structure doesn't confirm
    if (s.hasFVG && fvgAligned && !bosAligned && !s.htfAligned) {
      messages.push({
        type: 'warning', category: 'FVG SIN ESTRUCTURA',
        icon: '◉',
        message: `FVG ${s.fvgType === 'bullish' ? 'alcista' : 'bajista'} activo, pero estructura ${s.trend} no respaldada por HTF. FVG puede llenarse sin continuación — NO OPERAR aún.`,
        score: Math.max(0, score - 3)
      });
    }

    // Volume spike but price in wrong zone
    if (s.volHigh && s.volTrend === 'increasing' && bullDir && inPremium) {
      messages.push({
        type: 'warning', category: 'VOLUMEN EN PREMIUM',
        icon: '◈',
        message: `Volumen alto detectado pero precio en Zona Premium — faltan confluencias para confirmar compra institucional. Posible distribución o bull trap.`,
        score: Math.max(0, score - 2)
      });
    }
    if (s.volHigh && s.volTrend === 'increasing' && bearDir && inDiscount) {
      messages.push({
        type: 'warning', category: 'VOLUMEN EN DESCUENTO',
        icon: '◈',
        message: `Volumen creciente con tendencia bajista pero precio en Descuento — posible acumulación institucional. Evitar shorts hasta rebotar desde zona de valor.`,
        score: Math.max(0, score - 2)
      });
    }

    // HTF conflict
    if (htfConflict) {
      messages.push({
        type: 'warning', category: 'CONFLICTO HTF',
        icon: '⊘',
        message: `Conflicto HTF: 4H ${s.htf4h === 'bullish' ? '↑ alcista' : '↓ bajista'} vs 1D ${s.htf1d === 'bullish' ? '↑ alcista' : '↓ bajista'}. Multi-Timeframe no alineado — sesgo ambiguo, operar con tamaño reducido.`,
        score: 1
      });
    }

    // OB present but no BOS / CHoCH — structure not broken yet
    if (s.hasOB && obAligned && !bosAligned && !s.hasCHoCH) {
      messages.push({
        type: 'warning', category: 'OB SIN ROTURA',
        icon: '□',
        message: `Order Block ${s.obType === 'bullish' ? 'alcista' : 'bajista'} identificado, pero sin BOS ni CHoCH confirmado. El precio debe romper estructura antes de validar entrada desde el OB.`,
        score: Math.max(0, score - 1)
      });
    }

    // Signal LOW confidence
    if (s.signalCount > 0 && s.signalConfidence === 'LOW') {
      messages.push({
        type: 'warning', category: 'SEÑAL DÉBIL',
        icon: '△',
        message: `Señal ${s.signalType === 'long' ? 'LONG' : 'SHORT'} con confluencia BAJA (< 4 factores). Mínimo requerido no alcanzado — mejor dejar pasar o esperar confirmación adicional.`,
        score: Math.max(0, score - 2)
      });
    }

    // Outside killzone and no signal
    if (!kz && s.signalCount === 0) {
      const sessionStr = s.session ? ` | Sesión: ${s.session}` : '';
      messages.push({
        type: 'neutral', category: 'FUERA DE KILLZONE',
        icon: '⏸',
        message: `Sin Killzone activa${sessionStr}. Probabilidad de manipulación elevada fuera de ventanas institucionales. Sistema en modo espera.`,
        score: 0
      });
    }

    // ──────────────────────────────────────────
    // 🔴 DESCARTE (condiciones en contra)
    // ──────────────────────────────────────────

    // Trend against HTF
    if (bullDir && htfBear) {
      messages.push({
        type: 'invalid', category: 'CONTRA HTF',
        icon: '✖',
        message: `Estructura LTF alcista CONTRA HTF bajista (4H/1D). Operar long aquí equivale a ir en contra del flujo institucional. DESCARTADO.`,
        score: 0
      });
    }
    if (bearDir && htfBull) {
      messages.push({
        type: 'invalid', category: 'CONTRA HTF',
        icon: '✖',
        message: `Estructura LTF bajista CONTRA HTF alcista (4H/1D). El mercado mayor sigue comprando — short de baja probabilidad. DESCARTADO.`,
        score: 0
      });
    }

    // ──────────────────────────────────────────
    // 🔵 CONTEXTO NEUTRAL (datos informativos)
    // ──────────────────────────────────────────

    // Balanced OB + FVG + BOS — waiting for entry trigger
    if (s.hasOB && s.hasFVG && s.hasBOS && s.signalCount === 0) {
      messages.push({
        type: 'neutral', category: 'PRE-SETUP',
        icon: '◎',
        message: `Estructura pre-setup detectada: OB + FVG + BOS presentes. Aguardando formación de señal de entrada con confirmación de vela. Modo observación.`,
        score
      });
    }

    // Liquidity hunt scenario
    if (s.liqCount >= 3 && s.volHigh) {
      messages.push({
        type: 'neutral', category: 'HUNT DE LIQUIDEZ',
        icon: '◎',
        message: `${s.liqCount} zonas de liquidez activas con volumen alto — posible barrido institucional en curso. No perseguir rupturas, esperar reacción confirmada.`,
        score
      });
    }

    // General structure context
    if (messages.length === 0) {
      const dir = bullDir ? 'alcista' : bearDir ? 'bajista' : 'neutral';
      messages.push({
        type: 'neutral', category: 'ANÁLISIS',
        icon: '◎',
        message: `Estructura ${dir} en ${currentTimeframe} | HTF 4H: ${s.htf4h} · 1D: ${s.htf1d} | Zona: ${s.pdZone === 'premium' ? 'Premium' : s.pdZone === 'discount' ? 'Descuento' : 'Equilibrio'} | OBs: ${s.obCount} · FVGs: ${s.fvgCount}.`,
        score
      });
    }

    return messages;
  }


  /** Applies a single diagnostic entry to the DOM with fade animation. */
  function applyTickerEntry(entry) {
    const msgEl    = document.getElementById('tickerMessage');
    const dotEl    = document.getElementById('tickerStatusDot');
    const labelEl  = document.getElementById('tickerLabel');
    const badgeEl  = document.getElementById('tickerScoreBadge');
    const iconEl   = document.getElementById('tickerScoreIcon');
    const valueEl  = document.getElementById('tickerScoreValue');

    if (!msgEl) return;

    // Fade out
    msgEl.style.opacity = '0';
    msgEl.style.transform = 'translateY(-5px)';

    setTimeout(() => {
      // Update content
      msgEl.textContent = entry.message;

      // Remove old type classes and apply new ones
      ['valid','warning','invalid','neutral'].forEach(c => {
        msgEl.classList.remove(c);
        dotEl.classList.remove(c);
        labelEl.classList.remove(c);
        badgeEl.classList.remove(c);
      });

      msgEl.classList.add(entry.type);
      dotEl.classList.add(entry.type);
      labelEl.classList.add(entry.type);
      badgeEl.classList.add(entry.type);

      // Label text by category
      const CATEGORY_LABELS = {
        valid:   'CONFLUENCIA',
        warning: 'ALERTA',
        invalid: 'DESCARTE',
        neutral: 'ANÁLISIS',
      };
      labelEl.textContent = entry.category || CATEGORY_LABELS[entry.type] || 'DIAGNÓSTICO';

      // Score badge
      const scoreMap = {
        valid:   { icon: '✔', text: entry.score >= 6 ? `ALTA ${entry.score}` : `MED ${entry.score}` },
        warning: { icon: '△', text: `CF ${entry.score}` },
        invalid: { icon: '✖', text: 'DESCARTAR' },
        neutral: { icon: '◎', text: 'ESPERAR' },
      };
      const badge = scoreMap[entry.type] || { icon: '—', text: '—' };
      iconEl.textContent  = badge.icon;
      valueEl.textContent = badge.text;

      // Fade in
      msgEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      msgEl.style.opacity    = '1';
      msgEl.style.transform  = 'translateY(0)';
    }, 220);
  }

  /** Refreshes the message queue and advances to next message. Called on timer. */
  function rotateTicker() {
    _tickerMessages = buildDiagnosticMessages();
    if (_tickerMessages.length === 0) return;

    // Prioritize: always start with valid > warning > invalid > neutral if present
    // Sort: valid first, then warning, then invalid, then neutral
    const order = { valid: 0, warning: 1, invalid: 2, neutral: 3 };
    _tickerMessages.sort((a, b) => order[a.type] - order[b.type]);

    // Cycle through messages: first call always index 0, then advance
    if (!_tickerInitialized) {
      _tickerIndex = 0;
      _tickerInitialized = true;
    } else {
      _tickerIndex = (_tickerIndex + 1) % _tickerMessages.length;
    }

    applyTickerEntry(_tickerMessages[_tickerIndex]);
  }

  /** Starts the ticker rotation engine. Called once on init. */
  function initDiagnosticTicker() {
    // Initial placeholder render
    applyTickerEntry({
      type: 'neutral', category: 'SISTEMA',
      icon: '◎',
      message: '⚙ Cargando datos de mercado — conectando con Binance en tiempo real...',
      score: 0
    });

    // Refresh every 9 seconds
    _tickerTimer = setInterval(rotateTicker, 10000);
  }

  // Bootstrap ticker on load
  initDiagnosticTicker();



  // ===== 💰 MONEY SOUND — Web Audio API (no external files needed) =====
  function playMoneySound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // Resume context if it was suspended (browser autoplay policy)
      if (ctx.state === 'suspended') ctx.resume();

      // Helper: play a single metallic "ding" tone
      function playDing(startTime, freq, duration, gainVal) {
        const osc      = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const dist     = ctx.createWaveShaper();

        // Slight overdrive for metallic warmth
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i * 2) / 256 - 1;
          curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x));
        }
        dist.curve = curve;

        osc.connect(dist);
        dist.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        // Quick attack, slow exponential decay — like a coin hitting metal
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(gainVal, startTime + 0.008);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      }

      // Helper: short noise burst (coin rattle)
      function playRattle(startTime, duration, gainVal) {
        const bufSize = Math.floor(ctx.sampleRate * duration);
        const buf     = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data    = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
        }
        const src       = ctx.createBufferSource();
        const gainNode  = ctx.createGain();
        const filter    = ctx.createBiquadFilter();
        filter.type     = 'bandpass';
        filter.frequency.value = 4000;
        filter.Q.value  = 0.8;
        src.buffer      = buf;
        src.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        gainNode.gain.setValueAtTime(gainVal, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        src.start(startTime);
      }

      const t = ctx.currentTime + 0.05; // slight offset to avoid click

      // Sequence: 3 ascending coin dings + rattle — classic "cha-ching" 💰
      playDing(t,        1047, 0.55, 0.35); // Do5
      playRattle(t,      0.08, 0.12);
      playDing(t + 0.13, 1319, 0.55, 0.30); // Mi5
      playRattle(t+0.13, 0.08, 0.10);
      playDing(t + 0.26, 1568, 0.80, 0.55); // Sol5 — the big one 💰
      playRattle(t+0.26, 0.12, 0.18);
      // Final sparkle: high harmonic
      playDing(t + 0.38, 2093, 0.50, 0.20); // Do6

    } catch (e) {
      console.warn('Signal audio unavailable:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
