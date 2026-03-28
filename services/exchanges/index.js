function createExchangeService({ db, fs, path, WSClient, fetchImpl, baseDir }) {
  const EXCHANGE_CACHE_MS = 5 * 60 * 1000;
  const VARIATIONAL_DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000;
  const VARIATIONAL_BATCH_SIZE = 120;
  const FUNDING_LOOKBACK_MS = 72 * 60 * 60 * 1000;
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
  const exchangeLookupCache = new Map();
  const variationalFundingSnapshotDir = path.join(baseDir, '.runtime');
  const variationalFundingSnapshotFile = path.join(variationalFundingSnapshotDir, 'variational-funding-snapshots.json');
  let variationalDiscoveryPromise = null;

  function cacheGet(key) {
    const item = exchangeLookupCache.get(key);
    if (!item || !item.expiresAt || Date.now() > item.expiresAt) {
      exchangeLookupCache.delete(key);
      return null;
    }
    return item.value;
  }

  function cacheSet(key, value, ttlMs = EXCHANGE_CACHE_MS) {
    if (exchangeLookupCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of exchangeLookupCache) {
        if (!v || !v.expiresAt || now > v.expiresAt) exchangeLookupCache.delete(k);
      }
      if (exchangeLookupCache.size > 500) {
        const oldest = [...exchangeLookupCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        for (let i = 0; i < 100 && i < oldest.length; i++) exchangeLookupCache.delete(oldest[i][0]);
      }
    }
    exchangeLookupCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.headers || {}),
      },
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
    if (value.includes('grvt')) return 'grvt';
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
    items.forEach((item) => {
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
      ...extra,
    };
  }

  function buildFundingPayload(provider, exchangeName, market, symbol, currentRate, intervalSeconds, settledEntries, extra = {}) {
    const interval = parseFloat(intervalSeconds) || 0;
    const rows = (Array.isArray(settledEntries) ? settledEntries : [])
      .map((entry) => normalizeFundingEntry(entry.time, entry.fundingRate, entry.intervalSeconds || interval, entry.extra || {}))
      .filter(Boolean)
      .filter((entry) => entry.time >= Date.now() - FUNDING_LOOKBACK_MS)
      .sort((a, b) => b.time - a.time);
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
      ...extra,
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
    const rows = readVariationalFundingSnapshots().filter((item) => item && item.symbol && item.settlementTime && item.settlementTime >= Date.now() - FUNDING_LOOKBACK_MS - EIGHT_HOURS_MS);
    const existing = rows.find((item) => item.symbol === normalizedSymbol && item.settlementTime === settlementTime);
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
    return readVariationalFundingSnapshots()
      .filter((item) => item && item.symbol === normalizedSymbol && item.settlementTime <= now && item.settlementTime >= now - FUNDING_LOOKBACK_MS)
      .map((item) => ({ time: item.settlementTime, fundingRate: item.fundingRate, intervalSeconds: item.intervalSeconds }));
  }

  function wsListen(socket, event, handler) {
    if (socket && typeof socket.addEventListener === 'function') {
      socket.addEventListener(event, handler);
      return;
    }
    if (socket && typeof socket.on === 'function') {
      socket.on(event, (arg) => {
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
    return profile.frf.exchanges.find((item) => item.id === exchangeId) || null;
  }

  function buildQuotePayload(provider, exchangeName, market, symbol, price, referencePrice, bidPrice, askPrice, mode, sourceLabel) {
    return { provider, exchangeName, market, symbol, price, referencePrice, bidPrice, askPrice, mode, sourceLabel };
  }

  async function getExtendedMarkets() {
    const cached = cacheGet('extended_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://app.extended.exchange/api/v1/info/markets');
    const rows = payload && Array.isArray(payload.data) ? payload.data : [];
    const items = rows.filter((row) => row && row.active && row.status === 'ACTIVE' && row.name && row.assetName).map((row) => ({
      symbol: String(row.assetName || '').toUpperCase(),
      market: String(row.name || '').toUpperCase(),
      quote: String(row.collateralAssetName || 'USD').toUpperCase(),
      label: `${String(row.assetName || '').toUpperCase()} - ${String(row.name || '').toUpperCase()}`,
    }));
    return cacheSet('extended_markets', items);
  }

  async function searchExtendedMarkets(query) {
    const q = normalizeLookupSymbol(query, 30);
    const rows = await getExtendedMarkets();
    return rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market)))
      .slice(0, 12);
  }

  async function getExtendedQuote(token, mode, exchangeName) {
    const normalized = normalizeLookupSymbol(token);
    if (!normalized) throw new Error('Ungueltiges Extended-Symbol');
    const rows = await getExtendedMarkets();
    const market = rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
      .filter((row) => row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market)))[0];
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
      body: JSON.stringify({ type: 'meta' }),
    });
    const rows = payload && Array.isArray(payload.universe) ? payload.universe : [];
    const items = rows.filter((row) => row && row.name && !row.isDelisted).map((row) => ({
      symbol: String(row.name || '').toUpperCase(),
      market: String(row.name || '').toUpperCase(),
      quote: 'USD',
      label: `${String(row.name || '').toUpperCase()} perpetual`,
    }));
    return cacheSet('hyperliquid_universe', items);
  }

  async function searchHyperliquidSymbols(query) {
    const q = normalizeLookupSymbol(query, 30);
    const rows = await getHyperliquidUniverse();
    return rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.symbol.localeCompare(b.symbol)))
      .slice(0, 12);
  }

  async function getHyperliquidQuote(token, mode, exchangeName) {
    const normalized = normalizeLookupSymbol(token, 20);
    if (!normalized) throw new Error('Ungueltiges Hyperliquid-Symbol');
    const payload = await fetchJson('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!Array.isArray(payload) || payload.length < 2) throw new Error('Unerwartete Hyperliquid-Antwort');
    const universe = Array.isArray(payload[0] && payload[0].universe) ? payload[0].universe : [];
    const contexts = Array.isArray(payload[1]) ? payload[1] : [];
    const index = universe.findIndex((row) => row && String(row.name || '').toUpperCase() === normalized);
    if (index < 0 || !contexts[index]) throw new Error(`Hyperliquid-Markt fuer ${normalized} nicht gefunden`);
    const ctx = contexts[index];
    return buildQuotePayload('hyperliquid', exchangeName, normalized, normalized, parseFloat(ctx.markPx) || parseFloat(ctx.midPx) || 0, parseFloat(ctx.oraclePx) || 0, Array.isArray(ctx.impactPxs) ? parseFloat(ctx.impactPxs[0]) || 0 : 0, Array.isArray(ctx.impactPxs) ? parseFloat(ctx.impactPxs[1]) || 0 : 0, mode, 'Hyperliquid metaAndAssetCtxs');
  }

  async function getBybitSpotMarkets() {
    const cached = cacheGet('bybit_spot_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000');
    const rows = payload && payload.result && Array.isArray(payload.result.list) ? payload.result.list : [];
    const items = rows.filter((row) => row && row.status === 'Trading' && ['USDT', 'USDC', 'USD'].includes(String(row.quoteCoin || '').toUpperCase())).map((row) => ({
      symbol: String(row.baseCoin || '').toUpperCase(),
      market: String(row.symbol || '').toUpperCase(),
      quote: String(row.quoteCoin || '').toUpperCase(),
      label: `${String(row.baseCoin || '').toUpperCase()} / ${String(row.quoteCoin || '').toUpperCase()}`,
    }));
    return cacheSet('bybit_spot_markets', items);
  }

  async function getBybitPerpMarkets() {
    const cached = cacheGet('bybit_perp_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000');
    const rows = payload && payload.result && Array.isArray(payload.result.list) ? payload.result.list : [];
    const items = rows.filter((row) => row && row.status === 'Trading' && row.contractType === 'LinearPerpetual' && ['USDT', 'USDC'].includes(String(row.quoteCoin || '').toUpperCase())).map((row) => ({
      symbol: String(row.baseCoin || '').toUpperCase(),
      market: String(row.symbol || '').toUpperCase(),
      quote: String(row.quoteCoin || '').toUpperCase(),
      intervalSeconds: parseFloat(row.fundingInterval) ? parseFloat(row.fundingInterval) * 60 : 8 * 3600,
      label: `${String(row.baseCoin || '').toUpperCase()} perpetual ${String(row.quoteCoin || '').toUpperCase()}`,
    }));
    return cacheSet('bybit_perp_markets', items);
  }

  async function getPhemexSpotMarkets() {
    const cached = cacheGet('phemex_spot_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://api.phemex.com/public/products');
    const rows = payload && payload.data && Array.isArray(payload.data.products) ? payload.data.products : [];
    const items = rows.filter((row) => row && row.type === 'Spot' && row.status === 'Listed' && ['USDT', 'USDC', 'USD'].includes(String(row.quoteCurrency || '').toUpperCase())).map((row) => ({
      symbol: String(row.baseCurrency || '').toUpperCase(),
      market: String(row.symbol || '').toUpperCase(),
      quote: String(row.quoteCurrency || '').toUpperCase(),
      label: `${String(row.baseCurrency || '').toUpperCase()} / ${String(row.quoteCurrency || '').toUpperCase()}`,
    }));
    return cacheSet('phemex_spot_markets', items);
  }

  async function getPhemexPerpMarkets() {
    const cached = cacheGet('phemex_perp_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://api.phemex.com/public/products');
    const rowsV2 = payload && payload.data && Array.isArray(payload.data.perpProductsV2) ? payload.data.perpProductsV2 : [];
    const rowsLegacy = payload && payload.data && Array.isArray(payload.data.products) ? payload.data.products : [];
    const v2Items = rowsV2.filter((row) => row && String(row.status || '') === 'Listed' && ['USDT', 'USDC'].includes(String(row.quoteCurrency || '').toUpperCase())).map((row) => ({
      symbol: String(row.baseCurrency || '').toUpperCase(),
      market: String(row.symbol || '').toUpperCase(),
      quote: String(row.quoteCurrency || '').toUpperCase(),
      intervalSeconds: parseFloat(row.fundingInterval) || 28800,
      fundingHistorySymbol: String(row.fundingRate8hSymbol || row.fundingRateSymbol || '').trim(),
      label: `${String(row.baseCurrency || '').toUpperCase()} perpetual ${String(row.quoteCurrency || '').toUpperCase()}`,
    }));
    const legacyItems = rowsLegacy.filter((row) => row && String(row.type || '') === 'Perpetual' && String(row.status || '') === 'Listed' && ['USD'].includes(String(row.quoteCurrency || '').toUpperCase())).map((row) => ({
      symbol: String(String(row.displaySymbol || row.symbol || '').replace(/\s*\/.*$/, '') || '').replace(/^c/, '').toUpperCase(),
      market: String(row.symbol || '').toUpperCase(),
      quote: String(row.quoteCurrency || '').toUpperCase(),
      intervalSeconds: parseFloat(row.fundingInterval) || 28800,
      fundingHistorySymbol: String(row.fundingRate8hSymbol || row.fundingRateSymbol || '').trim(),
      label: `${String(String(row.displaySymbol || row.symbol || '').replace(/\s+/g, ' ').trim() || row.symbol || '').replace(/^c/, '')} perpetual`,
    })).filter((item) => item.symbol && item.market);
    return cacheSet('phemex_perp_markets', uniqueBy([...v2Items, ...legacyItems], (row) => row.market));
  }

  async function searchPhemexSymbols(query) {
    const q = normalizeLookupSymbol(query, 30);
    const [spot, perp] = await Promise.all([getPhemexSpotMarkets(), getPhemexPerpMarkets()]);
    const merged = uniqueBy([...perp, ...spot].sort((a, b) => preferUsdQuote(a.quote, b.quote)), (row) => row.symbol + ':' + row.quote);
    return merged.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.symbol.localeCompare(b.symbol)))
      .slice(0, 12);
  }

  async function resolvePhemexMarket(token, mode) {
    const normalized = normalizeLookupSymbol(token, 24);
    if (!normalized) throw new Error('Ungueltiges Phemex-Symbol');
    const rows = mode === 'spot' ? await getPhemexSpotMarkets() : await getPhemexPerpMarkets();
    const market = rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
      .filter((row) => row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market)))[0];
    if (!market) throw new Error(`Phemex-Markt fuer ${normalized} nicht gefunden`);
    return market;
  }

  async function getPhemexQuote(token, mode, exchangeName) {
    const market = await resolvePhemexMarket(token, mode);
    const targetPath = mode === 'spot'
      ? `https://api.phemex.com/md/spot/ticker/24hr?symbol=${encodeURIComponent(market.market)}`
      : `https://api.phemex.com/md/v2/ticker/24hr?symbol=${encodeURIComponent(market.market)}`;
    const payload = await fetchJson(targetPath);
    const row = payload && payload.result ? payload.result : null;
    if (!row) throw new Error(`Phemex-Ticker fuer ${market.market} nicht gefunden`);
    const price = mode === 'spot' ? (parseFloat(row.lastEp) || 0) / 1e8 : parseFloat(row.markPriceRp) || parseFloat(row.closeRp) || 0;
    const reference = mode === 'spot' ? (parseFloat(row.indexEp) || 0) / 1e8 : parseFloat(row.indexPriceRp) || 0;
    const bid = mode === 'spot' ? (parseFloat(row.bidEp) || 0) / 1e8 : 0;
    const ask = mode === 'spot' ? (parseFloat(row.askEp) || 0) / 1e8 : 0;
    return buildQuotePayload('phemex', exchangeName, market.market, market.symbol, price, reference, bid, ask, mode, mode === 'spot' ? 'Phemex spot ticker' : 'Phemex perp ticker');
  }

  async function resolveBybitMarket(token, mode) {
    const normalized = normalizeLookupSymbol(token, 24);
    if (!normalized) throw new Error('Ungueltiges Bybit-Symbol');
    const rows = mode === 'spot' ? await getBybitSpotMarkets() : await getBybitPerpMarkets();
    const market = rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
      .filter((row) => row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market)))[0];
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

  async function getBybitFunding(token, exchangeName) {
    const market = await resolveBybitMarket(token, 'perp');
    const [tickerPayload, historyPayload] = await Promise.all([
      fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(market.market)}`),
      fetchJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodeURIComponent(market.market)}&limit=30`),
    ]);
    const ticker = tickerPayload && tickerPayload.result && Array.isArray(tickerPayload.result.list) ? tickerPayload.result.list[0] : null;
    const intervalSeconds = market.intervalSeconds || ((parseFloat(ticker && ticker.fundingIntervalHour) || 8) * 3600);
    const settled = ((historyPayload && historyPayload.result && Array.isArray(historyPayload.result.list)) ? historyPayload.result.list : []).map((item) => ({
      time: parseFloat(item.fundingRateTimestamp) || 0,
      fundingRate: parseFloat(item.fundingRate),
      intervalSeconds,
    }));
    return buildFundingPayload('bybit', exchangeName, market.market, market.symbol, ticker ? ticker.fundingRate : null, intervalSeconds, settled, { nextFundingTime: ticker ? parseFloat(ticker.nextFundingTime) || 0 : 0 });
  }

  async function getPhemexFunding(token, exchangeName) {
    const market = await resolvePhemexMarket(token, 'perp');
    const historySymbol = market.fundingHistorySymbol || `.${market.market}FR8H`;
    const [tickerPayload, historyPayload] = await Promise.all([
      fetchJson(`https://api.phemex.com/md/v3/ticker/24hr?symbol=${encodeURIComponent(market.market)}`),
      fetchJson(`https://api.phemex.com/api-data/public/data/funding-rate-history?symbol=${encodeURIComponent(historySymbol)}&limit=30`),
    ]);
    const ticker = tickerPayload && tickerPayload.result ? tickerPayload.result : null;
    const settled = (((historyPayload && historyPayload.data && Array.isArray(historyPayload.data.rows)) ? historyPayload.data.rows : [])).map((item) => ({
      time: parseFloat(item.fundingTime) || 0,
      fundingRate: parseFloat(item.fundingRate),
      intervalSeconds: parseFloat(item.intervalSeconds) || market.intervalSeconds || 28800,
    }));
    return buildFundingPayload('phemex', exchangeName, market.market, market.symbol, ticker ? ticker.fundingRateRr : null, market.intervalSeconds || 28800, settled, { predictedRate: ticker ? parseFloat(ticker.predFundingRateRr) : null });
  }

  async function getHyperliquidFunding(token, exchangeName) {
    const normalized = normalizeLookupSymbol(token, 20);
    if (!normalized) throw new Error('Ungueltiges Hyperliquid-Symbol');
    const [currentPayload, historyPayload] = await Promise.all([
      fetchJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) }),
      fetchJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin: normalized, startTime: Date.now() - FUNDING_LOOKBACK_MS, endTime: Date.now() }) }),
    ]);
    const universe = Array.isArray(currentPayload[0] && currentPayload[0].universe) ? currentPayload[0].universe : [];
    const contexts = Array.isArray(currentPayload[1]) ? currentPayload[1] : [];
    const index = universe.findIndex((item) => item && String(item.name || '').toUpperCase() === normalized);
    if (index < 0 || !contexts[index]) throw new Error(`Hyperliquid-Markt fuer ${normalized} nicht gefunden`);
    const ctx = contexts[index];
    const rawHistory = Array.isArray(historyPayload) ? historyPayload : [];
    const intervalSeconds = rawHistory.length > 1 ? Math.max(1, Math.round(Math.abs(rawHistory[1].time - rawHistory[0].time) / 1000)) : 3600;
    const settled = rawHistory.map((item) => ({ time: parseFloat(item.time) || 0, fundingRate: parseFloat(item.fundingRate), intervalSeconds }));
    return buildFundingPayload('hyperliquid', exchangeName, normalized, normalized, ctx.funding, intervalSeconds, settled, { premium: parseFloat(ctx.premium) || 0 });
  }

  async function getExtendedFunding(token, exchangeName) {
    const normalized = normalizeLookupSymbol(token);
    if (!normalized) throw new Error('Ungueltiges Extended-Symbol');
    const rows = await getExtendedMarkets();
    const market = rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) })).filter((row) => row.rank < 9).sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.market.localeCompare(b.market)))[0];
    if (!market) throw new Error(`Extended-Markt fuer ${normalized} nicht gefunden`);
    const [statsPayload, historyPayload] = await Promise.all([
      fetchJson(`https://api.starknet.extended.exchange/api/v1/info/markets/${encodeURIComponent(market.market)}/stats`, { headers: { 'User-Agent': 'OpenCode Funding Integration' } }),
      fetchJson(`https://api.starknet.extended.exchange/api/v1/info/${encodeURIComponent(market.market)}/funding?startTime=${Date.now() - FUNDING_LOOKBACK_MS}&endTime=${Date.now()}`, { headers: { 'User-Agent': 'OpenCode Funding Integration' } }),
    ]);
    const stats = statsPayload && statsPayload.data ? statsPayload.data : null;
    const rawHistory = historyPayload && Array.isArray(historyPayload.data) ? historyPayload.data : [];
    const intervalSeconds = rawHistory.length > 1 ? Math.max(1, Math.round(Math.abs(rawHistory[1].T - rawHistory[0].T) / 1000)) : 3600;
    const settled = rawHistory.map((item) => ({ time: parseFloat(item.T) || 0, fundingRate: parseFloat(item.f), intervalSeconds }));
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
    const map = new Map(listings.map((item) => [String(item.ticker || '').toUpperCase(), item]));
    symbols.forEach((symbol) => {
      const item = map.get(String(symbol || '').toUpperCase());
      if (!item) return;
      storeVariationalFundingSnapshot(item.ticker, item.funding_rate, item.funding_interval_s, Date.now());
    });
  }

  async function getTrackedVariationalTokens() {
    const tracked = new Set();
    try {
      const result = await db.query('SELECT frf FROM profiles');
      (result.rows || []).forEach((row) => {
        const frf = row && row.frf ? row.frf : {};
        const exchanges = Array.isArray(frf.exchanges) ? frf.exchanges : [];
        const positions = Array.isArray(frf.positions) ? frf.positions : [];
        const variationalIds = new Set(exchanges.filter((exchange) => normalizeExchangeProvider(exchange && exchange.name) === 'variational').map((exchange) => exchange.id));
        positions.forEach((position) => {
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
    const supported = await discoverVariationalSymbols();
    if (!supported.some((item) => item && String(item.symbol || '').toUpperCase() === normalized)) {
      throw new Error(`Variational-Markt fuer ${normalized} nicht verfuegbar`);
    }
    const listings = await getVariationalStatsListings();
    await captureVariationalFundingSnapshotsForSymbols([normalized], listings);
    const listing = listings.find((item) => item && String(item.ticker || '').toUpperCase() === normalized);
    if (!listing) throw new Error(`Variational-Markt fuer ${normalized} nicht verfuegbar`);
    const settled = getVariationalSettlementEntries(normalized);
    return buildFundingPayload('variational', exchangeName, normalized, normalized, listing.funding_rate, parseFloat(listing.funding_interval_s) || 0, settled, { historySource: settled.length ? 'snapshot' : 'pending' });
  }

  async function searchBybitSymbols(query) {
    const q = normalizeLookupSymbol(query, 30);
    const [spot, perp] = await Promise.all([getBybitSpotMarkets(), getBybitPerpMarkets()]);
    const merged = uniqueBy([...perp, ...spot].sort((a, b) => preferUsdQuote(a.quote, b.quote)), (row) => row.symbol);
    return merged.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.symbol.localeCompare(b.symbol)))
      .slice(0, 12);
  }

  async function getVariationalCandidates() {
    const cached = cacheGet('variational_candidates');
    if (cached) return cached;
    const [extended, hyperliquid, bybitSpot, bybitPerp, phemexSpot, phemexPerp] = await Promise.all([getExtendedMarkets(), getHyperliquidUniverse(), getBybitSpotMarkets(), getBybitPerpMarkets(), getPhemexSpotMarkets(), getPhemexPerpMarkets()]);
    const set = new Set();
    [...extended, ...hyperliquid, ...bybitSpot, ...bybitPerp, ...phemexSpot, ...phemexPerp].forEach((row) => { if (row && row.symbol) set.add(String(row.symbol).toUpperCase()); });
    ['BTC', 'ETH', 'SOL', 'AVAX', 'ARB', 'DOGE', 'XRP', 'SUI', 'BNB', 'HYPE', 'LTC', 'VVV', 'GOAT', '4'].forEach((symbol) => set.add(symbol));
    return cacheSet('variational_candidates', [...set].filter((symbol) => /^[A-Z0-9._-]{1,20}$/.test(symbol)).sort(), VARIATIONAL_DISCOVERY_TTL_MS);
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
          instruments: symbols.map((symbol) => ({ underlying: symbol, instrument_type: 'perpetual_future', settlement_asset: 'USDC', funding_interval_s: 3600 })),
        }));
      });
      wsListen(socket, 'message', (event) => {
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
      wsListen(socket, 'error', (error) => {
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
          result.found.forEach((symbol) => found.add(symbol));
        }
        const items = [...found].sort().map((symbol) => ({ symbol, market: symbol, quote: 'USDC', label: `${symbol} perpetual` }));
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
    return rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.symbol.localeCompare(b.symbol)))
      .slice(0, 12);
  }

  async function getVariationalQuote(token, mode, exchangeName) {
    const normalized = normalizeLookupSymbol(token, 20);
    if (!normalized) throw new Error('Ungueltiges Variational-Symbol');
    const supported = await discoverVariationalSymbols();
    if (!supported.some((item) => item && String(item.symbol || '').toUpperCase() === normalized)) {
      throw new Error(`Variational-Markt fuer ${normalized} nicht verfuegbar`);
    }
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
          instruments: [{ underlying: normalized, instrument_type: 'perpetual_future', settlement_asset: 'USDC', funding_interval_s: 3600 }],
        }));
      });
      wsListen(socket, 'message', (event) => {
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

  function grvtNsToMs(ns) {
    if (typeof ns === 'string') {
      const trimmed = ns.trim();
      if (!trimmed) return 0;
      try {
        const big = BigInt(trimmed);
        return big > 1000000000000000n ? Number(big / 1000000n) : Number(big);
      } catch (_error) {
        return 0;
      }
    }
    const value = Number(ns);
    if (!Number.isFinite(value) || !(value > 0)) return 0;
    return value > 1e15 ? Math.floor(value / 1e6) : value;
  }

  async function getGrvtPerpMarkets() {
    const cached = cacheGet('grvt_perp_markets');
    if (cached) return cached;
    const payload = await fetchJson('https://market-data.grvt.io/full/v1/all_instruments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    const rows = payload && Array.isArray(payload.result) ? payload.result : [];
    const items = rows.filter((row) => row && row.kind === 'PERPETUAL' && row.instrument && row.base && ['USDT', 'USDC'].includes(String(row.quote || '').toUpperCase())).map((row) => ({
      symbol: String(row.base || '').toUpperCase(),
      market: String(row.instrument || '').trim(),
      quote: String(row.quote || '').toUpperCase(),
      intervalSeconds: (parseFloat(row.funding_interval_hours) || 8) * 3600,
      label: `${String(row.base || '').toUpperCase()} perpetual ${String(row.quote || '').toUpperCase()}`,
    }));
    return cacheSet('grvt_perp_markets', items);
  }

  async function searchGrvtSymbols(query) {
    const q = normalizeLookupSymbol(query, 30);
    const rows = await getGrvtPerpMarkets();
    return rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.symbol, q), rankLookup(row.market, q), rankLookup(row.label, q)) }))
      .filter((row) => !q || row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market)))
      .slice(0, 12);
  }

  async function resolveGrvtMarket(token) {
    const normalized = normalizeLookupSymbol(token, 24);
    if (!normalized) throw new Error('Ungueltiges GRVT-Symbol');
    const rows = await getGrvtPerpMarkets();
    const market = rows.map((row) => ({ ...row, rank: Math.min(rankLookup(row.market, normalized), rankLookup(row.symbol, normalized)) }))
      .filter((row) => row.rank < 9)
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : preferUsdQuote(a.quote, b.quote) || a.market.localeCompare(b.market)))[0];
    if (!market) throw new Error(`GRVT-Markt fuer ${normalized} nicht gefunden`);
    return market;
  }

  async function getGrvtQuote(token, mode, exchangeName) {
    const market = await resolveGrvtMarket(token);
    const payload = await fetchJson('https://market-data.grvt.io/full/v1/ticker', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instrument: market.market }),
    });
    const row = payload && payload.result ? payload.result : null;
    if (!row) throw new Error(`GRVT-Ticker fuer ${market.market} nicht gefunden`);
    return buildQuotePayload('grvt', exchangeName, market.market, market.symbol, parseFloat(row.mark_price) || parseFloat(row.last_price) || 0, parseFloat(row.index_price) || parseFloat(row.last_price) || 0, parseFloat(row.best_bid_price) || 0, parseFloat(row.best_ask_price) || 0, mode, 'GRVT ticker');
  }

  async function getGrvtFunding(token, exchangeName) {
    const market = await resolveGrvtMarket(token);
    const [tickerPayload, historyPayload] = await Promise.all([
      fetchJson('https://market-data.grvt.io/full/v1/ticker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instrument: market.market }),
      }),
      fetchJson('https://market-data.grvt.io/full/v1/funding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instrument: market.market, limit: 30 }),
      }),
    ]);
    const ticker = tickerPayload && tickerPayload.result ? tickerPayload.result : null;
    const settled = ((historyPayload && Array.isArray(historyPayload.result)) ? historyPayload.result : []).map((item) => ({
      time: grvtNsToMs(item.funding_time),
      fundingRate: parseFloat(item.funding_rate),
      intervalSeconds: (parseFloat(item.funding_interval_hours) || (market.intervalSeconds / 3600) || 8) * 3600,
    }));
    return buildFundingPayload('grvt', exchangeName, market.market, market.symbol, ticker ? parseFloat(ticker.funding_rate) : null, market.intervalSeconds || 28800, settled, { nextFundingTime: ticker ? grvtNsToMs(ticker.next_funding_time) : 0 });
  }

  async function searchSymbolsForExchange(exchangeName, query) {
    const provider = normalizeExchangeProvider(exchangeName);
    if (!provider) throw new Error('Boerse wird noch nicht unterstuetzt');
    if (provider === 'grvt') return { provider, items: await searchGrvtSymbols(query) };
    if (provider === 'extended') return { provider, items: await searchExtendedMarkets(query) };
    if (provider === 'hyperliquid') return { provider, items: await searchHyperliquidSymbols(query) };
    if (provider === 'variational') return { provider, items: await searchVariationalSymbols(query) };
    if (provider === 'phemex') return { provider, items: await searchPhemexSymbols(query) };
    return { provider, items: await searchBybitSymbols(query) };
  }

  async function getExchangeQuote(exchangeName, token, mode) {
    const provider = normalizeExchangeProvider(exchangeName);
    if (!provider) throw new Error('Boerse wird noch nicht unterstuetzt');
    if (provider === 'grvt') return getGrvtQuote(token, mode, exchangeName);
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
    if (provider === 'grvt') return getGrvtFunding(token, exchangeName);
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

  function cleanupCaches(now = Date.now()) {
    for (const [key, val] of exchangeLookupCache) {
      if (!val || !val.expiresAt || now > val.expiresAt) exchangeLookupCache.delete(key);
    }
  }

  return {
    captureTrackedVariationalFunding,
    cleanupCaches,
    getExchangeFunding,
    getExchangeQuote,
    getFrfSpotFallback,
    normalizeExchangeProvider,
    profileExchangeById,
    searchSymbolsForExchange,
  };
}

module.exports = { createExchangeService };
