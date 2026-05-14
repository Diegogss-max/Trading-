/**
 * Signal History Manager
 * Stores all generated signals with timestamp, type, and risk management details
 * Persists to a JSON file for durability across restarts
 */

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'signal_history.json');
const MAX_HISTORY = 200; // Keep last 200 signals

class SignalHistory {
  constructor() {
    this.signals = [];
    this.load();
  }

  load() {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        this.signals = JSON.parse(data);
        console.log(`Signal history loaded: ${this.signals.length} signals`);
      }
    } catch (err) {
      console.error('Error loading signal history:', err.message);
      this.signals = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.signals, null, 2));
    } catch (err) {
      console.error('Error saving signal history:', err.message);
    }
  }

  addSignal(signal) {
    // Check for duplicates (same type, similar entry within 1 minute)
    const isDuplicate = this.signals.some(s =>
      s.type === signal.type &&
      s.timeframe === signal.timeframe &&
      Math.abs(s.entry - signal.entry) < signal.entry * 0.0005 &&
      Math.abs(s.timestamp - signal.timestamp) < 60000
    );

    if (isDuplicate) return false;

    const historyEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      dateTime: new Date().toISOString(),
      type: signal.type,
      timeframe: signal.timeframe,
      entry: signal.entry,
      sl: signal.sl,
      tp: signal.tp,
      rr: signal.rr,
      confidence: signal.confidence,
      reason: signal.reason,
      riskManagement: {
        riskRewardRatio: `1:${signal.rr}`,
        stopLossDistance: Math.abs(signal.entry - signal.sl).toFixed(2),
        stopLossPercent: ((Math.abs(signal.entry - signal.sl) / signal.entry) * 100).toFixed(2),
        takeProfitDistance: Math.abs(signal.tp - signal.entry).toFixed(2),
        takeProfitPercent: ((Math.abs(signal.tp - signal.entry) / signal.entry) * 100).toFixed(2),
      },
      status: 'active', // active, hit_tp, hit_sl, expired
      result: null
    };

    this.signals.unshift(historyEntry);

    // Trim to max
    if (this.signals.length > MAX_HISTORY) {
      this.signals = this.signals.slice(0, MAX_HISTORY);
    }

    this.save();
    return historyEntry;
  }

  // Update signal status based on current price
  updateSignalStatuses(currentPrice) {
    let updated = false;

    for (const signal of this.signals) {
      if (signal.status !== 'active') continue;

      // Check if TP hit
      if (signal.type === 'long' && currentPrice >= signal.tp) {
        signal.status = 'hit_tp';
        signal.result = 'win';
        signal.closedAt = Date.now();
        signal.closedPrice = currentPrice;
        updated = true;
      } else if (signal.type === 'short' && currentPrice <= signal.tp) {
        signal.status = 'hit_tp';
        signal.result = 'win';
        signal.closedAt = Date.now();
        signal.closedPrice = currentPrice;
        updated = true;
      }

      // Check if SL hit
      if (signal.type === 'long' && currentPrice <= signal.sl) {
        signal.status = 'hit_sl';
        signal.result = 'loss';
        signal.closedAt = Date.now();
        signal.closedPrice = currentPrice;
        updated = true;
      } else if (signal.type === 'short' && currentPrice >= signal.sl) {
        signal.status = 'hit_sl';
        signal.result = 'loss';
        signal.closedAt = Date.now();
        signal.closedPrice = currentPrice;
        updated = true;
      }

      // Expire signals older than 24h
      if (Date.now() - signal.timestamp > 24 * 60 * 60 * 1000) {
        signal.status = 'expired';
        signal.result = 'expired';
        updated = true;
      }
    }

    if (updated) this.save();
    return updated;
  }

  getHistory(limit = 50) {
    return this.signals.slice(0, limit);
  }

  getStats() {
    const closed = this.signals.filter(s => s.status !== 'active');
    const wins = closed.filter(s => s.result === 'win').length;
    const losses = closed.filter(s => s.result === 'loss').length;
    const expired = closed.filter(s => s.result === 'expired').length;
    const active = this.signals.filter(s => s.status === 'active').length;
    const total = closed.length - expired;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    return {
      total: this.signals.length,
      active,
      wins,
      losses,
      expired,
      winRate: `${winRate}%`
    };
  }

  generateId() {
    return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
}

module.exports = { SignalHistory };
