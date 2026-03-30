const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExchangeService } = require('../services/exchanges');

class FakeWSClient {
  constructor() {
    this.handlers = { open: [], message: [], error: [], close: [] };
    setTimeout(() => this.emit('open', {}), 0);
  }

  addEventListener(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  send(payload) {
    const parsed = JSON.parse(payload);
    const symbols = (parsed.instruments || []).map((item) => item.underlying);
    symbols.forEach((symbol, index) => {
      setTimeout(() => {
        this.emit('message', { data: `unsupported instrument: P-${symbol}-USDC-3600` });
      }, index);
    });
  }

  close() {}

  emit(event, payload) {
    (this.handlers[event] || []).forEach((handler) => handler(payload));
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function mockFetch(url) {
  if (url.includes('variational.io/metadata/stats')) {
    return Promise.resolve(
      jsonResponse({
        listings: [
          {
            ticker: 'FARTCOIN',
            funding_rate: 0.0123,
            funding_interval_s: 3600,
          },
        ],
      }),
    );
  }
  if (url.includes('extended.exchange/api/v1/info/markets')) {
    return Promise.resolve(jsonResponse({ data: [] }));
  }
  if (url.includes('hyperliquid.xyz/info')) {
    return Promise.resolve(jsonResponse([{ universe: [] }, []]));
  }
  if (url.includes('bybit.com/v5/market/instruments-info')) {
    return Promise.resolve(jsonResponse({ result: { list: [] } }));
  }
  if (url.includes('phemex.com/public/products')) {
    return Promise.resolve(jsonResponse({ data: { products: [], perpProductsV2: [] } }));
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
}

test('variational funding returns unavailable when symbol is unsupported by price stream', async () => {
  const service = createExchangeService({
    db: { query: async () => ({ rows: [] }) },
    fs,
    path,
    WSClient: FakeWSClient,
    fetchImpl: mockFetch,
    baseDir: '/tmp/variational-unavailable-test',
  });

  await assert.rejects(
    () => service.getExchangeFunding('Variational', 'FARTCOIN', 'perp'),
    /nicht verf.+gbar|nicht verf.+bar|nicht gefunden/i,
  );
});
