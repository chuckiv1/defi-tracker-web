const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHelpers() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    source.match(/function loopCurrentRateSummary\(startAmount, currentAmount, runtimeDays, invert\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Helper-Snippet ${index + 1} nicht gefunden`);
  });
  const script = new vm.Script(`${snippets.map((match) => match[0]).join('\n')}; ({ loopCurrentRateSummary });`);
  return script.runInNewContext({});
}

test('loop current rate summary computes positive supply and negative borrow annualization', () => {
  const { loopCurrentRateSummary } = loadHelpers();

  const supply = loopCurrentRateSummary(100, 110, 30, false);
  const borrow = loopCurrentRateSummary(100, 110, 30, true);

  assert.equal(supply.nowPct.toFixed(2), '10.00');
  assert.equal(supply.avgPct.toFixed(2), '121.67');
  assert.equal(borrow.nowPct.toFixed(2), '-10.00');
  assert.equal(borrow.avgPct.toFixed(2), '-121.67');
});

test('past strategies remove reactivate button from cards and show it in detail header', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.ok(source.includes("hl += `<button class=\"bt be\" onclick=\"event.stopPropagation();delS('") );
  const detailChunk = source.slice(source.indexOf("(se.endedAt ? \"Beendet\" : \"Aktiv\")"), source.indexOf("<div class=\"dsg\""));
  assert.ok(detailChunk.includes('Reaktivieren'));
});

test('loop detail shows editable current amounts and now/avg rate summaries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.ok(source.includes('Aktuelle Supply-Menge'));
  assert.ok(source.includes('Aktuelle Borrow-Menge'));
  assert.ok(source.includes('Aktuelle Mengen speichern'));
  assert.ok(source.includes('now: '));
  assert.ok(source.includes('avr.: '));
  assert.equal(source.includes('now in '), false);
});

test('loop detail shows start token amount under status and uses post-loop amounts in cards', () => {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
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
    loopPegInfo: () => null,
    renderPegSummary: () => '',
    loopCurrentRateSummary: () => ({ nowPct: 0, avgPct: 0 }),
    fmtLoopRateSummary: () => 'now in +0.00% / avg. +0.00%',
    fmtSinceStartApr: (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}% APR` : '—';
    },
    loopSupplyAprSinceStart: () => null,
    loopBorrowAprSinceStart: () => null,
    loopAprSinceStartSummary: () => ({ available: false, netApr: null, supplySource: null, borrowSource: null }),
    db: () => 9.5,
    es: (value) => String(value || ''),
    fd: (value) => `FD:${value}`,
    fn: (value) => Number(value || 0).toFixed(2),
  };
  const script = new vm.Script(`${detailMatch[0]}; renderLoopDetailPanel;`);
  const renderLoopDetailPanel = script.runInNewContext(context);
  const html = renderLoopDetailPanel({
    id: 'loop-4',
    name: 'ETH / USDC',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'ETH',
    borrowtoken: 'USDC',
    startcollateralamount: 1.25,
    startcollateral: 2500,
    borrowedamount: 800,
    endcollateralamount: 1.4,
    endborrowedamount: 820,
    status: 'active',
  }, '2026-03-10T00:00:00.000Z', false);

  assert.ok(html.includes('Startmenge'));
  assert.ok(html.includes('1.25 ETH'));
  assert.ok(html.includes('1.40 ETH'));
  assert.ok(html.includes('820.00 USDC'));
});

test('current loop amount persistence uses dedicated current amount fields', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'loops.js'), 'utf8');
  assert.ok(routeSource.includes('currentCollateralAmount'));
  assert.ok(routeSource.includes('currentBorrowedAmount'));

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.ok(appSource.includes('currentcollateralamount') || appSource.includes('currentCollateralAmount'));
  assert.ok(appSource.includes('currentborrowedamount') || appSource.includes('currentBorrowedAmount'));
});
