/**
 * Liquidity Detection
 * Identifies areas where stop losses are likely clustered:
 * - Equal highs/lows (liquidity pools)
 * - Swing point clusters
 * - Trendline liquidity
 */

function detectLiquidity(candles, structure) {
  const liquidityZones = [];
  const { swingHighs, swingLows } = structure;
  const tolerance = getAverageTolerance(candles);

  // Detect equal highs (sell-side liquidity above)
  for (let i = 0; i < swingHighs.length - 1; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      const diff = Math.abs(swingHighs[i].price - swingHighs[j].price);
      if (diff < tolerance) {
        const avgPrice = (swingHighs[i].price + swingHighs[j].price) / 2;
        // Check if not already swept
        const swept = isLiquiditySwept(candles, swingHighs[j].index, avgPrice, 'high');

        if (!swept) {
          liquidityZones.push({
            type: 'equal_highs',
            price: avgPrice,
            startTime: candles[swingHighs[i].index].time,
            endTime: candles[swingHighs[j].index].time,
            index: swingHighs[j].index,
            touches: 2,
            swept: false
          });
        }
      }
    }
  }

  // Detect equal lows (buy-side liquidity below)
  for (let i = 0; i < swingLows.length - 1; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      const diff = Math.abs(swingLows[i].price - swingLows[j].price);
      if (diff < tolerance) {
        const avgPrice = (swingLows[i].price + swingLows[j].price) / 2;
        const swept = isLiquiditySwept(candles, swingLows[j].index, avgPrice, 'low');

        if (!swept) {
          liquidityZones.push({
            type: 'equal_lows',
            price: avgPrice,
            startTime: candles[swingLows[i].index].time,
            endTime: candles[swingLows[j].index].time,
            index: swingLows[j].index,
            touches: 2,
            swept: false
          });
        }
      }
    }
  }

  // Detect swing high liquidity (single prominent highs)
  const recentHighs = swingHighs.slice(-10);
  for (const sh of recentHighs) {
    const swept = isLiquiditySwept(candles, sh.index, sh.price, 'high');
    if (!swept) {
      liquidityZones.push({
        type: 'swing_high_liq',
        price: sh.price,
        startTime: candles[sh.index].time,
        endTime: candles[sh.index].time,
        index: sh.index,
        touches: 1,
        swept: false
      });
    }
  }

  // Detect swing low liquidity (single prominent lows)
  const recentLows = swingLows.slice(-10);
  for (const sl of recentLows) {
    const swept = isLiquiditySwept(candles, sl.index, sl.price, 'low');
    if (!swept) {
      liquidityZones.push({
        type: 'swing_low_liq',
        price: sl.price,
        startTime: candles[sl.index].time,
        endTime: candles[sl.index].time,
        index: sl.index,
        touches: 1,
        swept: false
      });
    }
  }

  // Deduplicate nearby zones
  return deduplicateZones(liquidityZones, tolerance);
}

function isLiquiditySwept(candles, fromIndex, price, type) {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    if (type === 'high' && candles[i].high > price) {
      return true;
    }
    if (type === 'low' && candles[i].low < price) {
      return true;
    }
  }
  return false;
}

function getAverageTolerance(candles) {
  // Tolerance is a percentage of average price range
  const recent = candles.slice(-50);
  let totalRange = 0;
  for (const c of recent) {
    totalRange += c.high - c.low;
  }
  return (totalRange / recent.length) * 0.3;
}

function deduplicateZones(zones, tolerance) {
  const unique = [];
  for (const zone of zones) {
    const exists = unique.find(z =>
      Math.abs(z.price - zone.price) < tolerance &&
      z.type === zone.type
    );
    if (!exists) {
      unique.push(zone);
    } else {
      exists.touches++;
    }
  }
  return unique;
}

module.exports = { detectLiquidity };
