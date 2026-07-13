/**
 * Market Structure Analysis
 * Detects swing highs/lows, BOS (Break of Structure), and CHoCH (Change of Character)
 */

function findSwingPoints(candles, lookback = 10) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwingHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swingHighs.push({ index: i, price: candles[i].high, time: candles[i].time });
    }
    if (isSwingLow) {
      swingLows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
  }

  return { swingHighs, swingLows };
}

function analyzeStructure(candles) {
  const lookback = 10;
  const { swingHighs, swingLows } = findSwingPoints(candles, lookback);
  const bos = [];
  const choch = [];

  let trend = 'neutral'; // 'bullish', 'bearish', 'neutral'
  let currentTrend = 'neutral';

  let activeHighs = [];
  let activeLows = [];

  for (let i = 0; i < candles.length; i++) {
    // Add swing points that are now fully confirmed (i.e. we have passed the lookback period)
    const newHigh = swingHighs.find(sh => sh.index === i - lookback);
    if (newHigh) activeHighs.push(newHigh);

    const newLow = swingLows.find(sl => sl.index === i - lookback);
    if (newLow) activeLows.push(newLow);

    const closePrice = candles[i].close;

    // Check for bullish breakout (candle close breaks the most recent active swing high)
    if (activeHighs.length > 0) {
      const lastHigh = activeHighs[activeHighs.length - 1];
      if (closePrice > lastHigh.price) {
        if (currentTrend === 'bearish') {
          choch.push({
            type: 'choch_bullish',
            time: candles[i].time,
            price: lastHigh.price,
            index: i
          });
          currentTrend = 'bullish';
        } else {
          bos.push({
            type: 'bos_bullish',
            time: candles[i].time,
            price: lastHigh.price,
            index: i
          });
          if (currentTrend === 'neutral') currentTrend = 'bullish';
        }
        // Once a break occurs, clear active highs to wait for new structure development
        activeHighs = [];
      }
    }

    // Check for bearish breakout (candle close breaks the most recent active swing low)
    if (activeLows.length > 0) {
      const lastLow = activeLows[activeLows.length - 1];
      if (closePrice < lastLow.price) {
        if (currentTrend === 'bullish') {
          choch.push({
            type: 'choch_bearish',
            time: candles[i].time,
            price: lastLow.price,
            index: i
          });
          currentTrend = 'bearish';
        } else {
          bos.push({
            type: 'bos_bearish',
            time: candles[i].time,
            price: lastLow.price,
            index: i
          });
          if (currentTrend === 'neutral') currentTrend = 'bearish';
        }
        // Once a break occurs, clear active lows
        activeLows = [];
      }
    }
  }

  // Determine overall trend
  if (bos.length > 0) {
    const lastBos = bos[bos.length - 1];
    trend = lastBos.type.includes('bullish') ? 'bullish' : 'bearish';
  }
  if (choch.length > 0) {
    const lastChoch = choch[choch.length - 1];
    const lastBos = bos.length > 0 ? bos[bos.length - 1] : null;
    if (!lastBos || lastChoch.index > lastBos.index) {
      trend = lastChoch.type.includes('bullish') ? 'bullish' : 'bearish';
    }
  }

  return {
    swingHighs,
    swingLows,
    bos,
    choch,
    trend,
    currentTrend
  };
}

module.exports = { analyzeStructure, findSwingPoints };
