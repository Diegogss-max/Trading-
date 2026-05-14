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
                  type: 'ob_bullish', startTime: candles[i].time, top: candles[i].open,
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

  // ===== SIGNALS =====
  function generateSignals(candles, structure, obs, fvgs, liquidity, pd, htfTrend) {
    const signals = [];
    const currentPrice = candles[candles.length - 1].close;
    const currentCandle = candles[candles.length - 1];
    const proximityThreshold = currentPrice * 0.003;

    // LONG signals
    for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(currentPrice - ob.top) <= proximityThreshold || Math.abs(ob.bottom - currentPrice) <= proximityThreshold;
      if (isInside || isNear) {
        const sl = ob.bottom - (ob.top - ob.bottom) * 0.3;
        const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: getConf(ob, pd, htfTrend, 'long'), reason: `Long: OB alcista (${ob.bottom.toFixed(0)}-${ob.top.toFixed(0)}). HTF: ${htfTrend}. Zona: ${pd ? pd.position : 'N/A'}.`, time: currentCandle.time });
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
      const isNear = (currentPrice >= fvg.bottom && currentPrice <= fvg.top) || (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold);
      if (isNear) {
        const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.5;
        const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: getConf(null, pd, htfTrend, 'long'), reason: `Long: FVG alcista (${fvg.bottom.toFixed(0)}-${fvg.top.toFixed(0)}). HTF: ${htfTrend}. Zona: ${pd ? pd.position : 'N/A'}.`, time: currentCandle.time });
      }
    }

    // SHORT signals
    for (const ob of obs.filter(o => o.type === 'ob_bearish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(ob.bottom - currentPrice) <= proximityThreshold || Math.abs(currentPrice - ob.top) <= proximityThreshold;
      if (isInside || isNear) {
        const sl = ob.top + (ob.top - ob.bottom) * 0.3;
        const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: getConf(ob, pd, htfTrend, 'short'), reason: `Short: OB bajista (${ob.bottom.toFixed(0)}-${ob.top.toFixed(0)}). HTF: ${htfTrend}. Zona: ${pd ? pd.position : 'N/A'}.`, time: currentCandle.time });
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish')) {
      const isNear = (currentPrice >= fvg.bottom && currentPrice <= fvg.top) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);
      if (isNear) {
        const sl = fvg.top + (fvg.top - fvg.bottom) * 0.5;
        const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: getConf(null, pd, htfTrend, 'short'), reason: `Short: FVG bajista (${fvg.bottom.toFixed(0)}-${fvg.top.toFixed(0)}). HTF: ${htfTrend}. Zona: ${pd ? pd.position : 'N/A'}.`, time: currentCandle.time });
      }
    }

    // BOS/CHoCH signals
    const lastBreak = [...structure.bos, ...structure.choch].sort((a, b) => b.index - a.index)[0];
    if (lastBreak && lastBreak.index > candles.length - 15) {
      if (lastBreak.type.includes('bullish') && pd && pd.position === 'discount') {
        const sl = findSwingLow(candles, 10) - currentPrice * 0.001;
        const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: 'medium', reason: `Long: BOS/CHoCH alcista reciente en zona descuento. HTF: ${htfTrend}.`, time: currentCandle.time });
      }
      if (lastBreak.type.includes('bearish') && pd && pd.position === 'premium') {
        const sl = findSwingHigh(candles, 10) + currentPrice * 0.001;
        const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calcRR(currentPrice, sl, tp);
        if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: 'medium', reason: `Short: BOS/CHoCH bajista reciente en zona premium. HTF: ${htfTrend}.`, time: currentCandle.time });
      }
    }

    return dedup(signals);
  }

  function findTarget(price, dir, fvgs, liquidity, pd) {
    let targets = [];
    if (dir === 'long') {
      fvgs.filter(f => f.type === 'fvg_bearish' && f.bottom > price).forEach(f => targets.push(f.bottom));
      liquidity.filter(l => l.type.includes('high') && l.price > price).forEach(l => targets.push(l.price));
      if (pd && pd.rangeHigh > price) targets.push(pd.rangeHigh);
      targets.push(price * 1.01);
    } else {
      fvgs.filter(f => f.type === 'fvg_bullish' && f.top < price).forEach(f => targets.push(f.top));
      liquidity.filter(l => l.type.includes('low') && l.price < price).forEach(l => targets.push(l.price));
      if (pd && pd.rangeLow < price) targets.push(pd.rangeLow);
      targets.push(price * 0.99);
    }
    targets.sort((a, b) => dir === 'long' ? a - b : b - a);
    const min = price * 0.003;
    const valid = targets.filter(t => Math.abs(t - price) >= min);
    return valid.length > 0 ? valid[0] : targets[targets.length - 1];
  }

  function calcRR(entry, sl, tp) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    return risk > 0 ? reward / risk : 0;
  }

  function getConf(ob, pd, htfTrend, dir) {
    let s = 0;
    if ((dir === 'long' && htfTrend === 'bullish') || (dir === 'short' && htfTrend === 'bearish')) s += 2;
    if (ob && ob.strength === 'strong') s += 2; else if (ob && ob.strength === 'moderate') s += 1;
    if (pd) { if (dir === 'long' && pd.position === 'discount') s += 2; if (dir === 'short' && pd.position === 'premium') s += 2; }
    return s >= 5 ? 'high' : s >= 3 ? 'medium' : 'low';
  }

  function findSwingLow(candles, n) { let low = candles[candles.length - 1].low; for (let i = candles.length - n; i < candles.length; i++) { if (candles[i].low < low) low = candles[i].low; } return low; }
  function findSwingHigh(candles, n) { let high = candles[candles.length - 1].high; for (let i = candles.length - n; i < candles.length; i++) { if (candles[i].high > high) high = candles[i].high; } return high; }

  function dedup(signals) {
    const unique = [];
    const order = { high: 3, medium: 2, low: 1 };
    for (const s of signals) {
      const ex = unique.find(u => u.type === s.type && Math.abs(u.entry - s.entry) < s.entry * 0.001);
      if (!ex) unique.push(s); else if (order[s.confidence] > order[ex.confidence]) unique[unique.indexOf(ex)] = s;
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

  // ===== PUBLIC API =====
  return {
    analyzeStructure,
    detectOrderBlocks,
    detectFVG,
    detectLiquidity,
    calculatePremiumDiscount,
    generateSignals,
    analyzeVolume,
    getCurrentSession
  };
})();
