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
        get(routePath, ...handlers) {
          routerRoutes.push({ method: 'GET', path: routePath, handlers });
        },
        post(routePath, ...handlers) {
          routerRoutes.push({ method: 'POST', path: routePath, handlers });
        },
        put(routePath, ...handlers) {
          routerRoutes.push({ method: 'PUT', path: routePath, handlers });
        },
        delete(routePath, ...handlers) {
          routerRoutes.push({ method: 'DELETE', path: routePath, handlers });
        },
      };
    },
  };

  const app = {
    get(routePath, ...handlers) {
      routes[`GET ${routePath}`] = handlers[handlers.length - 1];
    },
    post(routePath, ...handlers) {
      routes[`POST ${routePath}`] = handlers[handlers.length - 1];
    },
    put(routePath, ...handlers) {
      routes[`PUT ${routePath}`] = handlers[handlers.length - 1];
    },
    delete(routePath, ...handlers) {
      routes[`DELETE ${routePath}`] = handlers[handlers.length - 1];
    },
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

function createFrfPosition(overrides = {}) {
  return {
    id: 'pos-1',
    token: 'BTC',
    type: 'hedge',
    tokenAmount: 1,
    positionSizeUsd: 1000,
    entryPriceShort: 100,
    entryPriceLong: 100,
    shortExchangeId: 'short-ex',
    longExchangeId: 'long-ex',
    longIsSpot: false,
    fees: 0,
    linkedStrategyId: '',
    linkedLoopId: '',
    startDate: '2026-03-01T10:00:00.000Z',
    endedAt: null,
    closePnlShort: null,
    closePnlLong: null,
    closePnlIncludesFunding: false,
    closeNote: '',
    manualPrice: 0,
    useManualPrice: false,
    includeInStrategy: false,
    excluded: false,
    fundingShort: [],
    fundingLong: [],
    ...overrides,
  };
}

function createFrfHarness(profileOverrides = {}) {
  const { registerFrfRoutes } = require('../routes/frf');
  const { app, express, routes, finalize } = createRouteHarness();
  const frfOverrides = profileOverrides.frf || {};
  const remainingProfileOverrides = { ...profileOverrides };
  delete remainingProfileOverrides.frf;
  const profile = {
    frf: {
      exchanges: [
        { id: 'short-ex', name: 'Short', marginHistory: [{ id: 'm-base-short', amount: 1000, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }] },
        { id: 'long-ex', name: 'Long', marginHistory: [{ id: 'm-base-long', amount: 800, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }] },
      ],
      positions: [createFrfPosition()],
      ...frfOverrides,
    },
    undo: [],
    ...remainingProfileOverrides,
  };

  registerFrfRoutes(app, {
    attachProfile: (request, response, next) => next && next(),
    express,
    getExchangeFunding: async () => null,
    getExchangeQuote: async () => null,
    getFrfSpotFallback: async () => null,
    gid: (() => {
      let i = 0;
      return () => `gid-${++i}`;
    })(),
    profileExchangeById: () => null,
    requireAuth: (request, response, next) => next && next(),
    saveProfile: async () => {},
    searchSymbolsForExchange: async () => ({ provider: 'bybit', items: [] }),
    svU: () => {},
  });
  finalize();

  return { routes, profile };
}

test('closing with explicit date stores endedAt and creates tracked auto-close margin entries', async () => {
  const { routes, profile } = createFrfHarness();
  const req = {
    params: { id: 'pos-1' },
    body: {
      closePnlShort: 120,
      closePnlLong: -20,
      closePnlIncludesFunding: true,
      fees: 5,
      closeNote: 'manual close',
      closeDate: '2026-03-12T09:30',
    },
    profile,
  };
  const res = createResponseRecorder();

  await routes['PUT /api/frf/positions/:id/close'](req, res);

  const position = profile.frf.positions[0];
  assert.equal(res.statusCode, 200);
  assert.equal(position.endedAt, '2026-03-12T08:30:00.000Z');
  assert.equal(position.closePnlShort, 120);
  assert.equal(position.closePnlLong, -20);
  assert.ok(position.autoCloseMarginShortId);
  assert.ok(position.autoCloseMarginLongId);

  const shortExchange = profile.frf.exchanges.find((item) => item.id === 'short-ex');
  const longExchange = profile.frf.exchanges.find((item) => item.id === 'long-ex');
  assert.ok(shortExchange.marginHistory.some((item) => item.id === position.autoCloseMarginShortId && item.amount === 120 && item.date === position.endedAt));
  assert.ok(longExchange.marginHistory.some((item) => item.id === position.autoCloseMarginLongId && item.amount === -20 && item.date === position.endedAt));
});

test('editing a closed position updates tracked auto-close margin history instead of duplicating entries', async () => {
  const closedAt = '2026-03-12T08:30:00.000Z';
  const { routes, profile } = createFrfHarness({
    frf: {
      positions: [createFrfPosition({
        endedAt: closedAt,
        closePnlShort: 120,
        closePnlLong: -20,
        closePnlIncludesFunding: true,
        fees: 5,
        closeNote: 'old',
        autoCloseMarginShortId: 'auto-short',
        autoCloseMarginLongId: 'auto-long',
      })],
      exchanges: [
        { id: 'short-ex', name: 'Short', marginHistory: [{ id: 'm-base-short', amount: 1000, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }, { id: 'auto-short', amount: 120, date: closedAt, note: 'Auto-Close PNL: BTC' }] },
        { id: 'long-ex', name: 'Long', marginHistory: [{ id: 'm-base-long', amount: 800, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }, { id: 'auto-long', amount: -20, date: closedAt, note: 'Auto-Close PNL: BTC' }] },
      ],
    },
  });

  const req = {
    params: { id: 'pos-1' },
    body: {
      closePnlShort: 50,
      closePnlLong: 0,
      fees: 2,
      closeNote: 'edited',
      closeDate: '2026-03-15T17:45',
    },
    profile,
  };
  const res = createResponseRecorder();

  await routes['PUT /api/frf/positions/:id/close'](req, res);

  const position = profile.frf.positions[0];
  const shortExchange = profile.frf.exchanges.find((item) => item.id === 'short-ex');
  const longExchange = profile.frf.exchanges.find((item) => item.id === 'long-ex');
  const shortAutoEntries = shortExchange.marginHistory.filter((item) => item.id === 'auto-short');
  const longAutoEntries = longExchange.marginHistory.filter((item) => item.id === 'auto-long');

  assert.equal(res.statusCode, 200);
  assert.equal(position.endedAt, '2026-03-15T16:45:00.000Z');
  assert.equal(position.closePnlShort, 50);
  assert.equal(position.closePnlLong, 0);
  assert.equal(position.closeNote, 'edited');
  assert.equal(shortAutoEntries.length, 1);
  assert.equal(shortAutoEntries[0].amount, 50);
  assert.equal(shortAutoEntries[0].date, position.endedAt);
  assert.equal(longAutoEntries.length, 0);
});

test('reopen removes auto-close margin entries and resets close state', async () => {
  const closedAt = '2026-03-12T08:30:00.000Z';
  const { routes, profile } = createFrfHarness({
    frf: {
      positions: [createFrfPosition({
        endedAt: closedAt,
        closePnlShort: 120,
        closePnlLong: -20,
        closePnlIncludesFunding: true,
        fees: 5,
        closeNote: 'old',
        autoCloseMarginShortId: 'auto-short',
        autoCloseMarginLongId: 'auto-long',
      })],
      exchanges: [
        { id: 'short-ex', name: 'Short', marginHistory: [{ id: 'm-base-short', amount: 1000, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }, { id: 'auto-short', amount: 120, date: closedAt, note: 'Auto-Close PNL: BTC' }] },
        { id: 'long-ex', name: 'Long', marginHistory: [{ id: 'm-base-long', amount: 800, date: '2026-03-01T00:00:00.000Z', note: 'Initial Margin' }, { id: 'auto-long', amount: -20, date: closedAt, note: 'Auto-Close PNL: BTC' }] },
      ],
    },
  });

  const req = { params: { id: 'pos-1' }, profile };
  const res = createResponseRecorder();

  await routes['PUT /api/frf/positions/:id/reopen'](req, res);

  const position = profile.frf.positions[0];
  assert.equal(res.statusCode, 200);
  assert.equal(position.endedAt, null);
  assert.equal(position.closePnlShort, null);
  assert.equal(position.closePnlLong, null);
  assert.equal(position.closeNote, '');
  assert.equal(position.autoCloseMarginShortId || '', '');
  assert.equal(position.autoCloseMarginLongId || '', '');
  assert.equal(profile.frf.exchanges[0].marginHistory.some((item) => item.id === 'auto-short'), false);
  assert.equal(profile.frf.exchanges[1].marginHistory.some((item) => item.id === 'auto-long'), false);
});

test('position updates ignore legacy close-funding toggle requests', async () => {
  const closedAt = '2026-03-12T08:30:00.000Z';
  const { routes, profile } = createFrfHarness({
    frf: {
      positions: [createFrfPosition({
        endedAt: closedAt,
        closePnlShort: 100,
        closePnlLong: 50,
        closePnlIncludesFunding: false,
        fundingShort: [{ id: 'fs1', amount: 12, date: '2026-03-12T08:00:00.000Z' }],
        fundingLong: [{ id: 'fl1', amount: -2, date: '2026-03-12T08:00:00.000Z' }],
      })],
    },
  });

  const req = {
    params: { id: 'pos-1' },
    body: { closePnlIncludesFunding: true, fees: 7 },
    profile,
  };
  const res = createResponseRecorder();
  await routes['PUT /api/frf/positions/:id'](req, res);

  const position = profile.frf.positions[0];
  assert.equal(res.statusCode, 200);
  assert.equal(position.closePnlIncludesFunding, false);
  assert.equal(position.closePnlShort, 100);
  assert.equal(position.closePnlLong, 50);
  assert.equal(position.fees, 7);
});
