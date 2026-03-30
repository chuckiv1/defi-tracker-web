const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPriceHelpers(fetchImpl) {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/var BINANCE_PRICE_BASE_MAP = \{[\s\S]*?\};/),
    source.match(/var BINANCE_PRICE_QUOTES = \[[\s\S]*?\];/),
    source.match(/function loopBinanceBaseAsset\(sym\) \{[\s\S]*?\n\}/),
    source.match(/function buildBinancePriceLookup\(symbols\) \{[\s\S]*?\n\}/),
    source.match(/function applyBinancePriceRows\(symbolPairs, rows\) \{[\s\S]*?\n\}/),
    source.match(/function fetchCoinGeckoLoopPrices\(tokens\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Preis-Snippet ${index + 1} nicht gefunden`);
  });
  const context = {
    PRICES: {},
    Promise,
    fetch: fetchImpl || (() => Promise.reject(new Error('fetch missing'))),
    parseFloat,
    Object,
    String,
  };
  const script = new vm.Script(`${snippets.map((match) => match[0]).join('\n')}; ({ PRICES, loopBinanceBaseAsset, buildBinancePriceLookup, applyBinancePriceRows, fetchCoinGeckoLoopPrices });`);
  return script.runInNewContext(context);
}

test('WAVAX maps to AVAX for Binance while sAVAX stays unsupported', () => {
  const { loopBinanceBaseAsset } = loadPriceHelpers();

  assert.equal(loopBinanceBaseAsset('WAVAX'), 'AVAX');
  assert.equal(loopBinanceBaseAsset('AVAX'), 'AVAX');
  assert.equal(loopBinanceBaseAsset('sAVAX'), null);
});

test('Binance lookup deduplicates pairs and prefers USDC price', () => {
  const { PRICES, buildBinancePriceLookup, applyBinancePriceRows } = loadPriceHelpers();

  const lookup = buildBinancePriceLookup({ WAVAX: 'avalanche', AVAX: 'avalanche', SAVAX: 'benqi-liquid-staked-avax' });
  applyBinancePriceRows(lookup.symbolPairs, [
    { symbol: 'AVAXUSDT', price: '8.71' },
    { symbol: 'AVAXUSDC', price: '8.73' },
  ]);

  assert.deepEqual(Array.from(lookup.requestPairs), ['AVAXUSDC', 'AVAXUSDT']);
  assert.equal(PRICES.WAVAX, 8.73);
  assert.equal(PRICES.AVAX, 8.73);
  assert.equal(PRICES.SAVAX, undefined);
});

test('CoinGecko fallback only fills still-missing prices', async () => {
  const { PRICES, fetchCoinGeckoLoopPrices } = loadPriceHelpers(async () => ({
    ok: true,
    json: async () => ({
      avalanche: { usd: 8.5 },
      'benqi-liquid-staked-avax': { usd: 10.95 },
    }),
  }));
  PRICES.WAVAX = 8.73;

  await fetchCoinGeckoLoopPrices({
    WAVAX: 'avalanche',
    SAVAX: 'benqi-liquid-staked-avax',
  });

  assert.equal(PRICES.WAVAX, 8.73);
  assert.equal(PRICES.SAVAX, 10.95);
});
