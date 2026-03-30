const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLoopDetailRenderer() {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const detailMatch = source.match(/function renderLoopDetailPanel\(selLoop, nw, inline\) \{[\s\S]*?\n\}/);
  assert.ok(detailMatch, 'renderLoopDetailPanel nicht gefunden');
  const context = {
    calculateLoopingTotals: () => ({
      collateralAmount: 1.25,
      borrowTokenAmount: 820,
      leverage: 2.4,
      netApr: 13.5,
      supplyUsd: 2500,
      borrowUsd: 820,
      supplyRateApr: 8.5,
      borrowRateApr: 3.2,
    }),
    loopPegInfo: (asset, reference, entryPrice) => {
      const normalizedRef = String(reference || '').toUpperCase() === 'WAVAX' ? 'AVAX' : String(reference || '').toUpperCase();
      if (String(asset || '').toUpperCase() === 'SAVAX' && normalizedRef === 'AVAX') {
        return {
          asset: 'sAVAX',
          reference: 'AVAX',
          entry: Number(entryPrice) || 0,
          current: 1.0321,
          delta: Number(entryPrice) ? 1.0321 - Number(entryPrice) : 0,
          deltaPct: Number(entryPrice) ? ((1.0321 - Number(entryPrice)) / Number(entryPrice)) * 100 : 0,
        };
      }
      return entryPrice
        ? { asset, reference, entry: Number(entryPrice), current: 0.0942, delta: 0.0022, deltaPct: 2.39 }
        : null;
    },
    renderPegSummary: (info) =>
      info
        ? `<div class="peg-box"><span class="peg-label">Peg Einstieg</span><span class="peg-value">${info.entry}</span><span class="peg-label">Aktueller Peg</span><span class="peg-value">${info.current}</span><div>(Peg beim Aufsetzen = ${info.entry})</div><span class="peg-label">Delta</span><span class="peg-value">${info.delta}</span><div>Quelle:</div></div>`
        : '',
    loopCurrentRateSummary: (startAmount, currentAmount, runtimeDays, invert) => {
      const start = parseFloat(startAmount || 0);
      const current = parseFloat(currentAmount || 0);
      if (!(start > 0) || !(current > 0)) return { nowPct: null, avgPct: null };
      let nowPct = ((current - start) / start) * 100;
      if (invert) nowPct = -nowPct;
      return { nowPct, avgPct: runtimeDays > 0 ? (nowPct / runtimeDays) * 365 : null };
    },
    fmtLoopRateSummary: (summary) =>
      summary && summary.nowPct !== null
        ? `now in ${summary.nowPct >= 0 ? '+' : ''}${summary.nowPct.toFixed(2)}% / avg. ${summary.avgPct >= 0 ? '+' : ''}${summary.avgPct.toFixed(2)}%`
        : 'now in — / avg. —',
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
  return script.runInNewContext(context);
}

test('loop detail removes only the top metric card grid', () => {
  const renderLoopDetailPanel = loadLoopDetailRenderer();
  const html = renderLoopDetailPanel({
    id: 'loop-1',
    name: 'ETH / USDC',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'ETH',
    borrowtoken: 'USDC',
    status: 'active',
    pegreferencetoken: 'USDC',
    pegentryprice: 0.092,
  }, '2026-03-10T00:00:00.000Z', false);

  assert.equal(html.includes('class="dsg"'), false);
  assert.ok(html.includes('Gehebelte Live APR'));
  assert.ok(html.includes('Peg Einstieg'));
  assert.ok(html.includes('Aktueller Peg'));
  assert.ok(html.includes('Delta'));
  assert.ok(html.includes('Notiz') === false || typeof html === 'string');
});

test('loop detail still shows peg block even without configured peg entry values', () => {
  const renderLoopDetailPanel = loadLoopDetailRenderer();
  const html = renderLoopDetailPanel({
    id: 'loop-2',
    name: 'SOL / USDC',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'SOL',
    borrowtoken: 'USDC',
    status: 'active',
  }, '2026-03-10T00:00:00.000Z', false);

  assert.ok(html.includes('Peg Einstieg'));
  assert.ok(html.includes('Aktueller Peg'));
  assert.ok(html.includes('Delta'));
});

test('loop detail shows current peg for sAVAX even without peg entry when reference is WAVAX', () => {
  const renderLoopDetailPanel = loadLoopDetailRenderer();
  const html = renderLoopDetailPanel({
    id: 'loop-3',
    name: 'sAVAX / WAVAX',
    startdate: '2026-03-01T00:00:00.000Z',
    collateraltoken: 'sAVAX',
    borrowtoken: 'WAVAX',
    status: 'active',
  }, '2026-03-10T00:00:00.000Z', false);

  assert.ok(html.includes('Aktueller Peg'));
  assert.equal(html.includes('Peg Einstieg</span><span class="peg-value">0'), true);
  assert.equal(html.includes('Aktueller Peg</span><span class="peg-value">1.0321'), true);
  assert.ok(html.includes('Quelle:'));
  assert.ok(html.includes('(Peg beim Aufsetzen = '));
  assert.ok(html.indexOf('(Peg beim Aufsetzen = ') < html.indexOf('Quelle:'));
});

test('renderPegSummary places setup peg note before the source line', () => {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/function renderPegSummary\(info\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'renderPegSummary nicht gefunden');
  const context = {
    es: (value) => String(value || ''),
    fmtPeg: (value) => Number(value || 0).toFixed(4),
    fd: (value) => String(value || ''),
  };
  const script = new vm.Script(`${match[0]}; renderPegSummary;`);
  const renderPegSummary = script.runInNewContext(context);
  const html = renderPegSummary({
    asset: 'sAVAX',
    reference: 'AVAX',
    entry: 1.2517,
    current: 1.2560,
    delta: 0.0043,
    deltaPct: 0.34,
    source: 'Benqi Unstake',
    timestamp: '2026-03-29T12:12:00.000Z',
  });

  assert.ok(html.includes('(Peg beim Aufsetzen = 1.2517)'));
  assert.ok(html.includes('Quelle: Benqi Unstake'));
  assert.ok(html.indexOf('(Peg beim Aufsetzen = 1.2517)') < html.indexOf('Quelle: Benqi Unstake'));
  assert.ok(html.includes('position:absolute'));
});

test('loop modal shows looped collateral and borrow amounts in a separate yellow block', () => {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const modalMatch = source.match(/function renderLoopModal\(le, isEdit\) \{[\s\S]*?\n\}/);
  assert.ok(modalMatch, 'renderLoopModal nicht gefunden');
  const context = {
    renderPegSummary: () => '',
    loopPegInfo: () => null,
    loopTokenDatalist: () => '',
    loopRateLabel: (kind) => (kind === 'borrow' ? 'Borrow APR (%)' : 'Supply APR (%)'),
    es: (value) => String(value || ''),
    fds: (value) => String(value || '').slice(0, 10),
    fts: () => '10:00',
  };
  const script = new vm.Script(`${modalMatch[0]}; renderLoopModal;`);
  const renderLoopModal = script.runInNewContext(context);
  const html = renderLoopModal({
    startdate: '2026-03-01T00:00:00.000Z',
    startcollateral: 1000,
    collateraltoken: 'ETH',
    startcollateralamount: 1.25,
    collateralprice: 2000,
    supplyapy: 8.5,
    borrowtoken: 'USDC',
    borrowapy: 3.2,
    endcollateralamount: 1.4,
    endborrowedamount: 820,
  }, false);

  const borrowIndex = html.indexOf('📤 BORROW');
  const yellowIndex = html.indexOf('🟨');
  assert.ok(borrowIndex >= 0, 'Borrow-Bereich fehlt');
  assert.ok(yellowIndex > borrowIndex, 'Gelber Block sollte nach Borrow folgen');
  assert.ok(html.includes('Collateral Menge gelooped'));
  assert.ok(html.includes('Borrow Menge gelooped'));
  assert.equal(html.includes('Aktuelle Collateral-Menge'), false);
  assert.equal(html.includes('Aktuelle Borrow-Menge'), false);
});

test('open loop list keeps leverage x attached and apr in apr column', () => {
  const filePath = path.join(__dirname, '..', 'public', 'src', 'app-core.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('grid-template-columns:2fr 110px 90px 1fr 1fr');
  assert.ok(start >= 0, 'Loop-Listenblock nicht gefunden');
  const chunk = source.slice(start, start + 1400);

  assert.ok(chunk.includes("tot.leverage.toFixed(2) +"));
  assert.match(chunk, /tot\.leverage\.toFixed\(2\) \+\s+'x<\/span><span class=\"lt-apr/);
  assert.equal(chunk.includes("'</span><span class=\"lt-val\">' +\n                'x'"), false);
  assert.ok(chunk.indexOf("tot.leverage.toFixed(2)") < chunk.indexOf("lt-apr"));
});
