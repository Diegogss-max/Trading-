/**
 * Premium/Discount Zone Calculation
 * Based on the current dealing range (last significant swing high to swing low)
 * Premium: above 50% (equilibrium) - ideal for shorts
 * Discount: below 50% (equilibrium) - ideal for longs
 */

function calculatePremiumDiscount(candles, structure) {
  const { swingHighs, swingLows } = structure;

  if (swingHighs.length === 0 || swingLows.length === 0) {
    return null;
  }

  // Find the current dealing range
  // Use the most recent significant swing high and low
  const recentHighs = swingHighs.slice(-5);
  const recentLows = swingLows.slice(-5);

  let rangeHigh = Math.max(...recentHighs.map(h => h.price));
  let rangeLow = Math.min(...recentLows.map(l => l.price));

  // Find the actual swing points for the range
  const highPoint = recentHighs.find(h => h.price === rangeHigh);
  const lowPoint = recentLows.find(l => l.price === rangeLow);

  const equilibrium = (rangeHigh + rangeLow) / 2;
  const currentPrice = candles[candles.length - 1].close;

  // Calculate zones
  const premiumZone = {
    top: rangeHigh,
    bottom: equilibrium,
    label: 'Premium'
  };

  const discountZone = {
    top: equilibrium,
    bottom: rangeLow,
    label: 'Discount'
  };

  // Fibonacci levels within the range
  const range = rangeHigh - rangeLow;
  const fibLevels = {
    '0.0': rangeLow,
    '0.236': rangeLow + range * 0.236,
    '0.382': rangeLow + range * 0.382,
    '0.5': equilibrium,
    '0.618': rangeLow + range * 0.618,
    '0.786': rangeLow + range * 0.786,
    '1.0': rangeHigh
  };

  // Optimal Trade Entry (OTE) zone: 0.618 - 0.786 retracement
  const oteZone = {
    top: fibLevels['0.786'],
    bottom: fibLevels['0.618']
  };

  // Determine current position
  let position = 'neutral';
  if (currentPrice > equilibrium) {
    position = 'premium';
  } else if (currentPrice < equilibrium) {
    position = 'discount';
  }

  return {
    rangeHigh,
    rangeLow,
    equilibrium,
    premiumZone,
    discountZone,
    fibLevels,
    oteZone,
    position,
    currentPrice,
    highTime: highPoint ? highPoint.time : candles[candles.length - 1].time,
    lowTime: lowPoint ? lowPoint.time : candles[0].time
  };
}

module.exports = { calculatePremiumDiscount };
