const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function createStrategyRouterHarness() {
  const routes = {};
  const mountedRouters = [];
  const express = {
    Router() {
      const routerRoutes = [];
      return {
        __routes: routerRoutes,
        get(routePath, handler) { routerRoutes.push({ method: 'GET', path: routePath, handler }); },
        post(routePath, handler) { routerRoutes.push({ method: 'POST', path: routePath, handler }); },
        put(routePath, handler) { routerRoutes.push({ method: 'PUT', path: routePath, handler }); },
        delete(routePath, handler) { routerRoutes.push({ method: 'DELETE', path: routePath, handler }); },
      };
    },
  };
  const app = {
    get(routePath, ...handlers) { routes[`GET ${routePath}`] = handlers[handlers.length - 1]; },
    post(routePath, ...handlers) { routes[`POST ${routePath}`] = handlers[handlers.length - 1]; },
    use(basePath, ...handlers) {
      const router = handlers[handlers.length - 1];
      mountedRouters.push({ basePath, router });
    },
  };
  return {
    app,
    express,
    routes,
    finalize() {
      mountedRouters.forEach(({ basePath, router }) => {
        (router.__routes || []).forEach((route) => {
          routes[`${route.method} ${basePath}${route.path}`] = route.handler;
        });
      });
    },
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

test('strategy create stores repeatable token changes on the initial investment entry', async () => {
  const { registerStrategyRoutes } = require('../routes/strategies');
  const { app, express, routes, finalize } = createStrategyRouterHarness();
  const req = {
    body: {
      name: 'Vault Strat',
      startDate: '2026-03-29T10:00:00.000Z',
      investment: 1500,
      notes: 'new strat',
      tokenChanges: [
        { name: 'ETH', amount: 0.5, entryPrice: 3200 },
        { name: 'ARB', amount: 200, entryPrice: 1.25 },
      ],
    },
    profile: { data: [], undo: [] },
  };
  let saveCalls = 0;
  registerStrategyRoutes(app, {
    attachProfile: (request, response, next) => next && next(),
    express,
    gid: (() => { let i = 0; return () => `id-${++i}`; })(),
    requireAuth: (request, response, next) => next && next(),
    saveProfile: async () => { saveCalls += 1; },
    svU: () => {},
  });
  finalize();

  const res = createResponseRecorder();
  await routes['POST /api/strategies'](req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(saveCalls, 1);
  assert.equal(req.profile.data.length, 1);
  assert.equal(req.profile.data[0].token, null);
  assert.deepEqual(
    req.profile.data[0].investmentHistory[0].tokenChanges.map((entry) => ({ name: entry.name, amount: entry.amount, entryPrice: entry.entryPrice })),
    [
      { name: 'ETH', amount: 0.5, entryPrice: 3200 },
      { name: 'ARB', amount: 200, entryPrice: 1.25 },
    ],
  );
});

test('strategy investment accepts token-only additions and keeps token changes on the event', async () => {
  const { registerStrategyRoutes } = require('../routes/strategies');
  const { app, express, routes, finalize } = createStrategyRouterHarness();
  const req = {
    params: { id: 's1' },
    body: {
      amount: '',
      note: 'vault deposit',
      tokenChanges: [
        { name: 'USDC', amount: 250, entryPrice: 1 },
        { name: 'sAVAX', amount: 10, entryPrice: 10.8 },
      ],
    },
    profile: {
      data: [
        {
          id: 's1',
          investmentHistory: [],
          rewards: [],
          pnl: [],
        },
      ],
      undo: [],
    },
  };
  registerStrategyRoutes(app, {
    attachProfile: (request, response, next) => next && next(),
    express,
    gid: (() => { let i = 0; return () => `id-${++i}`; })(),
    requireAuth: (request, response, next) => next && next(),
    saveProfile: async () => {},
    svU: () => {},
  });
  finalize();

  const res = createResponseRecorder();
  await routes['POST /api/strategies/:id/investment'](req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(req.profile.data[0].investmentHistory.length, 1);
  assert.equal(req.profile.data[0].investmentHistory[0].amount, 0);
  assert.deepEqual(
    req.profile.data[0].investmentHistory[0].tokenChanges.map((entry) => ({ name: entry.name, amount: entry.amount, entryPrice: entry.entryPrice })),
    [
      { name: 'USDC', amount: 250, entryPrice: 1 },
      { name: 'sAVAX', amount: 10, entryPrice: 10.8 },
    ],
  );
});

test('strategy modals use add-token buttons instead of always-visible token fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.match(source, /strategyTokenInputSection\('f-token-create-rows'\)/);
  assert.match(source, /strategyTokenInputSection\('f-token-invest-rows'\)/);
  assert.match(source, /Token hinzufügen/);
});

test('investment token changes render as stacked rows instead of inline flow', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.match(source, /display:grid;gap:4px/);
  assert.match(source, /Tokenänderungen/);
});

test('top strategy token card renders each token in its own stacked row', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  assert.match(source, /display:grid;gap:10px/);
  assert.match(source, /Token</);
});

test('strategy token summary resets cost basis after a full exit and re-entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'src', 'app-core.js'), 'utf8');
  const snippets = [
    source.match(/function strategyTokenEntries\(s\) \{[\s\S]*?\n\}/),
    source.match(/function strategyTokenSummary\(s\) \{[\s\S]*?\n\}/),
  ];
  snippets.forEach((match, index) => {
    assert.ok(match, `Strategy-Token-Helfer ${index + 1} nicht gefunden`);
  });

  const script = new (require('node:vm').Script)(`${snippets.map((match) => match[0]).join('\n')}; strategyTokenSummary;`);
  const strategyTokenSummary = script.runInNewContext({ Array, Math, Number, Object, String, parseFloat });

  const summary = strategyTokenSummary({
    investmentHistory: [
      { tokenChanges: [{ name: 'ETH', amount: 1, entryPrice: 100 }] },
      { tokenChanges: [{ name: 'ETH', amount: -1, entryPrice: 100 }] },
      { tokenChanges: [{ name: 'ETH', amount: 1, entryPrice: 200 }] },
    ],
  });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].amount, 1);
  assert.equal(summary[0].entryPrice, 200);
  assert.equal(summary[0].value, 200);
});
