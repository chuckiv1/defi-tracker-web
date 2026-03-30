const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStrategyHelpers() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/function ci\(s\) \{[\s\S]*?\n\}/),
    source.match(/function strategyHasTokenEvents\(s\) \{[\s\S]*?\n\}/),
    source.match(/function strategyTokenEntries\(s\) \{[\s\S]*?\n\}/),
    source.match(/function strategyTokenSummary\(s\) \{[\s\S]*?\n\}/),
    source.match(/function strategyTokenSearchText\(s\) \{[\s\S]*?\n\}/),
    source.match(/function renderStrategyTokenChanges\(entry\) \{[\s\S]*?\n\}/),
    source.match(/function db\(a, b\) \{[\s\S]*?\n\}/),
    source.match(/function calcApr\(g, i, d\) \{[\s\S]*?\n\}/),
    source.match(/function bp\(s, e\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Strategy-Snippet ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`
var FR = { positions: [] };
function posPnl() { return 0; }
function es(v) { return String(v || ''); }
function fn(v) { return Number(v || 0).toFixed(2); }
${snippets.map((match) => match[0]).join('\n')}
({ ci, bp, strategyTokenSummary, strategyTokenSearchText, renderStrategyTokenChanges });
`);
  return script.runInNewContext({});
}

test('strategy investment total is the sum of all investment entries', () => {
  const { ci } = loadStrategyHelpers();
  const strategy = {
    investmentHistory: [
      { amount: 1000, date: '2026-03-01T00:00:00.000Z' },
      { amount: 250, date: '2026-03-03T00:00:00.000Z' },
      { amount: -100, date: '2026-03-05T00:00:00.000Z' },
    ],
  };

  assert.equal(ci(strategy), 1150);
});

test('strategy apr periods use cumulative investment after additions and withdrawals', () => {
  const { bp } = loadStrategyHelpers();
  const strategy = {
    investmentHistory: [
      { id: 'i1', amount: 1000, date: '2026-03-01T00:00:00.000Z', note: '' },
      { id: 'i2', amount: 250, date: '2026-03-03T00:00:00.000Z', note: '' },
      { id: 'i3', amount: -100, date: '2026-03-05T00:00:00.000Z', note: '' },
    ],
    rewards: [],
    pnl: [],
    id: 's1',
  };

  const periods = bp(strategy, '2026-03-08T00:00:00.000Z');
  assert.equal(periods.length, 3);
  assert.equal(periods[0].amount, 1000);
  assert.equal(periods[1].amount, 1250);
  assert.equal(periods[2].amount, 1150);
  assert.equal(periods[1].change, 250);
  assert.equal(periods[2].change, -100);
});

test('strategy token summary aggregates token changes by symbol across investment events', () => {
  const { strategyTokenSummary } = loadStrategyHelpers();
  const strategy = {
    investmentHistory: [
      { amount: 1000, tokenChanges: [{ name: 'ETH', amount: 0.5, entryPrice: 3000 }] },
      { amount: 0, tokenChanges: [{ name: 'ETH', amount: 0.25, entryPrice: 3200 }, { name: 'ARB', amount: 100, entryPrice: 1.1 }] },
      { amount: 200, tokenChanges: [{ name: 'ARB', amount: 50, entryPrice: 1.3 }] },
    ],
  };

  const summary = strategyTokenSummary(strategy);
  assert.equal(summary.length, 2);
  assert.deepEqual(Array.from(summary.map((entry) => entry.name)), ['ARB', 'ETH']);
  assert.equal(summary[0].amount, 150);
  assert.equal(summary[1].amount, 0.75);
});

test('strategy token summary keeps legacy base token and adds new token changes on top', () => {
  const { strategyTokenSummary } = loadStrategyHelpers();
  const strategy = {
    token: { name: 'ETH', amount: 1, entryPrice: 2800 },
    investmentHistory: [
      { amount: 1000, tokenChanges: [{ name: 'ETH', amount: 0.25, entryPrice: 3200 }] },
    ],
  };

  const summary = strategyTokenSummary(strategy);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].name, 'ETH');
  assert.equal(summary[0].amount, 1.25);
});

test('strategy token search text includes aggregated token symbols', () => {
  const { strategyTokenSearchText } = loadStrategyHelpers();
  const strategy = {
    investmentHistory: [
      { amount: 1000, tokenChanges: [{ name: 'sAVAX', amount: 10, entryPrice: 10 }] },
      { amount: 0, tokenChanges: [{ name: 'USDC', amount: 500, entryPrice: 1 }] },
    ],
  };

  const search = strategyTokenSearchText(strategy);
  assert.ok(search.includes('savax'));
  assert.ok(search.includes('usdc'));
});

test('strategy token changes render as plain stacked rows with sign token amount and price', () => {
  const { renderStrategyTokenChanges } = loadStrategyHelpers();
  const html = renderStrategyTokenChanges({
    tokenChanges: [
      { name: 'ETH', amount: 0.25, entryPrice: 3200 },
      { name: 'ARB', amount: -50, entryPrice: 1.2 },
    ],
  });

  assert.match(html, /display:grid;gap:4px/);
  assert.match(html, /\+ 0.25 ETH @ 3200.00\$/);
  assert.match(html, /- 50.00 ARB @ 1.20\$/);
});
