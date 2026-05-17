// SMC Analysis Engine - Client-side
// Runs all Smart Money Concepts analysis in the browser

const SMC = (function () {
  'use strict';

  // ===== STRUCTURE =====
  function findSwingPoints(candles, lookback = 5) {
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
        if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
      }
      if (isHigh) swingHighs.push({ index: i, price: candles[i].high, time: candles[i].time });
      if (isLow) swingLows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
    return { swingHighs, swingLows };
  }

  function analyzeStructure(candles) {
    const { swingHighs, swingLows } = findSwingPoints(candles);
    const bos = [], choch = [];
    let currentTrend = 'neutral';

    const allSwings = [];
    swingHighs.forEach(sh => allSwings.push({ ...sh, type: 'high' }));
    swingLows.forEach(sl => allSwings.push({ ...sl, type: 'low' }));
    allSwings.sort((a, b) => a.index - b.index);

    for (let i = 2; i < allSwings.length; i++) {
      const curr = allSwings[i];

      if (curr.type === 'high') {
        const prevHigh = allSwings.slice(0, i).filter(s => s.type === 'high').pop();
        if (prevHigh && curr.price > prevHigh.price) {
          if (currentTrend === 'bearish') {
            choch.push({ type: 'choch_bullish', time: candles[curr.index].time, price: curr.price, index: curr.index });
            currentTrend = 'bullish';
          } else {
            bos.push({ type: 'bos_bullish', time: candles[curr.index].time, price: curr.price, index: curr.index });
            if (currentTrend === 'neutral') currentTrend = 'bullish';
          }
        }
      }

      if (curr.type === 'low') {
        const prevLow = allSwings.slice(0, i).filter(s => s.type === 'low').pop();
        if (prevLow && curr.price < prevLow.price) {
          if (currentTrend === 'bullish') {
            choch.push({ type: 'choch_bearish', time: candles[curr.index].time, price: curr.price, index: curr.index });
            currentTrend = 'bearish';
          } else {
            bos.push({ type: 'bos_bearish', time: candles[curr.index].time, price: curr.price, index: curr.index });
            if (currentTrend === 'neutral') currentTrend = 'bearish';
          }
        }
      }
    }

    let trend = 'neutral';
    if (bos.length > 0) trend = bos[bos.length - 1].type.includes('bullish') ? 'bullish' : 'bearish';
    if (choch.length > 0) {
      const lastChoch = choch[choch.length - 1];
      const lastBos = bos.length > 0 ? bos[bos.length - 1] : null;
      if (!lastBos || lastChoch.index > lastBos.index) {
        trend = lastChoch.type.includes('bullish') ? 'bullish' : 'bearish';
      }
    }

    return { swingHighs, swingLows, bos, choch, trend, currentTrend };
  }

  // ===== ORDER BLOCKS =====
  function detectOrderBlocks(candles, structure) {
    const orderBlocks = [];
    const breakPoints = [...structure.bos, ...structure.choch].sort((a, b) => a.index - b.index);

    for (const bp of breakPoints) {
      const isBullish = bp.type.includes('bullish');
      if (isBullish) {
        for (let i = bp.index - 1; i >= Math.max(0, bp.index - 10); i--) {
          if (candles[i].close < candles[i].open) {
            const moveSize = Math.abs(candles[bp.index].close - candles[i].low);
            const avgRange = getAvgRange(candles, i, 20);
            if (moveSize > avgRange * 1.5) {
              const mitigated = isMitigated(candles, i, 'bullish');
              if (!mitigated) {
                orderBlocks.push({
                  type: 'ob_bullish', startTime: candles[i].time, top: candles[i].close,  // ICT: body (close of bearish candle)
                  bottom: candles[i].low, index: i, strength: moveSize > avgRange * 3 ? 'strong' : moveSize > avgRange * 2 ? 'moderate' : 'weak'
                });
              }
              break;
            }
          }
        }
      } else {
        for (let i = bp.index - 1; i >= Math.max(0, bp.index - 10); i--) {
          if (candles[i].close > candles[i].open) {
            const moveSize = Math.abs(candles[i].high - candles[bp.index].close);
            const avgRange = getAvgRange(candles, i, 20);
            if (moveSize > avgRange * 1.5) {
              const mitigated = isMitigated(candles, i, 'bearish');
              if (!mitigated) {
                orderBlocks.push({
                  type: 'ob_bearish', startTime: candles[i].time, top: candles[i].high,
                  bottom: candles[i].close, index: i, strength: moveSize > avgRange * 3 ? 'strong' : moveSize > avgRange * 2 ? 'moderate' : 'weak'
                });
              }
              break;
            }
          }
        }
      }
    }
    return orderBlocks;
  }

  function isMitigated(candles, idx, type) {
    for (let i = idx + 2; i < candles.length; i++) {
      if (type === 'bullish' && candles[i].close < candles[idx].low) return true;
      if (type === 'bearish' && candles[i].close > candles[idx].high) return true;
    }
    return false;
  }

  // ===== FVG =====
  function detectFVG(candles) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2], c3 = candles[i];
      const avgRange = getAvgRange(candles, i, 20);

      if (c3.low > c1.high && (c3.low - c1.high) > avgRange * 0.3) {
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) { if (candles[j].low <= c1.high) { filled = true; break; } }
        if (!filled) fvgs.push({ type: 'fvg_bullish', startTime: c1.time, endTime: c3.time, top: c3.low, bottom: c1.high, index: i - 1 });
      }

      if (c3.high < c1.low && (c1.low - c3.high) > avgRange * 0.3) {
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) { if (candles[j].high >= c1.low) { filled = true; break; } }
        if (!filled) fvgs.push({ type: 'fvg_bearish', startTime: c1.time, endTime: c3.time, top: c1.low, bottom: c3.high, index: i - 1 });
      }
    }
    return fvgs;
  }

  // ===== LIQUIDITY =====
  function detectLiquidity(candles, structure) {
    const zones = [];
    const { swingHighs, swingLows } = structure;
    const tolerance = getAvgRange(candles.slice(-50), 25, 25) * 0.3;

    for (let i = 0; i < swingHighs.length - 1; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        if (Math.abs(swingHighs[i].price - swingHighs[j].price) < tolerance) {
          const avg = (swingHighs[i].price + swingHighs[j].price) / 2;
          let swept = false;
          for (let k = swingHighs[j].index + 1; k < candles.length; k++) { if (candles[k].high > avg) { swept = true; break; } }
          if (!swept) zones.push({ type: 'equal_highs', price: avg, time: candles[swingHighs[j].index].time });
        }
      }
    }

    for (let i = 0; i < swingLows.length - 1; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        if (Math.abs(swingLows[i].price - swingLows[j].price) < tolerance) {
          const avg = (swingLows[i].price + swingLows[j].price) / 2;
          let swept = false;
          for (let k = swingLows[j].index + 1; k < candles.length; k++) { if (candles[k].low < avg) { swept = true; break; } }
          if (!swept) zones.push({ type: 'equal_lows', price: avg, time: candles[swingLows[j].index].time });
        }
      }
    }

    const recentHighs = swingHighs.slice(-8);
    for (const sh of recentHighs) {
      let swept = false;
      for (let k = sh.index + 1; k < candles.length; k++) { if (candles[k].high > sh.price) { swept = true; break; } }
      if (!swept) zones.push({ type: 'swing_high_liq', price: sh.price, time: candles[sh.index].time });
    }

    const recentLows = swingLows.slice(-8);
    for (const sl of recentLows) {
      let swept = false;
      for (let k = sl.index + 1; k < candles.length; k++) { if (candles[k].low < sl.price) { swept = true; break; } }
      if (!swept) zones.push({ type: 'swing_low_liq', price: sl.price, time: candles[sl.index].time });
    }

    // Deduplicate
    const unique = [];
    for (const z of zones) {
      if (!unique.find(u => Math.abs(u.price - z.price) < tolerance && u.type === z.type)) unique.push(z);
    }
    return unique;
  }

  // ===== PREMIUM / DISCOUNT =====
  function calculatePremiumDiscount(candles, structure) {
    const { swingHighs, swingLows } = structure;
    if (swingHighs.length === 0 || swingLows.length === 0) return null;

    const rangeHigh = Math.max(...swingHighs.slice(-5).map(h => h.price));
    const rangeLow = Math.min(...swingLows.slice(-5).map(l => l.price));
    const equilibrium = (rangeHigh + rangeLow) / 2;
    const currentPrice = candles[candles.length - 1].close;
    const position = currentPrice > equilibrium ? 'premium' : currentPrice < equilibrium ? 'discount' : 'equilibrium';

    return { rangeHigh, rangeLow, equilibrium, position, currentPrice };
  }

  // ===== SIGNALS (ICT Enhanced) =====
  // Config
  var SIGNAL_CONFIG = { MIN_RR: 2.5, STRICT_KZ: true, MIN_CONF: 3 };

  function generateSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend) {
    const signals = [];

    // Use penultimate candle (closed), not the forming one — change #7
    const signalCandle = candles.length >= 2 ? candles[candles.length - 2] : candles[candles.length - 1];
    const currentPrice = signalCandle.close;
    const currentCandle = signalCandle;

    // ICT Killzone check (NY time) — change #2
    const ictKZ = getICTKZInternal();
    const inKillzone = ictKZ.isActive;
    if (SIGNAL_CONFIG.STRICT_KZ && !inKillzone) return [];

    const proximityThreshold = currentPrice * 0.003;

    // HTF alignment — change #4
    const htfAligned = htfTrend !== 'neutral';
    const htfOkLong = htfAligned && htfTrend === 'bullish';
    const htfOkShort = htfAligned && htfTrend === 'bearish';

    // LONG signals
    for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(currentPrice - ob.top) <= proximityThreshold || Math.abs(ob.bottom - currentPrice) <= proximityThreshold;
      if (isInside || isNear) {
        const sl = ob.bottom - (ob.top - ob.bottom) * 0.1;
        const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        const conf = hardConfluences('long', ob, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
        if (rr >= SIGNAL_CONFIG.MIN_RR && conf.count >= SIGNAL_CONFIG.MIN_CONF) {
          signals.push(makeSignal('long', currentPrice, sl, tp, rr, currentCandle, conf, htfTrend, htfAligned, inKillzone, 'OB alcista ICT', ob));
        }
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
      const isInside = currentPrice >= fvg.bottom && currentPrice <= fvg.top;
      const isNear = (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);
      if (isInside || isNear) {
        const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.3;
        const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        const conf = hardConfluences('long', null, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
        if (rr >= SIGNAL_CONFIG.MIN_RR && conf.count >= SIGNAL_CONFIG.MIN_CONF) {
          signals.push(makeSignal('long', currentPrice, sl, tp, rr, currentCandle, conf, htfTrend, htfAligned, inKillzone, 'FVG alcista', fvg));
        }
      }
    }

    // SHORT signals
    for (const ob of obs.filter(o => o.type === 'ob_bearish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(ob.bottom - currentPrice) <= proximityThreshold || Math.abs(currentPrice - ob.top) <= proximityThreshold;
      if (isInside || isNear) {
        const sl = ob.top + (ob.top - ob.bottom) * 0.1;
        const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        const conf = hardConfluences('short', ob, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
        if (rr >= SIGNAL_CONFIG.MIN_RR && conf.count >= SIGNAL_CONFIG.MIN_CONF) {
          signals.push(makeSignal('short', currentPrice, sl, tp, rr, currentCandle, conf, htfTrend, htfAligned, inKillzone, 'OB bajista ICT', ob));
        }
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish')) {
      const isInside = currentPrice >= fvg.bottom && currentPrice <= fvg.top;
      const isNear = (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);
      if (isInside || isNear) {
        const sl = fvg.top + (fvg.top - fvg.bottom) * 0.3;
        const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        const conf = hardConfluences('short', null, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
        if (rr >= SIGNAL_CONFIG.MIN_RR && conf.count >= SIGNAL_CONFIG.MIN_CONF) {
          signals.push(makeSignal('short', currentPrice, sl, tp, rr, currentCandle, conf, htfTrend, htfAligned, inKillzone, 'FVG bajista', fvg));
        }
      }
    }

    return dedup(signals);
  }

  // Hard confluence check — change #5 (min 3 of 7)
  function hardConfluences(dir, ob, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure) {
    const list = []; let count = 0;
    // a) HTF aligned
    if (htfAligned && ((dir === 'long' && htfTrend === 'bullish') || (dir === 'short' && htfTrend === 'bearish'))) { count++; list.push('HTF alineado'); }
    // b) P/D zone
    if (pd) { if (dir === 'long' && pd.position === 'discount') { count++; list.push('Zona descuento'); } if (dir === 'short' && pd.position === 'premium') { count++; list.push('Zona premium'); } }
    // c) OB
    if (ob) { count++; list.push('OB ' + (ob.strength || '')); }
    // d) FVG
    if (fvg) { count++; list.push('FVG'); }
    // e) Liquidity swept
    const swept = checkLiquiditySwept(dir, liquidity, candles);
    if (swept) { count++; list.push('Liquidez barrida'); }
    // f) Killzone
    if (inKillzone) { count++; list.push('⚡ Killzone'); }
    // g) CHoCH in TF
    const recentChoch = (structure.choch || []).filter(c => c.index > candles.length - 10);
    if (recentChoch.some(c => dir === 'long' ? c.type.includes('bullish') : c.type.includes('bearish'))) { count++; list.push('CHoCH confirmado'); }
    return { count, list };
  }

  // Build signal with backtesting metadata — change #8
  function makeSignal(type, entry, sl, tp, rr, candle, conf, htfTrend, htfAligned, inKillzone, trigger, zone) {
    const zoneStr = zone ? ' (' + zone.bottom.toFixed(0) + '-' + zone.top.toFixed(0) + ')' : '';
    const confidence = getICTConf(htfTrend, htfAligned, type, conf.count, inKillzone);
    return {
      type, entry, sl, tp, rr: rr.toFixed(2), confidence,
      time: candle.time,
      confluences: conf.list,
      reason: (type === 'long' ? '↑ Long' : '↓ Short') + ': ' + trigger + zoneStr + '. HTF: ' + htfTrend + '. Confluencias (' + conf.count + '): ' + conf.list.join(' • ') + '. ⚠ Esperar cierre de vela.',
      meta: { confluences_count: conf.count, killzone_active: inKillzone, htf_aligned: htfAligned, rr_at_signal: rr.toFixed(2), trigger }
    };
  }

  // HTF mandatory for medium/high — change #4
  function getICTConf(htfTrend, htfAligned, dir, count, inKillzone) {
    const htfOk = htfAligned && ((dir === 'long' && htfTrend === 'bullish') || (dir === 'short' && htfTrend === 'bearish'));
    if (!htfOk) return 'low';
    if (count >= 5 && inKillzone) return 'high';
    if (count >= 4) return 'medium';
    return 'low';
  }

  // ICT Killzone (NY time) — change #2
  function getICTKZInternal() {
    try {
      const nyStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      const ny = new Date(nyStr);
      const t = ny.getHours() + ny.getMinutes() / 60;
      if (t >= 2 && t < 5) return { isActive: true, label: 'London Open KZ' };
      if (t >= 8.5 && t < 11) return { isActive: true, label: 'NY Open KZ' };
      return { isActive: false, label: null };
    } catch(e) { return { isActive: false, label: null }; }
  }

  // Find target — change #6: use 2nd target for better RR
  function findTarget(price, dir, fvgs, liquidity, pd) {
    let targets = [];
    if (dir === 'long') {
      fvgs.filter(f => f.type === 'fvg_bearish' && f.bottom > price).forEach(f => targets.push(f.bottom));
      liquidity.filter(l => l.type.includes('high') && l.price > price).forEach(l => targets.push(l.price));
      if (pd && pd.rangeHigh > price) targets.push(pd.rangeHigh);
      targets.push(price * 1.015); targets.push(price * 1.03);
    } else {
      fvgs.filter(f => f.type === 'fvg_bullish' && f.top < price).forEach(f => targets.push(f.top));
      liquidity.filter(l => l.type.includes('low') && l.price < price).forEach(l => targets.push(l.price));
      if (pd && pd.rangeLow < price) targets.push(pd.rangeLow);
      targets.push(price * 0.985); targets.push(price * 0.97);
    }
    targets.sort((a, b) => dir === 'long' ? a - b : b - a);
    const min = price * 0.003;
    const valid = targets.filter(t => Math.abs(t - price) >= min);
    // Use 2nd target if available — change #6
    if (valid.length >= 2) return valid[1];
    if (valid.length === 1) return valid[0];
    return dir === 'long' ? price * 1.025 : price * 0.975;
  }

  function calcRR(entry, sl, tp) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    return risk > 0 ? reward / risk : 0;
  }

  function checkLiquiditySwept(dir, liquidity, candles) {
    const recent = candles.slice(-10);
    if (dir === 'long') {
      for (const liq of liquidity.filter(l => l.type.includes('low'))) {
        for (const c of recent) { if (c.low < liq.price && c.close > liq.price) return true; }
      }
    } else {
      for (const liq of liquidity.filter(l => l.type.includes('high'))) {
        for (const c of recent) { if (c.high > liq.price && c.close < liq.price) return true; }
      }
    }
    return false;
  }

  function findSwingLow(candles, n) { let low = candles[candles.length - 1].low; for (let i = candles.length - n; i < candles.length; i++) { if (candles[i].low < low) low = candles[i].low; } return low; }
  function findSwingHigh(candles, n) { let high = candles[candles.length - 1].high; for (let i = candles.length - n; i < candles.length; i++) { if (candles[i].high > high) high = candles[i].high; } return high; }

  function dedup(signals) {
    const unique = []; const order = { high: 3, medium: 2, low: 1 };
    for (const s of signals) {
      const ex = unique.find(u => u.type === s.type && Math.abs(u.entry - s.entry) < s.entry * 0.001);
      if (!ex) unique.push(s); else if ((order[s.confidence] || 0) > (order[ex.confidence] || 0)) unique[unique.indexOf(ex)] = s;
    }
    return unique.sort((a, b) => (order[b.confidence] || 0) - (order[a.confidence] || 0));
  }

    // ===== VOLUME =====
  function analyzeVolume(candles) {
    const recent = candles.slice(-50);
    const avg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
    const curr = candles[candles.length - 1].volume;
    const rel = avg > 0 ? curr / avg : 1;
    const last10 = candles.slice(-10);
    let buy = 0, sell = 0;
    for (const c of last10) {
      const r = c.high - c.low; if (r === 0) continue;
      buy += c.volume * ((c.close - c.low) / r);
      sell += c.volume * ((c.high - c.close) / r);
    }
    const total = buy + sell;
    return {
      relativeVolume: rel.toFixed(2), isHighVolume: rel > 1.5,
      label: rel >= 3 ? 'Extremo' : rel >= 2 ? 'Muy Alto' : rel >= 1.5 ? 'Alto' : rel >= 0.8 ? 'Normal' : 'Bajo',
      volumeTrend: getVolTrend(candles.slice(-20)),
      pressure: { buyPercent: (total > 0 ? (buy / total * 100) : 50).toFixed(1), sellPercent: (total > 0 ? (sell / total * 100) : 50).toFixed(1) }
    };
  }

  function getVolTrend(candles) {
    const h1 = candles.slice(0, 10), h2 = candles.slice(10);
    const a1 = h1.reduce((s, c) => s + c.volume, 0) / h1.length;
    const a2 = h2.reduce((s, c) => s + c.volume, 0) / h2.length;
    const r = a1 > 0 ? a2 / a1 : 1;
    return r > 1.3 ? 'increasing' : r < 0.7 ? 'decreasing' : 'stable';
  }

  // ===== SESSIONS =====
  function getCurrentSession() {
    const h = new Date().getUTCHours();
    const sessions = [];
    if (h >= 0 && h < 8) sessions.push('Asia');
    if (h >= 7 && h < 16) sessions.push('Londres');
    if (h >= 12 && h < 21) sessions.push('New York');

    let kz = null, isKZ = false;
    if (h >= 2 && h < 5) { kz = 'London Open KZ'; isKZ = true; }
    else if (h >= 7 && h < 10) { kz = 'NY Open KZ'; isKZ = true; }
    else if (h >= 10 && h < 12) { kz = 'London Close KZ'; isKZ = true; }

    return {
      sessionLabel: sessions.join(' / ') || 'Off-hours',
      killzoneLabel: kz || 'Ninguna',
      isKillzoneActive: isKZ
    };
  }

  // ===== HELPERS =====
  function getAvgRange(candles, end, period) {
    const start = Math.max(0, end - period);
    let sum = 0, count = 0;
    for (let i = start; i < Math.min(end, candles.length); i++) { sum += candles[i].high - candles[i].low; count++; }
    return count > 0 ? sum / count : 1;
  }

  // ===== REFINED ENTRY =====
  // Takes a signal from 15m and refines it using lower timeframe (5m/1m)
  // Looks for CHoCH in the LTF within the signal zone for precise entry
  function refineEntry(signal, ltfCandles) {
    if (!ltfCandles || ltfCandles.length < 30) return null;

    const zone = { top: Math.max(signal.entry, signal.sl) + Math.abs(signal.entry - signal.sl) * 0.5, bottom: Math.min(signal.entry, signal.sl) };

    // Find candles within or near the zone (last 30 candles of LTF)
    const recent = ltfCandles.slice(-30);
    const structure = analyzeStructure(ltfCandles.slice(-100));

    // Look for CHoCH in the direction of the trade
    const targetChoch = signal.type === 'long' ? 'choch_bullish' : 'choch_bearish';
    const targetBos = signal.type === 'long' ? 'bos_bullish' : 'bos_bearish';

    // Find the most recent CHoCH or BOS in our direction within the zone
    let entryConfirmation = null;

    // Check CHoCH first (stronger signal)
    for (let i = structure.choch.length - 1; i >= Math.max(0, structure.choch.length - 5); i--) {
      const ch = structure.choch[i];
      if (ch.type === targetChoch) {
        const chPrice = ch.price;
        // Verify it happened near our zone
        const distToEntry = Math.abs(chPrice - signal.entry) / signal.entry;
        if (distToEntry < 0.005) { // Within 0.5% of original entry
          entryConfirmation = { type: 'choch', price: chPrice, time: ch.time, index: ch.index };
          break;
        }
      }
    }

    // If no CHoCH, check BOS
    if (!entryConfirmation) {
      for (let i = structure.bos.length - 1; i >= Math.max(0, structure.bos.length - 5); i--) {
        const b = structure.bos[i];
        if (b.type === targetBos) {
          const bPrice = b.price;
          const distToEntry = Math.abs(bPrice - signal.entry) / signal.entry;
          if (distToEntry < 0.005) {
            entryConfirmation = { type: 'bos', price: bPrice, time: b.time, index: b.index };
            break;
          }
        }
      }
    }

    if (!entryConfirmation) return null;

    // Calculate refined SL: just below/above the LTF swing that created the CHoCH
    let refinedSL;
    if (signal.type === 'long') {
      // SL below the swing low that preceded the CHoCH
      let swingLow = recent[0].low;
      const lookStart = Math.max(0, entryConfirmation.index - 10);
      for (let i = lookStart; i <= entryConfirmation.index && i < ltfCandles.length; i++) {
        if (ltfCandles[i].low < swingLow) swingLow = ltfCandles[i].low;
      }
      refinedSL = swingLow - (signal.entry - swingLow) * 0.1; // Small buffer
    } else {
      // SL above the swing high that preceded the CHoCH
      let swingHigh = recent[0].high;
      const lookStart = Math.max(0, entryConfirmation.index - 10);
      for (let i = lookStart; i <= entryConfirmation.index && i < ltfCandles.length; i++) {
        if (ltfCandles[i].high > swingHigh) swingHigh = ltfCandles[i].high;
      }
      refinedSL = swingHigh + (swingHigh - signal.entry) * 0.1;
    }

    // Keep the same TP from the higher timeframe
    const refinedEntry = ltfCandles[ltfCandles.length - 1].close;
    const refinedRR = calcRR(refinedEntry, refinedSL, signal.tp);

    // Only return if the refined entry actually improves R:R
    if (refinedRR <= parseFloat(signal.rr)) return null;

    return {
      type: signal.type,
      entry: refinedEntry,
      sl: refinedSL,
      tp: signal.tp,
      rr: refinedRR.toFixed(2),
      originalEntry: signal.entry,
      originalSL: signal.sl,
      originalRR: signal.rr,
      confirmation: entryConfirmation,
      improvement: {
        slReduction: Math.abs(Math.abs(signal.entry - signal.sl) - Math.abs(refinedEntry - refinedSL)).toFixed(2),
        slReductionPercent: ((1 - Math.abs(refinedEntry - refinedSL) / Math.abs(signal.entry - signal.sl)) * 100).toFixed(1),
        rrImprovement: (refinedRR - parseFloat(signal.rr)).toFixed(2)
      },
      reason: `Entrada refinada: ${entryConfirmation.type.toUpperCase()} ${signal.type === 'long' ? 'alcista' : 'bajista'} en LTF. SL reducido ${((1 - Math.abs(refinedEntry - refinedSL) / Math.abs(signal.entry - signal.sl)) * 100).toFixed(0)}%. R:R mejorado de 1:${signal.rr} → 1:${refinedRR.toFixed(2)}.`
    };
  }

  // ===== ICT ENGINE (Fede Esses Style) =====

  // NY Time Engine - converts current time to New York timezone
  function getNYTime() {
    const now = new Date();
    const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const ny = new Date(nyString);
    return { hours: ny.getHours(), minutes: ny.getMinutes(), full: ny };
  }

  // ICT Killzones in NY Time
  function getICTKillzone() {
    const { hours, minutes } = getNYTime();
    const timeDecimal = hours + minutes / 60;

    let killzone = null;
    let isActive = false;

    if (timeDecimal >= 2 && timeDecimal < 5) {
      killzone = 'London Open KZ (02:00-05:00 NY)';
      isActive = true;
    } else if (timeDecimal >= 8.5 && timeDecimal < 11) {
      killzone = 'NY Open KZ (08:30-11:00 NY)';
      isActive = true;
    } else if (timeDecimal >= 10 && timeDecimal < 11) {
      killzone = 'Silver Bullet AM (10:00-11:00 NY)';
      isActive = true;
    }

    return { killzone, isActive, nyHours: hours, nyMinutes: minutes };
  }

  // Midnight Open Price (PO3 - Power of 3)
  function getMidnightOpenPrice(candles) {
    if (!candles || candles.length === 0) return null;

    const { full: nyNow } = getNYTime();
    // Find midnight NY of today
    const midnightNY = new Date(nyNow);
    midnightNY.setHours(0, 0, 0, 0);
    const midnightTimestamp = Math.floor(midnightNY.getTime() / 1000);

    // Find the candle closest to midnight NY
    let closestCandle = null;
    let closestDiff = Infinity;

    for (const c of candles) {
      const diff = Math.abs(c.time - midnightTimestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestCandle = c;
      }
    }

    // Only valid if within 15 minutes of midnight
    if (closestCandle && closestDiff < 900) {
      return closestCandle.open;
    }

    // Fallback: use the first candle of the day
    for (const c of candles) {
      if (c.time >= midnightTimestamp) return c.open;
    }

    return null;
  }

  // Detect Inversion Fair Value Gaps (IFVG)
  // An IFVG occurs when price closes through a FVG with body, inverting its role
  function detectIFVG(candles, fvgs) {
    const ifvgs = [];

    for (const fvg of fvgs) {
      // Check if any recent candle closed through the FVG with body
      for (let i = fvg.index + 3; i < candles.length; i++) {
        const c = candles[i];

        if (fvg.type === 'fvg_bearish') {
          // Bearish FVG becomes bullish IFVG when price closes ABOVE it with body
          if (c.close > fvg.top && c.open < fvg.top) {
            // Now it's an IFVG Bull - acts as support on retest
            const retested = isIFVGRetested(candles, i, fvg.top, fvg.bottom, 'bull');
            ifvgs.push({
              type: 'ifvg_bull',
              top: fvg.top,
              bottom: fvg.bottom,
              inversionIndex: i,
              inversionTime: c.time,
              retested,
              originalType: 'fvg_bearish'
            });
            break;
          }
        }

        if (fvg.type === 'fvg_bullish') {
          // Bullish FVG becomes bearish IFVG when price closes BELOW it with body
          if (c.close < fvg.bottom && c.open > fvg.bottom) {
            const retested = isIFVGRetested(candles, i, fvg.top, fvg.bottom, 'bear');
            ifvgs.push({
              type: 'ifvg_bear',
              top: fvg.top,
              bottom: fvg.bottom,
              inversionIndex: i,
              inversionTime: c.time,
              retested,
              originalType: 'fvg_bullish'
            });
            break;
          }
        }
      }
    }

    return ifvgs;
  }

  function isIFVGRetested(candles, fromIndex, top, bottom, type) {
    for (let i = fromIndex + 1; i < candles.length; i++) {
      if (type === 'bull') {
        // Price comes back down to the IFVG zone (retest as support)
        if (candles[i].low <= top && candles[i].close > bottom) {
          return { retested: true, index: i, time: candles[i].time };
        }
      } else {
        // Price comes back up to the IFVG zone (retest as resistance)
        if (candles[i].high >= bottom && candles[i].close < top) {
          return { retested: true, index: i, time: candles[i].time };
        }
      }
    }
    return { retested: false };
  }

  // MSS (Market Structure Shift) detection on LTF
  function detectMSS(candles, direction) {
    if (!candles || candles.length < 30) return false;

    const structure = analyzeStructure(candles.slice(-50));

    if (direction === 'long') {
      // Need a bullish CHoCH or BOS in last 10 candles
      const recentBullish = [...structure.choch, ...structure.bos]
        .filter(b => b.type.includes('bullish') && b.index > candles.length - 15);
      return recentBullish.length > 0;
    } else {
      const recentBearish = [...structure.choch, ...structure.bos]
        .filter(b => b.type.includes('bearish') && b.index > candles.length - 15);
      return recentBearish.length > 0;
    }
  }

  // ICT Signal Filter - wraps existing generateSignals with ICT conditions
  function generateICTSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend, ltfCandles) {
    const ictKZ = getICTKillzone();

    // If outside killzone, return empty with status message
    if (!ictKZ.isActive) {
      return { signals: [], outsideKZ: true, killzoneStatus: 'Fuera de horario operativo (Esperando Killzone)', nextKZ: getNextKillzone() };
    }

    // Get base signals from existing logic
    const baseSignals = generateSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend);

    // Detect IFVGs
    const allFVGs = detectFVG(candles);
    const ifvgs = detectIFVG(candles, allFVGs);

    // Get Midnight Open Price for PO3
    const midnightOpen = getMidnightOpenPrice(candles);
    const currentPrice = candles[candles.length - 1].close;

    // Determine daily bias from PO3
    let dailyBias = 'neutral';
    if (midnightOpen) {
      if (htfTrend === 'bullish' && currentPrice < midnightOpen) dailyBias = 'long_accumulation';
      else if (htfTrend === 'bearish' && currentPrice > midnightOpen) dailyBias = 'short_distribution';
      else if (currentPrice > midnightOpen) dailyBias = 'above_midnight';
      else dailyBias = 'below_midnight';
    }

    // Filter and enhance signals with ICT conditions
    const ictSignals = [];

    for (const signal of baseSignals) {
      let ictScore = 0;
      const ictDetails = [...(signal.confluences || [])];

      // ICT Killzone bonus
      ictScore += 1;
      ictDetails.push(`⏰ ${ictKZ.killzone}`);

      // PO3 alignment
      if (signal.type === 'long' && (dailyBias === 'long_accumulation' || dailyBias === 'below_midnight')) {
        ictScore += 1;
        ictDetails.push('PO3: Bajo Midnight Open (Acumulación)');
      } else if (signal.type === 'short' && (dailyBias === 'short_distribution' || dailyBias === 'above_midnight')) {
        ictScore += 1;
        ictDetails.push('PO3: Sobre Midnight Open (Distribución)');
      }

      // IFVG check
      const relevantIFVG = ifvgs.find(ifvg => {
        if (signal.type === 'long' && ifvg.type === 'ifvg_bull') {
          return currentPrice >= ifvg.bottom && currentPrice <= ifvg.top * 1.002;
        }
        if (signal.type === 'short' && ifvg.type === 'ifvg_bear') {
          return currentPrice <= ifvg.top && currentPrice >= ifvg.bottom * 0.998;
        }
        return false;
      });

      if (relevantIFVG) {
        ictScore += 2;
        ictDetails.push('IFVG presente (Inversión confirmada)');
      }

      // MSS on LTF
      if (ltfCandles && ltfCandles.length > 30) {
        const hasMSS = detectMSS(ltfCandles, signal.type);
        if (hasMSS) {
          ictScore += 1;
          ictDetails.push('MSS confirmado en LTF');
        }
      }

      // Only pass signals with enough ICT confluence
      const totalScore = (parseInt(signal.rr) >= 2 ? 1 : 0) + ictScore;

      if (totalScore >= 2) {
        ictSignals.push({
          ...signal,
          ictScore,
          confluences: ictDetails,
          confidence: ictScore >= 4 ? 'high' : ictScore >= 2 ? 'medium' : 'low',
          midnightOpen,
          dailyBias,
          hasIFVG: !!relevantIFVG,
          reason: buildICTReason(signal, ictDetails, ictKZ, dailyBias, midnightOpen, relevantIFVG)
        });
      }
    }

    // Also generate IFVG-specific signals (retest entries)
    for (const ifvg of ifvgs) {
      if (ifvg.retested && ifvg.retested.retested) {
        const isRecent = ifvg.retested.index > candles.length - 5;
        if (!isRecent) continue;

        if (ifvg.type === 'ifvg_bull' && currentPrice >= ifvg.bottom && currentPrice <= ifvg.top * 1.003) {
          const sl = ifvg.bottom - (ifvg.top - ifvg.bottom) * 0.5;
          const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) {
            ictSignals.push({
              type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2),
              confidence: 'high', time: candles[candles.length - 1].time,
              ictScore: 5, hasIFVG: true, midnightOpen, dailyBias,
              confluences: ['IFVG Bull Retest', `⏰ ${ictKZ.killzone}`, 'Inversión confirmada'],
              reason: `Long: IFVG Bull en retest (${ifvg.bottom.toFixed(0)}-${ifvg.top.toFixed(0)}). FVG bajista invertido a soporte. ${ictKZ.killzone}. PO3 bias: ${dailyBias}.`
            });
          }
        }

        if (ifvg.type === 'ifvg_bear' && currentPrice <= ifvg.top && currentPrice >= ifvg.bottom * 0.997) {
          const sl = ifvg.top + (ifvg.top - ifvg.bottom) * 0.5;
          const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) {
            ictSignals.push({
              type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2),
              confidence: 'high', time: candles[candles.length - 1].time,
              ictScore: 5, hasIFVG: true, midnightOpen, dailyBias,
              confluences: ['IFVG Bear Retest', `⏰ ${ictKZ.killzone}`, 'Inversión confirmada'],
              reason: `Short: IFVG Bear en retest (${ifvg.bottom.toFixed(0)}-${ifvg.top.toFixed(0)}). FVG alcista invertido a resistencia. ${ictKZ.killzone}. PO3 bias: ${dailyBias}.`
            });
          }
        }
      }
    }

    return { signals: dedup(ictSignals), outsideKZ: false, killzoneStatus: ictKZ.killzone, midnightOpen, dailyBias };
  }

  function buildICTReason(signal, details, ictKZ, dailyBias, midnightOpen, ifvg) {
    let reason = signal.reason || '';
    reason += ` | ICT: ${details.join(' • ')}`;
    if (midnightOpen) reason += ` | MO: ${midnightOpen.toFixed(0)}`;
    return reason;
  }

  function getNextKillzone() {
    const { hours, minutes } = getNYTime();
    const t = hours + minutes / 60;
    if (t < 2) return 'London Open en ' + Math.floor((2 - t) * 60) + 'min';
    if (t >= 5 && t < 8.5) return 'NY Open en ' + Math.floor((8.5 - t) * 60) + 'min';
    if (t >= 11) return 'London Open mañana';
    return '';
  }

  // ===== PUBLIC API =====
  return {
    analyzeStructure,
    detectOrderBlocks,
    detectFVG,
    detectLiquidity,
    calculatePremiumDiscount,
    generateSignals,
    generateICTSignals,
    detectIFVG,
    getICTKillzone,
    getMidnightOpenPrice,
    analyzeVolume,
    getCurrentSession,
    refineEntry
  };
})();
