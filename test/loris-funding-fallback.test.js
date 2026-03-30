const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExchangeService } = require('../services/exchanges');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createService(fetchImpl) {
  return createExchangeService({
    db: { query: async () => ({ rows: [] }) },
    fs,
    path,
    WSClient: class FakeWSClient {},
    fetchImpl,
    baseDir: '/tmp/loris-funding-test',
  });
}

test('uses Loris current funding as fallback when native bybit funding fails', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://api.bybit.com/')) {
      return {
        ok: false,
        status: 500,
        async text() {
          return JSON.stringify({ message: 'native fail' });
        },
      };
    }
    if (url === 'https://api.loris.tools/funding') {
      return jsonResponse({
        funding_rates: { bybit: { BTC: -0.3 } },
        funding_intervals: { bybit: { BTC: 8 } },
        timestamp: '2026-03-30 08:00:00',
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const service = createService(fetchImpl);

  const funding = await service.getExchangeFunding('Bybit', 'BTC', 'perp');

  assert.equal(funding.provider, 'loris');
  assert.equal(funding.exchangeName, 'Bybit');
  assert.equal(funding.symbol, 'BTC');
  assert.ok(Math.abs(funding.currentRate - (-0.00003)) < 1e-12);
  assert.equal(funding.intervalSeconds, 28800);
  assert.equal(funding.settledRates72h8h.length, 0);
  assert.ok(calls.includes('https://api.loris.tools/funding'));
});

test('prefers native funding when bybit returns a usable current rate', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/v5/market/tickers?category=linear&symbol=BTCUSDT')) {
      return jsonResponse({ result: { list: [{ fundingRate: '0.0002', fundingIntervalHour: '8', nextFundingTime: '0' }] } });
    }
    if (url.includes('/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=30')) {
      return jsonResponse({ result: { list: [{ fundingRateTimestamp: String(Date.now() - 3600000), fundingRate: '0.0001' }] } });
    }
    if (url.includes('/v5/market/instruments-info?category=linear')) {
      return jsonResponse({ result: { list: [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading', contractType: 'LinearPerpetual', fundingInterval: '480' }] } });
    }
    if (url === 'https://api.loris.tools/funding') {
      return jsonResponse({ funding_rates: { bybit: { BTC: 3 } }, funding_intervals: { bybit: { BTC: 8 } }, timestamp: '2026-03-30 08:00:00' });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const service = createService(fetchImpl);

  const funding = await service.getExchangeFunding('Bybit', 'BTC', 'perp');

  assert.equal(funding.provider, 'bybit');
  assert.equal(funding.currentRate, 0.0002);
  assert.equal(funding.settledRates72h8h.length, 1);
  assert.equal(calls.includes('https://api.loris.tools/funding'), false);
});

test('converts Loris normalized 1h rates back to per-interval values', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://api.loris.tools/funding') {
      return jsonResponse({
        funding_rates: { hyperliquid: { ETH: 8 } },
        funding_intervals: { hyperliquid: { ETH: 1 } },
        timestamp: '2026-03-30 08:00:00',
      });
    }
    return {
      ok: false,
      status: 500,
      async text() {
        return JSON.stringify({ message: 'native fail' });
      },
    };
  };
  const service = createService(fetchImpl);

  const funding = await service.getExchangeFunding('Hyperliquid', 'ETH', 'perp');

  assert.equal(funding.provider, 'loris');
  assert.equal(funding.intervalSeconds, 3600);
  assert.equal(funding.currentRate, 0.0001);
});

test('uses Loris fallback for phemex funding when native source fails', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://api.phemex.com/public/products') {
      return jsonResponse({
        data: {
          perpProductsV2: [
            {
              symbol: 'ETHUSDT',
              baseCurrency: 'ETH',
              quoteCurrency: 'USDT',
              status: 'Listed',
              fundingInterval: 28800,
            },
          ],
        },
      });
    }
    if (url.startsWith('https://api.phemex.com/md/v3/ticker/24hr?symbol=')) {
      return {
        ok: false,
        status: 500,
        async text() {
          return JSON.stringify({ message: 'native fail' });
        },
      };
    }
    if (url === 'https://api.loris.tools/funding') {
      return jsonResponse({
        funding_rates: { phemex: { ETH: 12 } },
        funding_intervals: { phemex: { ETH: 8 } },
        timestamp: '2026-03-30 08:00:00',
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const service = createService(fetchImpl);

  const funding = await service.getExchangeFunding('Phemex', 'ETH', 'perp');

  assert.equal(funding.provider, 'loris');
  assert.equal(funding.symbol, 'ETH');
  assert.ok(Math.abs(funding.currentRate - 0.0012) < 1e-12);
  assert.equal(funding.intervalSeconds, 28800);
});
