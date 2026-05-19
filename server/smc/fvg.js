/**
 * Fair Value Gap (FVG) / Imbalance Detection
 * A FVG occurs when there's a gap between candle 1's high/low and candle 3's low/high
 * with candle 2 being the impulse candle
 */

function detectFVG(candles) {
  const fvgs = [];

  for (let i = 2; i < candles.length; i++) {
    const candle1 = candles[i - 2];
    const candle2 = candles[i - 1]; // impulse candle
    const candle3 = candles[i];

    // Bullish FVG: gap between candle1 high and candle3 low
    if (candle3.low > candle1.high) {
      const gapSize = candle3.low - candle1.high;
      const avgRange = getLocalAvgRange(candles, i, 20);

      // Only significant gaps
      if (gapSize > avgRange * 0.3) {
        fvgs.push({
          type: 'fvg_bullish',
          startTime: candle1.time,
          endTime: candle3.time,
          top: candle3.low,
          bottom: candle1.high,
          index: i - 1,
          filled: isFVGMitigated(candles, i, candle1.high, candle3.low, 'bullish'),
          ce: (candle3.low + candle1.high) / 2,
          size: gapSize
        });
      }
    }

    // Bearish FVG: gap between candle3 high and candle1 low
    if (candle3.high < candle1.low) {
      const gapSize = candle1.low - candle3.high;
      const avgRange = getLocalAvgRange(candles, i, 20);

      if (gapSize > avgRange * 0.3) {
        fvgs.push({
          type: 'fvg_bearish',
          startTime: candle1.time,
          endTime: candle3.time,
          top: candle1.low,
          bottom: candle3.high,
          index: i - 1,
          filled: isFVGMitigated(candles, i, candle3.high, candle1.low, 'bearish'),
          ce: (candle1.low + candle3.high) / 2,
          size: gapSize
        });
      }
    }
  }

  // Return only unfilled FVGs (active zones)
  return fvgs.filter(fvg => !fvg.filled);
}

function isFVGMitigated(candles, fvgIndex, bottom, top, type, mode = 'ce_rejection') {
  const ce = (top + bottom) / 2;

  // Check if price has returned to mitigate/fill the gap
  for (let i = fvgIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];

    if (type === 'bullish') {
      // 1. Full fill (100%)
      if (mode === 'full' && candle.low <= bottom) {
        return true;
      }
      // 2. Consequent Encroachment (50%)
      if (mode === 'ce' && candle.low <= ce) {
        return true;
      }
      // 3. CE + Partial mitigation + strong trend rejection
      if (mode === 'ce_rejection') {
        if (candle.low <= ce) return true; // Touched CE midpoint

        // Did it wick into the FVG partially?
        if (candle.low <= top) {
          const body = Math.abs(candle.close - candle.open);
          const range = candle.high - candle.low;
          const lowerWick = Math.min(candle.open, candle.close) - candle.low;
          const isBullishClose = candle.close > candle.open;

          const isHammer = lowerWick > body * 1.5 && isBullishClose && (range > 0 ? body / range < 0.5 : false);
          const isEngulfing = isBullishClose && prevCandle && candle.close > prevCandle.high && candle.open <= prevCandle.low;
          const isStrongMomentum = isBullishClose && (range > 0 ? body / range > 0.65 : false) && candle.close > (candle.high + candle.low) / 2;

          if (isHammer || isEngulfing || isStrongMomentum) {
            return true;
          }
        }
      }
    } else {
      // 1. Full fill (100%)
      if (mode === 'full' && candle.high >= top) {
        return true;
      }
      // 2. Consequent Encroachment (50%)
      if (mode === 'ce' && candle.high >= ce) {
        return true;
      }
      // 3. CE + Partial mitigation + strong trend rejection
      if (mode === 'ce_rejection') {
        if (candle.high >= ce) return true; // Touched CE midpoint

        // Did it wick into the FVG partially?
        if (candle.high >= bottom) {
          const body = Math.abs(candle.close - candle.open);
          const range = candle.high - candle.low;
          const upperWick = candle.high - Math.max(candle.open, candle.close);
          const isBearishClose = candle.close < candle.open;

          const isShootingStar = upperWick > body * 1.5 && isBearishClose && (range > 0 ? body / range < 0.5 : false);
          const isEngulfing = isBearishClose && prevCandle && candle.close < prevCandle.low && candle.open >= prevCandle.high;
          const isStrongMomentum = isBearishClose && (range > 0 ? body / range > 0.65 : false) && candle.close < (candle.high + candle.low) / 2;

          if (isShootingStar || isEngulfing || isStrongMomentum) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function getLocalAvgRange(candles, endIndex, period) {
  const start = Math.max(0, endIndex - period);
  let sum = 0;
  let count = 0;

  for (let i = start; i < endIndex; i++) {
    sum += candles[i].high - candles[i].low;
    count++;
  }

  return count > 0 ? sum / count : 1;
}

module.exports = { detectFVG };
