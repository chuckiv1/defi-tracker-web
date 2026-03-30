const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailService } = require('../services/mail');
const { registerAuthRoutes } = require('../routes/auth');

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    cookieCalls: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    cookie(name, value, options) {
      this.cookieCalls.push({ name, value, options });
      return this;
    },
    clearCookie() {
      return this;
    },
  };
}

function createAuthApp(deps) {
  const app = {
    routes: {},
    get(path, ...handlers) {
      this.routes[`GET ${path}`] = handlers[handlers.length - 1];
    },
    post(path, ...handlers) {
      this.routes[`POST ${path}`] = handlers[handlers.length - 1];
    },
  };

  registerAuthRoutes(app, {
    APP_URL: 'http://localhost:3010',
    SESSION_COOKIE: 'dv_session',
    SESSION_COOKIE_OPTS: { httpOnly: true },
    VERIFY_RESEND_LIMIT_MS: 10000,
    crypto: require('node:crypto'),
    db: { query: async () => ({ rows: [] }), ...(deps.db || {}) },
    gid: (() => {
      let i = 0;
      return () => `gid-${++i}`;
    })(),
    hashPassAsync: async (password, salt) => `${password}:${salt}`,
    jwt: { sign: () => 'signed-token' },
    jwtSecret: 'secret',
    normalizeRole: (role) => role,
    sendMail: async () => true,
    timingSafeCompare: (a, b) => a === b,
    touchPresence: () => {},
    verifyResendCooldowns: new Map(),
    ...(deps || {}),
  });

  return app;
}

test('auth endpoints reject missing request bodies with 400 instead of 500', async () => {
  const app = createAuthApp({});

  for (const routePath of ['POST /api/auth/register', 'POST /api/auth/verify', 'POST /api/auth/login']) {
    const res = createResponseRecorder();
    await app.routes[routePath]({}, res);
    assert.equal(res.statusCode, 400, `${routePath} should return 400`);
  }
});

test('register duplicate email uses a generic response to reduce account enumeration', async () => {
  const app = createAuthApp({
    db: {
      async query(sql) {
        if (/SELECT id FROM accounts/i.test(sql)) return { rows: [{ id: 'acc-1' }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  });

  const res = createResponseRecorder();
  await app.routes['POST /api/auth/register']({ body: { email: 'user@example.com', password: '12345678' } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(String(res.payload && res.payload.error), /ungültige anmeldedaten/i);
});

test('verified accounts can request resend without explicit enumeration error', async () => {
  const app = createAuthApp({
    db: {
      async query(sql) {
        if (/SELECT \* FROM accounts/i.test(sql)) {
          return { rows: [{ id: 'acc-1', email: 'user@example.com', isverified: true }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  });

  const res = createResponseRecorder();
  await app.routes['POST /api/auth/resend-verification']({ body: { email: 'user@example.com' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: 1, retryAfterMs: 10000 });
});

test('register stores a hashed expiring verification token outside the accounts table', async () => {
  const queries = [];
  const sent = [];
  const app = createAuthApp({
    gid: (() => {
      const values = ['verify-token-raw', 'account-id', 'verification-log-id'];
      return () => values.shift() || 'extra-id';
    })(),
    db: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (/SELECT id FROM accounts/i.test(sql)) return { rows: [] };
        if (/INSERT INTO accounts/i.test(sql)) return { rowCount: 1, rows: [] };
        if (/INSERT INTO email_verification_logs/i.test(sql)) return { rowCount: 1, rows: [] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    sendMail: async (to, subject, html) => {
      sent.push({ to, subject, html });
      return true;
    },
  });

  const res = createResponseRecorder();
  await app.routes['POST /api/auth/register']({ body: { email: 'new@example.com', password: '12345678' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(queries.some((entry) => /verifyToken/i.test(entry.sql)), false, 'accounts insert should not use verifyToken column');
  const verificationInsert = queries.find((entry) => /INSERT INTO email_verification_logs/i.test(entry.sql));
  assert.ok(verificationInsert, 'verification log insert expected');
  assert.notEqual(String(verificationInsert.params[2]), 'verify-token-raw', 'raw token must not be stored directly');
  assert.match(String(sent[0] && sent[0].html), /verify-token-raw/);
});

test('mail fallback simulation does not leak verification links or raw html', async () => {
  const logs = [];
  const logger = {
    log: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
  };
  const mailService = createMailService({
    nodemailer: {},
    smtpConfig: { host: '', auth: { user: '', pass: '' } },
    logger,
  });

  await mailService.sendMail('user@example.com', 'Verify', 'Klicke <a href="http://localhost:3010/verify.html?token=secret-token">hier</a>');

  const output = logs.join('\n');
  assert.equal(/secret-token/.test(output), false);
  assert.equal(/verify\.html\?token=/.test(output), false);
});
