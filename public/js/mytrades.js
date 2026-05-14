// My Trades - Tracks user's actual entries
const MyTrades = (function () {
  'use strict';

  let openTrades = [];
  let closedTrades = [];

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem('smc_mytrades') || '{}');
      openTrades = data.open || [];
      closedTrades = data.closed || [];
    } catch (e) { /* ignore */ }
  }

  function save() {
    localStorage.setItem('smc_mytrades', JSON.stringify({
      open: openTrades,
      closed: closedTrades.slice(0, 50)
    }));
  }

  function addTrade(signal, entryPrice) {
    const trade = {
      id: `mt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: signal.type,
      entryPrice: entryPrice,
      sl: signal.sl,
      tp: signal.tp,
      rr: signal.rr,
      confidence: signal.confidence,
      reason: signal.reason,
      timeframe: signal.timeframe,
      signalEntry: signal.entry,
      enteredAt: Date.now(),
      status: 'open'
    };

    openTrades.push(trade);
    save();
    return trade;
  }

  function closeTrade(tradeId, closePrice, reason) {
    const index = openTrades.findIndex(t => t.id === tradeId);
    if (index === -1) return null;

    const trade = openTrades[index];
    const priceDiff = trade.type === 'long'
      ? closePrice - trade.entryPrice
      : trade.entryPrice - closePrice;
    const pnlPercent = ((priceDiff / trade.entryPrice) * 100).toFixed(2);

    const closed = {
      ...trade,
      closePrice,
      closedAt: Date.now(),
      closeReason: reason,
      pnlPercent,
      result: parseFloat(pnlPercent) >= 0 ? 'win' : 'loss',
      status: 'closed'
    };

    closedTrades.unshift(closed);
    openTrades.splice(index, 1);
    save();
    return closed;
  }

  function getStats() {
    const wins = closedTrades.filter(t => t.result === 'win').length;
    const losses = closedTrades.filter(t => t.result === 'loss').length;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    return { wins, losses, total, winRate: `${winRate}%` };
  }

  load();

  return {
    addTrade,
    closeTrade,
    getOpen: () => openTrades,
    getClosed: (n) => closedTrades.slice(0, n || 30),
    getStats
  };
})();
