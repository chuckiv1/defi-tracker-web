const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExchangeHelpers() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/var CUSTOM_EXCHANGE_PRESET = [^;]+;/),
    source.match(/var CURATED_EXCHANGE_PRESETS = \[[\s\S]*?\];/),
    source.match(/function matchesExchangeAlias\(value, alias\) \{[\s\S]*?\n\}/),
    source.match(/function findCuratedExchangePreset\(name\) \{[\s\S]*?\n\}/),
    source.match(/function exchangePresetValueForName\(name\) \{[\s\S]*?\n\}/),
    source.match(/function resolveExchangeFormName\(rawName, presetValue\) \{[\s\S]*?\n\}/),
    source.match(/function frfResolveExchangeSelection\(exchanges, rawValue, side\) \{[\s\S]*?\n\}/),
    source.match(/function frfFilterExchangeOptions\(exchanges, query, side\) \{[\s\S]*?\n\}/),
    source.match(/function normExchangeLabel\(name\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Exchange-Helper-Snippet ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`
${snippets.map((match) => match[0]).join('\n')}
({
  CUSTOM_EXCHANGE_PRESET,
  exchangePresetValueForName,
  frfFilterExchangeOptions,
  frfResolveExchangeSelection,
  resolveExchangeFormName,
  normExchangeLabel,
});
`);
  return script.runInNewContext({});
}

test('curated exchange helpers normalize known providers and preserve custom names', () => {
  const helpers = loadExchangeHelpers();

  assert.equal(helpers.normExchangeLabel('Bybit Seed'), 'Bybit');
  assert.equal(helpers.normExchangeLabel('grvt.io'), 'GRVT');
  assert.equal(helpers.normExchangeLabel('Kraken Custom'), 'Kraken Custom');

  assert.equal(helpers.exchangePresetValueForName('Hyperliquid staging'), 'hyperliquid');
  assert.equal(helpers.exchangePresetValueForName('Kraken'), helpers.CUSTOM_EXCHANGE_PRESET);

  assert.equal(helpers.resolveExchangeFormName('Kraken', 'grvt'), 'GRVT');
  assert.equal(helpers.resolveExchangeFormName('Kraken', helpers.CUSTOM_EXCHANGE_PRESET), 'Kraken');
});

test('frf exchange helpers allow freitext resolution and curated suggestions', () => {
  const helpers = loadExchangeHelpers();
  const exchanges = [
    { id: 'ex1', name: 'Bybit' },
    { id: 'ex2', name: 'GRVT' },
    { id: 'ex3', name: 'Hyperliquid' },
  ];

  const grvtSelection = helpers.frfResolveExchangeSelection(exchanges, 'grvt', 'short');
  const spotSelection = helpers.frfResolveExchangeSelection(exchanges, 'spot', 'long');
  assert.equal(grvtSelection.id, 'ex2');
  assert.equal(grvtSelection.label, 'GRVT');
  assert.equal(spotSelection.id, '_spot');
  assert.equal(spotSelection.label, 'Spot');
  assert.equal(helpers.frfResolveExchangeSelection(exchanges, 'kraken', 'short'), null);

  const shortOptions = helpers.frfFilterExchangeOptions(exchanges, 'gr', 'short');
  const longOptions = helpers.frfFilterExchangeOptions(exchanges, '', 'long');
  assert.equal(shortOptions.map((item) => item.label).join('|'), 'GRVT');
  assert.equal(longOptions.map((item) => item.label).join('|'), 'Spot|Bybit|GRVT|Hyperliquid');
});
