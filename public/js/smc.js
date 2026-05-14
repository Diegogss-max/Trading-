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
    const prevCandle = candles[candles.length - 2];
    const proximityThreshold = currentPrice * 0.003;
    const session = getCurrentSession();

    // LONG signals
    for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(currentPrice - ob.top) <= proximityThreshold || Math.abs(ob.bottom - currentPrice) <= proximityThreshold;
      if (isInside || isNear) {
        const confirmation = checkBullishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('long', ob, null, pd, htfTrend, session, liquidity, candles, confirmation);

        if (confluence.score >= 3) {
          const sl = ob.bottom - (ob.top - ob.bottom) * 0.3;
          const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('long', 'OB alcista', ob, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
      const isNear = (currentPrice >= fvg.bottom && currentPrice <= fvg.top) || (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold);
      if (isNear) {
        const confirmation = checkBullishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('long', null, fvg, pd, htfTrend, session, liquidity, candles, confirmation);

        if (confluence.score >= 3) {
          const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.5;
          const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('long', 'FVG alcista', fvg, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
    }

    // SHORT signals
    for (const ob of obs.filter(o => o.type === 'ob_bearish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isNear = Math.abs(ob.bottom - currentPrice) <= proximityThreshold || Math.abs(currentPrice - ob.top) <= proximityThreshold;
      if (isInside || isNear) {
        const confirmation = checkBearishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('short', ob, null, pd, htfTrend, session, liquidity, candles, confirmation);

        if (confluence.score >= 3) {
          const sl = ob.top + (ob.top - ob.bottom) * 0.3;
          const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('short', 'OB bajista', ob, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
    }

    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish')) {
      const isNear = (currentPrice >= fvg.bottom && currentPrice <= fvg.top) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);
      if (isNear) {
        const confirmation = checkBearishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('short', null, fvg, pd, htfTrend, session, liquidity, candles, confirmation);

        if (confluence.score >= 3) {
          const sl = fvg.top + (fvg.top - fvg.bottom) * 0.5;
          const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('short', 'FVG bajista', fvg, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
    }

    // BOS/CHoCH signals (require confluence too)
    const lastBreak = [...structure.bos, ...structure.choch].sort((a, b) => b.index - a.index)[0];
    if (lastBreak && lastBreak.index > candles.length - 15) {
      if (lastBreak.type.includes('bullish') && pd && pd.position === 'discount') {
        const confirmation = checkBullishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('long', null, null, pd, htfTrend, session, liquidity, candles, confirmation);
        confluence.score += 1; // BOS/CHoCH itself is a confluence
        confluence.details.push('BOS/CHoCH alcista');

        if (confluence.score >= 3) {
          const sl = findSwingLow(candles, 10) - currentPrice * 0.001;
          const tp = findTarget(currentPrice, 'long', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'long', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('long', 'BOS/CHoCH alcista', null, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
      if (lastBreak.type.includes('bearish') && pd && pd.position === 'premium') {
        const confirmation = checkBearishConfirmation(currentCandle, prevCandle);
        const confluence = scoreConfluence('short', null, null, pd, htfTrend, session, liquidity, candles, confirmation);
        confluence.score += 1;
        confluence.details.push('BOS/CHoCH bajista');

        if (confluence.score >= 3) {
          const sl = findSwingHigh(candles, 10) + currentPrice * 0.001;
          const tp = findTarget(currentPrice, 'short', fvgs, liquidity, pd);
          const rr = calcRR(currentPrice, sl, tp);
          if (rr >= 1.0) signals.push({ type: 'short', entry: currentPrice, sl, tp, rr: rr.toFixed(2), confidence: confluence.level, reason: buildSignalReason('short', 'BOS/CHoCH bajista', null, confluence, htfTrend, pd, confirmation), time: currentCandle.time, confluences: confluence.details });
        }
      }
    }

    return dedup(signals);
  }

  // ===== CANDLE CONFIRMATION =====
  function checkBullishConfirmation(current, prev) {
    if (!current || !prev) return { confirmed: false, type: null };

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const bodyRatio = range > 0 ? body / range : 0;
    const isBullishClose = current.close > current.open;

    // Pin bar / hammer: long lower wick + small body + bullish close
    if (lowerWick > body * 1.5 && isBullishClose && bodyRatio < 0.5) {
      return { confirmed: true, type: 'pin_bar', strength: 'strong' };
    }

    // Engulfing: current body engulfs previous body + bullish
    if (isBullishClose && current.close > prev.high && current.open <= prev.low) {
      return { confirmed: true, type: 'engulfing', strength: 'strong' };
    }

    // Strong bullish candle: body > 65% of range + closes in upper 30%
    const closePosition = range > 0 ? (current.close - current.low) / range : 0;
    if (isBullishClose && bodyRatio > 0.65 && closePosition > 0.7) {
      return { confirmed: true, type: 'momentum', strength: 'moderate' };
    }

    // Rejection wick: lower wick > 50% of range
    if (lowerWick > range * 0.5 && isBullishClose) {
      return { confirmed: true, type: 'rejection', strength: 'moderate' };
    }

    return { confirmed: false, type: null };
  }

  function checkBearishConfirmation(current, prev) {
    if (!current || !prev) return { confirmed: false, type: null };

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const bodyRatio = range > 0 ? body / range : 0;
    const isBearishClose = current.close < current.open;

    // Shooting star: long upper wick + small body + bearish close
    if (upperWick > body * 1.5 && isBearishClose && bodyRatio < 0.5) {
      return { confirmed: true, type: 'pin_bar', strength: 'strong' };
    }

    // Bearish engulfing
    if (isBearishClose && current.close < prev.low && current.open >= prev.high) {
      return { confirmed: true, type: 'engulfing', strength: 'strong' };
    }

    // Strong bearish candle
    const closePosition = range > 0 ? (current.high - current.close) / range : 0;
    if (isBearishClose && bodyRatio > 0.65 && closePosition > 0.7) {
      return { confirmed: true, type: 'momentum', strength: 'moderate' };
    }

    // Rejection wick upper
    if (upperWick > range * 0.5 && isBearishClose) {
      return { confirmed: true, type: 'rejection', strength: 'moderate' };
    }

    return { confirmed: false, type: null };
  }

  // ===== CONFLUENCE SCORING =====
  // Minimum 3 confluences required to generate a signal
  function scoreConfluence(direction, ob, fvg, pd, htfTrend, session, liquidity, candles, confirmation) {
    let score = 0;
    const details = [];

    // 1. HTF trend alignment (+1)
    if ((direction === 'long' && htfTrend === 'bullish') || (direction === 'short' && htfTrend === 'bearish')) {
      score += 1;
      details.push(`HTF ${htfTrend}`);
    }

    // 2. Premium/Discount alignment (+1)
    if (pd) {
      if (direction === 'long' && pd.position === 'discount') { score += 1; details.push('Zona descuento'); }
      if (direction === 'short' && pd.position === 'premium') { score += 1; details.push('Zona premium'); }
    }

    // 3. OB or FVG present (+1)
    if (ob) { score += 1; details.push(`OB ${ob.strength}`); }
    if (fvg) { score += 1; details.push('FVG'); }

    // 4. OB strength bonus (+1 for strong)
    if (ob && ob.strength === 'strong') { score += 1; details.push('OB fuerte'); }

    // 5. Candle confirmation (+1 or +2 for strong)
    if (confirmation && confirmation.confirmed) {
      const pts = confirmation.strength === 'strong' ? 2 : 1;
      score += pts;
      const typeLabels = { pin_bar: 'Pin Bar', engulfing: 'Envolvente', momentum: 'Momentum', rejection: 'Rechazo' };
      details.push(`Vela: ${typeLabels[confirmation.type] || confirmation.type}`);
    }

    // 6. Killzone active (+1)
    if (session && session.isKillzoneActive) { score += 1; details.push(`⚡ ${session.killzoneLabel}`); }

    // 7. Liquidity swept nearby (+1)
    const swept = checkLiquiditySwept(direction, liquidity, candles);
    if (swept) { score += 1; details.push('Liquidez barrida'); }

    // Determine confidence level
    let level = 'low';
    if (score >= 6) level = 'high';
    else if (score >= 4) level = 'medium';

    return { score, level, details };
  }

  function checkLiquiditySwept(direction, liquidity, candles) {
    const lookback = 10;
    const recent = candles.slice(-lookback);

    if (direction === 'long') {
      for (const liq of liquidity.filter(l => l.type.includes('low'))) {
        for (const c of recent) {
          if (c.low < liq.price && c.close > liq.price) return true;
        }
      }
    } else {
      for (const liq of liquidity.filter(l => l.type.includes('high'))) {
        for (const c of recent) {
          if (c.high > liq.price && c.close < liq.price) return true;
        }
      }
    }
    return false;
  }

  function buildSignalReason(direction, trigger, zone, confluence, htfTrend, pd, confirmation) {
    const dir = direction === 'long' ? 'Long' : 'Short';
    let reason = `${dir}: ${trigger}`;
    if (zone) reason += ` (${zone.bottom.toFixed(0)}-${zone.top.toFixed(0)})`;
    reason += `. `;

    // Confluences
    reason += `Confluencias (${confluence.score}): ${confluence.details.join(' • ')}. `;

    // Confirmation status
    if (confirmation && confirmation.confirmed) {
      reason += `✓ Confirmación de vela.`;
    } else {
      reason += `⚠ Sin confirmación de vela (esperar).`;
    }

    return reason;
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

  // ===== PUBLIC API =====
  return {
    analyzeStructure,
    detectOrderBlocks,
    detectFVG,
    detectLiquidity,
    calculatePremiumDiscount,
    generateSignals,
    analyzeVolume,
    getCurrentSession,
    refineEntry
  };
})();
