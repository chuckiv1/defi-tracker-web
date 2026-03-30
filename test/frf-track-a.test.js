const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFrfHelpers() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/function calcApr\(g, i, d\) \{[\s\S]*?\n\}/),
    source.match(/function db\(a, b\) \{[\s\S]*?\n\}/),
    source.match(/function latestFunding\(arr\) \{[\s\S]*?\n\}/),
    source.match(/function posEntrySize\(p\) \{[\s\S]*?\n\}/),
    source.match(/function frfFundingContribution\(p\) \{[\s\S]*?\n\}/),
    source.match(/function frfAprForSort\(p\) \{[\s\S]*?\n\}/),
    source.match(/function marginTotalAt\(exchange, atIso\) \{[\s\S]*?\n\}/),
    source.match(/function positionUsesExchange\(position, exchangeId\) \{[\s\S]*?\n\}/),
    source.match(/function positionActiveAt\(position, atIso\) \{[\s\S]*?\n\}/),
    source.match(/function posCapitalAt\(position, atIso, positions, exchanges\) \{[\s\S]*?\n\}/),
    source.match(/function posAprCapital\(position, positions, exchanges, nowIso\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `FRF-Helper-Snippet ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`
${snippets.map((match) => match[0]).join('\n')}
({
  frfFundingContribution,
  frfAprForSort,
  posAprCapital,
});
`);
  return script.runInNewContext({
    FR: { positions: [], exchanges: [] },
    posPnl: () => 999,
  });
}

test('frf funding contribution is excluded when close pnl already includes funding', () => {
  const { frfFundingContribution } = loadFrfHelpers();

  assert.equal(
    frfFundingContribution({
      endedAt: '2026-03-22T10:00:00.000Z',
      closePnlIncludesFunding: false,
      fundingShort: [{ amount: 12 }],
      fundingLong: [{ amount: -2 }],
    }),
    10,
  );

  assert.equal(
    frfFundingContribution({
      endedAt: '2026-03-22T10:00:00.000Z',
      closePnlIncludesFunding: true,
      fundingShort: [{ amount: 12 }],
      fundingLong: [{ amount: -2 }],
    }),
    0,
  );
});

test('frf apr capital uses time-weighted allocation so new positions do not change prior apr retroactively', () => {
  const { posAprCapital } = loadFrfHelpers();
  const exchanges = [
    {
      id: 'ex-short',
      marginHistory: [
        { amount: 1000, date: '2026-03-01T00:00:00.000Z' },
        { amount: 1000, date: '2026-03-09T00:00:00.000Z' },
      ],
    },
  ];
  const positions = [
    {
      id: 'p1',
      tokenAmount: 1,
      entryPriceShort: 100,
      shortExchangeId: 'ex-short',
      longExchangeId: '',
      longIsSpot: true,
      startDate: '2026-03-01T00:00:00.000Z',
      endedAt: null,
    },
    {
      id: 'p2',
      tokenAmount: 1,
      entryPriceShort: 100,
      shortExchangeId: 'ex-short',
      longExchangeId: '',
      longIsSpot: true,
      startDate: '2026-03-06T00:00:00.000Z',
      endedAt: null,
    },
  ];

  const capital = posAprCapital(
    positions[0],
    positions,
    exchanges,
    '2026-03-11T00:00:00.000Z',
  );

  assert.equal(Number(capital.toFixed(2)), 850);
});

test('frf apr uses funding only and ignores display pnl', () => {
  const { frfAprForSort } = loadFrfHelpers();

  const apr = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 2,
    fundingShort: [{ amount: 15 }],
    fundingLong: [{ amount: -5 }],
  });

  assert.equal(Number(apr.toFixed(2)), 29.20);
});
