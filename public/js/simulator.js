// Signal Tracker - Tracks active signals and their outcomes
const SignalTracker = (function () {
  'use strict';

  let activeSignals = [];
  let historySignals = [];

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem('smc_signals') || '{}');
      activeSignals = data.active || [];
      historySignals = data.history || [];
    } catch (e) { /* ignore */ }
  }

  function save() {
    localStorage.setItem('smc_signals', JSON.stringify({
      active: activeSignals,
      history: historySignals.slice(0, 100)
    }));
  }

  function addSignal(signal) {
    const isDup = activeSignals.some(s => s.type === signal.type && Math.abs(s.entry - signal.entry) < signal.entry * 0.001 && Date.now() - s.createdAt < 60000);
    if (isDup) return null;

    const tracked = {
      id: `s_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: signal.type,
      entry: signal.entry,
      sl: signal.sl,
      tp: signal.tp,
      rr: signal.rr,
      confidence: signal.confidence,
      reason: signal.reason,
      timeframe: signal.timeframe || '15m',
      createdAt: Date.now(),
      status: 'active', // active, hit_tp, hit_sl, expired
      feasible: true,
      feasibleReason: ''
    };

    activeSignals.push(tracked);
    save();
    return tracked;
  }

  function updateWithPrice(currentPrice) {
    let changed = false;

    for (let i = activeSignals.length - 1; i >= 0; i--) {
      const s = activeSignals[i];

      // Update feasibility
      updateFeasibility(s, currentPrice);

      // Check TP hit
      if (s.type === 'long' && currentPrice >= s.tp) {
        moveToHistory(i, 'hit_tp', currentPrice);
        changed = true;
      } else if (s.type === 'short' && currentPrice <= s.tp) {
        moveToHistory(i, 'hit_tp', currentPrice);
        changed = true;
      }
      // Check SL hit
      else if (s.type === 'long' && currentPrice <= s.sl) {
        moveToHistory(i, 'hit_sl', currentPrice);
        changed = true;
      } else if (s.type === 'short' && currentPrice >= s.sl) {
        moveToHistory(i, 'hit_sl', currentPrice);
        changed = true;
      }
      // Expire after 4 hours
      else if (Date.now() - s.createdAt > 4 * 60 * 60 * 1000) {
        moveToHistory(i, 'expired', currentPrice);
        changed = true;
      }
    }

    if (changed) save();
    return changed;
  }

  function updateFeasibility(signal, currentPrice) {
    const entryDist = Math.abs(currentPrice - signal.entry) / signal.entry;
    const slDist = Math.abs(currentPrice - signal.sl);
    const tpDist = Math.abs(signal.tp - currentPrice);
    const totalRange = Math.abs(signal.tp - signal.sl);
    const progressToTP = signal.type === 'long'
      ? (currentPrice - signal.entry) / (signal.tp - signal.entry)
      : (signal.entry - currentPrice) / (signal.entry - signal.tp);
    const progressToSL = signal.type === 'long'
      ? (signal.entry - currentPrice) / (signal.entry - signal.sl)
      : (currentPrice - signal.entry) / (signal.sl - signal.entry);

    // Determine if still feasible to enter
    if (progressToTP >= 0.7) {
      signal.feasible = false;
      signal.feasibleReason = 'Precio muy cerca del TP, poco recorrido restante';
    } else if (progressToSL >= 0.8) {
      signal.feasible = false;
      signal.feasibleReason = 'Precio muy cerca del SL, riesgo alto';
    } else if (entryDist > 0.005 && progressToTP > 0.4) {
      signal.feasible = false;
      signal.feasibleReason = 'Precio se alejó del entry, R:R desfavorable';
    } else {
      // Calculate current R:R if entering now
      const currentRisk = signal.type === 'long' ? currentPrice - signal.sl : signal.sl - currentPrice;
      const currentReward = signal.type === 'long' ? signal.tp - currentPrice : currentPrice - signal.tp;
      const currentRR = currentRisk > 0 ? currentReward / currentRisk : 0;

      if (currentRR < 0.8) {
        signal.feasible = false;
        signal.feasibleReason = `R:R actual ${currentRR.toFixed(1)}:1, desfavorable`;
      } else if (currentRR >= 1.5) {
        signal.feasible = true;
        signal.feasibleReason = `Excelente entrada, R:R ${currentRR.toFixed(1)}:1`;
      } else if (currentRR >= 1.0) {
        signal.feasible = true;
        signal.feasibleReason = `Entrada aceptable, R:R ${currentRR.toFixed(1)}:1`;
      } else {
        signal.feasible = true;
        signal.feasibleReason = `Entrada ajustada, R:R ${currentRR.toFixed(1)}:1`;
      }
    }
  }

  function moveToHistory(index, status, closePrice) {
    const s = activeSignals[index];
    s.status = status;
    s.closedAt = Date.now();
    s.closePrice = closePrice;

    const priceDiff = s.type === 'long' ? closePrice - s.entry : s.entry - closePrice;
    s.result = status === 'hit_tp' ? 'win' : status === 'hit_sl' ? 'loss' : 'expired';
    s.pnlPercent = ((priceDiff / s.entry) * 100).toFixed(2);

    historySignals.unshift(s);
    activeSignals.splice(index, 1);
  }

  function getStats() {
    const wins = historySignals.filter(s => s.result === 'win').length;
    const losses = historySignals.filter(s => s.result === 'loss').length;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    return { wins, losses, total, winRate: `${winRate}%`, expired: historySignals.filter(s => s.result === 'expired').length, active: activeSignals.length };
  }

  function reset() {
    activeSignals = [];
    historySignals = [];
    save();
  }

  load();

  return {
    addSignal,
    updateWithPrice,
    getActive: () => activeSignals,
    getHistory: (n) => historySignals.slice(0, n || 30),
    getStats,
    reset
  };
})();
