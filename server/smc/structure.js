/**
 * Market Structure Analysis
 * Detects swing highs/lows, BOS (Break of Structure), and CHoCH (Change of Character)
 */

function findSwingPoints(candles, lookback = 5) {
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
  const { swingHighs, swingLows } = findSwingPoints(candles);
  const bos = [];
  const choch = [];

  // Determine trend based on swing points
  let trend = 'neutral'; // 'bullish', 'bearish', 'neutral'
  let lastHigherHigh = null;
  let lastHigherLow = null;
  let lastLowerHigh = null;
  let lastLowerLow = null;

  // Analyze consecutive swing highs and lows for structure
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i].price > swingHighs[i - 1].price) {
      lastHigherHigh = swingHighs[i];
    } else {
      lastLowerHigh = swingHighs[i];
    }
  }

  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i].price > swingLows[i - 1].price) {
      lastHigherLow = swingLows[i];
    } else {
      lastLowerLow = swingLows[i];
    }
  }

  // Detect BOS and CHoCH
  // BOS: price breaks a swing point in the direction of the trend
  // CHoCH: price breaks a swing point against the trend (trend reversal signal)
  let currentTrend = 'neutral';

  const allSwings = [];
  swingHighs.forEach(sh => allSwings.push({ ...sh, type: 'high' }));
  swingLows.forEach(sl => allSwings.push({ ...sl, type: 'low' }));
  allSwings.sort((a, b) => a.index - b.index);

  for (let i = 2; i < allSwings.length; i++) {
    const prev = allSwings[i - 2];
    const mid = allSwings[i - 1];
    const curr = allSwings[i];

    // Bullish BOS: new higher high after higher low
    if (curr.type === 'high' && mid.type === 'low') {
      const prevHigh = allSwings.slice(0, i).filter(s => s.type === 'high').pop();
      if (prevHigh && curr.price > prevHigh.price) {
        if (currentTrend === 'bullish') {
          bos.push({
            type: 'bos_bullish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
        } else if (currentTrend === 'bearish') {
          choch.push({
            type: 'choch_bullish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
          currentTrend = 'bullish';
        } else {
          currentTrend = 'bullish';
          bos.push({
            type: 'bos_bullish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
        }
      }
    }

    // Bearish BOS: new lower low after lower high
    if (curr.type === 'low' && mid.type === 'high') {
      const prevLow = allSwings.slice(0, i).filter(s => s.type === 'low').pop();
      if (prevLow && curr.price < prevLow.price) {
        if (currentTrend === 'bearish') {
          bos.push({
            type: 'bos_bearish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
        } else if (currentTrend === 'bullish') {
          choch.push({
            type: 'choch_bearish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
          currentTrend = 'bearish';
        } else {
          currentTrend = 'bearish';
          bos.push({
            type: 'bos_bearish',
            time: candles[curr.index].time,
            price: curr.price,
            index: curr.index
          });
        }
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
