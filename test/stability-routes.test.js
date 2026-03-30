const test = require('node:test');
const assert = require('node:assert/strict');

function createRouteHarness() {
  const routes = {};
  const mountedRouters = [];
  const express = {
    Router() {
      const routerRoutes = [];
      return {
        __routes: routerRoutes,
        get(routePath, ...handlers) { routerRoutes.push({ method: 'GET', path: routePath, handlers }); },
        post(routePath, ...handlers) { routerRoutes.push({ method: 'POST', path: routePath, handlers }); },
        put(routePath, ...handlers) { routerRoutes.push({ method: 'PUT', path: routePath, handlers }); },
        delete(routePath, ...handlers) { routerRoutes.push({ method: 'DELETE', path: routePath, handlers }); },
      };
    },
  };

  const app = {
    get(routePath, ...handlers) { routes[`GET ${routePath}`] = handlers[handlers.length - 1]; },
    post(routePath, ...handlers) { routes[`POST ${routePath}`] = handlers[handlers.length - 1]; },
    put(routePath, ...handlers) { routes[`PUT ${routePath}`] = handlers[handlers.length - 1]; },
    delete(routePath, ...handlers) { routes[`DELETE ${routePath}`] = handlers[handlers.length - 1]; },
    use(basePath, ...handlers) {
      const router = handlers[handlers.length - 1];
      mountedRouters.push({ basePath, router });
    },
  };

  function finalize() {
    mountedRouters.forEach(({ basePath, router }) => {
      (router.__routes || []).forEach((route) => {
        routes[`${route.method} ${basePath}${route.path}`] = route.handlers[route.handlers.length - 1];
      });
    });
  }

  return { app, express, routes, finalize };
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

test('profile delete rejects deleting the last remaining profile', async () => {
  const { registerProfileRoutes } = require('../routes/profiles');
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS count FROM profiles/i.test(sql)) {
        return { rows: [{ count: 1 }] };
      }
      if (/DELETE FROM profiles/i.test(sql)) {
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const app = {
    post() {},
    put() {},
    delete(path, ...handlers) {
      this.handler = handlers[handlers.length - 1];
    },
  };

  registerProfileRoutes(app, {
    db,
    gid: () => 'profile-2',
    requireAuth: (req, res, next) => next && next(),
  });

  const req = {
    params: { id: 'profile-1' },
    account: { id: 'account-1' },
  };
  const res = createResponseRecorder();
  await app.handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(String(res.payload && res.payload.error), /mindestens ein profil/i);
  assert.equal(queries.some((entry) => /DELETE FROM profiles/i.test(entry.sql)), false);
});

test('admin role change rejects invalid roles instead of silently downgrading to user', async () => {
  const { registerAdminRoutes } = require('../routes/admin');
  const queries = [];
  const app = {
    get() {},
    delete() {},
    post() {},
    put(path, ...handlers) {
      if (path === '/api/admin/accounts/:id/role') this.roleHandler = handlers[handlers.length - 1];
    },
  };
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT id, email, role FROM accounts/i.test(sql)) {
        return { rows: [{ id: 'target-1', email: 'user@example.com', role: 'user' }] };
      }
      if (/UPDATE accounts SET role/i.test(sql)) {
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  registerAdminRoutes(app, {
    db,
    hasRole: () => true,
    normalizeRole: (role) => ['user', 'support', 'admin', 'owner'].includes(role) ? role : 'user',
    requireAdmin: (req, res, next) => next && next(),
  });

  const req = {
    params: { id: 'target-1' },
    body: { role: 'superadmin' },
    account: { id: 'owner-1', role: 'owner' },
  };
  const res = createResponseRecorder();
  await app.roleHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(String(res.payload && res.payload.error), /ungültige rolle/i);
  assert.equal(queries.some((entry) => /UPDATE accounts SET role/i.test(entry.sql)), false);
});

test('strategy token update rejects invalid token amount instead of coercing to zero', async () => {
  const { registerStrategyRoutes } = require('../routes/strategies');
  const { app, express, routes, finalize } = createRouteHarness();
  const req = {
    params: { id: 's1', action: 'token' },
    body: { name: 'ETH', amount: 'abc', entryPrice: '3200' },
    profile: {
      data: [{ id: 's1', token: null, rewards: [], pnl: [], investmentHistory: [] }],
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
  await routes['PUT /api/strategies/:id/:action'](req, res);

  assert.equal(res.statusCode, 400);
  assert.match(String(res.payload && res.payload.error), /tokenmenge|betrag|ungültig/i);
});

test('frf exchange creation rejects invalid initial margin', async () => {
  const { registerFrfRoutes } = require('../routes/frf');
  const { app, express, routes, finalize } = createRouteHarness();
  const req = {
    body: { name: 'Bybit', margin: 'abc' },
    profile: { frf: { exchanges: [], positions: [] }, undo: [] },
  };

  registerFrfRoutes(app, {
    attachProfile: (request, response, next) => next && next(),
    express,
    getExchangeFunding: async () => null,
    getExchangeQuote: async () => null,
    getFrfSpotFallback: async () => null,
    gid: (() => { let i = 0; return () => `id-${++i}`; })(),
    profileExchangeById: () => null,
    requireAuth: (request, response, next) => next && next(),
    saveProfile: async () => {},
    searchSymbolsForExchange: async () => ({ provider: 'bybit', items: [] }),
    svU: () => {},
  });
  finalize();

  const res = createResponseRecorder();
  await routes['POST /api/frf/exchanges'](req, res);

  assert.equal(res.statusCode, 400);
  assert.match(String(res.payload && res.payload.error), /margin|betrag|ungültig/i);
});
