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
    source.match(/function posFloatingPnl\(p\) \{[\s\S]*?\n\}/),
    source.match(/function posPnl\(p\) \{[\s\S]*?\n\}/),
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
    PRICES: {},
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
      longIsSpot: false,
      startDate: '2026-03-01T00:00:00.000Z',
      endedAt: null,
    },
    {
      id: 'p2',
      tokenAmount: 1,
      entryPriceShort: 100,
      shortExchangeId: 'ex-short',
      longExchangeId: '',
      longIsSpot: false,
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

test('frf apr capital for spot-hedges uses full deployed spot capital and closed apr uses close pnl only', () => {
  const { posAprCapital, frfAprForSort } = loadFrfHelpers();
  const exchanges = [
    {
      id: 'ex-short',
      marginHistory: [
        { amount: 5000, date: '2024-01-10T09:15:00.000Z' },
      ],
    },
  ];
  const closedWithoutFunding = {
    id: 'demo-closed',
    tokenAmount: 5,
    entryPriceShort: 2200,
    entryPriceLong: 2180,
    shortExchangeId: 'ex-short',
    longExchangeId: '',
    longIsSpot: true,
    startDate: '2024-01-10T09:15:00.000Z',
    endedAt: '2024-03-01T11:00:00.000Z',
    fees: 10,
    closePnlShort: -450,
    closePnlLong: 460,
    fundingShort: [{ amount: 80 }],
    fundingLong: [],
    closePnlIncludesFunding: false,
  };
  const closedWithFunding = {
    ...closedWithoutFunding,
    closePnlShort: -370,
    closePnlLong: 460,
    closePnlIncludesFunding: true,
  };
  const positions = [
    closedWithoutFunding,
    {
      id: 'other-open',
      tokenAmount: 1,
      entryPriceShort: 3870,
      entryPriceLong: 3870,
      shortExchangeId: 'ex-short',
      longExchangeId: '',
      longIsSpot: true,
      startDate: '2024-02-10T00:00:00.000Z',
      endedAt: null,
    },
  ];

  const capital = posAprCapital(
    closedWithoutFunding,
    positions,
    exchanges,
    closedWithoutFunding.endedAt,
  );

  assert.equal(Number(capital.toFixed(2)), 10950);
  assert.equal(Number(frfAprForSort(closedWithoutFunding).toFixed(2)), 0);
  assert.equal(Number(frfAprForSort(closedWithFunding).toFixed(2)), 5.22);
});

test('open frf apr includes running funding and ignores missing close pnl', () => {
  const { frfAprForSort } = loadFrfHelpers();

  const startDate = '2026-03-01T00:00:00.000Z';
  const apr = frfAprForSort({
    startDate,
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 2,
    fundingShort: [{ amount: 15 }],
    fundingLong: [{ amount: -5 }],
  });

  const durationDays = (Date.now() - new Date(startDate).getTime()) / 864e5;
  const expected = (8 / 1000 / durationDays) * 365 * 100;
  assert.equal(Number(apr.toFixed(2)), Number(expected.toFixed(2)));
});

test('closed frf apr turns negative when close pnl after fees is negative', () => {
  const { frfAprForSort } = loadFrfHelpers();

  const apr = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 20,
    closePnlShort: -40,
    closePnlLong: 0,
    fundingShort: [{ amount: 15 }],
    fundingLong: [{ amount: -5 }],
    closePnlIncludesFunding: false,
  });

  assert.ok(apr < 0, `Expected negative APR, got ${apr}`);
  assert.equal(Number(apr.toFixed(2)), -219.00);
});

test('legacy closed positions with funding folded into close pnl yield a higher apr', () => {
  const { frfAprForSort } = loadFrfHelpers();

  const separateFundingApr = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 5,
    closePnlShort: 100,
    closePnlLong: 50,
    fundingShort: [{ amount: 12 }],
    fundingLong: [{ amount: -2 }],
    closePnlIncludesFunding: false,
  });

  const includedFundingApr = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 5,
    closePnlShort: 112,
    closePnlLong: 48,
    fundingShort: [{ amount: 12 }],
    fundingLong: [{ amount: -2 }],
    closePnlIncludesFunding: true,
  });

  assert.equal(Number(separateFundingApr.toFixed(2)), 529.25);
  assert.equal(Number(includedFundingApr.toFixed(2)), 565.75);
  assert.ok(includedFundingApr > separateFundingApr);
});

test('legacy closed positions with negative funding folded into close pnl yield a lower apr', () => {
  const { frfAprForSort } = loadFrfHelpers();

  const withoutFunding = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 0,
    closePnlShort: 100,
    closePnlLong: 0,
    fundingShort: [{ amount: -15 }],
    fundingLong: [{ amount: 5 }],
    closePnlIncludesFunding: false,
  });

  const withFunding = frfAprForSort({
    startDate: '2026-03-01T00:00:00.000Z',
    endedAt: '2026-03-11T00:00:00.000Z',
    tokenAmount: 10,
    entryPriceShort: 100,
    longIsSpot: true,
    fees: 0,
    closePnlShort: 85,
    closePnlLong: 5,
    fundingShort: [{ amount: -15 }],
    fundingLong: [{ amount: 5 }],
    closePnlIncludesFunding: true,
  });

  assert.equal(Number(withoutFunding.toFixed(2)), 365.00);
  assert.equal(Number(withFunding.toFixed(2)), 328.50);
  assert.ok(withFunding < withoutFunding);
});

test('frf list and detail views derive apr from the shared frfAprForSort helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.match(source, /a\s*=\s*frfAprForSort\(p\)/);
  assert.match(source, /a\s*=\s*frfAprForSort\(fp\)/);
});
