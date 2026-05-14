/**
 * Signal Generator
 * Combines all SMC concepts to generate trade signals
 * Filters by HTF trend alignment and R:R ratio
 */

function generateSignals(candles, context) {
  const { structure, obs, fvgs, liquidity, pd, htfAnalysis, timeframe, session, volume } = context;
  const signals = [];
  const currentPrice = candles[candles.length - 1].close;
  const currentCandle = candles[candles.length - 1];

  // Get HTF trend for confluence
  const htfTrend = getHTFTrend(htfAnalysis);

  // Session filter: boost confidence during killzones
  const inKillzone = session ? session.isKillzoneActive : false;

  // --- LONG SIGNALS ---
  if (htfTrend === 'bullish' || htfTrend === 'neutral') {
    // 1. Price at bullish OB in discount zone
    for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
      if (currentPrice >= ob.bottom && currentPrice <= ob.top) {
        const sl = ob.bottom - (ob.top - ob.bottom) * 0.2;
        const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 2) {
          signals.push({
            type: 'long',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(ob, pd, htfTrend, 'long', inKillzone, volume),
            reason: buildReason('long', 'order_block', ob, pd, htfTrend, structure),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 2. Price at bullish FVG in discount
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
      if (currentPrice >= fvg.bottom && currentPrice <= fvg.top) {
        const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.5;
        const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 2) {
          signals.push({
            type: 'long',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(null, pd, htfTrend, 'long', inKillzone, volume),
            reason: buildReason('long', 'fvg', fvg, pd, htfTrend, structure),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 3. Liquidity sweep + reversal (inducement)
    const recentSweep = detectLiquiditySweep(candles, liquidity, 'low');
    if (recentSweep) {
      const sl = recentSweep.sweepLow - (currentPrice - recentSweep.sweepLow) * 0.1;
      const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);

      if (rr >= 2) {
        signals.push({
          type: 'long',
          entry: currentPrice,
          sl,
          tp,
          rr: rr.toFixed(2),
          confidence: 'high',
          reason: `Liquidity sweep detectado en ${formatPrice(recentSweep.sweepLow)}. Precio barrió stops y revirtió. HTF tendencia ${htfTrend}. Entrada en zona de descuento con confluencia de inducement.`,
          time: currentCandle.time,
          timeframe
        });
      }
    }
  }

  // --- SHORT SIGNALS ---
  if (htfTrend === 'bearish' || htfTrend === 'neutral') {
    // 1. Price at bearish OB in premium zone
    for (const ob of obs.filter(o => o.type === 'ob_bearish')) {
      if (currentPrice >= ob.bottom && currentPrice <= ob.top) {
        const sl = ob.top + (ob.top - ob.bottom) * 0.2;
        const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 2) {
          signals.push({
            type: 'short',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(ob, pd, htfTrend, 'short', inKillzone, volume),
            reason: buildReason('short', 'order_block', ob, pd, htfTrend, structure),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 2. Price at bearish FVG in premium
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish')) {
      if (currentPrice >= fvg.bottom && currentPrice <= fvg.top) {
        const sl = fvg.top + (fvg.top - fvg.bottom) * 0.5;
        const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 2) {
          signals.push({
            type: 'short',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(null, pd, htfTrend, 'short', inKillzone, volume),
            reason: buildReason('short', 'fvg', fvg, pd, htfTrend, structure),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 3. Liquidity sweep + reversal (inducement) for shorts
    const recentSweepHigh = detectLiquiditySweep(candles, liquidity, 'high');
    if (recentSweepHigh) {
      const sl = recentSweepHigh.sweepHigh + (recentSweepHigh.sweepHigh - currentPrice) * 0.1;
      const tp = findNextTarget(currentPrice, 'short', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);

      if (rr >= 2) {
        signals.push({
          type: 'short',
          entry: currentPrice,
          sl,
          tp,
          rr: rr.toFixed(2),
          confidence: 'high',
          reason: `Liquidity sweep detectado en ${formatPrice(recentSweepHigh.sweepHigh)}. Precio barrió stops alcistas y revirtió. HTF tendencia ${htfTrend}. Entrada en zona premium con confluencia de inducement.`,
          time: currentCandle.time,
          timeframe
        });
      }
    }
  }

  // Deduplicate and sort by confidence
  return deduplicateSignals(signals);
}

function getHTFTrend(htfAnalysis) {
  if (htfAnalysis['1d'] && htfAnalysis['1d'].structure) {
    return htfAnalysis['1d'].structure.trend;
  }
  if (htfAnalysis['4h'] && htfAnalysis['4h'].structure) {
    return htfAnalysis['4h'].structure.trend;
  }
  return 'neutral';
}

function findNextTarget(price, direction, fvgs, liquidity, pd) {
  let targets = [];

  if (direction === 'long') {
    // Targets above current price
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish' && f.bottom > price)) {
      targets.push(fvg.bottom);
    }
    for (const liq of liquidity.filter(l => l.type.includes('high') && l.price > price)) {
      targets.push(liq.price);
    }
    if (pd && pd.equilibrium > price) targets.push(pd.equilibrium);
    if (pd && pd.rangeHigh > price) targets.push(pd.rangeHigh);
  } else {
    // Targets below current price
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish' && f.top < price)) {
      targets.push(fvg.top);
    }
    for (const liq of liquidity.filter(l => l.type.includes('low') && l.price < price)) {
      targets.push(liq.price);
    }
    if (pd && pd.equilibrium < price) targets.push(pd.equilibrium);
    if (pd && pd.rangeLow < price) targets.push(pd.rangeLow);
  }

  if (targets.length === 0) {
    // Default target based on ATR
    const atr = Math.abs(price * 0.015); // ~1.5% as fallback
    return direction === 'long' ? price + atr : price - atr;
  }

  // Pick the nearest target
  targets.sort((a, b) => direction === 'long' ? a - b : b - a);
  return targets[0];
}

function calculateRR(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  return risk > 0 ? reward / risk : 0;
}

function getConfidence(ob, pd, htfTrend, direction, inKillzone, volume) {
  let score = 0;

  // HTF alignment
  if ((direction === 'long' && htfTrend === 'bullish') ||
      (direction === 'short' && htfTrend === 'bearish')) {
    score += 2;
  }

  // OB strength
  if (ob) {
    if (ob.strength === 'strong') score += 2;
    else if (ob.strength === 'moderate') score += 1;
  }

  // Premium/Discount alignment
  if (pd) {
    if (direction === 'long' && pd.position === 'discount') score += 2;
    if (direction === 'short' && pd.position === 'premium') score += 2;
  }

  // Killzone bonus
  if (inKillzone) score += 1;

  // Volume confirmation
  if (volume && volume.isHighVolume) score += 1;

  if (score >= 6) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function buildReason(direction, trigger, zone, pd, htfTrend, structure) {
  const dir = direction === 'long' ? 'Long' : 'Short';
  const trendText = htfTrend === 'bullish' ? 'alcista' : htfTrend === 'bearish' ? 'bajista' : 'neutral';
  const pdText = pd ? (pd.position === 'premium' ? 'premium' : pd.position === 'discount' ? 'descuento' : 'equilibrio') : 'N/A';

  let reason = `${dir}: `;

  if (trigger === 'order_block') {
    reason += `Precio en Order Block ${direction === 'long' ? 'alcista' : 'bajista'} (${formatPrice(zone.bottom)} - ${formatPrice(zone.top)}). `;
  } else if (trigger === 'fvg') {
    reason += `Precio en FVG ${direction === 'long' ? 'alcista' : 'bajista'} (${formatPrice(zone.bottom)} - ${formatPrice(zone.top)}). `;
  }

  reason += `Tendencia HTF: ${trendText}. Zona: ${pdText}. `;

  if (structure.choch.length > 0) {
    const lastChoch = structure.choch[structure.choch.length - 1];
    reason += `Último CHoCH: ${lastChoch.type.includes('bullish') ? 'alcista' : 'bajista'} en ${formatPrice(lastChoch.price)}. `;
  }

  return reason;
}

function detectLiquiditySweep(candles, liquidity, type) {
  const lookback = 5;
  const recent = candles.slice(-lookback);

  if (type === 'low') {
    for (const liq of liquidity.filter(l => l.type.includes('low'))) {
      for (let i = 0; i < recent.length - 1; i++) {
        // Wick below liquidity then close above
        if (recent[i].low < liq.price && recent[i].close > liq.price) {
          return { sweepLow: recent[i].low, liquidityPrice: liq.price };
        }
      }
    }
  } else {
    for (const liq of liquidity.filter(l => l.type.includes('high'))) {
      for (let i = 0; i < recent.length - 1; i++) {
        if (recent[i].high > liq.price && recent[i].close < liq.price) {
          return { sweepHigh: recent[i].high, liquidityPrice: liq.price };
        }
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
  const confidenceOrder = { high: 3, medium: 2, low: 1 };

  for (const signal of signals) {
    const existing = unique.find(s =>
      s.type === signal.type &&
      Math.abs(s.entry - signal.entry) < signal.entry * 0.001
    );
    if (!existing) {
      unique.push(signal);
    } else if (confidenceOrder[signal.confidence] > confidenceOrder[existing.confidence]) {
      const idx = unique.indexOf(existing);
      unique[idx] = signal;
    }
  }

  return unique.sort((a, b) => {
    const confA = confidenceOrder[a.confidence] || 0;
    const confB = confidenceOrder[b.confidence] || 0;
    return confB - confA;
  });
}

module.exports = { generateSignals };
