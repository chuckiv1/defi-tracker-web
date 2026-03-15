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

const app = express();
const PORT = process.env.PORT || 3002;
const APP_URL = process.env.APP_URL || 'https://defivault.cloud';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNUNG: JWT_SECRET ist nicht gesetzt! Verwende unsicheren Fallback. In Produktion UNBEDINGT setzen!');
}
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';
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

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER || "", pass: process.env.SMTP_PASS || "" }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.set('trust proxy', 1);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/resend-verification', authLimiter);

app.use(express.static(path.join(__dirname, 'public')));

db.initDB().catch(err => console.error('❌ DB-Init fehlgeschlagen:', err));

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
  if (!SMTP_CONFIG.host) {
    const linkMatch = typeof html === 'string' ? html.match(/href="([^"]*)"/) : null;
    console.log(`\n=== E-MAIL SIMULATION ===\nAn: ${to}\nBetreff: ${subject}\n${linkMatch ? 'Inhalt (Link): '+linkMatch[1] : 'Inhalt: '+String(html || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 500)}\n=========================\n`);
    return true;
  }
  try {
    let transporter = nodemailer.createTransport(SMTP_CONFIG);
    await transporter.sendMail({ from: `"DeFi Vault" <${SMTP_CONFIG.auth.user}>`, to, subject, html });
    console.log(`✅ Mail erfolgreich an ${to} gesendet.`);
    return true;
  } catch (e) { 
    console.error("❌ Mail-Fehler beim Senden an", to, ":", e.message); 
    console.error("Stack:", e);
    return false; 
  }
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
  const linkUrl = String(body.linkUrl || '').trim();
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
    linkUrl: linkUrl || null,
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

// Globale Auth-Prüfung
app.use(async (req, res, next) => {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [decoded.accountId]);
    if (rows.length > 0) {
      req.account = rows[0];
      req.account.role = normalizeRole(req.account.role);
      touchPresence(req.account.id);
    }
  } catch (e) {
    // Ungültiger oder abgelaufener Token
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'Nicht eingeloggt' });
  if (req.account.isblocked) return res.status(403).json({ error: 'Account blockiert' });
  if (!req.account.isverified) return res.status(403).json({ error: 'E-Mail nicht verifiziert' });
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!hasRole(req.account, 'admin')) return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
    next();
  });
}

function requireSupport(req, res, next) {
  requireAuth(req, res, () => {
    if (!hasRole(req.account, 'support')) return res.status(403).json({ error: 'Support-Rechte erforderlich' });
    next();
  });
}

function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (!hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Owner-Rechte erforderlich' });
    next();
  });
}

async function attachProfile(req, res, next) {
  const profileId = req.headers['x-profile-id'];
  if (!profileId) return res.status(400).json({ error: 'Kein Profil ausgewählt' });
  
  try {
    const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1 AND accountid = $2', [profileId, req.account.id]);
    if (rows.length === 0) return res.status(403).json({ error: 'Profil Zugriff verweigert' });
    req.profile = rows[0];
    if(!req.profile.data) req.profile.data = [];
    if(!req.profile.frf) req.profile.frf = { exchanges: [], positions: [] };
    if(!req.profile.undo) req.profile.undo = [];
    next();
  } catch(e) {
    res.status(500).json({ error: "Fehler beim Laden des Profils" });
  }
}

async function saveProfile(req) {
  await db.query('UPDATE profiles SET data = $1, frf = $2, undo = $3 WHERE id = $4 AND accountid = $5', [
    JSON.stringify(req.profile.data), JSON.stringify(req.profile.frf), JSON.stringify(req.profile.undo),
    req.profile.id, req.account.id
  ]);
}

// ============================================
// AUTH & ACCOUNT API
// ============================================
app.get('/api/auth/status', async (req, res) => {
  try {
    if (!req.account) return res.json({ loggedIn: false });
    const { rows: profiles } = await db.query('SELECT id, name FROM profiles WHERE accountid = $1', [req.account.id]);
    res.json({ loggedIn: true, account: { email: req.account.email, role: req.account.role }, profiles });
  } catch(e) {
    console.error('auth/status error:', e.message);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
  const { email, password } = req.body;
  if (!email || !email.includes('@') || !password || password.length < 8) return res.status(400).json({ error: 'Ungültige Daten' });
  
  const { rows: existing } = await db.query('SELECT id FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing.length > 0) return res.status(400).json({ error: 'E-Mail existiert bereits' });
  
  const { rows: allAccs } = await db.query('SELECT count(id) as count FROM accounts');
  const isFirstUser = parseInt(allAccs[0].count) === 0;
  
  const salt = crypto.randomBytes(16).toString('hex');
  const verifyToken = gid();
  const accId = gid();
  const passHash = await hashPassAsync(password, salt);
  const role = isFirstUser ? 'admin' : 'user';
  
  await db.query(
    'INSERT INTO accounts (id, email, salt, passHash, role, isVerified, verifyToken, isBlocked) VALUES ($1, $2, $3, $4, $5, false, $6, false)',
    [accId, email, salt, passHash, role, verifyToken]
  );
  
  const link = `${APP_URL}/verify.html?token=${verifyToken}`;
  await sendMail(email, "DeFi Vault - Bitte verifiziere deine E-Mail", `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
  res.json({ ok: 1 });
  } catch(e) {
    console.error('register error:', e.message);
    if (e.code === '23505') return res.status(400).json({ error: 'E-Mail existiert bereits' });
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token fehlt' });
    const { rows } = await db.query('SELECT * FROM accounts WHERE verifyToken = $1', [token]);
    if (rows.length === 0) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link' });
    
    const acc = rows[0];
    await db.query('UPDATE accounts SET isVerified = true, verifyToken = NULL WHERE id = $1', [acc.id]);
    
    // Automatisches Standard-Profil anlegen
    await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [gid(), acc.id, 'Main Wallet']);
    
    res.json({ ok: 1 });
  } catch(e) {
    console.error('verify error:', e.message);
    res.status(500).json({ error: 'Verifizierung fehlgeschlagen' });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Ungültige E-Mail' });

  const now = Date.now();
  const lastSentAt = verifyResendCooldowns.get(email) || 0;
  const waitMs = VERIFY_RESEND_LIMIT_MS - (now - lastSentAt);
  if (waitMs > 0) {
    return res.status(429).json({ error: 'Bitte warte kurz vor dem nächsten Versand', retryAfterMs: waitMs });
  }

  const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
  if (rows.length === 0) return res.status(400).json({ error: 'Anfrage konnte nicht verarbeitet werden' });

  const acc = rows[0];
  if (acc.isverified) return res.status(400).json({ error: 'E-Mail ist bereits verifiziert' });

  const verifyToken = acc.verifytoken || gid();
  if (!acc.verifytoken) {
    await db.query('UPDATE accounts SET verifyToken = $1 WHERE id = $2', [verifyToken, acc.id]);
  }

  const link = `${APP_URL}/verify.html?token=${verifyToken}`;
  await sendMail(acc.email, 'DeFi Vault - Bitte verifiziere deine E-Mail', `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
  verifyResendCooldowns.set(email, now);
  res.json({ ok: 1, retryAfterMs: VERIFY_RESEND_LIMIT_MS });
  } catch(e) {
    console.error('resend-verification error:', e.message);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
    
    const acc = rows[0];
    const computedHash = await hashPassAsync(password, acc.salt);
    if (!timingSafeCompare(acc.passhash, computedHash)) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
    if (acc.isblocked) return res.status(403).json({ error: 'Account ist blockiert' });
    if (!acc.isverified) return res.status(403).json({ error: 'E-Mail noch nicht verifiziert' });
    
    // Track login
    const today = new Date().toISOString().split('T')[0];
    await db.query(
      'INSERT INTO account_logins (id, accountId, loginDate) VALUES ($1, $2, $3) ON CONFLICT (accountId, loginDate) DO NOTHING',
      [gid(), acc.id, today]
    ).catch(e => console.error("Fehler beim Login Tracking:", e));
    touchPresence(acc.id);

    const token = jwt.sign({ accountId: acc.id }, JWT_SECRET, { expiresIn: '7d' });
    const cookieOpts = rememberMe
      ? { ...SESSION_COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 }
      : { ...SESSION_COOKIE_OPTS };
    res.cookie(SESSION_COOKIE, token, cookieOpts);
    res.json({ ok: 1 });
  } catch(e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTS);
  res.json({ ok: 1 });
});

// ============================================
// PROFILE (WALLETS) API
// ============================================
app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Name fehlt' });
    const pId = gid();
    await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [pId, req.account.id, name]);
    res.json({ id: pId, accountId: req.account.id, name });
  } catch(e) { console.error('profile create error:', e.message); res.status(500).json({ error: 'Fehler beim Erstellen' }); }
});
app.put('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Name fehlt' });
    const { rowCount } = await db.query('UPDATE profiles SET name = $1 WHERE id = $2 AND accountid = $3', [name, req.params.id, req.account.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json({ id: req.params.id, name });
  } catch(e) { console.error('profile update error:', e.message); res.status(500).json({ error: 'Fehler beim Aktualisieren' }); }
});
app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenes Profil kann nicht gelöscht werden' });
    await db.query('DELETE FROM profiles WHERE id = $1 AND accountid = $2', [req.params.id, req.account.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error('profile delete error:', e.message); res.status(500).json({ error: 'Fehler beim Löschen' }); }
});

// ============================================
// LOOPING API
// ============================================
app.get('/api/loops', requireAuth, attachProfile, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM loops 
      WHERE profileId = $1 
      ORDER BY startDate DESC
    `, [req.profile.id]);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Laden'}); }
});

app.post('/api/loops', requireAuth, attachProfile, async (req, res) => {
  try {
    const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, 
            startCollateralAmount, supplyApy, borrowedAmount, borrowApy, endCollateralAmount, 
            endBorrowedAmount, leverage } = req.body;
    
    if (!name || !startDate || !collateralToken || !borrowToken || !startCollateral || !collateralPrice || 
        !startCollateralAmount || !supplyApy || !borrowApy) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen' });
    }
    
    const loopId = gid();
    const numericLeverage = parseFloat(leverage) || 1;
    const numericBorrowedAmount = parseFloat(borrowedAmount);
    const numericEndBorrowedAmount = parseFloat(endBorrowedAmount);
    const borrowAmountValue = Number.isFinite(numericBorrowedAmount) ? numericBorrowedAmount : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : 0);
    const supplyAmountValue = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : parseFloat(startCollateralAmount);
    
    await db.query(`
      INSERT INTO loops (id, profileId, name, startDate, collateralToken, borrowToken, 
        initialCollateral, supplyApy, borrowApr, supplyAmount, borrowAmount,
        startCollateral, collateralPrice, startCollateralAmount, borrowedAmount, borrowApy, 
        endCollateralAmount, endBorrowedAmount, leverage, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `, [loopId, req.profile.id, name, startDate, collateralToken, borrowToken, 
        startCollateral, supplyApy, borrowApy, supplyAmountValue, borrowAmountValue,
        startCollateral, collateralPrice, startCollateralAmount, borrowAmountValue, borrowApy,
        endCollateralAmount || startCollateralAmount, Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue, numericLeverage, 'active']);
    
    res.json({ id: loopId, ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Erstellen'}); }
});

app.put('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
  try {
    const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, startCollateralAmount, supplyApy, borrowApy, leverage, endCollateralAmount, endBorrowedAmount, status, notes } = req.body;
    const nStartColl = Number.isFinite(parseFloat(startCollateral)) ? parseFloat(startCollateral) : null;
    const nCollPrice = Number.isFinite(parseFloat(collateralPrice)) ? parseFloat(collateralPrice) : null;
    const nStartAmt = Number.isFinite(parseFloat(startCollateralAmount)) ? parseFloat(startCollateralAmount) : null;
    const nSupplyApy = Number.isFinite(parseFloat(supplyApy)) ? parseFloat(supplyApy) : null;
    const nBorrowApy = Number.isFinite(parseFloat(borrowApy)) ? parseFloat(borrowApy) : null;
    const nLev = Number.isFinite(parseFloat(leverage)) ? parseFloat(leverage) : null;
    const nEndColl = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : null;
    const nEndBorrow = Number.isFinite(parseFloat(endBorrowedAmount)) ? parseFloat(endBorrowedAmount) : null;
    const { rowCount } = await db.query(`
      UPDATE loops 
      SET name = COALESCE($1,name), startDate = COALESCE($2,startDate), collateralToken = COALESCE($3,collateralToken), borrowToken = COALESCE($4,borrowToken),
          initialCollateral = COALESCE($5,initialCollateral), startCollateral = COALESCE($5,startCollateral), collateralPrice = COALESCE($6,collateralPrice), startCollateralAmount = COALESCE($7,startCollateralAmount),
          supplyApy = COALESCE($8,supplyApy), borrowApr = COALESCE($9,borrowApr), borrowApy = COALESCE($9,borrowApy), leverage = COALESCE($10,leverage),
          supplyAmount = COALESCE($11,supplyAmount), borrowAmount = COALESCE($12,borrowAmount), endCollateralAmount = COALESCE($11,endCollateralAmount), endBorrowedAmount = COALESCE($12,endBorrowedAmount),
          status = COALESCE($13,status), notes = COALESCE($14,notes), updatedAt = CURRENT_TIMESTAMP
      WHERE id = $15 AND profileId = $16
    `, [name || null, startDate || null, collateralToken || null, borrowToken || null, nStartColl, nCollPrice, nStartAmt, nSupplyApy, nBorrowApy, nLev, nEndColl, nEndBorrow, status || null, notes || null, req.params.id, req.profile.id]);
    
    if (rowCount === 0) return res.status(404).json({ error: 'Loop nicht gefunden' });
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Aktualisieren'}); }
});

app.delete('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
  try {
    await db.query('DELETE FROM loops WHERE id = $1 AND profileId = $2', [req.params.id, req.profile.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Löschen'}); }
});

app.post('/api/loops/:id/close', requireAuth, attachProfile, async (req, res) => {
  try {
    const { endDate, endCollateralAmount, endBorrowedAmount } = req.body;
    await db.query(`
      UPDATE loops 
      SET status = 'closed', endDate = $1, supplyAmount = $2, borrowAmount = $3, endCollateralAmount = $2, endBorrowedAmount = $3, updatedAt = CURRENT_TIMESTAMP
      WHERE id = $4 AND profileId = $5
    `, [endDate, endCollateralAmount, endBorrowedAmount, req.params.id, req.profile.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Schließen'}); }
});

// ============================================
// ADMIN API
// ============================================
app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.id, a.email, a.role, a.isverified, a.isblocked, a.createdat,
             COUNT(DISTINCT p.id) as "profileCount", COUNT(DISTINCT l.id) as "loginCount30d",
             MAX(ap.lastseen) as "lastSeenAt"
      FROM accounts a 
      LEFT JOIN profiles p ON a.id = p.accountid
      LEFT JOIN account_logins l ON a.id = l.accountid AND l.logindate >= CURRENT_DATE - INTERVAL '30 days'
      LEFT JOIN account_presence ap ON a.id = ap.accountid
      GROUP BY a.id ORDER BY a.createdat DESC
    `);
    res.json(rows);
  } catch(e) { console.error('admin accounts error:', e.message); res.status(500).json({ error: 'Fehler' }); }
});
app.get('/api/admin/accounts/:id/stats', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT logindate as date FROM account_logins 
      WHERE accountId = $1 AND logindate >= CURRENT_DATE - INTERVAL '365 days'
      ORDER BY logindate ASC
    `, [req.params.id]);
    res.json(rows.map(r => r.date));
  } catch(e) { console.error('admin stats error:', e.message); res.status(500).json({ error: 'Fehler' }); }
});
app.put('/api/admin/accounts/:id/toggle-block', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht sperren' });
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
    const targetRole = normalizeRole(rows[0].role);
    if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gesperrt werden' });
    if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins sperren' });
    await db.query('UPDATE accounts SET isblocked = NOT isblocked WHERE id = $1', [req.params.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error('admin toggle-block error:', e.message); res.status(500).json({ error: 'Fehler' }); }
});
app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
    const targetRole = normalizeRole(rows[0].role);
    if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gelöscht werden' });
    if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins löschen' });
    await db.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error('admin delete error:', e.message); res.status(500).json({ error: 'Fehler' }); }
});
app.put('/api/admin/accounts/:id/role', requireAdmin, async (req, res) => {
  const nextRole = normalizeRole(req.body.role);
  const { rows } = await db.query('SELECT id, email, role FROM accounts WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Account nicht gefunden' });
  const target = rows[0];
  const currentRole = normalizeRole(target.role);
  if (req.account.id === target.id && nextRole !== 'owner') return res.status(400).json({ error: 'Eigene Owner-Rolle kann nicht entfernt werden' });
  if (!hasRole(req.account, 'owner')) {
    if (currentRole === 'admin' || currentRole === 'owner' || nextRole === 'admin' || nextRole === 'owner') {
      return res.status(403).json({ error: 'Nur Owner kann Admin/Owner-Rollen verwalten' });
    }
  }
  await db.query('UPDATE accounts SET role = $1 WHERE id = $2', [nextRole, target.id]);
  res.json({ ok: 1, role: nextRole });
});

app.get('/api/admin/features', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.title, r.description, r.status, r.createdat, a.email as author,
             (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) as votes
      FROM feature_requests r
      JOIN accounts a ON r.account_id = a.id
      ORDER BY r.createdat DESC
    `);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.put('/api/admin/features/:id/status', requireAdmin, async (req, res) => {
  try {
    const validStatuses = ['pending', 'approved', 'planned', 'implemented', 'rejected'];
    const status = String(req.body.status || '').trim();
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    await db.query('UPDATE feature_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

// ============================================
// MESSAGE CENTER API
// ============================================
app.get('/api/messages/summary', requireAuth, async (req, res) => {
  try {
    await flushScheduledMessages();
    const { rows } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE mr.readAt IS NULL)::int AS "unreadCount",
             COUNT(*) FILTER (WHERE mr.readAt IS NULL AND (m.priority = 'urgent' OR m.isPinned = true))::int AS "importantUnreadCount",
             COUNT(*) FILTER (WHERE mr.readAt IS NULL AND m.category = 'support')::int AS "supportUnreadCount"
      FROM message_recipients mr
      JOIN messages m ON m.id = mr.messageId
      WHERE mr.accountId = $1
        AND mr.archived = false
        AND m.status = 'sent'
        AND m.withdrawnAt IS NULL
        AND (m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP)
    `, [req.account.id]);
    res.json(rows[0] || { unreadCount: 0, importantUnreadCount: 0, supportUnreadCount: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
  }
});

app.get('/api/messages/inbox', requireAuth, async (req, res) => {
  try {
    await flushScheduledMessages();
    const { rows } = await db.query(`
      SELECT m.*, sender.email AS senderEmail, target.email AS targetEmail,
             self.readAt AS selfReadAt,
             (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount,
             (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount,
             (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount
      FROM messages m
      JOIN accounts sender ON sender.id = m.senderAccountId
      LEFT JOIN accounts target ON target.id = m.targetAccountId
      LEFT JOIN message_recipients self ON self.messageId = m.id AND self.accountId = $1
      WHERE m.status = 'sent'
        AND m.withdrawnAt IS NULL
        AND (m.senderAccountId = $1 OR self.accountId = $1)
        AND ((m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP) OR m.senderAccountId = $1)
      ORDER BY COALESCE(m.sentAt, m.createdAt) DESC, m.createdAt DESC
      LIMIT 250
    `, [req.account.id]);
    res.json(rows.map((row) => mapMessageRow(row, req.account.id)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Inbox konnte nicht geladen werden' });
  }
});

app.post('/api/messages/read-all', requireAuth, async (req, res) => {
  try {
    await flushScheduledMessages();
    await db.query(`
      UPDATE message_recipients mr
      SET readAt = CURRENT_TIMESTAMP
      FROM messages m
      WHERE mr.messageId = m.id
        AND mr.accountId = $1
        AND mr.readAt IS NULL
        AND m.status = 'sent'
        AND m.withdrawnAt IS NULL
        AND (m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP)
    `, [req.account.id]);
    res.json({ ok: 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachrichten konnten nicht aktualisiert werden' });
  }
});

app.put('/api/messages/:id/read', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await db.query('UPDATE message_recipients SET readAt = COALESCE(readAt, CURRENT_TIMESTAMP) WHERE messageId = $1 AND accountId = $2', [req.params.id, req.account.id]);
    if (!rowCount) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    res.json({ ok: 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachricht konnte nicht als gelesen markiert werden' });
  }
});

app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const payload = normalizeMessagePayload(req.body || {});
    if (!payload.title || !payload.body) return res.status(400).json({ error: 'Betreff und Nachricht sind erforderlich' });

      if (!hasRole(req.account, 'support')) {
        payload.targetType = 'direct';
        payload.status = 'sent';
        payload.category = 'support';
        payload.isPinned = false;
        payload.emailMirror = false;
      const { rows: admins } = await db.query("SELECT id FROM accounts WHERE id = $1 AND role IN ('support','admin','owner') AND isVerified = true AND isBlocked = false", [payload.targetAccountId]);
      if (!admins.length) return res.status(403).json({ error: 'Antworten sind nur an Support/Admin erlaubt' });
    }

    if (hasRole(req.account, 'support')) {
      if (payload.targetType === 'direct' && !payload.targetAccountId) return res.status(400).json({ error: 'Empfänger fehlt' });
      if (payload.targetType === 'segment' && !MESSAGE_SEGMENTS.has(payload.audiencePreset)) return res.status(400).json({ error: 'Ungültiges Segment' });
      if (payload.status === 'scheduled' && !payload.scheduledAt) return res.status(400).json({ error: 'Zeitpunkt für geplante Nachricht fehlt' });
    }

    const previewRecipients = await getMessageRecipients(req.account.id, payload.targetType, payload.targetAccountId, payload.audiencePreset);
    if (!previewRecipients.length) return res.status(400).json({ error: 'Keine gültigen Empfänger gefunden' });

    const id = gid();
    const initialConversationId = payload.conversationId || id;
    const initialStatus = hasRole(req.account, 'support') ? payload.status : 'sent';
    const sentAt = initialStatus === 'sent' ? new Date().toISOString() : null;
    await db.query(`
      INSERT INTO messages (id, senderAccountId, conversationId, parentMessageId, targetType, targetAccountId, audiencePreset, title, body, priority, category, linkUrl, isPinned, expiresAt, status, scheduledAt, sentAt, readTracking, emailMirror)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [id, req.account.id, initialConversationId, payload.parentMessageId, payload.targetType, payload.targetAccountId, payload.audiencePreset, payload.title, payload.body, payload.priority, payload.category, payload.linkUrl, payload.isPinned, payload.expiresAt, initialStatus, payload.scheduledAt, sentAt, payload.readTracking, payload.emailMirror]);

    if (initialStatus === 'sent') {
      const messageRow = {
        id,
        senderaccountid: req.account.id,
        targettype: payload.targetType,
        targetaccountid: payload.targetAccountId,
        audiencepreset: payload.audiencePreset,
        emailmirror: payload.emailMirror,
        title: payload.title,
        body: payload.body,
        linkurl: payload.linkUrl
      };
      await Promise.all(previewRecipients.map((recipient) => db.query(
        'INSERT INTO message_recipients (messageId, accountId) VALUES ($1, $2) ON CONFLICT (messageId, accountId) DO NOTHING',
        [id, recipient.id]
      )));
      await mirrorMessageToRecipients(messageRow, previewRecipients);
    }

    res.json({ ok: 1, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachricht konnte nicht erstellt werden' });
  }
});

app.put('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const message = await getEditableMessageForSender(req.params.id, req.account.id);
    if (!message) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    const stats = await getMessageStats(message.id);
    if (message.status === 'sent' && stats.read > 0) return res.status(409).json({ error: 'Bereits gelesene Nachrichten können nicht mehr bearbeitet werden' });

    const payload = normalizeMessagePayload(req.body || {});
    if (!payload.title || !payload.body) return res.status(400).json({ error: 'Betreff und Nachricht sind erforderlich' });

    // Privilege Escalation Fix: Normale User dürfen nur direkte Nachrichten senden
    if (!hasRole(req.account, 'support')) {
      payload.targetType = 'direct';
      payload.status = 'sent';
      payload.category = 'support';
      payload.isPinned = false;
      payload.emailMirror = false;
    }

    if (payload.targetType === 'direct' && !payload.targetAccountId) return res.status(400).json({ error: 'Empfänger fehlt' });
    if (payload.targetType === 'segment' && !MESSAGE_SEGMENTS.has(payload.audiencePreset)) return res.status(400).json({ error: 'Ungültiges Segment' });
    if (payload.status === 'scheduled' && !payload.scheduledAt) return res.status(400).json({ error: 'Zeitpunkt für geplante Nachricht fehlt' });

    const previewRecipients = await getMessageRecipients(req.account.id, payload.targetType, payload.targetAccountId, payload.audiencePreset);
    if (!previewRecipients.length) return res.status(400).json({ error: 'Keine gültigen Empfänger gefunden' });

    const nextStatus = payload.status;
    const shouldSendNow = nextStatus === 'sent' && message.status !== 'sent';
    await db.query(`
      UPDATE messages
      SET targetType = $1, targetAccountId = $2, audiencePreset = $3, title = $4, body = $5, priority = $6, category = $7, linkUrl = $8,
          isPinned = $9, expiresAt = $10, status = $11, scheduledAt = $12, readTracking = $13, emailMirror = $14,
          conversationId = COALESCE($15, conversationId), parentMessageId = $16, sentAt = CASE WHEN $17 THEN CURRENT_TIMESTAMP ELSE sentAt END,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = $18 AND senderAccountId = $19
    `, [payload.targetType, payload.targetAccountId, payload.audiencePreset, payload.title, payload.body, payload.priority, payload.category, payload.linkUrl,
        payload.isPinned, payload.expiresAt, nextStatus, payload.scheduledAt, payload.readTracking, payload.emailMirror,
        payload.conversationId || message.conversationid || message.id, payload.parentMessageId || null, shouldSendNow, message.id, req.account.id]);

    await db.query('DELETE FROM message_recipients WHERE messageId = $1', [message.id]);
    if (nextStatus === 'sent') {
      await Promise.all(previewRecipients.map((recipient) => db.query(
        'INSERT INTO message_recipients (messageId, accountId) VALUES ($1, $2) ON CONFLICT (messageId, accountId) DO NOTHING',
        [message.id, recipient.id]
      )));
      const messageRow = {
        id: message.id,
        senderaccountid: req.account.id,
        targettype: payload.targetType,
        targetaccountid: payload.targetAccountId,
        audiencepreset: payload.audiencePreset,
        emailmirror: payload.emailMirror,
        title: payload.title,
        body: payload.body,
        linkurl: payload.linkUrl
      };
      if (shouldSendNow) await mirrorMessageToRecipients(messageRow, previewRecipients);
    }
    res.json({ ok: 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachricht konnte nicht gespeichert werden' });
  }
});

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const message = await getEditableMessageForSender(req.params.id, req.account.id);
    if (!message) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    if (message.status === 'draft' || message.status === 'scheduled') {
      await db.query('DELETE FROM messages WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
      return res.json({ ok: 1, deleted: true });
    }
    const stats = await getMessageStats(message.id);
    if (stats.total > 0 && stats.unread === 0) return res.status(409).json({ error: 'Nachricht wurde bereits von allen Empfängern gelesen' });
    await db.query('UPDATE messages SET withdrawnAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
    res.json({ ok: 1, withdrawn: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Nachricht konnte nicht entfernt werden' });
  }
});

app.get('/api/admin/messages/overview', requireSupport, async (req, res) => {
  try {
    await flushScheduledMessages();
    const [draftRes, historyRes, userRes, statRes] = await Promise.all([
      db.query(`
        SELECT m.*,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount
        FROM messages m
        WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL AND m.status IN ('draft', 'scheduled')
        ORDER BY m.updatedAt DESC
      `, [req.account.id]),
      db.query(`
        SELECT m.*,
               target.email AS targetEmail,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount
        FROM messages m
        LEFT JOIN accounts target ON target.id = m.targetAccountId
        WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL AND m.status = 'sent'
        ORDER BY COALESCE(m.sentAt, m.createdAt) DESC
        LIMIT 100
      `, [req.account.id]),
      db.query(`
        SELECT a.id, a.email, a.role, a.isverified, a.isblocked, a.createdat,
               COUNT(DISTINCT p.id)::int as "profileCount", COUNT(DISTINCT l.id)::int as "loginCount30d",
               MAX(ap.lastseen) as "lastSeenAt",
               COUNT(DISTINCT mr.messageId) FILTER (WHERE mr.readAt IS NULL AND m.senderAccountId = $1 AND m.targetType = 'direct' AND m.withdrawnAt IS NULL)::int as "directUnreadCount"
        FROM accounts a
        LEFT JOIN profiles p ON a.id = p.accountid
        LEFT JOIN account_logins l ON a.id = l.accountid AND l.logindate >= CURRENT_DATE - INTERVAL '30 days'
        LEFT JOIN account_presence ap ON a.id = ap.accountid
        LEFT JOIN message_recipients mr ON mr.accountId = a.id
        LEFT JOIN messages m ON m.id = mr.messageId
        GROUP BY a.id
        ORDER BY a.createdat DESC
      `, [req.account.id]),
      db.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'sent' AND sentAt >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS "sent30d",
               COUNT(*) FILTER (WHERE status = 'sent' AND targetType = 'direct' AND sentAt >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS "direct30d",
               COUNT(*) FILTER (WHERE status IN ('draft', 'scheduled') AND withdrawnAt IS NULL)::int AS drafts,
               COALESCE(ROUND(AVG(CASE WHEN recipientStats.total > 0 THEN (recipientStats.read::numeric / recipientStats.total::numeric) * 100 ELSE NULL END)), 0)::int AS "avgReadRate"
        FROM messages m
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE readAt IS NOT NULL)::int AS read
          FROM message_recipients mr WHERE mr.messageId = m.id
        ) recipientStats ON true
        WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL
      `, [req.account.id])
    ]);

    res.json({
      drafts: draftRes.rows.map((row) => mapMessageRow(row, req.account.id)),
      history: historyRes.rows.map((row) => mapMessageRow(row, req.account.id)),
      users: userRes.rows,
      stats: statRes.rows[0] || { sent30d: 0, direct30d: 0, drafts: 0, avgReadRate: 0 }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Admin-Nachrichten konnten nicht geladen werden' });
  }
});

app.get('/api/admin/messages/:id/recipients', requireSupport, async (req, res) => {
  try {
    const { rows: own } = await db.query('SELECT id FROM messages WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
    if (!own.length) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    const { rows } = await db.query(`
      SELECT a.id, a.email, mr.readAt, ap.lastSeen as "lastSeenAt"
      FROM message_recipients mr
      JOIN accounts a ON a.id = mr.accountId
      LEFT JOIN account_presence ap ON ap.accountId = a.id
      WHERE mr.messageId = $1
      ORDER BY mr.readAt NULLS FIRST, a.email ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Empfänger konnten nicht geladen werden' });
  }
});

// ============================================
// BACKUP API
// ============================================
app.get('/api/backup', requireAuth, attachProfile, (req, res) => {
  res.json({ backupVersion: "9.0", profileName: req.profile.name, timestamp: new Date().toISOString(), data: req.profile.data, frf: req.profile.frf });
});
app.get('/api/oracle/lookup', requireAuth, async (req, res) => {
  try {
    const asset = String(req.query.asset || '').trim().slice(0, 32);
    const protocol = String(req.query.protocol || '').trim().slice(0, 40);
    const type = String(req.query.type || '').trim().toUpperCase();
    if (!asset) return res.status(400).json({ error: 'Asset fehlt' });
    if (type && !['SUPPLY', 'BORROW', 'PRICE'].includes(type)) return res.status(400).json({ error: 'Ungueltiger Typ' });
    const rows = await oracle.queryOracleData({ asset, protocol: protocol || undefined, type: type || undefined });
    res.json(rows);
  } catch (e) {
    console.error('oracle lookup:', e.message);
    res.status(500).json({ error: 'Oracle-Daten konnten nicht geladen werden' });
  }
});
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
  if (!data || !frf) return res.status(400).json({ error: "Ungültige Backup-Datei" });
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
      const basisToken = strategy.token ? `${strategy.token.amount} ${strategy.token.name} (@ ${strategy.token.entryPrice})` : '-';
      
      const mainRow = ws.addRow({
        type: '📌 Strategie',
        name_or_date: strategy.name,
        token: basisToken,
        invested: investiert,
        rewards: rewards,
        pnl: (rewards - investiert) + investiert,
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

// ============================================
// DATEN API (STRATEGIEN & FRF)
// ============================================
app.get('/api/undo', requireAuth, attachProfile, (req, res) => { res.json(req.profile.undo.map((u, i) => ({ index: i, label: u.label, time: u.time }))); });
app.post('/api/undo/:index', requireAuth, attachProfile, async (req, res) => {
  try {
    const undo = req.profile.undo; const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= undo.length) return res.status(400).json({ error: 'Ungültiger Index' });
    req.profile.data = undo[idx].data; if (undo[idx].frf) req.profile.frf = undo[idx].frf;
    req.profile.undo = undo.slice(0, idx); 
    await saveProfile(req);
    res.json({ ok: 1 });
  } catch(e) { console.error('undo error:', e.message); res.status(500).json({ error: 'Fehler' }); }
});

app.get('/api/strategies', requireAuth, attachProfile, (req, res) => { res.json(req.profile.data); });
app.get('/api/frf', requireAuth, attachProfile, (req, res) => { res.json(req.profile.frf); });

function svU(req, lbl) {
  const u = req.profile.undo; 
  u.push({ label: lbl, data: JSON.parse(JSON.stringify(req.profile.data)), frf: JSON.parse(JSON.stringify(req.profile.frf)), time: new Date().toISOString() });
  while(u.length>10) u.shift();
  req.profile.undo = u;
}

const router = express.Router();
app.use('/api', requireAuth, attachProfile, router);

router.post('/strategies', async (req, res) => { try { const inv = parseFloat(req.body.investment); if (isNaN(inv)) return res.status(400).json({ error: 'Ungültiges Investment' }); svU(req, 'Neue Strategie'); const d = req.profile.data; d.push({id: gid(), name: String(req.body.name||'').slice(0,200), startDate: req.body.startDate, notes: req.body.notes||'', token: req.body.token||null, includeInTotalApr: true, investmentHistory: [{id:gid(), amount:inv, date:req.body.startDate, note:''}], rewards:[], pnl:[], endedAt:null}); req.profile.data = d; await saveProfile(req); res.json(d[d.length-1]); } catch(e) { console.error('strategy create:', e.message); res.status(500).json({error:'Fehler'}); }});
router.delete('/strategies/:id', async (req, res) => { try { svU(req, 'Strat del'); req.profile.data = req.profile.data.filter(s => s.id !== req.params.id); await saveProfile(req); res.json({ok:1}); } catch(e) { console.error('strategy delete:', e.message); res.status(500).json({error:'Fehler'}); }});
router.put('/strategies/:id/:action', async (req, res) => {
  try {
    const validActions = ['end', 'reactivate', 'enddate', 'notes', 'token', 'toggle-total-apr'];
    if (!validActions.includes(req.params.action)) return res.status(400).json({ error: 'Ungültige Aktion' });
    const s = req.profile.data.find(x => x.id === req.params.id); if(!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
    svU(req, 'Strat Edit');
    if(req.params.action === 'end') s.endedAt = new Date().toISOString();
    if(req.params.action === 'reactivate') s.endedAt = null;
    if(req.params.action === 'enddate') s.endedAt = req.body.endedAt || new Date().toISOString();
    if(req.params.action === 'notes') s.notes = req.body.notes||'';
    if(req.params.action === 'token') s.token = req.body.name ? {name: req.body.name, amount: parseFloat(req.body.amount)||0, entryPrice: parseFloat(req.body.entryPrice)||0} : null;
    if(req.params.action === 'toggle-total-apr') s.includeInTotalApr = !s.includeInTotalApr;
    await saveProfile(req); res.json(s);
  } catch(e) { console.error('strategy edit:', e.message); res.status(500).json({error:'Fehler'}); }
});
router.post('/strategies/:id/investment', async (req, res) => { try { const s = req.profile.data.find(x => x.id === req.params.id); if(!s) return res.status(404).json({error:'Nicht gefunden'}); const amt = parseFloat(req.body.amount); if(isNaN(amt)) return res.status(400).json({error:'Ungültiger Betrag'}); svU(req, 'Invest+'); s.investmentHistory.push({id:gid(), amount:amt, date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(s); } catch(e) { console.error('invest:', e.message); res.status(500).json({error:'Fehler'}); }});
router.post('/strategies/:id/rewards', async (req, res) => { try { const s = req.profile.data.find(x => x.id === req.params.id); if(!s) return res.status(404).json({error:'Nicht gefunden'}); const amt = parseFloat(req.body.amount); if(isNaN(amt)) return res.status(400).json({error:'Ungültiger Betrag'}); svU(req, 'Reward+'); s.rewards.push({id:gid(), amount:amt, date:req.body.date||new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(s); } catch(e) { console.error('reward:', e.message); res.status(500).json({error:'Fehler'}); }});
router.post('/strategies/:id/pnl', async (req, res) => { try { const s = req.profile.data.find(x => x.id === req.params.id); if(!s) return res.status(404).json({error:'Nicht gefunden'}); const amt = parseFloat(req.body.amount); if(isNaN(amt)) return res.status(400).json({error:'Ungültiger Betrag'}); svU(req, 'PNL+'); s.pnl.push({id:gid(), amount:amt, note:req.body.note||'', date:new Date().toISOString(), includeInAPR:false}); await saveProfile(req); res.json(s); } catch(e) { console.error('pnl:', e.message); res.status(500).json({error:'Fehler'}); }});
router.put('/strategies/:id/investment/:itemId', async (req, res) => {
  svU(req, 'Invest~');
  const s = req.profile.data.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
  const it = (s.investmentHistory || []).find(x => x.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'Investment-Eintrag nicht gefunden' });
  const amount = parseFloat(req.body.amount);
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
  const d = req.body.date ? new Date(req.body.date) : null;
  if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
  it.amount = amount;
  it.note = req.body.note || '';
  if (d) it.date = d.toISOString();
  await saveProfile(req);
  res.json(s);
});
router.put('/strategies/:id/rewards/:itemId', async (req, res) => {
  svU(req, 'Reward~');
  const s = req.profile.data.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
  const it = (s.rewards || []).find(x => x.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'Reward-Eintrag nicht gefunden' });
  const amount = parseFloat(req.body.amount);
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
  const d = req.body.date ? new Date(req.body.date) : null;
  if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
  it.amount = amount;
  it.note = req.body.note || '';
  if (d) it.date = d.toISOString();
  await saveProfile(req);
  res.json(s);
});
router.put('/strategies/:id/pnl/:itemId', async (req, res) => {
  svU(req, 'PNL~');
  const s = req.profile.data.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
  const it = (s.pnl || []).find(x => x.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'PNL-Eintrag nicht gefunden' });
  const amount = parseFloat(req.body.amount);
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
  const d = req.body.date ? new Date(req.body.date) : null;
  if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
  it.amount = amount;
  it.note = req.body.note || '';
  if (d) it.date = d.toISOString();
  await saveProfile(req);
  res.json(s);
});
router.put('/strategies/:id/pnl/:itemId/toggle', async (req, res) => {
  svU(req, 'PNL toggle');
  const s = req.profile.data.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
  const it = (s.pnl || []).find(x => x.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'PNL-Eintrag nicht gefunden' });
  it.includeInAPR = !it.includeInAPR;
  await saveProfile(req);
  res.json(s);
});
router.delete('/strategies/:id/:type/:itemId', async (req, res) => {
  try {
    const validTypes = ['rewards', 'pnl'];
    if (!validTypes.includes(req.params.type)) return res.status(400).json({ error: 'Ungültiger Typ' });
    const s = req.profile.data.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Strategie nicht gefunden' });
    svU(req, 'Item del');
    if(req.params.type === 'rewards') s.rewards = (s.rewards||[]).filter(x => x.id !== req.params.itemId);
    if(req.params.type === 'pnl') s.pnl = (s.pnl||[]).filter(x => x.id !== req.params.itemId);
    await saveProfile(req); res.json({ok:1});
  } catch(e) { console.error('item del:', e.message); res.status(500).json({error:'Fehler'}); }
});

router.get('/frf/exchanges/:id/symbols', async (req, res) => {
  try {
    const exchangeId = String(req.params.id || '').trim().slice(0, 100);
    const query = String(req.query.q || '').trim().slice(0, 30);
    if (!exchangeId) return res.status(400).json({ error: 'Boerse erforderlich' });
    const exchange = profileExchangeById(req.profile, exchangeId);
    if (!exchange) return res.status(404).json({ error: 'Boerse nicht gefunden' });
    const result = await searchSymbolsForExchange(exchange.name, query);
    return res.json({ exchangeId, exchangeName: exchange.name, provider: result.provider, items: result.items });
  } catch (e) {
    console.error('frf exchange symbols:', e.message);
    return res.status(500).json({ error: e.message || 'Symbolsuche fehlgeschlagen' });
  }
});
router.get('/frf/positions/:id/live', async (req, res) => {
  try {
    const positionId = String(req.params.id || '').trim().slice(0, 100);
    if (!positionId) return res.status(400).json({ error: 'Position erforderlich' });
    const position = req.profile.frf.positions.find(x => x.id === positionId);
    if (!position) return res.status(404).json({ error: 'Position nicht gefunden' });
    const shortExchange = position.shortExchangeId ? profileExchangeById(req.profile, position.shortExchangeId) : null;
    const longExchange = !position.longIsSpot && position.longExchangeId ? profileExchangeById(req.profile, position.longExchangeId) : null;
    const tokenAmount = !Number.isNaN(parseFloat(position.tokenAmount)) ? parseFloat(position.tokenAmount) : 0;
    const shortEntry = !Number.isNaN(parseFloat(position.entryPriceShort)) ? parseFloat(position.entryPriceShort) : 0;
    const longEntry = !Number.isNaN(parseFloat(position.entryPriceLong)) ? parseFloat(position.entryPriceLong) : 0;
    let shortData = null;
    let longData = null;
    try {
      if (!shortExchange) throw new Error('Short-Boerse nicht gefunden');
      const [quote, funding] = await Promise.all([
        getExchangeQuote(shortExchange.name, position.token, 'perp'),
        getExchangeFunding(shortExchange.name, position.token, 'perp')
      ]);
      shortData = {
        ...quote,
        funding,
        entryPrice: shortEntry,
        pnl: tokenAmount > 0 && shortEntry > 0 && quote.price > 0 ? (shortEntry - quote.price) * tokenAmount : 0
      };
    } catch (error) {
      shortData = { exchangeName: shortExchange ? shortExchange.name : 'Short', error: error.message || 'Short-Livepreis fehlgeschlagen', funding: null, entryPrice: shortEntry, pnl: 0 };
    }
    try {
      const quote = position.longIsSpot ? await getFrfSpotFallback(position.token, shortExchange ? shortExchange.name : '', shortData && !shortData.error ? shortData : null) : await getExchangeQuote(longExchange ? longExchange.name : '', position.token, 'perp');
      const funding = position.longIsSpot ? null : await getExchangeFunding(longExchange ? longExchange.name : '', position.token, 'perp');
      longData = {
        ...quote,
        funding,
        exchangeName: position.longIsSpot ? (quote.exchangeName || 'Spot') : quote.exchangeName,
        entryPrice: longEntry,
        pnl: tokenAmount > 0 && longEntry > 0 && quote.price > 0 ? (quote.price - longEntry) * tokenAmount : 0
      };
    } catch (error) {
      longData = { exchangeName: position.longIsSpot ? 'Spot' : (longExchange ? longExchange.name : 'Long'), error: error.message || 'Long-Livepreis fehlgeschlagen', funding: null, entryPrice: longEntry, pnl: 0 };
    }
    return res.json({
      token: position.token,
      fetchedAt: new Date().toISOString(),
      short: shortData,
      long: longData,
      totalPnl: (shortData && !shortData.error ? shortData.pnl : 0) + (longData && !longData.error ? longData.pnl : 0)
    });
  } catch (e) {
    console.error('frf live quote:', e.message);
    return res.status(500).json({ error: e.message || 'Livepreise konnten nicht geladen werden' });
  }
});
router.post('/frf/exchanges', async (req, res) => { try { svU(req, 'Börse+'); const f = req.profile.frf; f.exchanges.push({id:gid(), name:String(req.body.name||'').slice(0,100), marginHistory:[{id:gid(), amount:parseFloat(req.body.margin)||0, date:new Date().toISOString(), note:'Ersteinzahlung'}]}); await saveProfile(req); res.json(f); } catch(e) { console.error('exchange create:', e.message); res.status(500).json({error:'Fehler'}); }});
router.delete('/frf/exchanges/:id', async (req, res) => { try { svU(req, 'Börse del'); const f = req.profile.frf; f.exchanges = f.exchanges.filter(x => x.id !== req.params.id); await saveProfile(req); res.json(f); } catch(e) { console.error('exchange del:', e.message); res.status(500).json({error:'Fehler'}); }});
router.post('/frf/exchanges/:id/margin', async (req, res) => { try { const f = req.profile.frf; const e = f.exchanges.find(x => x.id === req.params.id); if(!e) return res.status(404).json({error:'Börse nicht gefunden'}); const amt = parseFloat(req.body.amount); if(isNaN(amt)) return res.status(400).json({error:'Ungültiger Betrag'}); svU(req, 'Margin+'); e.marginHistory.push({id:gid(), amount:amt, date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(f); } catch(e) { console.error('margin:', e.message); res.status(500).json({error:'Fehler'}); }});
router.put('/frf/exchanges/:id', async (req, res) => {
  svU(req, 'Borse~');
  const f = req.profile.frf;
  const e = f.exchanges.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Boerse nicht gefunden' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) e.name = req.body.name.trim();
  const margin = parseFloat(req.body.margin);
  if (!Number.isNaN(margin)) {
    const current = (e.marginHistory || []).reduce((a, m) => a + (parseFloat(m.amount) || 0), 0);
    const delta = margin - current;
    if (Math.abs(delta) > 0.000001) {
      e.marginHistory = e.marginHistory || [];
      e.marginHistory.push({ id: gid(), amount: delta, date: new Date().toISOString(), note: 'Korrektur (Bearbeitung)' });
    }
  }
  await saveProfile(req);
  res.json(f);
});
router.put('/frf/exchanges/:id/margin/:mid', async (req, res) => {
  svU(req, 'Margin~');
  const f = req.profile.frf;
  const e = f.exchanges.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Boerse nicht gefunden' });
  const m = (e.marginHistory || []).find(x => x.id === req.params.mid);
  if (!m) return res.status(404).json({ error: 'Margin-Eintrag nicht gefunden' });
  const amount = parseFloat(req.body.amount);
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
  const d = req.body.date ? new Date(req.body.date) : null;
  if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
  m.amount = amount;
  m.note = req.body.note || '';
  if (d) m.date = d.toISOString();
  await saveProfile(req);
  res.json(f);
});
router.delete('/frf/exchanges/:id/margin/:mid', async (req, res) => {
  svU(req, 'Margin-');
  const f = req.profile.frf;
  const e = f.exchanges.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Boerse nicht gefunden' });
  e.marginHistory = (e.marginHistory || []).filter(x => x.id !== req.params.mid);
  await saveProfile(req);
  res.json(f);
});

router.post('/frf/positions', async (req, res) => {
  svU(req, 'Pos+'); const f = req.profile.frf;
  f.positions.push({id:gid(), type:req.body.type, token:req.body.token, coingeckoId:req.body.coingeckoId||'', tokenAmount:parseFloat(req.body.tokenAmount)||0, positionSizeUsd:parseFloat(req.body.positionSizeUsd)||0, entryPriceShort:parseFloat(req.body.entryPriceShort)||0, entryPriceLong:parseFloat(req.body.entryPriceLong)||0, shortExchangeId:req.body.shortExchangeId, longExchangeId:req.body.longExchangeId, longIsSpot:req.body.longIsSpot, fees:parseFloat(req.body.fees)||0, linkedStrategyId:req.body.linkedStrategyId||'', linkedLoopId:req.body.linkedLoopId||'', startDate:req.body.startDate||new Date().toISOString(), endedAt:null, closePnlShort:null, closePnlLong:null, closeNote:'', manualPrice:0, useManualPrice:false, includeInStrategy:false, excluded:false, fundingShort:[], fundingLong:[]});
  await saveProfile(req); res.json(f);
});
router.delete('/frf/positions/:id', async (req, res) => { svU(req, 'Pos del'); const f = req.profile.frf; f.positions = f.positions.filter(x => x.id !== req.params.id); await saveProfile(req); res.json(f); });
router.put('/frf/positions/:id', async (req, res) => {
  svU(req, 'Pos~');
  const f = req.profile.frf;
  const p = f.positions.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Position nicht gefunden' });
  p.type = req.body.type || p.type;
  p.token = req.body.token || p.token;
  p.coingeckoId = req.body.coingeckoId || p.coingeckoId || '';
  if (!Number.isNaN(parseFloat(req.body.tokenAmount))) p.tokenAmount = parseFloat(req.body.tokenAmount);
  if (!Number.isNaN(parseFloat(req.body.positionSizeUsd))) p.positionSizeUsd = parseFloat(req.body.positionSizeUsd);
  if (!Number.isNaN(parseFloat(req.body.entryPriceShort))) p.entryPriceShort = parseFloat(req.body.entryPriceShort);
  if (!Number.isNaN(parseFloat(req.body.entryPriceLong))) p.entryPriceLong = parseFloat(req.body.entryPriceLong);
  if (typeof req.body.shortExchangeId === 'string') p.shortExchangeId = req.body.shortExchangeId;
  if (typeof req.body.longExchangeId === 'string') p.longExchangeId = req.body.longExchangeId;
  if (typeof req.body.longIsSpot === 'boolean') p.longIsSpot = req.body.longIsSpot;
  if (!Number.isNaN(parseFloat(req.body.fees))) p.fees = parseFloat(req.body.fees);
  if (typeof req.body.linkedStrategyId === 'string') p.linkedStrategyId = req.body.linkedStrategyId;
  if (typeof req.body.linkedLoopId === 'string') p.linkedLoopId = req.body.linkedLoopId;
  if (req.body.startDate) {
    const d = new Date(req.body.startDate);
    if (!Number.isNaN(d.getTime())) p.startDate = d.toISOString();
  }
  await saveProfile(req);
  res.json(f);
});
router.put('/frf/positions/:id/close', async (req, res) => {
  try { svU(req, 'Pos close'); const f = req.profile.frf; const p = f.positions.find(x => x.id === req.params.id);
  if(!p) return res.status(404).json({error:'Position nicht gefunden'});
  p.endedAt = new Date().toISOString(); p.closePnlShort = parseFloat(req.body.closePnlShort)||0; p.closePnlLong = parseFloat(req.body.closePnlLong)||0; p.fees = parseFloat(req.body.fees)||0; p.closeNote = req.body.closeNote || '';
  if(p.closePnlShort !== 0 && p.shortExchangeId) { let e = f.exchanges.find(x=>x.id===p.shortExchangeId); if(e) e.marginHistory.push({id:gid(), amount:p.closePnlShort, date:p.endedAt, note:'Auto-Close PNL: '+p.token}); }
  if(p.closePnlLong !== 0 && !p.longIsSpot && p.longExchangeId) { let e = f.exchanges.find(x=>x.id===p.longExchangeId); if(e) e.marginHistory.push({id:gid(), amount:p.closePnlLong, date:p.endedAt, note:'Auto-Close PNL: '+p.token}); }
  await saveProfile(req); res.json(f);
  } catch(e) { console.error('pos close:', e.message); res.status(500).json({error:'Fehler'}); }
});
router.put('/frf/positions/:id/toggle-strategy', async (req, res) => { try { svU(req, 'Toggle Strat'); const p = req.profile.frf.positions.find(x => x.id === req.params.id); if(!p) return res.status(404).json({error:'Position nicht gefunden'}); p.includeInStrategy = !p.includeInStrategy; await saveProfile(req); res.json(req.profile.frf); } catch(e) { console.error('toggle strat:', e.message); res.status(500).json({error:'Fehler'}); }});
router.put('/frf/positions/:id/price', async (req, res) => {
  svU(req, 'Price~');
  const p = req.profile.frf.positions.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Position nicht gefunden' });
  p.useManualPrice = !!req.body.useManualPrice;
  p.manualPrice = !Number.isNaN(parseFloat(req.body.manualPrice)) ? parseFloat(req.body.manualPrice) : 0;
  await saveProfile(req);
  res.json(req.profile.frf);
});
router.post('/frf/positions/:id/funding/:side', async (req, res) => { try { const p = req.profile.frf.positions.find(x => x.id === req.params.id); if(!p) return res.status(404).json({error:'Position nicht gefunden'}); if(req.params.side!=='short'&&req.params.side!=='long') return res.status(400).json({error:'Ungültige Seite'}); const amt = parseFloat(req.body.amount); if(isNaN(amt)) return res.status(400).json({error:'Ungültiger Betrag'}); svU(req, 'Fund+'); const arr = req.params.side === 'short' ? p.fundingShort : p.fundingLong; arr.push({id:gid(), amount:amt, date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(req.profile.frf); } catch(e) { console.error('funding add:', e.message); res.status(500).json({error:'Fehler'}); }});
router.put('/frf/positions/:id/funding/:side/:fid', async (req, res) => {
  svU(req, 'Fund~');
  const p = req.profile.frf.positions.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Position nicht gefunden' });
  if (req.params.side !== 'short' && req.params.side !== 'long') return res.status(400).json({ error: 'Ungueltige Seite' });
  const arr = req.params.side === 'short' ? p.fundingShort : p.fundingLong;
  const f = arr.find(x => x.id === req.params.fid);
  if (!f) return res.status(404).json({ error: 'Funding-Eintrag nicht gefunden' });
  const amount = parseFloat(req.body.amount);
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
  let dateIso = f.date || new Date().toISOString();
  if (req.body.date) {
    const d = new Date(req.body.date);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
    dateIso = d.toISOString();
  }
  f.amount = amount;
  f.note = req.body.note || '';
  f.date = dateIso;
  await saveProfile(req);
  res.json(req.profile.frf);
});
router.delete('/frf/positions/:id/funding/:side/:fid', async (req, res) => { try { const p = req.profile.frf.positions.find(x => x.id === req.params.id); if(!p) return res.status(404).json({error:'Position nicht gefunden'}); svU(req, 'Fund-'); if(req.params.side==='short') p.fundingShort = (p.fundingShort||[]).filter(x=>x.id!==req.params.fid); else p.fundingLong = (p.fundingLong||[]).filter(x=>x.id!==req.params.fid); await saveProfile(req); res.json(req.profile.frf); } catch(e) { console.error('funding del:', e.message); res.status(500).json({error:'Fehler'}); }});
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
const variationalFundingTimer = setInterval(() => { captureTrackedVariationalFunding().catch(() => {}); }, VARIATIONAL_FUNDING_CAPTURE_MS);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DeFi Vault Server läuft auf Port ${PORT} (PostgreSQL+JWT)`);
  captureTrackedVariationalFunding().catch(() => {});
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
