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
          filled: isFVGFilled(candles, i, candle1.high, candle3.low, 'bullish'),
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
          filled: isFVGFilled(candles, i, candle3.high, candle1.low, 'bearish'),
          size: gapSize
        });
      }
    }
  }

  // Return only unfilled FVGs (active zones)
  return fvgs.filter(fvg => !fvg.filled);
}

function isFVGFilled(candles, fvgIndex, bottom, top, type) {
  // Check if price has returned to fill the gap
  for (let i = fvgIndex + 1; i < candles.length; i++) {
    if (type === 'bullish') {
      // Bullish FVG filled when price comes back down into the gap
      if (candles[i].low <= bottom) {
        return true;
      }
    } else {
      // Bearish FVG filled when price comes back up into the gap
      if (candles[i].high >= top) {
        return true;
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
