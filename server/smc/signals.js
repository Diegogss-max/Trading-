/**
 * Signal Generator — ICT/SMC Enhanced
 * Changes:
 * 1. RR minimum raised to 2.5
 * 2. Strict killzone filter
 * 3. ICT-correct OB definition (body only)
 * 4. HTF alignment mandatory for medium/high confidence
 * 5. Hard minimum 3 confluences
 * 6. TP uses second target (higher RR)
 * 7. Candle close filter (use penultimate candle)
 * 8. Backtesting metadata on every signal
 */

// ===== CONFIG =====
const CONFIG = {
  MIN_RR: 2.5,
  STRICT_KILLZONE_FILTER: true,
  MIN_CONFLUENCES: 3
};

function generateSignals(candles, context) {
  const { structure, obs, fvgs, liquidity, pd, htfAnalysis, timeframe, session, volume } = context;

  // Use penultimate candle (closed) not the forming one
  const signalCandle = candles[candles.length - 2];
  const currentPrice = signalCandle ? signalCandle.close : candles[candles.length - 1].close;
  const currentCandle = signalCandle || candles[candles.length - 1];

  const htfTrend = getHTFTrend(htfAnalysis);
  const htf1d = htfAnalysis['1d'] && htfAnalysis['1d'].structure ? htfAnalysis['1d'].structure.trend : 'neutral';
  const htf4h = htfAnalysis['4h'] && htfAnalysis['4h'].structure ? htfAnalysis['4h'].structure.trend : 'neutral';
  const htfAligned = htf1d !== 'neutral' && htf1d === htf4h;

  const inKillzone = session ? session.isKillzoneActive : false;

  // STRICT KILLZONE FILTER
  if (CONFIG.STRICT_KILLZONE_FILTER && !inKillzone) {
    return [];
  }

  const signals = [];
  const proximityThreshold = currentPrice * 0.003;

  // ===== LONG SIGNALS =====
  for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
    const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
    const isNear = Math.abs(currentPrice - ob.top) <= proximityThreshold || Math.abs(ob.bottom - currentPrice) <= proximityThreshold;

    if (isInside || isNear) {
      const sl = ob.bottom - (ob.top - ob.bottom) * 0.1;
      const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);
      const confluence = checkConfluences('long', ob, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);

      if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
        signals.push(buildSignal('long', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'OB alcista ICT', ob));
      }
    }
  }

  for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
    const isInside = currentPrice >= fvg.bottom && currentPrice <= fvg.top;
    const isNear = (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);

    if (isInside || isNear) {
      const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.3;
      const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);
      const confluence = checkConfluences('long', null, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);

      if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
        signals.push(buildSignal('long', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'FVG alcista', fvg));
      }
    }
  }

  // Liquidity sweep long
  const sweepLow = detectLiquiditySweep(candles, liquidity, 'low');
  if (sweepLow) {
    const sl = sweepLow.sweepLow - (currentPrice - sweepLow.sweepLow) * 0.1;
    const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
    const rr = calculateRR(currentPrice, sl, tp);
    const confluence = checkConfluences('long', null, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
    confluence.list.push('Liquidity sweep');
    confluence.count++;

    if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
      signals.push(buildSignal('long', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'Liquidity sweep alcista', null));
    }
  }

  // ===== SHORT SIGNALS =====
  for (const ob of obs.filter(o => o.type === 'ob_bearish')) {
    const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
    const isNear = Math.abs(ob.bottom - currentPrice) <= proximityThreshold || Math.abs(currentPrice - ob.top) <= proximityThreshold;

    if (isInside || isNear) {
      const sl = ob.top + (ob.top - ob.bottom) * 0.1;
      const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);
      const confluence = checkConfluences('short', ob, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);

      if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
        signals.push(buildSignal('short', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'OB bajista ICT', ob));
      }
    }
  }

  for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish')) {
    const isInside = currentPrice >= fvg.bottom && currentPrice <= fvg.top;
    const isNear = (currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold) || (fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold);

    if (isInside || isNear) {
      const sl = fvg.top + (fvg.top - fvg.bottom) * 0.3;
      const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);
      const confluence = checkConfluences('short', null, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);

      if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
        signals.push(buildSignal('short', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'FVG bajista', fvg));
      }
    }
  }

  // Liquidity sweep short
  const sweepHigh = detectLiquiditySweep(candles, liquidity, 'high');
  if (sweepHigh) {
    const sl = sweepHigh.sweepHigh + (sweepHigh.sweepHigh - currentPrice) * 0.1;
    const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
    const rr = calculateRR(currentPrice, sl, tp);
    const confluence = checkConfluences('short', null, null, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure);
    confluence.list.push('Liquidity sweep');
    confluence.count++;

    if (rr >= CONFIG.MIN_RR && confluence.count >= CONFIG.MIN_CONFLUENCES) {
      signals.push(buildSignal('short', currentPrice, sl, tp, rr, currentCandle, timeframe, confluence, htfTrend, htfAligned, inKillzone, 'Liquidity sweep bajista', null));
    }
  }

  return deduplicateSignals(signals);
}

// ===== HARD CONFLUENCE CHECK (min 3 of 7) =====
function checkConfluences(direction, ob, fvg, pd, htfTrend, htfAligned, inKillzone, liquidity, candles, structure) {
  const list = [];
  let count = 0;

  // a) HTF aligned (1D + 4H same direction)
  if (htfAligned && ((direction === 'long' && htfTrend === 'bullish') || (direction === 'short' && htfTrend === 'bearish'))) {
    count++; list.push('HTF alineado (1D+4H)');
  }

  // b) Premium/Discount correct zone
  if (pd) {
    if (direction === 'long' && pd.position === 'discount') { count++; list.push('Zona descuento'); }
    if (direction === 'short' && pd.position === 'premium') { count++; list.push('Zona premium'); }
  }

  // c) OB present
  if (ob) { count++; list.push(`OB ${ob.strength || ''}`); }

  // d) FVG present
  if (fvg) { count++; list.push('FVG presente'); }

  // e) Liquidity sweep recent
  const sweep = detectLiquiditySweep(candles, liquidity, direction === 'long' ? 'low' : 'high');
  if (sweep) { count++; list.push('Liquidez barrida'); }

  // f) Killzone active
  if (inKillzone) { count++; list.push('⚡ Killzone activa'); }

  // g) CHoCH confirmed in entry TF
  const recentChoch = structure.choch.filter(c => c.index > candles.length - 10);
  const hasChoch = recentChoch.some(c => direction === 'long' ? c.type.includes('bullish') : c.type.includes('bearish'));
  if (hasChoch) { count++; list.push('CHoCH confirmado'); }

  return { count, list };
}

// ===== BUILD SIGNAL WITH BACKTESTING METADATA =====
function buildSignal(type, entry, sl, tp, rr, candle, timeframe, confluence, htfTrend, htfAligned, inKillzone, trigger, zone) {
  const confidence = getConfidence(htfTrend, htfAligned, type, confluence.count, inKillzone);
  const zoneStr = zone ? ` (${zone.bottom.toFixed(0)}-${zone.top.toFixed(0)})` : '';

  return {
    type,
    entry,
    sl,
    tp,
    rr: rr.toFixed(2),
    confidence,
    time: candle.time,
    timeframe,
    confluences: confluence.list,
    reason: `${type === 'long' ? '↑ Long' : '↓ Short'}: ${trigger}${zoneStr}. HTF: ${htfTrend}. Confluencias (${confluence.count}): ${confluence.list.join(' • ')}. ⚠ Esperar cierre de vela.`,
    // Backtesting metadata
    meta: {
      confluences_count: confluence.count,
      killzone_active: inKillzone,
      htf_aligned: htfAligned,
      rr_at_signal: rr.toFixed(2),
      trigger,
      timestamp: Date.now()
    }
  };
}

// ===== HTF TREND =====
function getHTFTrend(htfAnalysis) {
  const t1d = htfAnalysis['1d'] && htfAnalysis['1d'].structure ? htfAnalysis['1d'].structure.trend : 'neutral';
  const t4h = htfAnalysis['4h'] && htfAnalysis['4h'].structure ? htfAnalysis['4h'].structure.trend : 'neutral';
  if (t1d === t4h && t1d !== 'neutral') return t1d;
  return t4h !== 'neutral' ? t4h : t1d;
}

// ===== CONFIDENCE (HTF mandatory) =====
function getConfidence(htfTrend, htfAligned, direction, confluenceCount, inKillzone) {
  // HTF alignment is mandatory for medium/high
  const htfOk = htfAligned && ((direction === 'long' && htfTrend === 'bullish') || (direction === 'short' && htfTrend === 'bearish'));
  if (!htfOk) return 'low';

  if (confluenceCount >= 5 && inKillzone) return 'high';
  if (confluenceCount >= 4) return 'medium';
  return 'low';
}

// ===== FIND TARGET (use 2nd target for better RR) =====
function findNextTarget(price, direction, fvgs, liquidity, pd) {
  let targets = [];

  if (direction === 'long') {
    fvgs.filter(f => f.type === 'fvg_bearish' && f.bottom > price).forEach(f => targets.push(f.bottom));
    liquidity.filter(l => l.type.includes('high') && l.price > price).forEach(l => targets.push(l.price));
    if (pd && pd.rangeHigh > price) targets.push(pd.rangeHigh);
    targets.push(price * 1.015); // fallback 1.5%
    targets.push(price * 1.025); // fallback 2.5%
  } else {
    fvgs.filter(f => f.type === 'fvg_bullish' && f.top < price).forEach(f => targets.push(f.top));
    liquidity.filter(l => l.type.includes('low') && l.price < price).forEach(l => targets.push(l.price));
    if (pd && pd.rangeLow < price) targets.push(pd.rangeLow);
    targets.push(price * 0.985);
    targets.push(price * 0.975);
  }

  targets.sort((a, b) => direction === 'long' ? a - b : b - a);
  const minDist = price * 0.003;
  const valid = targets.filter(t => Math.abs(t - price) >= minDist);

  // Use SECOND target if available (higher RR)
  if (valid.length >= 2) return valid[1];
  if (valid.length === 1) return valid[0];
  return direction === 'long' ? price * 1.02 : price * 0.98;
}

function calculateRR(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  return risk > 0 ? reward / risk : 0;
}

function detectLiquiditySweep(candles, liquidity, type) {
  const recent = candles.slice(-8);
  if (type === 'low') {
    for (const liq of liquidity.filter(l => l.type.includes('low'))) {
      for (const c of recent) {
        if (c.low < liq.price && c.close > liq.price) return { sweepLow: c.low };
      }
    }
  } else {
    for (const liq of liquidity.filter(l => l.type.includes('high'))) {
      for (const c of recent) {
        if (c.high > liq.price && c.close < liq.price) return { sweepHigh: c.high };
      }
    }
  }
  return null;
}

function formatPrice(price) {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function deduplicateSignals(signals) {
  const unique = [];
  const order = { high: 3, medium: 2, low: 1 };
  for (const s of signals) {
    const ex = unique.find(u => u.type === s.type && Math.abs(u.entry - s.entry) < s.entry * 0.001);
    if (!ex) unique.push(s);
    else if ((order[s.confidence] || 0) > (order[ex.confidence] || 0)) unique[unique.indexOf(ex)] = s;
  }
  return unique.sort((a, b) => (order[b.confidence] || 0) - (order[a.confidence] || 0));
}

module.exports = { generateSignals, CONFIG };
