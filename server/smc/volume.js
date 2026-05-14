/**
 * Volume Analysis
 * Analyzes volume patterns to confirm SMC zones
 * - Relative volume (compared to average)
 * - Volume at key zones (OBs, FVGs)
 * - Buying/selling pressure estimation
 */

function analyzeVolume(candles) {
  if (!candles || candles.length < 20) return null;

  const recent = candles.slice(-50);
  const avgVolume = getAverageVolume(recent);
  const currentVolume = candles[candles.length - 1].volume;
  const relativeVolume = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // Volume trend (increasing or decreasing)
  const volumeTrend = getVolumeTrend(candles.slice(-20));

  // Estimate buying vs selling pressure from recent candles
  const pressure = estimatePressure(candles.slice(-10));

  return {
    currentVolume,
    avgVolume: avgVolume.toFixed(2),
    relativeVolume: relativeVolume.toFixed(2),
    isHighVolume: relativeVolume > 1.5,
    isVeryHighVolume: relativeVolume > 2.5,
    volumeTrend,
    pressure,
    label: getVolumeLabel(relativeVolume)
  };
}

function getVolumeAtIndex(candles, index, lookback = 5) {
  const start = Math.max(0, index - lookback);
  const end = Math.min(candles.length, index + lookback);
  const slice = candles.slice(start, end);
  const avgVol = getAverageVolume(candles.slice(Math.max(0, index - 50), index));

  let zoneVolume = 0;
  for (const c of slice) {
    zoneVolume += c.volume;
  }

  const relVol = avgVol > 0 ? (zoneVolume / slice.length) / avgVol : 1;

  return {
    zoneVolume,
    relativeVolume: relVol.toFixed(2),
    isSignificant: relVol > 1.5
  };
}

function getAverageVolume(candles) {
  if (!candles || candles.length === 0) return 0;
  let sum = 0;
  for (const c of candles) {
    sum += c.volume;
  }
  return sum / candles.length;
}

function getVolumeTrend(candles) {
  if (candles.length < 10) return 'neutral';

  const firstHalf = candles.slice(0, Math.floor(candles.length / 2));
  const secondHalf = candles.slice(Math.floor(candles.length / 2));

  const avgFirst = getAverageVolume(firstHalf);
  const avgSecond = getAverageVolume(secondHalf);

  const ratio = avgFirst > 0 ? avgSecond / avgFirst : 1;

  if (ratio > 1.3) return 'increasing';
  if (ratio < 0.7) return 'decreasing';
  return 'stable';
}

function estimatePressure(candles) {
  let buyVolume = 0;
  let sellVolume = 0;

  for (const c of candles) {
    const range = c.high - c.low;
    if (range === 0) continue;

    // Estimate: if close > open, more buying; if close < open, more selling
    // Weight by how close the close is to the high/low
    const buyRatio = (c.close - c.low) / range;
    const sellRatio = (c.high - c.close) / range;

    buyVolume += c.volume * buyRatio;
    sellVolume += c.volume * sellRatio;
  }

  const total = buyVolume + sellVolume;
  const buyPercent = total > 0 ? (buyVolume / total * 100).toFixed(1) : 50;
  const sellPercent = total > 0 ? (sellVolume / total * 100).toFixed(1) : 50;

  let dominance = 'neutral';
  if (buyPercent > 60) dominance = 'buyers';
  else if (sellPercent > 60) dominance = 'sellers';

  return {
    buyPercent,
    sellPercent,
    dominance
  };
}

function getVolumeLabel(relVol) {
  if (relVol >= 3) return 'Extremo';
  if (relVol >= 2) return 'Muy Alto';
  if (relVol >= 1.5) return 'Alto';
  if (relVol >= 0.8) return 'Normal';
  return 'Bajo';
}

module.exports = { analyzeVolume, getVolumeAtIndex };
