/**
 * Order Block Detection
 * An Order Block is the last opposing candle before a strong move (BOS)
 * Bullish OB: last bearish candle before a bullish BOS
 * Bearish OB: last bullish candle before a bearish BOS
 */

function detectOrderBlocks(candles, structure) {
  const orderBlocks = [];
  const { bos, choch } = structure;

  const breakPoints = [...bos, ...choch].sort((a, b) => a.index - b.index);

  for (const bp of breakPoints) {
    const isBullish = bp.type.includes('bullish');

    if (isBullish) {
      // Look for the last bearish candle before this bullish break
      for (let i = bp.index - 1; i >= Math.max(0, bp.index - 10); i--) {
        if (candles[i].close < candles[i].open) {
          // Validate: the move after the OB should be strong
          const moveSize = Math.abs(candles[bp.index].close - candles[i].low);
          const avgRange = getAverageRange(candles, i, 20);

          if (moveSize > avgRange * 1.5) {
            orderBlocks.push({
              type: 'ob_bullish',
              startTime: candles[i].time,
              endTime: candles[Math.min(i + 1, candles.length - 1)].time,
              top: candles[i].open,
              bottom: candles[i].low,
              index: i,
              mitigated: isOBMitigated(candles, i, 'bullish'),
              strength: calculateOBStrength(candles, i, bp.index)
            });
            break;
          }
        }
      }
    } else {
      // Look for the last bullish candle before this bearish break
      for (let i = bp.index - 1; i >= Math.max(0, bp.index - 10); i--) {
        if (candles[i].close > candles[i].open) {
          const moveSize = Math.abs(candles[i].high - candles[bp.index].close);
          const avgRange = getAverageRange(candles, i, 20);

          if (moveSize > avgRange * 1.5) {
            orderBlocks.push({
              type: 'ob_bearish',
              startTime: candles[i].time,
              endTime: candles[Math.min(i + 1, candles.length - 1)].time,
              top: candles[i].high,
              bottom: candles[i].close,
              index: i,
              mitigated: isOBMitigated(candles, i, 'bearish'),
              strength: calculateOBStrength(candles, i, bp.index)
            });
            break;
          }
        }
      }
    }
  }

  // Only return unmitigated OBs (active zones)
  return orderBlocks.filter(ob => !ob.mitigated);
}

function isOBMitigated(candles, obIndex, type) {
  const ob = candles[obIndex];

  for (let i = obIndex + 2; i < candles.length; i++) {
    if (type === 'bullish') {
      // Bullish OB is mitigated when price returns and closes below it
      if (candles[i].close < ob.low) {
        return true;
      }
    } else {
      // Bearish OB is mitigated when price returns and closes above it
      if (candles[i].close > ob.high) {
        return true;
      }
    }
  }
  return false;
}

function calculateOBStrength(candles, obIndex, breakIndex) {
  // Strength based on: displacement after OB, volume, and how clean the move was
  const displacement = Math.abs(candles[breakIndex].close - candles[obIndex].close);
  const avgRange = getAverageRange(candles, obIndex, 20);
  const ratio = displacement / avgRange;

  if (ratio > 3) return 'strong';
  if (ratio > 2) return 'moderate';
  return 'weak';
}

function getAverageRange(candles, endIndex, period) {
  const start = Math.max(0, endIndex - period);
  let sum = 0;
  let count = 0;

  for (let i = start; i < endIndex; i++) {
    sum += candles[i].high - candles[i].low;
    count++;
  }

  return count > 0 ? sum / count : 0;
}

module.exports = { detectOrderBlocks };
