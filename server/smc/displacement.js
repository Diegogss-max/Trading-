/**
 * Displacement / Momentum Filter
 * Measures the strength of price moves to validate SMC zones
 * A valid displacement has:
 * - Large body relative to total range (body > 70% of range)
 * - Above-average range
 * - Closes near the extreme (strong close)
 */

function analyzeDisplacement(candles, index) {
  if (index < 0 || index >= candles.length) return null;

  const candle = candles[index];
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const bodyRatio = range > 0 ? body / range : 0;

  // Average range for context
  const avgRange = getAvgRange(candles, index, 20);
  const rangeRatio = avgRange > 0 ? range / avgRange : 1;

  // Close strength: how close to the extreme the close is
  const isBullish = candle.close > candle.open;
  let closeStrength;
  if (isBullish) {
    closeStrength = range > 0 ? (candle.close - candle.low) / range : 0;
  } else {
    closeStrength = range > 0 ? (candle.high - candle.close) / range : 0;
  }

  const isDisplacement = bodyRatio >= 0.65 && rangeRatio >= 1.3;
  const isStrongDisplacement = bodyRatio >= 0.75 && rangeRatio >= 2.0 && closeStrength >= 0.8;

  return {
    bodyRatio: bodyRatio.toFixed(2),
    rangeRatio: rangeRatio.toFixed(2),
    closeStrength: closeStrength.toFixed(2),
    isDisplacement,
    isStrongDisplacement,
    direction: isBullish ? 'bullish' : 'bearish',
    score: calculateDisplacementScore(bodyRatio, rangeRatio, closeStrength)
  };
}

/**
 * Analyze displacement for a range of candles (e.g., the move after an OB)
 */
function analyzeRangeDisplacement(candles, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= candles.length || startIndex >= endIndex) return null;

  let maxDisplacement = null;
  let totalScore = 0;
  let count = 0;

  for (let i = startIndex; i <= endIndex; i++) {
    const d = analyzeDisplacement(candles, i);
    if (d) {
      totalScore += d.score;
      count++;
      if (!maxDisplacement || d.score > maxDisplacement.score) {
        maxDisplacement = d;
      }
    }
  }

  return {
    maxDisplacement,
    avgScore: count > 0 ? (totalScore / count).toFixed(2) : 0,
    hasStrongMove: maxDisplacement ? maxDisplacement.isStrongDisplacement : false
  };
}

function calculateDisplacementScore(bodyRatio, rangeRatio, closeStrength) {
  // Score from 0-100
  const bodyScore = Math.min(bodyRatio / 0.9, 1) * 35;
  const rangeScore = Math.min(rangeRatio / 3, 1) * 40;
  const closeScore = closeStrength * 25;
  return Math.round(bodyScore + rangeScore + closeScore);
}

function getAvgRange(candles, endIndex, period) {
  const start = Math.max(0, endIndex - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < endIndex; i++) {
    sum += candles[i].high - candles[i].low;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

module.exports = { analyzeDisplacement, analyzeRangeDisplacement };
