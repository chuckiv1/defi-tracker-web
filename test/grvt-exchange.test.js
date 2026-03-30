const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

function createGrvtFetchMock() {
  const calls = [];
  const nowMs = Date.now();
  const latestFundingMs = nowMs - (2 * 60 * 60 * 1000);
  const previousFundingMs = nowMs - (10 * 60 * 60 * 1000);
  const nextFundingNs = String(BigInt(nowMs + (6 * 60 * 60 * 1000)) * 1000000n);
  const latestFundingNs = String(BigInt(latestFundingMs) * 1000000n);
  const previousFundingNs = String(BigInt(previousFundingMs) * 1000000n);
  const markets = [
    {
      instrument: 'BTC_USDT_Perp',
      base: 'BTC',
      quote: 'USDT',
      kind: 'PERPETUAL',
      funding_interval_hours: 8,
    },
    {
      instrument: 'ETH_USDT_Perp',
      base: 'ETH',
      quote: 'USDT',
      kind: 'PERPETUAL',
      funding_interval_hours: 8,
    },
  ];

  async function fetchImpl(url, options = {}) {
    calls.push({ url, options });
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['content-type'], 'application/json');
    const body = JSON.parse(options.body || '{}');

    if (url === 'https://market-data.grvt.io/full/v1/all_instruments') {
      assert.deepEqual(body, { is_active: true });
      return jsonResponse({ result: markets });
    }

    if (url === 'https://market-data.grvt.io/full/v1/ticker') {
      assert.deepEqual(body, { instrument: 'BTC_USDT_Perp' });
      return jsonResponse({
        result: {
          mark_price: '64001.25',
          index_price: '63990.5',
          last_price: '64010.0',
          best_bid_price: '64000.0',
          best_ask_price: '64002.5',
          funding_rate: '0.0006',
          next_funding_time: nextFundingNs,
        },
      });
    }

    if (url === 'https://market-data.grvt.io/full/v1/funding') {
      assert.deepEqual(body, { instrument: 'BTC_USDT_Perp', limit: 30 });
      return jsonResponse({
        result: [
          {
            funding_rate: '0.0005',
            funding_time: latestFundingNs,
            funding_interval_hours: 8,
          },
          {
            funding_rate: '-0.00025',
            funding_time: previousFundingNs,
            funding_interval_hours: 8,
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }

  return { fetchImpl, calls, nowMs, latestFundingMs, previousFundingMs };
}

function createService(fetchImpl) {
  return createExchangeService({
    db: { query: async () => ({ rows: [] }) },
    fs,
    path,
    WSClient: class FakeWSClient {},
    fetchImpl,
    baseDir: '/tmp/grvt-exchange-test',
  });
}

function loadNormExchangeLabel() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/var CUSTOM_EXCHANGE_PRESET = [^;]+;/),
    source.match(/var CURATED_EXCHANGE_PRESETS = \[[\s\S]*?\];/),
    source.match(/function matchesExchangeAlias\(value, alias\) \{[\s\S]*?\n\}/),
    source.match(/function findCuratedExchangePreset\(name\) \{[\s\S]*?\n\}/),
    source.match(/function normExchangeLabel\(name\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `normExchangeLabel-Snippet ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`${snippets.map((match) => match[0]).join('\n')}; normExchangeLabel;`);
  return script.runInNewContext({});
}

test('normalizes GRVT provider names', () => {
  const service = createService(async () => {
    throw new Error('fetch should not be called');
  });

  assert.equal(service.normalizeExchangeProvider('GRVT'), 'grvt');
  assert.equal(service.normalizeExchangeProvider('grvt.io'), 'grvt');
});

test('frontend label normalizes GRVT and GRVT.io to GRVT', () => {
  const normExchangeLabel = loadNormExchangeLabel();

  assert.equal(normExchangeLabel('grvt'), 'GRVT');
  assert.equal(normExchangeLabel('grvt.io'), 'GRVT');
});

test('search returns BTC_USDT_Perp for GRVT', async () => {
  const { fetchImpl } = createGrvtFetchMock();
  const service = createService(fetchImpl);

  const result = await service.searchSymbolsForExchange('GRVT', 'BTC');

  assert.equal(result.provider, 'grvt');
  assert.equal(result.items[0].market, 'BTC_USDT_Perp');
  assert.equal(result.items[0].symbol, 'BTC');
  assert.equal(result.items[0].quote, 'USDT');
});

test('quote parsing converts GRVT string prices and resolves perp market for spot mode', async () => {
  const { fetchImpl } = createGrvtFetchMock();
  const service = createService(fetchImpl);

  const quote = await service.getExchangeQuote('GRVT', 'BTC', 'spot');

  assert.deepEqual(quote, {
    provider: 'grvt',
    exchangeName: 'GRVT',
    market: 'BTC_USDT_Perp',
    symbol: 'BTC',
    price: 64001.25,
    referencePrice: 63990.5,
    bidPrice: 64000,
    askPrice: 64002.5,
    mode: 'spot',
    sourceLabel: 'GRVT ticker',
  });
});

test('funding parsing converts GRVT nanoseconds to milliseconds and returns settled history', async () => {
  const { fetchImpl, nowMs, latestFundingMs, previousFundingMs } = createGrvtFetchMock();
  const service = createService(fetchImpl);

  const funding = await service.getExchangeFunding('GRVT', 'BTC', 'perp');

  assert.equal(funding.provider, 'grvt');
  assert.equal(funding.market, 'BTC_USDT_Perp');
  assert.equal(funding.symbol, 'BTC');
  assert.equal(funding.currentRate, 0.0006);
  assert.equal(funding.intervalSeconds, 28800);
  assert.equal(funding.settledRates72h8h.length, 2);
  assert.deepEqual(funding.settledRates72h8h[0], {
    time: latestFundingMs,
    fundingRate: 0.0005,
    intervalSeconds: 28800,
    rate8h: 0.0005,
  });
  assert.deepEqual(funding.settledRates72h8h[1], {
    time: previousFundingMs,
    fundingRate: -0.00025,
    intervalSeconds: 28800,
    rate8h: -0.00025,
  });
  assert.ok(funding.settledRates72h8h[0].time > funding.settledRates72h8h[1].time);
  assert.ok(funding.settledRates72h8h[0].time > nowMs - (72 * 60 * 60 * 1000));
});

test('invalid GRVT symbol yields a German error', async () => {
  const { fetchImpl } = createGrvtFetchMock();
  const service = createService(fetchImpl);

  await assert.rejects(
    () => service.getExchangeQuote('GRVT', 'FOO', 'perp'),
    /GRVT-Markt fuer FOO nicht gefunden/i,
  );
});
