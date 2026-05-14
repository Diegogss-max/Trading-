const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const http = require('http');
const { BinanceClient } = require('./binance');
const { analyzeStructure } = require('./smc/structure');
const { detectOrderBlocks } = require('./smc/orderBlocks');
const { detectFVG } = require('./smc/fvg');
const { detectLiquidity } = require('./smc/liquidity');
const { calculatePremiumDiscount } = require('./smc/premiumDiscount');
const { generateSignals } = require('./smc/signals');
const { getCurrentSession, getSessionForTime } = require('./smc/sessions');
const { analyzeDisplacement, analyzeRangeDisplacement } = require('./smc/displacement');
const { analyzeVolume, getVolumeAtIndex } = require('./smc/volume');
const { SignalHistory } = require('./signalHistory');
const { TradeSimulator } = require('./simulator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Signal history instance
const signalHistory = new SignalHistory();

// Trade simulator instance
const simulator = new TradeSimulator();

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// API endpoint for signal history
app.get('/api/signals/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = signalHistory.getHistory(limit);
  const stats = signalHistory.getStats();
  res.json({ history, stats });
});

// API endpoint for signal stats
app.get('/api/signals/stats', (req, res) => {
  const stats = signalHistory.getStats();
  res.json(stats);
});

// API endpoint for simulator data
app.get('/api/simulator', (req, res) => {
  const stats = simulator.getStats();
  const openPositions = simulator.getOpenPositions();
  const closedTrades = simulator.getClosedTrades(30);
  res.json({ stats, openPositions, closedTrades });
});

const PORT = process.env.PORT || 3000;

// Store candle data per timeframe
const candleData = {};
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const MAX_CANDLES = 500;

// Store higher timeframe analysis for context
let htfAnalysis = { '4h': null, '1d': null };

const binance = new BinanceClient();

// Initialize historical data for all timeframes
async function initializeData() {
  console.log('Initializing historical data...');
  for (const tf of TIMEFRAMES) {
    try {
      const candles = await binance.getKlines('BTCUSDT', tf, MAX_CANDLES);
      candleData[tf] = candles;
      console.log(`Loaded ${candles.length} candles for ${tf}`);
    } catch (err) {
      console.error(`Error loading ${tf}:`, err.message);
      candleData[tf] = [];
    }
  }

  // Perform initial HTF analysis
  updateHTFAnalysis();
  console.log('Data initialization complete.');
}

function updateHTFAnalysis() {
  for (const tf of ['4h', '1d']) {
    if (candleData[tf] && candleData[tf].length > 50) {
      const structure = analyzeStructure(candleData[tf]);
      const obs = detectOrderBlocks(candleData[tf], structure);
      const fvgs = detectFVG(candleData[tf]);
      const liquidity = detectLiquidity(candleData[tf], structure);
      const pd = calculatePremiumDiscount(candleData[tf], structure);

      htfAnalysis[tf] = { structure, obs, fvgs, liquidity, pd };
    }
  }
}

function performAnalysis(timeframe) {
  const candles = candleData[timeframe];
  if (!candles || candles.length < 50) return null;

  const structure = analyzeStructure(candles);
  const obs = detectOrderBlocks(candles, structure);
  const fvgs = detectFVG(candles);
  const liquidity = detectLiquidity(candles, structure);
  const pd = calculatePremiumDiscount(candles, structure);
  const session = getCurrentSession();
  const volume = analyzeVolume(candles);

  const signals = generateSignals(candles, {
    structure,
    obs,
    fvgs,
    liquidity,
    pd,
    htfAnalysis,
    timeframe,
    session,
    volume
  });

  // Multi-timeframe summary
  const mtfSummary = getMTFSummary();

  return { structure, obs, fvgs, liquidity, pd, signals, session, volume, mtfSummary };
}

function getMTFSummary() {
  const summary = {};
  for (const tf of TIMEFRAMES) {
    const candles = candleData[tf];
    if (candles && candles.length > 50) {
      const structure = analyzeStructure(candles);
      summary[tf] = {
        trend: structure.trend,
        lastBos: structure.bos.length > 0 ? structure.bos[structure.bos.length - 1].type : null,
        lastChoch: structure.choch.length > 0 ? structure.choch[structure.choch.length - 1].type : null
      };
    } else {
      summary[tf] = { trend: 'neutral', lastBos: null, lastChoch: null };
    }
  }
  return summary;
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'subscribe') {
        const tf = data.timeframe || '15m';
        ws.timeframe = tf;

        // Send historical data
        const candles = candleData[tf] || [];
        const analysis = performAnalysis(tf);

        ws.send(JSON.stringify({
          type: 'init',
          timeframe: tf,
          candles,
          analysis
        }));

        // Send signal history
        const history = signalHistory.getHistory(50);
        const stats = signalHistory.getStats();
        ws.send(JSON.stringify({
          type: 'history_update',
          history,
          stats
        }));

        // Send simulator data
        const simStats = simulator.getStats();
        const openPositions = simulator.getOpenPositions();
        const closedTrades = simulator.getClosedTrades(30);
        ws.send(JSON.stringify({
          type: 'simulator_update',
          stats: simStats,
          openPositions,
          closedTrades
        }));
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Broadcast updates to subscribed clients
function broadcastUpdate(timeframe, candle, analysis) {
  // Update simulator positions with current price
  if (candle) {
    const simUpdated = simulator.updatePositions(candle.close);
    const histUpdated = signalHistory.updateSignalStatuses(candle.close);

    if (simUpdated || histUpdated) {
      broadcastSimulator();
      broadcastHistory();
    }
  }

  // Store new signals in history and open simulated positions
  if (analysis && analysis.signals && analysis.signals.length > 0) {
    let newSignalAdded = false;
    for (const signal of analysis.signals) {
      const entry = signalHistory.addSignal({ ...signal, timestamp: Date.now() });
      if (entry) {
        newSignalAdded = true;
        // Open simulated trade for each new signal
        simulator.openPosition(signal);
      }
    }
    if (newSignalAdded) {
      broadcastHistory();
      broadcastSimulator();
    }
  }

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.timeframe === timeframe) {
      client.send(JSON.stringify({
        type: 'update',
        timeframe,
        candle,
        analysis
      }));
    }
  });
}

function broadcastHistory() {
  const history = signalHistory.getHistory(50);
  const stats = signalHistory.getStats();

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({
        type: 'history_update',
        history,
        stats
      }));
    }
  });
}

function broadcastSimulator() {
  const simStats = simulator.getStats();
  const openPositions = simulator.getOpenPositions();
  const closedTrades = simulator.getClosedTrades(30);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({
        type: 'simulator_update',
        stats: simStats,
        openPositions,
        closedTrades
      }));
    }
  });
}

// Start real-time data streaming
async function startStreaming() {
  for (const tf of TIMEFRAMES) {
    binance.subscribeKline('btcusdt', tf, (candle) => {
      const candles = candleData[tf];

      if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
        candles[candles.length - 1] = candle;
      } else {
        candles.push(candle);
        if (candles.length > MAX_CANDLES) {
          candles.shift();
        }
      }

      // Update HTF analysis periodically
      if (tf === '4h' || tf === '1d') {
        updateHTFAnalysis();
      }

      const analysis = performAnalysis(tf);
      broadcastUpdate(tf, candle, analysis);
    });
  }
}

// Start the server
initializeData().then(() => {
  startStreaming();
  server.listen(PORT, () => {
    console.log(`SMC Trading App running on http://localhost:${PORT}`);
  });
});
