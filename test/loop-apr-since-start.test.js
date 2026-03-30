const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLoopAprHelpers(contextOverrides = {}) {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/function loopAnnualizedRateFromChange\(startValue, currentValue, runtimeDays\) \{[\s\S]*?\n\}/),
    source.match(/function loopHasManualCurrentAmounts\(loop\) \{[\s\S]*?\n\}/),
    source.match(/function loopSupplyAprSinceStart\(loop, runtimeDays\) \{[\s\S]*?\n\}/),
    source.match(/function loopBorrowAprSinceStart\(loop, runtimeDays\) \{[\s\S]*?\n\}/),
    source.match(/function loopAprSinceStartSummary\(loop, runtimeDays\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `APR-Helfer ${index + 1} nicht gefunden`);
  });
  const context = {
    Math,
    parseFloat,
    Number,
    loopPegInfo: () => null,
    ...contextOverrides,
  };
  const script = new vm.Script(`${snippets.map((match) => match[0]).join('\n')}; ({ loopAnnualizedRateFromChange, loopHasManualCurrentAmounts, loopSupplyAprSinceStart, loopBorrowAprSinceStart, loopAprSinceStartSummary });`);
  return script.runInNewContext(context);
}

function createRouteHarness() {
  const routes = {};
  return {
    app: {
      get(path, ...handlers) {
        routes[`GET ${path}`] = handlers[handlers.length - 1];
      },
      post(path, ...handlers) {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      },
      put(path, ...handlers) {
        routes[`PUT ${path}`] = handlers[handlers.length - 1];
      },
      delete(path, ...handlers) {
        routes[`DELETE ${path}`] = handlers[handlers.length - 1];
      },
    },
    routes,
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('loop APR helper annualizes sAVAX Benqi peg growth from stored start snapshot', () => {
  const { loopSupplyAprSinceStart } = loadLoopAprHelpers({
    loopPegInfo: () => ({ current: 1.08 }),
  });

  const result = loopSupplyAprSinceStart({
    collateraltoken: 'sAVAX',
    supplypegstart: 1.02,
  }, 30);

  assert.ok(result);
  assert.equal(result.source, 'benqi-peg');
  assert.ok(result.aprPct > 70 && result.aprPct < 72);
});

test('loop APR helper uses realized borrow change only after manual current amount save', () => {
  const { loopBorrowAprSinceStart } = loadLoopAprHelpers();

  const manual = loopBorrowAprSinceStart({
    endborrowedamount: 100,
    currentborrowedamount: 110,
    currentamountsupdatedat: '2026-03-20T00:00:00.000Z',
    avgborrowapr: 5,
  }, 30);
  const fallback = loopBorrowAprSinceStart({
    endborrowedamount: 100,
    currentborrowedamount: 110,
    avgborrowapr: 5,
  }, 30);

  assert.equal(manual.source, 'current-amounts');
  assert.ok(manual.aprPct < -121 && manual.aprPct > -122);
  assert.equal(fallback.source, 'snapshot-average');
  assert.equal(fallback.aprPct, -5);
});

test('loop APR summary combines supply and borrow since-start sources into leveraged APR', () => {
  const { loopAprSinceStartSummary } = loadLoopAprHelpers({
    loopPegInfo: () => ({ current: 1.06 }),
  });

  const summary = loopAprSinceStartSummary({
    collateraltoken: 'sAVAX',
    supplypegstart: 1.02,
    leverage: 2,
    avgborrowapr: 4,
  }, 40);

  assert.ok(summary.available);
  assert.equal(summary.supplySource, 'benqi-peg');
  assert.equal(summary.borrowSource, 'snapshot-average');
  assert.ok(summary.netApr > 65 && summary.netApr < 68);
});

test('loop totals preserve negative supply and borrow rates instead of forcing absolute values', () => {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/function loopTokenPrice\(sym, fallback\) \{[\s\S]*?\n\}/),
    source.match(/function calculateLoopingTotals\(l\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Loop-Helfer ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`${snippets.map((match) => match[0]).join('\n')}; ({ loopTokenPrice, calculateLoopingTotals });`);
  const helpers = script.runInNewContext({ parseFloat, Math, PRICES: {}, STABLE_PRICES: { USDC: 1, USDT: 1, DAI: 1 } });

  const negativeBorrow = helpers.calculateLoopingTotals({
    collateralToken: 'USDC',
    borrowToken: 'USDC',
    startCollateral: 1000,
    collateralPrice: 1,
    startCollateralAmount: 1000,
    endCollateralAmount: 1500,
    endBorrowedAmount: 500,
    supplyApy: 5,
    borrowApy: -2,
  });
  const negativeSupply = helpers.calculateLoopingTotals({
    collateralToken: 'USDC',
    borrowToken: 'USDC',
    startCollateral: 1000,
    collateralPrice: 1,
    startCollateralAmount: 1000,
    endCollateralAmount: 1500,
    endBorrowedAmount: 500,
    supplyApy: -5,
    borrowApy: 2,
  });

  assert.equal(negativeBorrow.borrowRateApr, -2);
  assert.equal(negativeBorrow.netApr, 8.5);
  assert.equal(negativeSupply.supplyRateApr, -5);
  assert.equal(negativeSupply.netApr, -8.5);
});

test('loop APR since-start stays unavailable when no real borrow data exists', () => {
  const { loopAprSinceStartSummary } = loadLoopAprHelpers({
    loopPegInfo: () => ({ current: 1.06, source: 'benqi' }),
  });

  const summary = loopAprSinceStartSummary({
    collateraltoken: 'sAVAX',
    supplypegstart: 1.02,
    leverage: 2,
  }, 40);

  assert.equal(summary.available, false);
  assert.equal(summary.borrowSource, null);
  assert.equal(summary.borrowApr, null);
});

test('loop route stores Benqi start snapshot and initial borrow APR snapshot on create', async () => {
  const { registerLoopRoutes } = require('../routes/loops');
  const { app, routes } = createRouteHarness();
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
  registerLoopRoutes(app, {
    attachProfile: (req, res, next) => next && next(),
    benqiProvider: { fetchPegQuote: async () => ({ value: 1.0312, timestamp: '2026-03-01T00:00:00.000Z' }) },
    db,
    gid: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    normalizeLoopTokenInput: (value) => String(value || '').trim().toUpperCase(),
    oracle: { queryOracleData: async () => [] },
    requireAuth: (req, res, next) => next && next(),
  });

  const req = {
    body: {
      name: 'sAVAX / WAVAX',
      startDate: '2026-03-01T00:00:00.000Z',
      collateralToken: 'sAVAX',
      borrowToken: 'WAVAX',
      startCollateral: 1000,
      collateralPrice: 30,
      startCollateralAmount: 32,
      supplyApy: 6,
      borrowApy: 3.5,
      endCollateralAmount: 40,
      endBorrowedAmount: 200,
      leverage: 2,
    },
    profile: { id: 'profile-1' },
  };
  const res = createResponseRecorder();

  await routes['POST /api/loops'](req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /supplyPegStart/);
  assert.equal(queries[0].params[25], 1.0312);
  assert.match(queries[1].sql, /loop_borrow_rate_snapshots/);
  assert.equal(queries[1].params[3], '2026-03-01T00:00:00.000Z');
  assert.equal(queries[1].params[4], 3.5);
});

test('loop route marks current amount saves with a timestamp', async () => {
  const { registerLoopRoutes } = require('../routes/loops');
  const { app, routes } = createRouteHarness();
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
  registerLoopRoutes(app, {
    attachProfile: (req, res, next) => next && next(),
    benqiProvider: { fetchPegQuote: async () => null },
    db,
    gid: () => 'id-1',
    normalizeLoopTokenInput: (value) => String(value || '').trim().toUpperCase(),
    oracle: { queryOracleData: async () => [] },
    requireAuth: (req, res, next) => next && next(),
  });

  const req = {
    body: {
      currentCollateralAmount: 41,
      currentBorrowedAmount: 205,
    },
    params: { id: 'loop-1' },
    profile: { id: 'profile-1' },
  };
  const res = createResponseRecorder();

  await routes['PUT /api/loops/:id'](req, res);

  assert.equal(res.statusCode, 200);
  assert.match(queries[0].sql, /currentAmountsUpdatedAt/);
  assert.ok(queries[0].params.some((value) => typeof value === 'string' && value.includes('T')));
});

test('loop detail closes APR header block before supply cards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  const detailMatch = source.match(/function renderLoopDetailPanel\(selLoop, nw, inline\) \{[\s\S]*?\n\}/);
  assert.ok(detailMatch, 'renderLoopDetailPanel nicht gefunden');

  const context = {
    calculateLoopingTotals: () => ({
      collateralAmount: 1.4,
      borrowTokenAmount: 820,
      leverage: 2.4,
      netApr: 13.5,
      supplyUsd: 2800,
      borrowUsd: 820,
      supplyRateApr: 8.5,
      borrowRateApr: 3.2,
      borrowPrice: 1,
    }),
    loopPegInfo: () => ({ current: 1.04, source: 'Benqi Unstake' }),
    loopAprSinceStartSummary: () => ({ available: true, netApr: 11.2, supplySource: 'benqi-peg', borrowSource: 'snapshot-average' }),
    loopCurrentRateSummary: () => ({ nowPct: 0, avgPct: 0 }),
    fmtLoopRateSummary: () => 'avr. +0.00%',
    fmtSinceStartApr: (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}% APR` : '—';
    },
    db: () => 9.5,
    es: (value) => String(value || ''),
    fd: (value) => `FD:${value}`,
    fn: (value) => Number(value || 0).toFixed(2),
    renderPegSummary: () => '',
  };
  const script = new vm.Script(`${detailMatch[0]}; renderLoopDetailPanel;`);
  const renderLoopDetailPanel = script.runInNewContext(context);
  const html = renderLoopDetailPanel({
    id: 'loop-header-close',
    name: 'Layout',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'sAVAX',
    borrowtoken: 'WAVAX',
    startcollateralamount: 1.25,
    startcollateral: 2500,
    borrowedamount: 800,
    endcollateralamount: 1.4,
    endborrowedamount: 820,
    supplypegstart: 1.01,
    status: 'active',
  }, '2026-03-10T00:00:00.000Z', false);

  assert.ok(
    html.includes('</div></div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px">'),
    'APR-Header muss komplett geschlossen sein, bevor die Supply/Borrow-Karten beginnen',
  );
  assert.ok(
    html.indexOf('APR seit Aufsetzen') < html.indexOf('Gehebelte Live APR'),
    'APR seit Aufsetzen soll im Header vor der Live-APR stehen',
  );
  assert.equal(html.includes('Supply: Benqi Peg | Borrow:'), false);
});

test('loop detail cards show now and avr APR labels for supply and borrow', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  const detailMatch = source.match(/function renderLoopDetailPanel\(selLoop, nw, inline\) \{[\s\S]*?\n\}/);
  assert.ok(detailMatch, 'renderLoopDetailPanel nicht gefunden');

  const context = {
    calculateLoopingTotals: () => ({
      collateralAmount: 1.4,
      borrowTokenAmount: 820,
      leverage: 2.4,
      netApr: 13.5,
      supplyUsd: 2800,
      borrowUsd: 820,
      supplyRateApr: 6,
      borrowRateApr: 3.85,
      price: 2000,
      borrowPrice: 1,
    }),
    loopPegInfo: () => ({ current: 1.04, source: 'Benqi Unstake' }),
    loopAprSinceStartSummary: () => ({ available: true, netApr: 11.2, supplySource: 'benqi-peg', borrowSource: 'snapshot-average' }),
    loopSupplyAprSinceStart: () => ({ aprPct: 8.12, source: 'benqi-peg' }),
    loopBorrowAprSinceStart: () => ({ aprPct: -5.67, source: 'snapshot-average' }),
    loopCurrentRateSummary: () => ({ nowPct: 0, avgPct: 0 }),
    fmtLoopRateSummary: () => 'avr. +0.00%',
    fmtSinceStartApr: (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}% APR` : '—';
    },
    db: () => 9.5,
    es: (value) => String(value || ''),
    fd: (value) => `FD:${value}`,
    fn: (value) => Number(value || 0).toFixed(2),
    renderPegSummary: () => '',
  };
  const script = new vm.Script(`${detailMatch[0]}; renderLoopDetailPanel;`);
  const renderLoopDetailPanel = script.runInNewContext(context);
  const html = renderLoopDetailPanel({
    id: 'loop-now-avr',
    name: 'NowAvr',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'sAVAX',
    borrowtoken: 'WAVAX',
    startcollateralamount: 1.25,
    startcollateral: 2500,
    borrowedamount: 800,
    endcollateralamount: 1.4,
    endborrowedamount: 820,
    supplypegstart: 1.01,
    status: 'active',
  }, '2026-03-10T00:00:00.000Z', false);

  assert.match(html, /now: \+6\.00% APR \/ avr\.: \+8\.12% APR/);
  assert.match(html, /now: -3\.85% APR \/ avr\.: -5\.67% APR/);
});

test('db init backfills legacy sAVAX loops with the agreed peg start', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.match(source, /UPDATE loops[\s\S]*SET supplyPegStart = 1\.2517/);
  assert.match(source, /UPPER\(collateralToken\) = 'SAVAX'/);
  assert.match(source, /supplyPegStart IS NULL/);
});
