// Trade Simulator - Client-side with localStorage persistence
const Simulator = (function () {
  'use strict';

  const CONFIG = { capitalPerTrade: 20, leverage: 30, positionSize: 600, fee: 0.0004 };
  let openPositions = [];
  let closedTrades = [];
  let balance = 0;

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem('smc_simulator') || '{}');
      openPositions = data.openPositions || [];
      closedTrades = data.closedTrades || [];
      balance = data.balance || 0;
    } catch (e) { /* ignore */ }
  }

  function save() {
    localStorage.setItem('smc_simulator', JSON.stringify({
      openPositions, closedTrades: closedTrades.slice(0, 100), balance
    }));
  }

  function openPosition(signal) {
    const isDup = openPositions.some(p => p.type === signal.type && Math.abs(p.entry - signal.entry) < signal.entry * 0.001 && Date.now() - p.openedAt < 60000);
    if (isDup) return null;

    const pos = {
      id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: signal.type, entry: signal.entry, sl: signal.sl, tp: signal.tp, rr: signal.rr,
      capital: CONFIG.capitalPerTrade, leverage: CONFIG.leverage, positionSize: CONFIG.positionSize,
      entryFee: CONFIG.positionSize * CONFIG.fee,
      openedAt: Date.now(), timeframe: signal.timeframe || '15m',
      confidence: signal.confidence, reason: signal.reason,
      status: 'open', currentPnl: 0, currentPnlPercent: 0
    };

    openPositions.push(pos);
    save();
    return pos;
  }

  function updatePositions(currentPrice) {
    let changed = false;

    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const diff = pos.type === 'long' ? currentPrice - pos.entry : pos.entry - currentPrice;
      const pnl = (diff / pos.entry) * pos.positionSize - pos.entryFee;
      pos.currentPnl = pnl;
      pos.currentPnlPercent = ((pnl / pos.capital) * 100).toFixed(2);

      let closeReason = null;
      if (pos.type === 'long' && currentPrice >= pos.tp) closeReason = 'tp';
      else if (pos.type === 'short' && currentPrice <= pos.tp) closeReason = 'tp';
      else if (pos.type === 'long' && currentPrice <= pos.sl) closeReason = 'sl';
      else if (pos.type === 'short' && currentPrice >= pos.sl) closeReason = 'sl';
      else if (pnl <= -(pos.capital * 0.95)) closeReason = 'liquidated';

      if (closeReason) {
        closePosition(i, currentPrice, closeReason);
        changed = true;
      }
    }

    if (changed) save();
    return changed;
  }

  function closePosition(index, closePrice, reason) {
    const pos = openPositions[index];
    const diff = pos.type === 'long' ? closePrice - pos.entry : pos.entry - closePrice;
    const exitFee = CONFIG.positionSize * CONFIG.fee;
    const netPnl = (diff / pos.entry) * pos.positionSize - pos.entryFee - exitFee;

    closedTrades.unshift({
      ...pos, closePrice, closedAt: Date.now(), closeReason: reason,
      netPnl: netPnl.toFixed(2), netPnlPercent: ((netPnl / pos.capital) * 100).toFixed(2),
      result: netPnl >= 0 ? 'win' : 'loss', status: 'closed'
    });

    balance += netPnl;
    openPositions.splice(index, 1);
  }

  function getStats() {
    const wins = closedTrades.filter(t => t.result === 'win');
    const losses = closedTrades.filter(t => t.result === 'loss');
    const total = closedTrades.length;
    const winRate = total > 0 ? ((wins.length / total) * 100).toFixed(1) : '0.0';
    const totalProfit = wins.reduce((s, t) => s + parseFloat(t.netPnl), 0);
    const totalLoss = losses.reduce((s, t) => s + Math.abs(parseFloat(t.netPnl)), 0);
    const pf = totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : '∞';
    const avgWin = wins.length > 0 ? (totalProfit / wins.length).toFixed(2) : '0.00';
    const avgLoss = losses.length > 0 ? (totalLoss / losses.length).toFixed(2) : '0.00';

    let maxStreak = 0, streak = 0, peak = 0, maxDD = 0, running = 0;
    for (const t of [...closedTrades].reverse()) {
      if (t.result === 'loss') { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
      running += parseFloat(t.netPnl); peak = Math.max(peak, running); maxDD = Math.max(maxDD, peak - running);
    }

    return { totalTrades: total, wins: wins.length, losses: losses.length, winRate: `${winRate}%`, balance: balance.toFixed(2), profitFactor: pf, avgWin, avgLoss, maxConsecLosses: maxStreak, maxDrawdown: maxDD.toFixed(2), openPositions: openPositions.length };
  }

  function reset() {
    openPositions = []; closedTrades = []; balance = 0;
    save();
  }

  load();

  return { openPosition, updatePositions, getStats, getOpenPositions: () => openPositions, getClosedTrades: (n) => closedTrades.slice(0, n || 30), reset, CONFIG };
})();
