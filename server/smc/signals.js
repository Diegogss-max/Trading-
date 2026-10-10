/**
 * Signal Generator
 * Combines all SMC concepts to generate trade signals
 * More aggressive detection: proximity to zones, multiple triggers, lower R:R threshold
 */

function generateSignals(candles, context) {
  const { structure, obs, fvgs, liquidity, pd, htfAnalysis, timeframe, session, volume } = context;
  const signals = [];
  const currentPrice = candles[candles.length - 1].close;
  const currentCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // Get HTF trend for confluence
  const htfTrend = getHTFTrend(htfAnalysis);

  // Session filter: boost confidence during killzones
  const inKillzone = session ? session.isKillzoneActive : false;

  // Proximity threshold: 0.3% of price (catches zones within ~$250 for BTC)
  const proximityThreshold = currentPrice * 0.003;

  // --- LONG SIGNALS ---
  // Always allow both directions - HTF trend affects confidence, not permission
  {
    // 1. Price at or near bullish OB
    for (const ob of obs.filter(o => o.type === 'ob_bullish')) {
      const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
      const isAboveNear = currentPrice - ob.top > 0 && currentPrice - ob.top <= proximityThreshold;
      const isBelowNear = ob.bottom - currentPrice > 0 && ob.bottom - currentPrice <= proximityThreshold;

      if (isInside || isAboveNear || isBelowNear) {
        const sl = ob.bottom - (ob.top - ob.bottom) * 0.3;
        const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 1.0) {
          signals.push({
            type: 'long',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(ob, pd, htfTrend, 'long', inKillzone, volume),
            reason: buildReason('long', 'order_block', ob, pd, htfTrend, structure, inKillzone),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 2. Price at or near bullish FVG
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish')) {
      const isInside = currentPrice >= fvg.bottom && currentPrice <= fvg.top;
      const isAboveNear = currentPrice - fvg.top >= 0 && currentPrice - fvg.top <= proximityThreshold;
      const isBelowNear = fvg.bottom - currentPrice >= 0 && fvg.bottom - currentPrice <= proximityThreshold;

      if (isInside || isAboveNear || isBelowNear) {
        const sl = fvg.bottom - (fvg.top - fvg.bottom) * 0.5;
        const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
        const rr = calculateRR(currentPrice, sl, tp);

        if (rr >= 1.0) {
          signals.push({
            type: 'long',
            entry: currentPrice,
            sl,
            tp,
            rr: rr.toFixed(2),
            confidence: getConfidence(null, pd, htfTrend, 'long', inKillzone, volume),
            reason: buildReason('long', 'fvg', fvg, pd, htfTrend, structure, inKillzone),
            time: currentCandle.time,
            timeframe
          });
        }
      }
    }

    // 3. Liquidity sweep + reversal (inducement)
    const recentSweep = detectLiquiditySweep(candles, liquidity, 'low');
    if (recentSweep) {
      const sl = recentSweep.sweepLow - (currentPrice - recentSweep.sweepLow) * 0.15;
      const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
      const rr = calculateRR(currentPrice, sl, tp);

      if (rr >= 1.0) {
        signals.push({
          type: 'long',
          entry: currentPrice,
          sl,
          tp,
          rr: rr.toFixed(2),
          confidence: 'high',
          reason: `Liquidity sweep en ${formatPrice(recentSweep.sweepLow)}. Barrió stops y revirtió. HTF: ${htfTrend}. ${inKillzone ? '⚡ En Killzone.' : ''}`,
          time: currentCandle.time,
          timeframe
        });
      }
    }

    // 4. BOS/CHoCH bullish + discount zone (new trigger)
    if (structure.bos.length > 0 || structure.choch.length > 0) {
      const lastBullishBreak = [...structure.bos, ...structure.choch]
        .filter(b => b.type.includes('bullish'))
        .sort((a, b) => b.index - a.index)[0];

      if (lastBullishBreak && pd && pd.position === 'discount') {
        const recentBreak = lastBullishBreak.index > candles.length - 15;
        if (recentBreak) {
          const swingLow = findRecentSwingLow(candles, 10);
          const sl = swingLow - (currentPrice - swingLow) * 0.1;
          const tp = findNextTarget(currentPrice, 'long', fvgs, liquidity, pd);
          const rr = calculateRR(currentPrice, sl, tp);

          if (rr >= 1.0) {
            signals.push({
              type: 'long',
              entry: currentPrice,
              sl,
              tp,
              rr: rr.toFixed(2),
              confidence: getConfidence(null, pd, htfTrend, 'long', inKillzone, volume),
              reason: `BOS/CHoCH alcista reciente. Precio en zona de descuento. HTF: ${htfTrend}. SL bajo último swing low. ${inKillzone ? '⚡ En Killzone.' : ''}`,
              time: currentCandle.time,
              timeframe
            });
          }
        }
      }
    }
  }

  // --- SHORT SIGNALS omitted per user request ---

  // Deduplicate and sort by confidence
  return deduplicateSignals(signals);
}

function hasRecentBullishChoch(structure) {
  if (!structure.choch || structure.choch.length === 0) return false;
  const last = structure.choch[structure.choch.length - 1];
  return last.type.includes('bullish');
}

function hasRecentBearishChoch(structure) {
  if (!structure.choch || structure.choch.length === 0) return false;
  const last = structure.choch[structure.choch.length - 1];
  return last.type.includes('bearish');
}

function findRecentSwingLow(candles, lookback) {
  const recent = candles.slice(-lookback);
  let lowest = recent[0].low;
  for (const c of recent) {
    if (c.low < lowest) lowest = c.low;
  }
  return lowest;
}

function findRecentSwingHigh(candles, lookback) {
  const recent = candles.slice(-lookback);
  let highest = recent[0].high;
  for (const c of recent) {
    if (c.high > highest) highest = c.high;
  }
  return highest;
}

function getHTFTrend(htfAnalysis) {
  const trend1d = htfAnalysis['1d'] && htfAnalysis['1d'].structure ? htfAnalysis['1d'].structure.trend : 'neutral';
  const trend4h = htfAnalysis['4h'] && htfAnalysis['4h'].structure ? htfAnalysis['4h'].structure.trend : 'neutral';

  // If both agree, strong signal
  if (trend1d === trend4h) return trend1d;

  // If they disagree, use 4h as it's more reactive
  // But mark as the 4h trend (allows both directions with lower confidence)
  return trend4h;
}

function findNextTarget(price, direction, fvgs, liquidity, pd) {
  let targets = [];

  if (direction === 'long') {
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bearish' && f.bottom > price)) {
      targets.push(fvg.bottom);
    }
    for (const liq of liquidity.filter(l => l.type.includes('high') && l.price > price)) {
      targets.push(liq.price);
    }
    if (pd && pd.rangeHigh > price) targets.push(pd.rangeHigh);
    // Always add a 1% target as minimum
    targets.push(price * 1.01);
  } else {
    for (const fvg of fvgs.filter(f => f.type === 'fvg_bullish' && f.top < price)) {
      targets.push(fvg.top);
    }
    for (const liq of liquidity.filter(l => l.type.includes('low') && l.price < price)) {
      targets.push(liq.price);
    }
    if (pd && pd.rangeLow < price) targets.push(pd.rangeLow);
    // Always add a 1% target as minimum
    targets.push(price * 0.99);
  }

  // Sort and pick the best target (not too close, not too far)
  targets.sort((a, b) => direction === 'long' ? a - b : b - a);

  // Filter out targets that are too close (< 0.3% away)
  const minDistance = price * 0.003;
  const validTargets = targets.filter(t => Math.abs(t - price) >= minDistance);

  return validTargets.length > 0 ? validTargets[0] : targets[targets.length - 1];
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

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function buildReason(direction, trigger, zone, pd, htfTrend, structure, inKillzone) {
  const dir = direction === 'long' ? 'Long' : 'Short';
  const trendText = htfTrend === 'bullish' ? 'alcista' : htfTrend === 'bearish' ? 'bajista' : 'neutral';
  const pdText = pd ? (pd.position === 'premium' ? 'premium' : pd.position === 'discount' ? 'descuento' : 'equilibrio') : 'N/A';

  let reason = `${dir}: `;

  if (trigger === 'order_block') {
    reason += `Precio en/cerca de Order Block ${direction === 'long' ? 'alcista' : 'bajista'} (${formatPrice(zone.bottom)} - ${formatPrice(zone.top)}). `;
  } else if (trigger === 'fvg') {
    reason += `Precio en/cerca de FVG ${direction === 'long' ? 'alcista' : 'bajista'} (${formatPrice(zone.bottom)} - ${formatPrice(zone.top)}). `;
  }

  reason += `HTF: ${trendText}. Zona: ${pdText}. `;

  if (inKillzone) {
    reason += '⚡ En Killzone. ';
  }

  if (structure.choch.length > 0) {
    const lastChoch = structure.choch[structure.choch.length - 1];
    reason += `CHoCH: ${lastChoch.type.includes('bullish') ? 'alcista' : 'bajista'} en ${formatPrice(lastChoch.price)}.`;
  }

  return reason;
}

function detectLiquiditySweep(candles, liquidity, type) {
  const lookback = 8; // Increased lookback
  const recent = candles.slice(-lookback);

  if (type === 'low') {
    for (const liq of liquidity.filter(l => l.type.includes('low'))) {
      for (let i = 0; i < recent.length - 1; i++) {
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
