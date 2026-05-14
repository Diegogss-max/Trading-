const https = require('https');
const WebSocket = require('ws');

class BinanceClient {
  constructor() {
    this.baseUrl = 'https://api.binance.com';
    this.wsBaseUrl = 'wss://stream.binance.com:9443/ws';
    this.wsConnections = [];
  }

  // Fetch historical klines
  getKlines(symbol, interval, limit = 500) {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const klines = JSON.parse(data);
            if (klines.code) {
              reject(new Error(klines.msg));
              return;
            }
            const candles = klines.map((k) => ({
              time: Math.floor(k[0] / 1000),
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5])
            }));
            resolve(candles);
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  // Subscribe to real-time kline updates
  subscribeKline(symbol, interval, callback) {
    const wsUrl = `${this.wsBaseUrl}/${symbol}@kline_${interval}`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`WS connected: ${symbol}@kline_${interval}`);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        const k = msg.k;
        const candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          closed: k.x
        };
        callback(candle);
      } catch (err) {
        console.error('WS parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error(`WS error ${interval}:`, err.message);
    });

    ws.on('close', () => {
      console.log(`WS closed: ${symbol}@kline_${interval}, reconnecting...`);
      setTimeout(() => this.subscribeKline(symbol, interval, callback), 5000);
    });

    this.wsConnections.push(ws);
  }
}

module.exports = { BinanceClient };
