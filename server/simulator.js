/**
 * Trade Simulator
 * Simulates trades with $20 capital per operation and x30 leverage
 * Tracks PnL, open positions, and closed trades
 */

const fs = require('fs');
const path = require('path');

const SIMULATOR_FILE = path.join(__dirname, '..', 'data', 'simulator.json');

const CONFIG = {
  capitalPerTrade: 20,       // $20 per trade
  leverage: 30,              // x30
  positionSize: 20 * 30,    // $600 effective position
  makerFee: 0.0002,         // 0.02% maker
  takerFee: 0.0004,         // 0.04% taker
};

class TradeSimulator {
  constructor() {
    this.openPositions = [];
    this.closedTrades = [];
    this.balance = 0; // Running PnL (starts at 0, tracks profit/loss)
    this.totalDeposited = 0;
    this.load();
  }

  load() {
    try {
      const dir = path.dirname(SIMULATOR_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(SIMULATOR_FILE)) {
        const data = JSON.parse(fs.readFileSync(SIMULATOR_FILE, 'utf-8'));
        this.openPositions = data.openPositions || [];
        this.closedTrades = data.closedTrades || [];
        this.balance = data.balance || 0;
        this.totalDeposited = data.totalDeposited || 0;
        console.log(`Simulator loaded: ${this.openPositions.length} open, ${this.closedTrades.length} closed, Balance: $${this.balance.toFixed(2)}`);
      }
    } catch (err) {
      console.error('Error loading simulator:', err.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(SIMULATOR_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(SIMULATOR_FILE, JSON.stringify({
        openPositions: this.openPositions,
        closedTrades: this.closedTrades.slice(-100), // Keep last 100
        balance: this.balance,
        totalDeposited: this.totalDeposited
      }, null, 2));
    } catch (err) {
      console.error('Error saving simulator:', err.message);
    }
  }

  // Open a new simulated position
  openPosition(signal) {
    // Check for duplicate (same direction, similar entry)
    const isDuplicate = this.openPositions.some(p =>
      p.type === signal.type &&
      Math.abs(p.entry - signal.entry) < signal.entry * 0.001 &&
      Date.now() - p.openedAt < 60000
    );

    if (isDuplicate) return null;

    const entryFee = CONFIG.positionSize * CONFIG.takerFee;
    const position = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: signal.type, // 'long' or 'short'
      entry: signal.entry,
      sl: signal.sl,
      tp: signal.tp,
      rr: signal.rr,
      capital: CONFIG.capitalPerTrade,
      leverage: CONFIG.leverage,
      positionSize: CONFIG.positionSize,
      entryFee,
      openedAt: Date.now(),
      openedAtISO: new Date().toISOString(),
      timeframe: signal.timeframe,
      confidence: signal.confidence,
      reason: signal.reason,
      status: 'open',
      currentPnl: 0,
      currentPnlPercent: 0
    };

    this.openPositions.push(position);
    this.totalDeposited += CONFIG.capitalPerTrade;
    this.save();

    console.log(`[SIM] Opened ${signal.type.toUpperCase()} @ ${signal.entry.toFixed(2)} | Size: $${CONFIG.positionSize} | SL: ${signal.sl.toFixed(2)} | TP: ${signal.tp.toFixed(2)}`);
    return position;
  }

  // Update all open positions with current price
  updatePositions(currentPrice) {
    let updated = false;

    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const pos = this.openPositions[i];

      // Calculate current PnL
      let priceDiff;
      if (pos.type === 'long') {
        priceDiff = currentPrice - pos.entry;
      } else {
        priceDiff = pos.entry - currentPrice;
      }

      const pnlRaw = (priceDiff / pos.entry) * pos.positionSize;
      const fees = pos.entryFee; // Exit fee added on close
      pos.currentPnl = pnlRaw - fees;
      pos.currentPnlPercent = ((pos.currentPnl / pos.capital) * 100).toFixed(2);

      // Check TP hit
      if (pos.type === 'long' && currentPrice >= pos.tp) {
        this.closePosition(i, currentPrice, 'tp');
        updated = true;
      } else if (pos.type === 'short' && currentPrice <= pos.tp) {
        this.closePosition(i, currentPrice, 'tp');
        updated = true;
      }
      // Check SL hit
      else if (pos.type === 'long' && currentPrice <= pos.sl) {
        this.closePosition(i, currentPrice, 'sl');
        updated = true;
      } else if (pos.type === 'short' && currentPrice >= pos.sl) {
        this.closePosition(i, currentPrice, 'sl');
        updated = true;
      }
      // Check liquidation (loss > capital)
      else if (pos.currentPnl <= -(pos.capital * 0.95)) {
        this.closePosition(i, currentPrice, 'liquidated');
        updated = true;
      }
    }

    if (updated) this.save();
    return updated;
  }

  closePosition(index, closePrice, reason) {
    const pos = this.openPositions[index];

    let priceDiff;
    if (pos.type === 'long') {
      priceDiff = closePrice - pos.entry;
    } else {
      priceDiff = pos.entry - closePrice;
    }

    const exitFee = CONFIG.positionSize * CONFIG.takerFee;
    const totalFees = pos.entryFee + exitFee;
    const grossPnl = (priceDiff / pos.entry) * pos.positionSize;
    const netPnl = grossPnl - totalFees;

    const closedTrade = {
      ...pos,
      closePrice,
      closedAt: Date.now(),
      closedAtISO: new Date().toISOString(),
      closeReason: reason,
      grossPnl: grossPnl.toFixed(2),
      fees: totalFees.toFixed(2),
      netPnl: netPnl.toFixed(2),
      netPnlPercent: ((netPnl / pos.capital) * 100).toFixed(2),
      status: 'closed',
      result: netPnl >= 0 ? 'win' : 'loss'
    };

    this.closedTrades.unshift(closedTrade);
    this.balance += netPnl;
    this.openPositions.splice(index, 1);

    const emoji = netPnl >= 0 ? '✅' : '❌';
    console.log(`[SIM] ${emoji} Closed ${pos.type.toUpperCase()} @ ${closePrice.toFixed(2)} | Reason: ${reason} | PnL: $${netPnl.toFixed(2)} (${closedTrade.netPnlPercent}%)`);

    return closedTrade;
  }

  getStats() {
    const wins = this.closedTrades.filter(t => t.result === 'win');
    const losses = this.closedTrades.filter(t => t.result === 'loss');
    const totalTrades = this.closedTrades.length;
    const winRate = totalTrades > 0 ? ((wins.length / totalTrades) * 100).toFixed(1) : '0.0';

    const totalProfit = wins.reduce((sum, t) => sum + parseFloat(t.netPnl), 0);
    const totalLoss = losses.reduce((sum, t) => sum + Math.abs(parseFloat(t.netPnl)), 0);
    const profitFactor = totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : '∞';

    const avgWin = wins.length > 0 ? (totalProfit / wins.length).toFixed(2) : '0.00';
    const avgLoss = losses.length > 0 ? (totalLoss / losses.length).toFixed(2) : '0.00';

    // Max consecutive losses
    let maxConsecLosses = 0;
    let currentStreak = 0;
    for (const t of [...this.closedTrades].reverse()) {
      if (t.result === 'loss') {
        currentStreak++;
        maxConsecLosses = Math.max(maxConsecLosses, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    // Max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;
    for (const t of [...this.closedTrades].reverse()) {
      runningPnl += parseFloat(t.netPnl);
      peak = Math.max(peak, runningPnl);
      const dd = peak - runningPnl;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }

    return {
      totalTrades,
      openPositions: this.openPositions.length,
      wins: wins.length,
      losses: losses.length,
      winRate: `${winRate}%`,
      balance: this.balance.toFixed(2),
      totalDeposited: this.totalDeposited.toFixed(2),
      roi: this.totalDeposited > 0 ? ((this.balance / this.totalDeposited) * 100).toFixed(2) : '0.00',
      profitFactor,
      avgWin,
      avgLoss,
      maxConsecLosses,
      maxDrawdown: maxDrawdown.toFixed(2),
      config: CONFIG
    };
  }

  getOpenPositions() {
    return this.openPositions;
  }

  getClosedTrades(limit = 30) {
    return this.closedTrades.slice(0, limit);
  }
}

module.exports = { TradeSimulator, CONFIG };
