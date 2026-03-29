require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WSClient = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
const db = require('./db');
const fs = require('fs');
const oracle = require('./services/oracle/aggregator');
const benqiProvider = require('./services/oracle/providers/benqi');
const validation = require('./services/validation');
const { createMailService } = require('./services/mail');
const { createExchangeService } = require('./services/exchanges');
const { createAuthMiddleware } = require('./middleware/auth');
const { applyAuthRateLimiters, createAuthLimiter } = require('./middleware/rateLimiter');
const { registerAuthRoutes } = require('./routes/auth');
const { registerProfileRoutes } = require('./routes/profiles');
const { registerLoopRoutes } = require('./routes/loops');
const { registerAdminRoutes } = require('./routes/admin');
const { registerMessageRoutes } = require('./routes/messages');
const { registerBackupRoutes } = require('./routes/backup');
const { registerOracleRoutes } = require('./routes/oracle');
const { registerStrategyRoutes } = require('./routes/strategies');
const { registerFrfRoutes } = require('./routes/frf');

const app = express();
const PORT = process.env.PORT || 3002;
const APP_URL = process.env.APP_URL || 'https://defivault.cloud';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET ist erforderlich. Bitte in der Umgebung setzen.');
}
const APP_IS_HTTPS = (() => {
  try {
    return new URL(APP_URL).protocol === 'https:';
  } catch {
    return true;
  }
})();
const SESSION_COOKIE = 'dv_session';
const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: APP_IS_HTTPS,
  path: '/'
};
const VERIFY_RESEND_LIMIT_MS = 10000;
const verifyResendCooldowns = new Map();
const ACTIVITY_TOUCH_MS = 60000;
const activityTouchCache = new Map();
const EXCHANGE_CACHE_MS = 5 * 60 * 1000;
const VARIATIONAL_DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000;
const VARIATIONAL_BATCH_SIZE = 120;
const FUNDING_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const VARIATIONAL_FUNDING_CAPTURE_MS = 5 * 60 * 1000;
const exchangeLookupCache = new Map();
const variationalFundingSnapshotDir = path.join(__dirname, '.runtime');
const variationalFundingSnapshotFile = path.join(variationalFundingSnapshotDir, 'variational-funding-snapshots.json');
const MESSAGE_SEGMENTS = new Set(['all_users', 'active_7d', 'active_30d', 'new_14d', 'verified_users', 'admins']);
const ROLE_ORDER = ['user', 'support', 'admin', 'owner'];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidEntryArray(list, requiredFields) {
  if (!Array.isArray(list)) return false;
  return list.every((entry) => isPlainObject(entry) && requiredFields.every((field) => Object.prototype.hasOwnProperty.call(entry, field)));
}

function isValidStrategy(strategy) {
  return isPlainObject(strategy)
    && typeof strategy.id === 'string'
    && typeof strategy.name === 'string'
    && typeof strategy.startDate === 'string'
    && isPlainObject(strategy.token)
    && typeof strategy.token.name === 'string'
    && Number.isFinite(parseFloat(strategy.token.amount))
    && Number.isFinite(parseFloat(strategy.token.entryPrice))
    && isValidEntryArray(strategy.investmentHistory || [], ['id', 'amount', 'date'])
    && isValidEntryArray(strategy.rewards || [], ['id', 'amount', 'date'])
    && isValidEntryArray(strategy.pnl || [], ['id', 'amount', 'date']);
}

function isValidFrfPayload(frf) {
  if (!isPlainObject(frf) || !Array.isArray(frf.exchanges) || !Array.isArray(frf.positions)) return false;

  const exchangesValid = frf.exchanges.every((exchange) => isPlainObject(exchange)
    && typeof exchange.id === 'string'
    && typeof exchange.name === 'string'
    && isValidEntryArray(exchange.marginHistory || [], ['id', 'amount', 'date']));

  const positionsValid = frf.positions.every((position) => isPlainObject(position)
    && typeof position.id === 'string'
    && typeof position.type === 'string'
    && typeof position.token === 'string'
    && Number.isFinite(parseFloat(position.tokenAmount))
    && isValidEntryArray(position.fundingShort || [], ['id', 'amount', 'date'])
    && isValidEntryArray(position.fundingLong || [], ['id', 'amount', 'date']));

  return exchangesValid && positionsValid;
}

function sanitizeMessageLinkUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { value: null, invalid: false };
  if (value.startsWith('/') && !value.startsWith('//')) return { value, invalid: false };

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { value: parsed.toString(), invalid: false };
    }
  } catch (error) {
    return { value: null, invalid: true };
  }

  return { value: null, invalid: true };
}

function normalizeLoopTokenInput(value) {
  return String(value || '').trim().toUpperCase().slice(0, 50);
}

async function isPrivilegedRecipient(targetAccountId) {
  if (!targetAccountId) return false;
  const { rows } = await db.query(
    "SELECT id FROM accounts WHERE id = $1 AND role IN ('support','admin','owner') AND isVerified = true AND isBlocked = false",
    [targetAccountId],
  );
  return rows.length > 0;
}

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER || "", pass: process.env.SMTP_PASS || "" }
};

const mailService = createMailService({ nodemailer, smtpConfig: SMTP_CONFIG, logger: console });
const exchangeService = createExchangeService({ db, fs, path, WSClient, fetchImpl: fetch, baseDir: __dirname });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.set('trust proxy', 1);

const authLimiter = createAuthLimiter(rateLimit);
applyAuthRateLimiters(app, authLimiter);

app.use(express.static(path.join(__dirname, 'public')));

async function initDbWithRetry(maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.initDB();
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.error(`DB-Init Versuch ${attempt} fehlgeschlagen: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

initDbWithRetry().catch((err) => console.error('DB-Init fehlgeschlagen:', err));

// Cleanup Maps alle 10 Minuten um Memory Leaks zu verhindern
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of verifyResendCooldowns) {
    if (now - val > VERIFY_RESEND_LIMIT_MS * 3) verifyResendCooldowns.delete(key);
  }
  for (const [key, val] of activityTouchCache) {
    if (now - val > ACTIVITY_TOUCH_MS * 10) activityTouchCache.delete(key);
  }
  for (const [key, val] of exchangeLookupCache) {
    if (!val || !val.expiresAt || now > val.expiresAt) exchangeLookupCache.delete(key);
  }
  exchangeService.cleanupCaches(now);
}, 600000);

function gid() { return crypto.randomBytes(16).toString('hex'); }
function hashPass(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
}
function hashPassAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 210000, 64, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}
function timingSafeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function cacheGet(key) {
  const item = exchangeLookupCache.get(key);
  if (!item || !item.expiresAt || Date.now() > item.expiresAt) {
    exchangeLookupCache.delete(key);
    return null;
  }
  return item.value;
}
function cacheSet(key, value, ttlMs = EXCHANGE_CACHE_MS) {
  exchangeLookupCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Ungueltige Antwort von ${url}`);
  }
  if (!response.ok) {
    const message = data && (data.error || data.message || data.retMsg) ? String(data.error || data.message || data.retMsg) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
function normalizeExchangeProvider(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('extended') || value.includes('extendet')) return 'extended';
  if (value.includes('hyperliquid') || value === 'hl') return 'hyperliquid';
  if (value.includes('variational') || value.includes('omni')) return 'variational';
  if (value.includes('phemex')) return 'phemex';
  if (value.includes('bybit')) return 'bybit';
  return null;
}
function normalizeLookupSymbol(raw, maxLen = 32) {
  const value = String(raw || '').trim().toUpperCase().slice(0, maxLen);
  return /^[A-Z0-9._-]{1,32}$/.test(value) ? value : '';
}
function rankLookup(value, query) {
  if (!query) return 3;
  const normalized = String(value || '').toUpperCase();
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  return 9;
}
function preferUsdQuote(a, b) {
  const order = { USDT: 0, USDC: 1, USD: 2 };
  const av = order[String(a || '').toUpperCase()] ?? 9;
  const bv = order[String(b || '').toUpperCase()] ?? 9;
  return av - bv;
}
function uniqueBy(items, keyFn) {
  const seen = new Map();
  items.forEach(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.set(key, item);
  });
  return [...seen.values()];
}
function ensureRuntimeDir() {
  try {
    if (!fs.existsSync(variationalFundingSnapshotDir)) fs.mkdirSync(variationalFundingSnapshotDir, { recursive: true });
  } catch (error) {}
}
function readVariationalFundingSnapshots() {
  try {
    if (!fs.existsSync(variationalFundingSnapshotFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(variationalFundingSnapshotFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}
function writeVariationalFundingSnapshots(items) {
  try {
    ensureRuntimeDir();
    fs.writeFileSync(variationalFundingSnapshotFile, JSON.stringify(items, null, 2));
  } catch (error) {}
}
function normalizeFundingEntry(time, rate, intervalSeconds, extra = {}) {
  const ts = parseFloat(time) || 0;
  const fundingRate = parseFloat(rate);
  const interval = parseFloat(intervalSeconds) || 0;
  if (!(ts > 0) || !Number.isFinite(fundingRate) || !(interval > 0)) return null;
  return {
    time: Math.round(ts),
    fundingRate,
    intervalSeconds: interval,
    rate8h: fundingRate * (EIGHT_HOURS_MS / 1000) / interval,
    ...extra
  };
}
function buildFundingPayload(provider, exchangeName, market, symbol, currentRate, intervalSeconds, settledEntries, extra = {}) {
  const interval = parseFloat(intervalSeconds) || 0;
  const rows = (Array.isArray(settledEntries) ? settledEntries : []).map(entry => normalizeFundingEntry(entry.time, entry.fundingRate, entry.intervalSeconds || interval, entry.extra || {})).filter(Boolean).filter(entry => entry.time >= Date.now() - FUNDING_LOOKBACK_MS).sort((a, b) => b.time - a.time);
  const avgRate8h = rows.length ? rows.reduce((sum, entry) => sum + entry.rate8h, 0) / rows.length : null;
  return {
    provider,
    exchangeName,
    market,
    symbol,
    currentRate: Number.isFinite(parseFloat(currentRate)) ? parseFloat(currentRate) : null,
    intervalSeconds: interval || null,
    averageRate8h: Number.isFinite(avgRate8h) ? avgRate8h : null,
    settledRates72h8h: rows,
    ...extra
  };
}
function variationalSettlementTime(nowMs, intervalSeconds) {
  const intervalMs = (parseFloat(intervalSeconds) || 0) * 1000;
  if (!(intervalMs > 0)) return 0;
  return Math.ceil(nowMs / intervalMs) * intervalMs;
}
function storeVariationalFundingSnapshot(symbol, fundingRate, intervalSeconds, capturedAtMs) {
  const normalizedSymbol = normalizeLookupSymbol(symbol, 20);
  const interval = parseFloat(intervalSeconds) || 0;
  const rate = parseFloat(fundingRate);
  const capturedAt = parseFloat(capturedAtMs) || Date.now();
  if (!normalizedSymbol || !(interval > 0) || !Number.isFinite(rate)) return;
  const settlementTime = variationalSettlementTime(capturedAt, interval);
  if (!(settlementTime > 0)) return;
  const rows = readVariationalFundingSnapshots().filter(item => item && item.symbol && item.settlementTime && item.settlementTime >= Date.now() - FUNDING_LOOKBACK_MS - EIGHT_HOURS_MS);
  const existing = rows.find(item => item.symbol === normalizedSymbol && item.settlementTime === settlementTime);
  if (existing) {
    existing.fundingRate = rate;
    existing.intervalSeconds = interval;
    existing.capturedAt = capturedAt;
  } else {
    rows.push({ symbol: normalizedSymbol, fundingRate: rate, intervalSeconds: interval, settlementTime, capturedAt });
  }
  writeVariationalFundingSnapshots(rows.sort((a, b) => a.settlementTime - b.settlementTime));
}
function getVariationalSettlementEntries(symbol) {
  const normalizedSymbol = normalizeLookupSymbol(symbol, 20);
  const now = Date.now();
  return readVariationalFundingSnapshots().filter(item => item && item.symbol === normalizedSymbol && item.settlementTime <= now && item.settlementTime >= now - FUNDING_LOOKBACK_MS).map(item => ({ time: item.settlementTime, fundingRate: item.fundingRate, intervalSeconds: item.intervalSeconds }));
}
function wsListen(socket, event, handler) {
  if (socket && typeof socket.addEventListener === 'function') {
    socket.addEventListener(event, handler);
    return;
  }
  if (socket && typeof socket.on === 'function') {
    socket.on(event, arg => {
      if (event === 'message') {
        const data = typeof arg === 'string' ? arg : (arg && arg.data !== undefined ? arg.data : arg);
        handler({ data: typeof data === 'string' ? data : data.toString() });
        return;
      }
      handler(arg);
    });
  }
}
function profileExchangeById(profile, exchangeId) {
  if (!profile || !profile.frf || !Array.isArray(profile.frf.exchanges)) return null;
  return profile.frf.exchanges.find(x => x.id === exchangeId) || null;
}
function buildQuotePayload(provider, exchangeName, market, symbol, price, referencePrice, bidPrice, askPrice, mode, sourceLabel) {
  return {
    provider,
    exchangeName,
    market,
    symbol,
    price,
    referencePrice,
    bidPrice,
    askPrice,
    mode,
    sourceLabel
  };
}
let variationalDiscoveryPromise = null;
async function getExtendedMarkets() {
  const cached = cacheGet('extended_markets');
  if (cached) return cached;
  const payload = await fetchJson('https://app.extended.exchange/api/v1/info/markets');
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];
  const items = rows.filter(row => row && row.active && row.status === 'ACTIVE' && row.name && row.assetName).map(row => ({
    symbol: String(row.assetName || '').toUpperCase(),
    market: String(row.name || '').toUpperCase(),
    quote: String(row.collateralAssetName || 'USD').toUpperCase(),
    label: `${String(row.assetName || '').toUpperCase()} - ${String(row.name || '').toUpperCase()}`
  }));
  return cacheSet('extended_markets', items);
}
async function searchExtendedMarkets(query) {
  const q = normalizeLookupSymbol(query, 30);
  const rows = await getExtendedMarkets();
  return rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
    .filter(row => !q || row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market))
    .slice(0, 12);
}
async function getExtendedQuote(token, mode, exchangeName) {
  const normalized = normalizeLookupSymbol(token);
  if (!normalized) throw new Error('Ungueltiges Extended-Symbol');
  const rows = await getExtendedMarkets();
  const market = rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
    .filter(row => row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market))[0];
  if (!market) throw new Error(`Extended-Markt fuer ${normalized} nicht gefunden`);
  const payload = await fetchJson(`https://app.extended.exchange/api/v1/info/markets/${encodeURIComponent(market.market)}/stats`);
  const data = payload && payload.data ? payload.data : null;
  if (!data) throw new Error('Keine Extended-Marktdaten erhalten');
  return buildQuotePayload('extended', exchangeName, market.market, market.symbol, parseFloat(data.lastPrice) || 0, parseFloat(data.markPrice) || 0, parseFloat(data.bidPrice) || 0, parseFloat(data.askPrice) || 0, mode, 'Extended market stats');
}
async function getHyperliquidUniverse() {
  const cached = cacheGet('hyperliquid_universe');
  if (cached) return cached;
  const payload = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'meta' })
  });
  const rows = payload && Array.isArray(payload.universe) ? payload.universe : [];
  const items = rows.filter(row => row && row.name && !row.isDelisted).map(row => ({
    symbol: String(row.name || '').toUpperCase(),
    market: String(row.name || '').toUpperCase(),
    quote: 'USD',
    label: `${String(row.name || '').toUpperCase()} perpetual`
  }));
  return cacheSet('hyperliquid_universe', items);
}
async function searchHyperliquidSymbols(query) {
  const q = normalizeLookupSymbol(query, 30);
  const rows = await getHyperliquidUniverse();
  return rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.label, q)) }))
    .filter(row => !q || row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.symbol.localeCompare(b.symbol))
    .slice(0, 12);
}
async function getHyperliquidQuote(token, mode, exchangeName) {
  const normalized = normalizeLookupSymbol(token, 20);
  if (!normalized) throw new Error('Ungueltiges Hyperliquid-Symbol');
  const payload = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' })
  });
  if (!Array.isArray(payload) || payload.length < 2) throw new Error('Unerwartete Hyperliquid-Antwort');
  const universe = Array.isArray(payload[0] && payload[0].universe) ? payload[0].universe : [];
  const contexts = Array.isArray(payload[1]) ? payload[1] : [];
  const index = universe.findIndex(row => row && String(row.name || '').toUpperCase() === normalized);
  if (index < 0 || !contexts[index]) throw new Error(`Hyperliquid-Markt fuer ${normalized} nicht gefunden`);
  const ctx = contexts[index];
  return buildQuotePayload('hyperliquid', exchangeName, normalized, normalized, parseFloat(ctx.markPx) || parseFloat(ctx.midPx) || 0, parseFloat(ctx.oraclePx) || 0, Array.isArray(ctx.impactPxs) ? parseFloat(ctx.impactPxs[0]) || 0 : 0, Array.isArray(ctx.impactPxs) ? parseFloat(ctx.impactPxs[1]) || 0 : 0, mode, 'Hyperliquid metaAndAssetCtxs');
}
async function getBybitSpotMarkets() {
  const cached = cacheGet('bybit_spot_markets');
  if (cached) return cached;
  const payload = await fetchJson('https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000');
  const rows = payload && payload.result && Array.isArray(payload.result.list) ? payload.result.list : [];
  const items = rows.filter(row => row && row.status === 'Trading' && ['USDT', 'USDC', 'USD'].includes(String(row.quoteCoin || '').toUpperCase())).map(row => ({
    symbol: String(row.baseCoin || '').toUpperCase(),
    market: String(row.symbol || '').toUpperCase(),
    quote: String(row.quoteCoin || '').toUpperCase(),
    label: `${String(row.baseCoin || '').toUpperCase()} / ${String(row.quoteCoin || '').toUpperCase()}`
  }));
  return cacheSet('bybit_spot_markets', items);
}
async function getBybitPerpMarkets() {
  const cached = cacheGet('bybit_perp_markets');
  if (cached) return cached;
  const payload = await fetchJson('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000');
  const rows = payload && payload.result && Array.isArray(payload.result.list) ? payload.result.list : [];
  const items = rows.filter(row => row && row.status === 'Trading' && row.contractType === 'LinearPerpetual' && ['USDT', 'USDC'].includes(String(row.quoteCoin || '').toUpperCase())).map(row => ({
    symbol: String(row.baseCoin || '').toUpperCase(),
    market: String(row.symbol || '').toUpperCase(),
    quote: String(row.quoteCoin || '').toUpperCase(),
    intervalSeconds: parseFloat(row.fundingInterval) ? parseFloat(row.fundingInterval) * 60 : 8 * 3600,
    label: `${String(row.baseCoin || '').toUpperCase()} perpetual ${String(row.quoteCoin || '').toUpperCase()}`
  }));
  return cacheSet('bybit_perp_markets', items);
}
async function getPhemexSpotMarkets() {
  const cached = cacheGet('phemex_spot_markets');
  if (cached) return cached;
  const payload = await fetchJson('https://api.phemex.com/public/products');
  const rows = payload && payload.data && Array.isArray(payload.data.products) ? payload.data.products : [];
  const items = rows.filter(row => row && row.type === 'Spot' && row.status === 'Listed' && ['USDT', 'USDC', 'USD'].includes(String(row.quoteCurrency || '').toUpperCase())).map(row => ({
    symbol: String(row.baseCurrency || '').toUpperCase(),
    market: String(row.symbol || '').toUpperCase(),
    quote: String(row.quoteCurrency || '').toUpperCase(),
    label: `${String(row.baseCurrency || '').toUpperCase()} / ${String(row.quoteCurrency || '').toUpperCase()}`
  }));
  return cacheSet('phemex_spot_markets', items);
}
async function getPhemexPerpMarkets() {
  const cached = cacheGet('phemex_perp_markets');
  if (cached) return cached;
  const payload = await fetchJson('https://api.phemex.com/public/products');
  const rowsV2 = payload && payload.data && Array.isArray(payload.data.perpProductsV2) ? payload.data.perpProductsV2 : [];
  const rowsLegacy = payload && payload.data && Array.isArray(payload.data.products) ? payload.data.products : [];
  const v2Items = rowsV2.filter(row => row && String(row.status || '') === 'Listed' && ['USDT', 'USDC'].includes(String(row.quoteCurrency || '').toUpperCase())).map(row => ({
    symbol: String(row.baseCurrency || '').toUpperCase(),
    market: String(row.symbol || '').toUpperCase(),
    quote: String(row.quoteCurrency || '').toUpperCase(),
    intervalSeconds: parseFloat(row.fundingInterval) || 28800,
    fundingHistorySymbol: String(row.fundingRate8hSymbol || row.fundingRateSymbol || '').trim(),
    label: `${String(row.baseCurrency || '').toUpperCase()} perpetual ${String(row.quoteCurrency || '').toUpperCase()}`
  }));
  const legacyItems = rowsLegacy.filter(row => row && String(row.type || '') === 'Perpetual' && String(row.status || '') === 'Listed' && ['USD'].includes(String(row.quoteCurrency || '').toUpperCase())).map(row => ({
    symbol: String(String(row.displaySymbol || row.symbol || '').replace(/\s*\/.*$/, '') || '').replace(/^c/, '').toUpperCase(),
    market: String(row.symbol || '').toUpperCase(),
    quote: String(row.quoteCurrency || '').toUpperCase(),
    intervalSeconds: parseFloat(row.fundingInterval) || 28800,
    fundingHistorySymbol: String(row.fundingRate8hSymbol || row.fundingRateSymbol || '').trim(),
    label: `${String(String(row.displaySymbol || row.symbol || '').replace(/\s+/g, ' ').trim() || row.symbol || '').replace(/^c/, '')} perpetual`
  })).filter(item => item.symbol && item.market);
  return cacheSet('phemex_perp_markets', uniqueBy([...v2Items, ...legacyItems], row => row.market));
}
async function searchPhemexSymbols(query) {
  const q = normalizeLookupSymbol(query, 30);
  const [spot, perp] = await Promise.all([getPhemexSpotMarkets(), getPhemexPerpMarkets()]);
  const merged = uniqueBy([...perp, ...spot].sort((a, b) => preferUsdQuote(a.quote, b.quote)), row => row.symbol + ':' + row.quote);
  return merged.map(row => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
    .filter(row => !q || row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);
}
async function resolvePhemexMarket(token, mode) {
  const normalized = normalizeLookupSymbol(token, 24);
  if (!normalized) throw new Error('Ungueltiges Phemex-Symbol');
  const rows = mode === 'spot' ? await getPhemexSpotMarkets() : await getPhemexPerpMarkets();
  const market = rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
    .filter(row => row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market))[0];
  if (!market) throw new Error(`Phemex-Markt fuer ${normalized} nicht gefunden`);
  return market;
}
async function getPhemexQuote(token, mode, exchangeName) {
  const market = await resolvePhemexMarket(token, mode);
  const path = mode === 'spot' ? `https://api.phemex.com/md/spot/ticker/24hr?symbol=${encodeURIComponent(market.market)}` : `https://api.phemex.com/md/v2/ticker/24hr?symbol=${encodeURIComponent(market.market)}`;
  const payload = await fetchJson(path);
  const row = payload && payload.result ? payload.result : null;
  if (!row) throw new Error(`Phemex-Ticker fuer ${market.market} nicht gefunden`);
  const price = mode === 'spot' ? (parseFloat(row.lastEp) || 0) / 1e8 : parseFloat(row.markPriceRp) || parseFloat(row.closeRp) || 0;
  const reference = mode === 'spot' ? (parseFloat(row.indexEp) || 0) / 1e8 : parseFloat(row.indexPriceRp) || 0;
  const bid = mode === 'spot' ? (parseFloat(row.bidEp) || 0) / 1e8 : 0;
  const ask = mode === 'spot' ? (parseFloat(row.askEp) || 0) / 1e8 : 0;
  return buildQuotePayload('phemex', exchangeName, market.market, market.symbol, price, reference, bid, ask, mode, mode === 'spot' ? 'Phemex spot ticker' : 'Phemex perp ticker');
}
async function getBybitFunding(token, exchangeName) {
  const market = await resolveBybitMarket(token, 'perp');
  const [tickerPayload, historyPayload] = await Promise.all([
    fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(market.market)}`),
    fetchJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodeURIComponent(market.market)}&limit=30`)
  ]);
  const ticker = tickerPayload && tickerPayload.result && Array.isArray(tickerPayload.result.list) ? tickerPayload.result.list[0] : null;
  const intervalSeconds = market.intervalSeconds || ((parseFloat(ticker && ticker.fundingIntervalHour) || 8) * 3600);
  const settled = ((historyPayload && historyPayload.result && Array.isArray(historyPayload.result.list)) ? historyPayload.result.list : []).map(item => ({
    time: parseFloat(item.fundingRateTimestamp) || 0,
    fundingRate: parseFloat(item.fundingRate),
    intervalSeconds
  }));
  return buildFundingPayload('bybit', exchangeName, market.market, market.symbol, ticker ? ticker.fundingRate : null, intervalSeconds, settled, { nextFundingTime: ticker ? parseFloat(ticker.nextFundingTime) || 0 : 0 });
}
async function getPhemexFunding(token, exchangeName) {
  const market = await resolvePhemexMarket(token, 'perp');
  const historySymbol = market.fundingHistorySymbol || `.${market.market}FR8H`;
  const [tickerPayload, historyPayload] = await Promise.all([
    fetchJson(`https://api.phemex.com/md/v3/ticker/24hr?symbol=${encodeURIComponent(market.market)}`),
    fetchJson(`https://api.phemex.com/api-data/public/data/funding-rate-history?symbol=${encodeURIComponent(historySymbol)}&limit=30`)
  ]);
  const ticker = tickerPayload && tickerPayload.result ? tickerPayload.result : null;
  const settled = (((historyPayload && historyPayload.data && Array.isArray(historyPayload.data.rows)) ? historyPayload.data.rows : [])).map(item => ({
    time: parseFloat(item.fundingTime) || 0,
    fundingRate: parseFloat(item.fundingRate),
    intervalSeconds: parseFloat(item.intervalSeconds) || market.intervalSeconds || 28800
  }));
  return buildFundingPayload('phemex', exchangeName, market.market, market.symbol, ticker ? ticker.fundingRateRr : null, market.intervalSeconds || 28800, settled, { predictedRate: ticker ? parseFloat(ticker.predFundingRateRr) : null });
}
async function getHyperliquidFunding(token, exchangeName) {
  const normalized = normalizeLookupSymbol(token, 20);
  if (!normalized) throw new Error('Ungueltiges Hyperliquid-Symbol');
  const [currentPayload, historyPayload] = await Promise.all([
    fetchJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) }),
    fetchJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin: normalized, startTime: Date.now() - FUNDING_LOOKBACK_MS, endTime: Date.now() }) })
  ]);
  const universe = Array.isArray(currentPayload[0] && currentPayload[0].universe) ? currentPayload[0].universe : [];
  const contexts = Array.isArray(currentPayload[1]) ? currentPayload[1] : [];
  const index = universe.findIndex(item => item && String(item.name || '').toUpperCase() === normalized);
  if (index < 0 || !contexts[index]) throw new Error(`Hyperliquid-Markt fuer ${normalized} nicht gefunden`);
  const ctx = contexts[index];
  const rawHistory = Array.isArray(historyPayload) ? historyPayload : [];
  const intervalSeconds = rawHistory.length > 1 ? Math.max(1, Math.round(Math.abs(rawHistory[1].time - rawHistory[0].time) / 1000)) : 3600;
  const settled = rawHistory.map(item => ({ time: parseFloat(item.time) || 0, fundingRate: parseFloat(item.fundingRate), intervalSeconds }));
  return buildFundingPayload('hyperliquid', exchangeName, normalized, normalized, ctx.funding, intervalSeconds, settled, { premium: parseFloat(ctx.premium) || 0 });
}
async function getExtendedFunding(token, exchangeName) {
  const normalized = normalizeLookupSymbol(token);
  if (!normalized) throw new Error('Ungueltiges Extended-Symbol');
  const rows = await getExtendedMarkets();
  const market = rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) })).filter(row => row.rank < 9).sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market))[0];
  if (!market) throw new Error(`Extended-Markt fuer ${normalized} nicht gefunden`);
  const [statsPayload, historyPayload] = await Promise.all([
    fetchJson(`https://api.starknet.extended.exchange/api/v1/info/markets/${encodeURIComponent(market.market)}/stats`, { headers: { 'User-Agent': 'OpenCode Funding Integration' } }),
    fetchJson(`https://api.starknet.extended.exchange/api/v1/info/${encodeURIComponent(market.market)}/funding?startTime=${Date.now() - FUNDING_LOOKBACK_MS}&endTime=${Date.now()}`, { headers: { 'User-Agent': 'OpenCode Funding Integration' } })
  ]);
  const stats = statsPayload && statsPayload.data ? statsPayload.data : null;
  const rawHistory = historyPayload && Array.isArray(historyPayload.data) ? historyPayload.data : [];
  const intervalSeconds = rawHistory.length > 1 ? Math.max(1, Math.round(Math.abs(rawHistory[1].T - rawHistory[0].T) / 1000)) : 3600;
  const settled = rawHistory.map(item => ({ time: parseFloat(item.T) || 0, fundingRate: parseFloat(item.f), intervalSeconds }));
  return buildFundingPayload('extended', exchangeName, market.market, market.symbol, stats ? stats.fundingRate : null, intervalSeconds, settled, { nextFundingTime: stats ? parseFloat(stats.nextFundingRate) || 0 : 0 });
}
async function getVariationalStatsListings() {
  const cached = cacheGet('variational_stats_listings');
  if (cached) return cached;
  const payload = await fetchJson('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats');
  const listings = Array.isArray(payload && payload.listings) ? payload.listings : [];
  return cacheSet('variational_stats_listings', listings, EXCHANGE_CACHE_MS);
}
async function captureVariationalFundingSnapshotsForSymbols(symbols, listingsInput) {
  const listings = Array.isArray(listingsInput) ? listingsInput : await getVariationalStatsListings();
  const map = new Map(listings.map(item => [String(item.ticker || '').toUpperCase(), item]));
  symbols.forEach(symbol => {
    const item = map.get(String(symbol || '').toUpperCase());
    if (!item) return;
    storeVariationalFundingSnapshot(item.ticker, item.funding_rate, item.funding_interval_s, Date.now());
  });
}
async function getTrackedVariationalTokens() {
  const tracked = new Set();
  try {
    const result = await db.query('SELECT frf FROM profiles');
    (result.rows || []).forEach(row => {
      const frf = row && row.frf ? row.frf : {};
      const exchanges = Array.isArray(frf.exchanges) ? frf.exchanges : [];
      const positions = Array.isArray(frf.positions) ? frf.positions : [];
      const variationalIds = new Set(exchanges.filter(ex => normalizeExchangeProvider(ex && ex.name) === 'variational').map(ex => ex.id));
      positions.forEach(position => {
        if (!position || position.endedAt) return;
        const shortMatch = position.shortExchangeId && variationalIds.has(position.shortExchangeId);
        const longMatch = !position.longIsSpot && position.longExchangeId && variationalIds.has(position.longExchangeId);
        if ((shortMatch || longMatch) && position.token) tracked.add(String(position.token).toUpperCase());
      });
    });
  } catch (error) {}
  return [...tracked];
}
async function captureTrackedVariationalFunding() {
  try {
    const symbols = await getTrackedVariationalTokens();
    if (!symbols.length) return;
    const listings = await getVariationalStatsListings();
    await captureVariationalFundingSnapshotsForSymbols(symbols, listings);
  } catch (error) {
    console.warn('variational funding capture:', error.message);
  }
}
async function getVariationalFunding(token, exchangeName) {
  const normalized = normalizeLookupSymbol(token, 20);
  if (!normalized) throw new Error('Ungueltiges Variational-Symbol');
  const listings = await getVariationalStatsListings();
  await captureVariationalFundingSnapshotsForSymbols([normalized], listings);
  const listing = listings.find(item => item && String(item.ticker || '').toUpperCase() === normalized);
  if (!listing) throw new Error(`Variational-Markt fuer ${normalized} nicht gefunden`);
  const settled = getVariationalSettlementEntries(normalized);
  return buildFundingPayload('variational', exchangeName, normalized, normalized, listing.funding_rate, parseFloat(listing.funding_interval_s) || 0, settled, { historySource: settled.length ? 'snapshot' : 'pending' });
}
async function searchBybitSymbols(query) {
  const q = normalizeLookupSymbol(query, 30);
  const [spot, perp] = await Promise.all([getBybitSpotMarkets(), getBybitPerpMarkets()]);
  const merged = uniqueBy([...perp, ...spot].sort((a, b) => preferUsdQuote(a.quote, b.quote)), row => row.symbol);
  return merged.map(row => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
    .filter(row => !q || row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);
}
async function resolveBybitMarket(token, mode) {
  const normalized = normalizeLookupSymbol(token, 24);
  if (!normalized) throw new Error('Ungueltiges Bybit-Symbol');
  const rows = mode === 'spot' ? await getBybitSpotMarkets() : await getBybitPerpMarkets();
  const market = rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
    .filter(row => row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market))[0];
  if (!market) throw new Error(`Bybit-Markt fuer ${normalized} nicht gefunden`);
  return market;
}
async function getBybitQuote(token, mode, exchangeName) {
  const market = await resolveBybitMarket(token, mode);
  const category = mode === 'spot' ? 'spot' : 'linear';
  const payload = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=${encodeURIComponent(category)}&symbol=${encodeURIComponent(market.market)}`);
  const row = payload && payload.result && Array.isArray(payload.result.list) ? payload.result.list[0] : null;
  if (!row) throw new Error(`Bybit-Ticker fuer ${market.market} nicht gefunden`);
  const price = mode === 'spot' ? parseFloat(row.lastPrice) || 0 : parseFloat(row.markPrice) || parseFloat(row.lastPrice) || 0;
  const reference = parseFloat(row.indexPrice) || parseFloat(row.lastPrice) || 0;
  return buildQuotePayload('bybit', exchangeName, market.market, market.symbol, price, reference, parseFloat(row.bid1Price) || 0, parseFloat(row.ask1Price) || 0, mode, mode === 'spot' ? 'Bybit spot ticker' : 'Bybit linear ticker');
}
async function getVariationalCandidates() {
  const cached = cacheGet('variational_candidates');
  if (cached) return cached;
  const [extended, hyperliquid, bybitSpot, bybitPerp, phemexSpot, phemexPerp] = await Promise.all([getExtendedMarkets(), getHyperliquidUniverse(), getBybitSpotMarkets(), getBybitPerpMarkets(), getPhemexSpotMarkets(), getPhemexPerpMarkets()]);
  const set = new Set();
  [...extended, ...hyperliquid, ...bybitSpot, ...bybitPerp, ...phemexSpot, ...phemexPerp].forEach(row => { if (row && row.symbol) set.add(String(row.symbol).toUpperCase()); });
  ['BTC', 'ETH', 'SOL', 'AVAX', 'ARB', 'DOGE', 'XRP', 'SUI', 'BNB', 'HYPE', 'LTC', 'VVV', 'GOAT', '4'].forEach(symbol => set.add(symbol));
  return cacheSet('variational_candidates', [...set].filter(symbol => /^[A-Z0-9._-]{1,20}$/.test(symbol)).sort(), VARIATIONAL_DISCOVERY_TTL_MS);
}
function probeVariationalBatch(symbols) {
  return new Promise((resolve, reject) => {
    const found = new Set();
    const unsupported = new Set();
    const socket = new WSClient('wss://omni-ws-server.prod.ap-northeast-1.variational.io/prices');
    const timeout = setTimeout(() => {
      try { socket.close(); } catch (error) {}
      resolve({ found: [...found], unsupported: [...unsupported] });
    }, 12000);
    function finish(value) {
      clearTimeout(timeout);
      try { socket.close(); } catch (error) {}
      resolve(value);
    }
    wsListen(socket, 'open', () => {
      socket.send(JSON.stringify({
        action: 'subscribe',
        instruments: symbols.map(symbol => ({
          underlying: symbol,
          instrument_type: 'perpetual_future',
          settlement_asset: 'USDC',
          funding_interval_s: 3600
        }))
      }));
    });
    wsListen(socket, 'message', event => {
      const raw = String(event.data || '');
      if (!raw || raw.includes('heartbeat')) return;
      if (raw.startsWith('unsupported instrument: P-')) {
        unsupported.add(raw.replace('unsupported instrument: P-', '').replace('-USDC-3600', '').trim());
      } else {
        try {
          const payload = JSON.parse(raw);
          if (payload.channel && payload.channel.startsWith('instrument_price:P-')) found.add(payload.channel.replace('instrument_price:P-', '').replace('-USDC-3600', ''));
        } catch (error) {}
      }
      if (found.size + unsupported.size >= symbols.length) finish({ found: [...found], unsupported: [...unsupported] });
    });
    wsListen(socket, 'error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
async function discoverVariationalSymbols() {
  const cached = cacheGet('variational_symbols');
  if (cached) return cached;
  if (variationalDiscoveryPromise) return variationalDiscoveryPromise;
  variationalDiscoveryPromise = (async () => {
    try {
      const candidates = await getVariationalCandidates();
      const found = new Set();
      for (let index = 0; index < candidates.length; index += VARIATIONAL_BATCH_SIZE) {
        const batch = candidates.slice(index, index + VARIATIONAL_BATCH_SIZE);
        const result = await probeVariationalBatch(batch);
        result.found.forEach(symbol => found.add(symbol));
      }
      const items = [...found].sort().map(symbol => ({ symbol, market: symbol, quote: 'USDC', label: `${symbol} perpetual` }));
      return cacheSet('variational_symbols', items, VARIATIONAL_DISCOVERY_TTL_MS);
    } finally {
      variationalDiscoveryPromise = null;
    }
  })();
  return variationalDiscoveryPromise;
}
async function searchVariationalSymbols(query) {
  const q = normalizeLookupSymbol(query, 30);
  const rows = await discoverVariationalSymbols();
  return rows.map(row => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.label, q)) }))
    .filter(row => !q || row.rank < 9)
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.symbol.localeCompare(b.symbol))
    .slice(0, 12);
}
async function getVariationalQuote(token, mode, exchangeName) {
  const normalized = normalizeLookupSymbol(token, 20);
  if (!normalized) throw new Error('Ungueltiges Variational-Symbol');
  return new Promise((resolve, reject) => {
    const socket = new WSClient('wss://omni-ws-server.prod.ap-northeast-1.variational.io/prices');
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try { socket.close(); } catch (error) {}
      reject(new Error('Variational-Preisstream hat nicht rechtzeitig geantwortet'));
    }, 8000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { socket.close(); } catch (closeError) {}
      if (error) reject(error);
      else resolve(value);
    }
    wsListen(socket, 'open', () => {
      socket.send(JSON.stringify({
        action: 'subscribe',
        instruments: [{ underlying: normalized, instrument_type: 'perpetual_future', settlement_asset: 'USDC', funding_interval_s: 3600 }]
      }));
    });
    wsListen(socket, 'message', event => {
      const raw = String(event.data || '');
      if (!raw || raw.includes('heartbeat')) return;
      if (raw.startsWith('unsupported instrument: P-')) {
        finish(new Error(raw));
        return;
      }
      try {
        const payload = JSON.parse(raw);
        if (!payload.channel || !payload.pricing) {
          finish(new Error('Variational hat ein unerwartetes Payload gesendet'));
          return;
        }
        const pricing = payload.pricing;
        finish(null, buildQuotePayload('variational', exchangeName, normalized, normalized, parseFloat(pricing.price) || 0, parseFloat(pricing.underlying_price) || 0, 0, 0, mode, 'Variational price websocket'));
      } catch (error) {
        finish(new Error(raw));
      }
    });
    wsListen(socket, 'error', () => finish(new Error('Variational-WebSocket konnte nicht verbunden werden')));
    wsListen(socket, 'close', () => { if (!done) finish(new Error('Variational-WebSocket wurde zu frueh geschlossen')); });
  });
}
async function searchSymbolsForExchange(exchangeName, query) {
  const provider = normalizeExchangeProvider(exchangeName);
  if (!provider) throw new Error('Boerse wird noch nicht unterstuetzt');
  if (provider === 'extended') return { provider, items: await searchExtendedMarkets(query) };
  if (provider === 'hyperliquid') return { provider, items: await searchHyperliquidSymbols(query) };
  if (provider === 'variational') return { provider, items: await searchVariationalSymbols(query) };
  if (provider === 'phemex') return { provider, items: await searchPhemexSymbols(query) };
  return { provider, items: await searchBybitSymbols(query) };
}
async function getExchangeQuote(exchangeName, token, mode) {
  const provider = normalizeExchangeProvider(exchangeName);
  if (!provider) throw new Error('Boerse wird noch nicht unterstuetzt');
  if (provider === 'extended') return getExtendedQuote(token, mode, exchangeName);
  if (provider === 'hyperliquid') return getHyperliquidQuote(token, mode, exchangeName);
  if (provider === 'variational') return getVariationalQuote(token, mode, exchangeName);
  if (provider === 'phemex') return getPhemexQuote(token, mode, exchangeName);
  return getBybitQuote(token, mode, exchangeName);
}
async function getExchangeFunding(exchangeName, token, mode) {
  if (mode === 'spot') return null;
  const provider = normalizeExchangeProvider(exchangeName);
  if (!provider) throw new Error('Boerse wird noch nicht unterstuetzt');
  if (provider === 'extended') return getExtendedFunding(token, exchangeName);
  if (provider === 'hyperliquid') return getHyperliquidFunding(token, exchangeName);
  if (provider === 'variational') return getVariationalFunding(token, exchangeName);
  if (provider === 'phemex') return getPhemexFunding(token, exchangeName);
  return getBybitFunding(token, exchangeName);
}
async function getFrfSpotFallback(token, shortExchangeName, shortQuote) {
  if (normalizeExchangeProvider(shortExchangeName) === 'phemex') {
    try { return await getPhemexQuote(token, 'spot', `${shortExchangeName} Spot`); } catch (error) {}
  }
  if (normalizeExchangeProvider(shortExchangeName) === 'bybit') {
    try { return await getBybitQuote(token, 'spot', `${shortExchangeName} Spot`); } catch (error) {}
  }
  try { return await getPhemexQuote(token, 'spot', 'Phemex Spot'); } catch (error) {}
  try { return await getBybitQuote(token, 'spot', 'Bybit Spot'); } catch (error) {}
  if (shortQuote) return { ...shortQuote, exchangeName: 'Spot-Fallback', sourceLabel: 'Short-Markt als Spot-Fallback' };
  throw new Error('Kein Spot-Livepreis verfuegbar');
}
function normalizeRole(role) { return ROLE_ORDER.includes(role) ? role : 'user'; }
function hasRole(account, minRole) {
  if (!account) return false;
  return ROLE_ORDER.indexOf(normalizeRole(account.role)) >= ROLE_ORDER.indexOf(minRole);
}
function touchPresence(accountId) {
  if (!accountId) return;
  const now = Date.now();
  const last = activityTouchCache.get(accountId) || 0;
  if (now - last < ACTIVITY_TOUCH_MS) return;
  activityTouchCache.set(accountId, now);
  db.query(
    'INSERT INTO account_presence (accountId, lastSeen) VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (accountId) DO UPDATE SET lastSeen = EXCLUDED.lastSeen',
    [accountId]
  ).catch(() => {});
}

// E-Mail Sender (Fallback auf Konsole)
async function sendMail(to, subject, html) {
  return mailService.sendMail(to, subject, html);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeMessagePayload(body) {
  const targetType = ['all', 'direct', 'segment'].includes(body.targetType) ? body.targetType : 'direct';
  const audiencePreset = MESSAGE_SEGMENTS.has(body.audiencePreset) ? body.audiencePreset : 'all_users';
  const priority = ['info', 'important', 'urgent'].includes(body.priority) ? body.priority : 'info';
  const category = ['system', 'update', 'maintenance', 'security', 'support'].includes(body.category) ? body.category : 'system';
  const status = ['draft', 'scheduled', 'sent'].includes(body.status) ? body.status : 'draft';
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const linkData = sanitizeMessageLinkUrl(body.linkUrl);
  const targetAccountId = body.targetAccountId ? String(body.targetAccountId) : null;
  const conversationId = body.conversationId ? String(body.conversationId) : null;
  const parentMessageId = body.parentMessageId ? String(body.parentMessageId) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  return {
    targetType,
    targetAccountId,
    audiencePreset,
    title,
    body: text,
    priority,
    category,
    linkUrl: linkData.value,
    invalidLinkUrl: linkData.invalid,
    isPinned: !!body.isPinned,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
    status,
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null,
    readTracking: body.readTracking !== false,
    emailMirror: !!body.emailMirror,
    conversationId,
    parentMessageId
  };
}

async function getMessageRecipients(senderAccountId, targetType, targetAccountId, audiencePreset) {
  if (targetType === 'direct') {
    if (!targetAccountId || targetAccountId === senderAccountId) return [];
    const { rows } = await db.query('SELECT id, email FROM accounts WHERE id = $1 AND isVerified = true AND isBlocked = false', [targetAccountId]);
    return rows;
  }
  if (targetType === 'all') {
    const { rows } = await db.query('SELECT id, email FROM accounts WHERE isVerified = true AND isBlocked = false AND id <> $1 ORDER BY createdAt DESC', [senderAccountId]);
    return rows;
  }
  if (targetType === 'segment') {
    if (audiencePreset === 'active_7d') {
      const { rows } = await db.query(`
        SELECT a.id, a.email
        FROM accounts a
        JOIN account_presence ap ON ap.accountId = a.id
        WHERE a.isVerified = true AND a.isBlocked = false AND a.id <> $1 AND ap.lastSeen >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        ORDER BY ap.lastSeen DESC
      `, [senderAccountId]);
      return rows;
    }
    if (audiencePreset === 'active_30d') {
      const { rows } = await db.query(`
        SELECT a.id, a.email
        FROM accounts a
        JOIN account_presence ap ON ap.accountId = a.id
        WHERE a.isVerified = true AND a.isBlocked = false AND a.id <> $1 AND ap.lastSeen >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY ap.lastSeen DESC
      `, [senderAccountId]);
      return rows;
    }
    if (audiencePreset === 'new_14d') {
      const { rows } = await db.query(`
        SELECT id, email
        FROM accounts
        WHERE isVerified = true AND isBlocked = false AND id <> $1 AND createdAt >= CURRENT_TIMESTAMP - INTERVAL '14 days'
        ORDER BY createdAt DESC
      `, [senderAccountId]);
      return rows;
    }
    if (audiencePreset === 'verified_users') {
      const { rows } = await db.query('SELECT id, email FROM accounts WHERE isVerified = true AND isBlocked = false AND id <> $1 ORDER BY createdAt DESC', [senderAccountId]);
      return rows;
    }
    if (audiencePreset === 'admins') {
      const { rows } = await db.query("SELECT id, email FROM accounts WHERE role IN ('support','admin','owner') AND isVerified = true AND isBlocked = false AND id <> $1 ORDER BY createdAt DESC", [senderAccountId]);
      return rows;
    }
  }
  return [];
}

async function assignRecipientsToMessage(messageRow) {
  const recipients = await getMessageRecipients(messageRow.senderaccountid, messageRow.targettype, messageRow.targetaccountid, messageRow.audiencepreset);
  if (!recipients.length) return [];
  await Promise.all(recipients.map((recipient) => db.query(
    'INSERT INTO message_recipients (messageId, accountId) VALUES ($1, $2) ON CONFLICT (messageId, accountId) DO NOTHING',
    [messageRow.id, recipient.id]
  )));
  return recipients;
}

async function mirrorMessageToRecipients(messageRow, recipients) {
  if (!messageRow.emailmirror || !recipients.length) return;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>${escHtml(messageRow.title)}</h2>
      <p>${escHtml(messageRow.body).replace(/\n/g, '<br>')}</p>
      ${messageRow.linkurl ? `<p><a href="${escHtml(messageRow.linkurl)}">Link öffnen</a></p>` : ''}
      <p style="margin-top:20px;color:#555">Öffne dein Nachrichten Dashboard in DeFi Vault für Details.</p>
    </div>
  `;
  await Promise.all(recipients.map((recipient) => sendMail(recipient.email, `DeFi Vault Nachricht: ${messageRow.title}`, html)));
}

async function flushScheduledMessages() {
  const { rows } = await db.query(`
    SELECT *
    FROM messages
    WHERE status = 'scheduled' AND withdrawnAt IS NULL AND scheduledAt IS NOT NULL AND scheduledAt <= CURRENT_TIMESTAMP
    ORDER BY scheduledAt ASC
  `);
  for (const row of rows) {
    const recipients = await assignRecipientsToMessage(row);
    await db.query(`
      UPDATE messages
      SET status = 'sent', sentAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP, conversationId = COALESCE(conversationId, id)
      WHERE id = $1
    `, [row.id]);
    if (recipients.length) await mirrorMessageToRecipients(row, recipients);
  }
}

async function getMessageStats(messageId) {
  const { rows } = await db.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE readAt IS NOT NULL)::int AS read,
           COUNT(*) FILTER (WHERE readAt IS NULL)::int AS unread
    FROM message_recipients
    WHERE messageId = $1
  `, [messageId]);
  return rows[0] || { total: 0, read: 0, unread: 0 };
}

async function getEditableMessageForSender(messageId, accountId) {
  const { rows } = await db.query('SELECT * FROM messages WHERE id = $1 AND senderAccountId = $2', [messageId, accountId]);
  return rows[0] || null;
}

function mapMessageRow(row, accountId) {
  const sentAt = row.sentat || row.createdat;
  return {
    id: row.id,
    conversationId: row.conversationid || row.id,
    parentMessageId: row.parentmessageid || null,
    senderAccountId: row.senderaccountid,
    senderEmail: row.senderemail,
    targetType: row.targettype,
    targetAccountId: row.targetaccountid,
    targetEmail: row.targetemail || null,
    audiencePreset: row.audiencepreset || null,
    title: row.title,
    body: row.body,
    priority: row.priority,
    category: row.category,
    linkUrl: row.linkurl || null,
    isPinned: !!row.ispinned,
    expiresAt: row.expiresat,
    status: row.status,
    scheduledAt: row.scheduledat,
    sentAt,
    withdrawnAt: row.withdrawnat,
    readTracking: row.readtracking !== false,
    emailMirror: !!row.emailmirror,
    createdAt: row.createdat,
    updatedAt: row.updatedat,
    selfReadAt: row.selfreadat || null,
    isRead: !!row.selfreadat,
    isOwn: row.senderaccountid === accountId,
    recipientCount: Number(row.recipientcount || 0),
    readCount: Number(row.readcount || 0),
    unreadCount: Number(row.unreadcount || 0)
  };
}

const authMiddleware = createAuthMiddleware({
  db,
  jwt,
  jwtSecret: JWT_SECRET,
  sessionCookie: SESSION_COOKIE,
  normalizeRole,
  hasRole,
  touchPresence,
});

const {
  attachAccount,
  attachProfile,
  requireAdmin,
  requireAuth,
  requireOwner,
  requireSupport,
} = authMiddleware;

app.use(attachAccount);

async function saveProfile(req) {
  await db.query('UPDATE profiles SET data = $1, frf = $2, undo = $3 WHERE id = $4 AND accountid = $5', [
    JSON.stringify(req.profile.data), JSON.stringify(req.profile.frf), JSON.stringify(req.profile.undo),
    req.profile.id, req.account.id
  ]);
}

registerAuthRoutes(app, {
  APP_URL,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTS,
  VERIFY_RESEND_LIMIT_MS,
  crypto,
  db,
  gid,
  hashPassAsync,
  jwt,
  jwtSecret: JWT_SECRET,
  normalizeRole,
  sendMail: mailService.sendMail,
  timingSafeCompare,
  touchPresence,
  verifyResendCooldowns,
});

registerProfileRoutes(app, { db, gid, requireAuth });
registerLoopRoutes(app, {
  attachProfile,
  benqiProvider,
  db,
  gid,
  normalizeLoopTokenInput: validation.normalizeLoopTokenInput,
  oracle,
  requireAuth,
});
registerAdminRoutes(app, { db, hasRole, normalizeRole, requireAdmin });
registerMessageRoutes(app, {
  MESSAGE_SEGMENTS: validation.MESSAGE_SEGMENTS,
  db,
  flushScheduledMessages,
  getEditableMessageForSender,
  getMessageRecipients,
  getMessageStats,
  gid,
  hasRole,
  isPrivilegedRecipient,
  mapMessageRow,
  mirrorMessageToRecipients,
  normalizeMessagePayload: validation.normalizeMessagePayload,
  requireAuth,
  requireSupport,
});
registerBackupRoutes(app, { attachProfile, isValidFrfPayload: validation.isValidFrfPayload, isValidStrategy: validation.isValidStrategy, requireAuth, saveProfile });
registerOracleRoutes(app, { benqiProvider, normalizeLoopTokenInput: validation.normalizeLoopTokenInput, oracle, requireAuth });
// ============================================
// DEMO API (Unauthenticated)
// ============================================
app.get('/api/demo-data', (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'demo_data.json');
    const frfPath = path.join(__dirname, 'demo_frf.json');
    const loopsPath = path.join(__dirname, 'demo_loops.json');
    
    let demoData = [];
    let demoFrf = { exchanges: [], positions: [] };
    let demoLoops = [];

    if (fs.existsSync(dataPath)) {
      demoData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    if (fs.existsSync(frfPath)) {
      demoFrf = JSON.parse(fs.readFileSync(frfPath, 'utf8'));
    }
    if (fs.existsSync(loopsPath)) {
      demoLoops = JSON.parse(fs.readFileSync(loopsPath, 'utf8'));
    }

    res.json({ data: demoData, frf: demoFrf, loops: demoLoops });
  } catch (error) {
    console.error("Fehler beim Laden der Demo-Daten:", error);
    res.status(500).json({ error: "Fehler beim Laden der Demo-Daten." });
  }
});

app.post('/api/backup/restore', requireAuth, attachProfile, async (req, res) => {
  const { data, frf } = req.body;
  if (!Array.isArray(data) || !data.every(isValidStrategy) || !isValidFrfPayload(frf)) {
    return res.status(400).json({ error: "Ungültige Backup-Datei" });
  }
  req.profile.data = data; req.profile.frf = frf;
  await saveProfile(req);
  res.json({ ok: 1 });
});

// ============================================
// EXPORT API (EXCEL)
// ============================================
app.get('/api/export/excel', requireAuth, attachProfile, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DeFi Vault';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Dashboard', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

    const FONT_ALL = { name: 'Arial', size: 10 };
    const FONT_HEADER = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const FONT_MAIN_ROW = { name: 'Arial', size: 10, bold: true };
    const FONT_SUB_ROW = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF555555' } };

    const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    const FILL_MAIN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    const FILL_SUB_INV = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    const FILL_SUB_REW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };

    ws.columns = [
      { header: 'Typ / Aktion', key: 'type', width: 22 },
      { header: 'Strategie / Datum', key: 'name_or_date', width: 35 },
      { header: 'Basis Token', key: 'token', width: 25 },
      { header: 'Investiert ($)', key: 'invested', width: 18 },
      { header: 'Belohnungen ($)', key: 'rewards', width: 18 },
      { header: 'Net PnL ($)', key: 'pnl', width: 18 },
      { header: 'Notizen', key: 'notes', width: 50 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = FONT_HEADER;
    headerRow.fill = FILL_HEADER;
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    let currentRowCount = 2;

    req.profile.data.forEach((strategy) => {
      const investiert = strategy.investmentHistory.reduce((sum, current) => sum + current.amount, 0);
      const rewards = strategy.rewards.reduce((sum, current) => sum + current.amount, 0);
      const pnl = (strategy.pnl || []).reduce((sum, current) => sum + current.amount, 0) + rewards;
      const basisToken = strategy.token ? `${strategy.token.amount} ${strategy.token.name} (@ ${strategy.token.entryPrice})` : '-';
      
      const mainRow = ws.addRow({
        type: '📌 Strategie',
        name_or_date: strategy.name,
        token: basisToken,
        invested: investiert,
        rewards: rewards,
        pnl,
        notes: strategy.notes
      });

      mainRow.font = FONT_MAIN_ROW;
      mainRow.fill = FILL_MAIN;
      mainRow.height = 22;
      mainRow.getCell('invested').numFmt = '#,##0.00 $';
      mainRow.getCell('rewards').numFmt = '#,##0.00 $';
      mainRow.getCell('pnl').numFmt = '#,##0.00 $';
      mainRow.alignment = { vertical: 'middle' };
      
      currentRowCount++;

      strategy.investmentHistory.forEach(inv => {
        const subRow = ws.addRow({
          type: '    ➡️ Investition',
          name_or_date: new Date(inv.date).toLocaleDateString() + ' ' + new Date(inv.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          token: '', invested: inv.amount, rewards: '', pnl: '', notes: inv.note
        });
        subRow.font = FONT_SUB_ROW; subRow.fill = FILL_SUB_INV;
        subRow.getCell('invested').numFmt = '#,##0.00 $'; subRow.alignment = { vertical: 'middle' };
        subRow.outlineLevel = 1; currentRowCount++;
      });

      strategy.rewards.forEach(rew => {
        const subRow = ws.addRow({
          type: '    🎁 Belohnung',
          name_or_date: new Date(rew.date).toLocaleDateString() + ' ' + new Date(rew.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          token: '', invested: '', rewards: rew.amount, pnl: '', notes: rew.note
        });
        subRow.font = FONT_SUB_ROW; subRow.fill = FILL_SUB_REW;
        subRow.getCell('rewards').numFmt = '#,##0.00 $'; subRow.alignment = { vertical: 'middle' };
        subRow.outlineLevel = 1; currentRowCount++;
      });
      
      const divider = ws.addRow({}); divider.height = 10; currentRowCount++;
    });

    ws.eachRow({ includeEmpty: false }, function(row, rowNumber) {
      if (rowNumber === 1) return;
      row.eachCell({ includeEmpty: true }, function(cell) { if (!cell.font) cell.font = FONT_ALL; });
    });

    for(let i = currentRowCount; i <= Math.max(currentRowCount, 150); i++) {
       ws.getRow(i).outlineLevel = 0; ws.getRow(i).font = FONT_ALL;
    }

    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DeFi_Vault_${req.profile.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel Generation Error:", error);
    res.status(500).json({ error: 'Fehler beim Generieren der Excel Datei' });
  }
});

function svU(req, lbl) {
  const undo = req.profile.undo;
  undo.push({ label: lbl, data: JSON.parse(JSON.stringify(req.profile.data)), frf: JSON.parse(JSON.stringify(req.profile.frf)), time: new Date().toISOString() });
  while (undo.length > 10) undo.shift();
  req.profile.undo = undo;
}

registerStrategyRoutes(app, { attachProfile, express, gid, requireAuth, saveProfile, svU });
registerFrfRoutes(app, {
  attachProfile,
  express,
  getExchangeFunding: exchangeService.getExchangeFunding,
  getExchangeQuote: exchangeService.getExchangeQuote,
  getFrfSpotFallback: exchangeService.getFrfSpotFallback,
  gid,
  profileExchangeById: exchangeService.profileExchangeById,
  requireAuth,
  saveProfile,
  searchSymbolsForExchange: exchangeService.searchSymbolsForExchange,
  svU,
});
// ============================================
// SUPPORT & COMMUNITY API
// ============================================
app.post('/api/support', requireAuth, async (req, res) => {
  try {
    const title = escHtml(String(req.body.title || '').trim()).slice(0, 200);
    const message = escHtml(String(req.body.message || '').trim()).replace(/\n/g, '<br>');
    if (!title || !message) return res.status(400).json({ error: 'Titel und Nachricht erforderlich' });
    const ok = await sendMail("tracker.support@defivault.cloud", "Support-Anfrage: " + title, "Von: " + escHtml(req.account.email) + "<br><br>" + message);
    res.json({ ok: ok ? 1 : 0 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.post('/api/features', requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 200);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    if (!title || !description) return res.status(400).json({ error: 'Titel und Beschreibung erforderlich' });
    await db.query('INSERT INTO feature_requests (id, account_id, title, description) VALUES ($1, $2, $3, $4)', [gid(), req.account.id, title, description]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

function getLastSyncReset() {
  const d = new Date();
  // Saturday is day 6. If today is Sat (6) after 18:00, or Sun-Fri, find the correct previous/current Saturday 18:00.
  // 18:00 in CET is 17:00 UTC. Let's base it on UTC.
  const day = d.getUTCDay();
  const hours = d.getUTCHours();
  
  // How many days ago was the last Saturday?
  // day 6 (Sat) -> 0 if hours >= 17, else 7
  // day 0 (Sun) -> 1
  // day 1 (Mon) -> 2 ...
  let daysAgo = 0;
  if (day === 6) { daysAgo = hours >= 17 ? 0 : 7; } 
  else { daysAgo = day + 1; }
  
  const reset = new Date(d);
  reset.setUTCDate(d.getUTCDate() - daysAgo);
  reset.setUTCHours(17, 0, 0, 0); // 17:00 UTC = 18:00 CET (Winter), 19:00 CEST (Summer) - close enough, or exactly 18:00 Local:
  // For exact 18:00 Local time we use local methods:
  const localReset = new Date();
  localReset.setDate(localReset.getDate() - (localReset.getDay() === 6 ? (localReset.getHours() >= 18 ? 0 : 7) : localReset.getDay() + 1));
  localReset.setHours(18, 0, 0, 0);
  return localReset.toISOString();
}

app.get('/api/features', requireAuth, async (req, res) => {
  try {
    const lastReset = getLastSyncReset();

    const { rows: voteCheck } = await db.query('SELECT COUNT(*) as anz FROM feature_votes WHERE account_id = $1 AND createdat >= $2', [req.account.id, lastReset]);
    const weeklyVotesUsed = parseInt(voteCheck[0].anz) || 0;
    const canVoteGlobally = weeklyVotesUsed < 1;

    const { rows } = await db.query(`
      SELECT r.id, r.title, r.description, r.status, r.createdat, 
             a.email as author,
             (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) as votes,
             EXISTS(SELECT 1 FROM feature_votes v WHERE v.request_id = r.id AND v.account_id = $1) as has_voted
      FROM feature_requests r
      JOIN accounts a ON r.account_id = a.id
      WHERE r.status IN ('approved', 'implemented', 'planned')
      ORDER BY votes DESC, r.createdat DESC
    `, [req.account.id]);
    
    res.json({ list: rows, canVoteGlobally, weeklyVotesUsed, nextReset: getLastSyncReset()  });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.post('/api/features/:id/vote', requireAuth, async (req, res) => {
  try {
    const lastReset = getLastSyncReset();

    // Hat der User in diesem Zeitraum auf dem gesamten Board schon abgestimmt?
    const { rows: voteCheck } = await db.query('SELECT 1 FROM feature_votes WHERE account_id = $1 AND createdat >= $2', [req.account.id, lastReset]);
    
    // Prüfe, ob er evtl GERADE diesen Vote ENTFERNEN will (Toggle) -> Wenn User VOR dem Reset abgestimmt hat, verbieten wir das ab-voten?
    // Oder ob "max 1 Vote" bedeutet "nur 1 aktiver Vote pro Woche setzbar, ab-voten immer erlaubt"? 
    // Wir implementieren: Nur HINZUFÜGEN ist limitiert auf 1 pro Woche.
    const { rows: hasVoted } = await db.query('SELECT 1 FROM feature_votes WHERE request_id = $1 AND account_id = $2', [req.params.id, req.account.id]);
    
    if (hasVoted.length > 0) {
      // Vote zurückziehen (immer erlaubt)
      await db.query('DELETE FROM feature_votes WHERE request_id = $1 AND account_id = $2', [req.params.id, req.account.id]);
      return res.json({ voted: false });
    } else {
      // Neuen Vote setzen -> Block, falls in der Woche schon was anderes gevotet wurde!
      if (voteCheck.length >= 1) {
        return res.status(403).json({ error: 'wöchentliches voting limit erreicht' });
      }
      await db.query('INSERT INTO feature_votes (request_id, account_id, createdat) VALUES ($1, $2, NOW())', [req.params.id, req.account.id]);
      return res.json({ voted: true });
    }
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

// Global Error Handler - fängt unbehandelte Fehler in Express-Routen ab
app.use((err, req, res, next) => {
  console.error('Unhandled Express Error:', err.message, err.stack);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

// Unhandled Promise Rejections und Exceptions loggen
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message, err.stack);
  process.exit(1);
});

// Graceful Shutdown
const variationalFundingTimer = setInterval(() => { exchangeService.captureTrackedVariationalFunding().catch(() => {}); }, VARIATIONAL_FUNDING_CAPTURE_MS);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DeFi Vault Server läuft auf Port ${PORT} (PostgreSQL+JWT)`);
  exchangeService.captureTrackedVariationalFunding().catch(() => {});
});
function gracefulShutdown(signal) {
  console.log(`\n${signal} empfangen. Fahre Server herunter...`);
  clearInterval(variationalFundingTimer);
  server.close(() => {
    db.pool.end().then(() => {
      console.log('DB-Pool geschlossen. Server beendet.');
      process.exit(0);
    });
  });
  setTimeout(() => { process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
