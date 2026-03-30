import { SECTION_MARKERS, mountLegacyHtml } from "./render-sections.mjs";

var AUTH = { loggedIn: false, account: null, profiles: [] },
  PID = null,
  S = [],
  FR = { exchanges: [], positions: [] },
  U = [],
  LO = [];
var V = "active",
  FRFV = "open",
  LOOPV = "open",
  SI = null,
  FPI = null,
  LPI = null,
  UD = false;
var VW = "grid",
  STRAT_SORT = "invest",
  STRAT_SORT_DIR = "desc",
  FRF_SORT = "size",
  FRF_SORT_DIR = "desc";
var M = {};
var PRICES = {};
var EXP = {};
var MSG_SUM = {
  unreadCount: 0,
  importantUnreadCount: 0,
  supportUnreadCount: 0,
};
var MSG = {
  inbox: [],
  drafts: [],
  history: [],
  users: [],
  stats: { sent30d: 0, direct30d: 0, drafts: 0, avgReadRate: 0 },
  recipients: [],
  selectedId: null,
  selectedAdminId: null,
};
var MSG_VIEW = "inbox",
  MSG_FILTER = "all",
  MSG_SEARCH = "",
  MSG_ADMIN_SEARCH = "",
  MSG_SEGMENT = "all_users";
var MC = {
  id: null,
  targetType: "all",
  targetAccountId: "",
  targetEmail: "",
  conversationId: "",
  parentMessageId: "",
  title: "",
  body: "",
  priority: "info",
  category: "system",
  linkUrl: "",
  isPinned: false,
  expiresAt: "",
  status: "draft",
  scheduledAt: "",
  readTracking: true,
  emailMirror: false,
  audiencePreset: "all_users",
};
var SHOW_HINTS = true;
var LAST_WAKE_AT = Date.now();
var VERIFY_EMAIL = "",
  VERIFY_RETRY_AT = 0;
var FRF_TOKEN_REQ = { new: 0, edit: 0 },
  FRF_LIVE_QUOTES = {},
  FRF_LIVE_LOADING = {},
  FRF_LIVE_NEXT_AT = {},
  FRF_LIVE_TIMER = {};
var BG_SIGNATURE = "";
var LOOP_PEG_QUOTES = {},
  LOOP_PEG_LOADING = {},
  LOOP_PEG_NEXT_AT = {};

// Pagination & Search Flags
var PG_ACT = 1,
  PG_PAST = 1,
  PG_FRFO = 1,
  PG_FRFC = 1,
  PG_LOOP = 1;
var SEARCH_ACT = "",
  SEARCH_PAST = "",
  SEARCH_FRF = "",
  SEARCH_LOOP = "",
  ITEMS_PER_PAGE = 12;
var IS_DEMO = false;
var ROLE_ORDER = ["user", "support", "admin", "owner"];
var STABLE_PRICES = {
  USDC: 1,
  USDT: 1,
  DAI: 1,
  USDE: 1,
  FDUSD: 1,
  "USDC.E": 1,
};
var LOOP_TOKEN_OPTIONS = [
  "sAVAX",
  "WAVAX",
  "AVAX",
  "USDC",
  "USDT",
  "ETH",
  "BTC",
  "WBTC",
  "SOL",
  "LINK",
  "AAVE",
];
var LOOP_ORACLE_TOKEN_MAP = {
  SUPPLY: {
    SAVAX: {
      asset: "sAVAX",
      protocol: "Benqi",
      type: "SUPPLY",
      rateKind: "APR",
    },
  },
  BORROW: {
    WAVAX: {
      asset: "WAVAX",
      protocol: "Aave",
      type: "BORROW",
      rateKind: "APY",
    },
    AVAX: {
      asset: "WAVAX",
      protocol: "Aave",
      type: "BORROW",
      rateKind: "APY",
    },
  },
};
var LOOP_ORACLE_REQ = 0;

// ─── Field Validation Helpers ───────────────────────────────────────────────

/**
 * Marks a field as invalid: red border + message below it.
 * id     - the element's id attribute
 * msg    - the error text to display (falsy = no message, just red border)
 * Returns false so callers can do: return showFieldError('f-n', 'Pflichtfeld');
 */
function showFieldError(id, msg) {
  var el = document.getElementById(id);
  if (!el) return false;
  var fg = el.closest('.fg');
  if (fg) {
    fg.classList.add('fg--error');
    var existing = fg.querySelector('.fg-err');
    if (existing) existing.remove();
    if (msg) {
      var span = document.createElement('span');
      span.className = 'fg-err';
      span.textContent = msg;
      fg.appendChild(span);
    }
    // Auto-clear when user types/changes
    var clearFn = function() {
      fg.classList.remove('fg--error');
      var err = fg.querySelector('.fg-err');
      if (err) err.remove();
      el.removeEventListener('input', clearFn);
      el.removeEventListener('change', clearFn);
    };
    el.addEventListener('input', clearFn);
    el.addEventListener('change', clearFn);
  }
  return false;
}

/**
 * Clears error state from one or more field ids.
 * ids - array of id strings, or a single id string
 */
function clearFieldErrors(ids) {
  var list = Array.isArray(ids) ? ids : [ids];
  list.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var fg = el.closest('.fg');
    if (!fg) return;
    fg.classList.remove('fg--error');
    var err = fg.querySelector('.fg-err');
    if (err) err.remove();
  });
}

/**
 * Validate a set of fields at once.
 * rules - array of { id, test: fn(value) => bool, msg }
 * Returns true if all valid, false if any failed (shows all errors at once).
 */
function validateFields(rules) {
  var ok = true;
  rules.forEach(function(rule) {
    var el = document.getElementById(rule.id);
    var value = el ? el.value : '';
    if (!rule.test(value)) {
      showFieldError(rule.id, rule.msg || 'Pflichtfeld');
      ok = false;
    }
  });
  return ok;
}

function setPgAct(p) {
  PG_ACT = p;
  R();
}
function setPgPast(p) {
  PG_PAST = p;
  R();
}
function setPgFrfO(p) {
  PG_FRFO = p;
  R();
}
function setPgFrfC(p) {
  PG_FRFC = p;
  R();
}

var UI_KEY_BASE = "defi_vault_ui_state",
  LAST_RENDER_AT = 0;
var CG_MAP = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  avalanche: "AVAX",
  "benqi-liquid-staked-avax": "SAVAX",
  pendle: "PENDLE",
  chainlink: "LINK",
  arbitrum: "ARB",
  optimism: "OP",
  uniswap: "UNI",
  aave: "AAVE",
  tether_gold: "XAUT",
  coinbase_wrapped_btc: "cbBTC",
  wrapped_bitcoin: "WBTC",
  berachain: "BERA",
  monad: "WMON",
};
var CG_REV = {};
for (let k in CG_MAP) CG_REV[CG_MAP[k].toUpperCase()] = k;
CG_REV.WAVAX = "avalanche";
var BINANCE_PRICE_BASE_MAP = {
  AVAX: "AVAX",
  WAVAX: "AVAX",
  BTC: "BTC",
  WBTC: "BTC",
  CBBTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  LINK: "LINK",
  AAVE: "AAVE",
  ARB: "ARB",
  OP: "OP",
  UNI: "UNI",
  PENDLE: "PENDLE",
  BERA: "BERA",
};
var BINANCE_PRICE_QUOTES = ["USDC", "USDT"];

PID = localStorage.getItem("dv_pid") || null;

function uiKey() {
  return UI_KEY_BASE + "_" + (PID || "guest");
}
function saveUi() {
  try {
    localStorage.setItem(
      uiKey(),
      JSON.stringify({
        V: V,
        SI: SI,
        FRFV: FRFV,
        LOOPV: LOOPV,
        FPI: FPI,
        LPI: LPI,
        VW: VW,
        STRAT_SORT: STRAT_SORT,
        STRAT_SORT_DIR: STRAT_SORT_DIR,
        FRF_SORT: FRF_SORT,
        FRF_SORT_DIR: FRF_SORT_DIR,
        EXP: EXP,
        SH: SHOW_HINTS,
      }),
    );
  } catch (e) {}
}
function loopBinanceBaseAsset(sym) {
  var key = String(sym || "").trim().toUpperCase();
  return BINANCE_PRICE_BASE_MAP[key] || null;
}
function buildBinancePriceLookup(symbols) {
  var symbolPairs = {},
    requestPairs = [];
  Object.keys(symbols || {}).forEach(function (sym) {
    var baseAsset = loopBinanceBaseAsset(sym);
    if (!baseAsset) return;
    var pairs = BINANCE_PRICE_QUOTES.map(function (quote) {
      return baseAsset + quote;
    });
    symbolPairs[sym] = pairs;
    pairs.forEach(function (pair) {
      if (requestPairs.indexOf(pair) === -1) requestPairs.push(pair);
    });
  });
  return { symbolPairs: symbolPairs, requestPairs: requestPairs };
}
function applyBinancePriceRows(symbolPairs, rows) {
  var tickerMap = {};
  (rows || []).forEach(function (row) {
    var symbol = String((row && row.symbol) || "").trim().toUpperCase(),
      price = parseFloat(row && row.price);
    if (symbol && price > 0) tickerMap[symbol] = price;
  });
  Object.keys(symbolPairs || {}).forEach(function (sym) {
    var price = 0;
    (symbolPairs[sym] || []).some(function (pair) {
      var pairPrice = parseFloat(tickerMap[pair] || 0);
      if (pairPrice > 0) {
        price = pairPrice;
        return true;
      }
      return false;
    });
    if (price > 0) PRICES[sym] = price;
  });
}
function fetchCoinGeckoLoopPrices(tokens) {
  var missingSymbols = Object.keys(tokens || {}).filter(function (sym) {
    return !(parseFloat(PRICES[sym] || 0) > 0);
  });
  if (!missingSymbols.length) return Promise.resolve();
  var coinGeckoIds = [];
  missingSymbols.forEach(function (sym) {
    var id = tokens[sym];
    if (id && coinGeckoIds.indexOf(id) === -1) coinGeckoIds.push(id);
  });
  if (!coinGeckoIds.length) return Promise.resolve();
  return fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=" +
      coinGeckoIds.join(",") +
      "&vs_currencies=usd",
  )
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (d) {
      missingSymbols.forEach(function (sym) {
        var cgId = tokens[sym],
          price = d && d[cgId] ? parseFloat(d[cgId].usd) : 0;
        if (price > 0) PRICES[sym] = price;
      });
    })
    .catch(function () {});
}
function restoreUi() {
  try {
    var raw = localStorage.getItem(uiKey());
    if (!raw) return;
    var st = JSON.parse(raw) || {};
    if (st.V) V = st.V;
    if (st.SI !== undefined) SI = st.SI || null;
    if (st.FRFV) FRFV = st.FRFV;
    if (st.LOOPV) LOOPV = st.LOOPV;
    if (st.FPI !== undefined) FPI = st.FPI || null;
    if (st.LPI !== undefined) LPI = st.LPI || null;
    if (st.VW) VW = st.VW;
    if (st.STRAT_SORT) STRAT_SORT = st.STRAT_SORT;
    if (st.STRAT_SORT_DIR) STRAT_SORT_DIR = st.STRAT_SORT_DIR;
    if (st.FRF_SORT) FRF_SORT = st.FRF_SORT;
    if (st.FRF_SORT_DIR) FRF_SORT_DIR = st.FRF_SORT_DIR;
    if (st.EXP && typeof st.EXP === "object") EXP = st.EXP;
    if (st.SH !== undefined) SHOW_HINTS = !!st.SH;
  } catch (e) {}
}
function normUi() {
  if (
    [
      "active",
      "past",
      "detail",
      "frf",
      "frf_pos",
      "looping",
      "admin",
      "community",
      "messages",
    ].indexOf(V) === -1
  )
    V = "active";
  if (VW !== "grid" && VW !== "list") VW = "grid";
  if (FRFV !== "open" && FRFV !== "closed") FRFV = "open";
  if (LOOPV !== "open" && LOOPV !== "closed") LOOPV = "open";
  if (STRAT_SORT === "size") STRAT_SORT = "invest";
  if (STRAT_SORT === "az") {
    STRAT_SORT = "name";
    STRAT_SORT_DIR = "asc";
  }
  if (STRAT_SORT === "za") {
    STRAT_SORT = "name";
    STRAT_SORT_DIR = "desc";
  }
  if (!["name", "invest", "rewards", "pnl", "apr", "runtime"].includes(STRAT_SORT))
    STRAT_SORT = "invest";
  if (!["asc", "desc"].includes(STRAT_SORT_DIR)) STRAT_SORT_DIR = "desc";
  if (FRF_SORT === "az") {
    FRF_SORT = "token";
    FRF_SORT_DIR = "asc";
  }
  if (FRF_SORT === "za") {
    FRF_SORT = "token";
    FRF_SORT_DIR = "desc";
  }
  if (!["token", "type", "size", "amount", "pnl", "apr", "runtime"].includes(FRF_SORT))
    FRF_SORT = "size";
  if (!["asc", "desc"].includes(FRF_SORT_DIR)) FRF_SORT_DIR = "desc";
  if (!EXP || typeof EXP !== "object") EXP = {};
  if (V === "detail" && (!SI || !S.find((x) => x.id === SI))) {
    SI = null;
    V = "active";
  }
  if (V === "looping" && !PID) {
    V = "active";
  }
  if (V === "messages" && !AUTH.loggedIn) {
    V = "active";
  }
  if (V === "frf_pos" && (!FPI || !FR.positions.find((x) => x.id === FPI))) {
    FPI = null;
    V = "frf";
  }
  if (V === "looping" && LPI && LO.length && !LO.find((x) => x.id === LPI))
    LPI = null;
}

function cm() {
  var ev = window.event;
  if (
    ev &&
    ev.type === "click" &&
    ev.target &&
    ev.target.classList &&
    ev.target.classList.contains("ov")
  )
    return;
  M = {};
}
function tgl(k) {
  EXP[k] = !EXP[k];
  R();
}
function fd(i) {
  if (!i) return "—";
  var d = new Date(i);
  return (
    d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}
function fds(i) {
  if (!i) return "";
  return new Date(i).toISOString().slice(0, 10);
}
function fts(i) {
  if (!i) return "";
  return new Date(i).toTimeString().slice(0, 5);
}
function db(a, b) {
  return Math.max(0, (new Date(b) - new Date(a)) / 864e5);
}
function calcApr(g, i, d) {
  return !i || d < 0.001 ? 0 : (g / i / d) * 365 * 100;
}
function fn(n) {
  return (n || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fpr(n) {
  if (!n) return "0";
  var s = String(n),
    d = s.indexOf(".");
  if (d < 0) return fn(n);
  var dc = s.length - d - 1;
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: Math.max(2, dc),
    maximumFractionDigits: Math.max(2, dc),
  });
}
function es(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function onlineMeta(ts) {
  if (!ts) return { dot: "var(--r)", txt: "Offline", tt: "Keine Aktivität" };
  var m = (Date.now() - new Date(ts).getTime()) / 60000;
  if (m <= 5)
    return {
      dot: "var(--g)",
      txt: "Online",
      tt: "Aktiv in den letzten 5 Min.",
    };
  if (m <= 30)
    return {
      dot: "var(--y)",
      txt: "Idle",
      tt: "Keine Aktivität seit " + Math.floor(m) + " Min.",
    };
  return {
    dot: "var(--r)",
    txt: "Offline",
    tt: "Keine Aktivität seit " + Math.floor(m) + " Min.",
  };
}
function onlineBadge(ts) {
  var o = onlineMeta(ts);
  return (
    '<span title="' +
    es(o.tt) +
    '" style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:' +
    o.dot +
    '"></span><span style="font-size:11px;color:var(--t3)">' +
    o.txt +
    "</span></span>"
  );
}

function ci(s) {
  var h = s.investmentHistory;
  return h && h.length ? h.reduce((a, x) => a + (parseFloat(x.amount) || 0), 0) : 0;
}
function strategyTokenEntries(s) {
  var history = Array.isArray(s && s.investmentHistory) ? s.investmentHistory : [],
    rows = [];
  history.forEach(function (entry) {
    (Array.isArray(entry && entry.tokenChanges) ? entry.tokenChanges : []).forEach(function (change) {
      var name = String((change && change.name) || '').trim(),
        amount = parseFloat(change && change.amount),
        entryPrice = parseFloat(change && change.entryPrice);
      if (!name || !Number.isFinite(amount) || amount === 0) return;
      rows.push({
        name: name,
        amount: amount,
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
        date: entry && entry.date ? entry.date : null,
      });
    });
  });
  if (s && s.token && s.token.name) {
    rows.unshift({
      name: String(s.token.name || '').trim(),
      amount: parseFloat(s.token.amount) || 0,
      entryPrice: parseFloat(s.token.entryPrice) || 0,
      date: s.startDate || null,
    });
  }
  return rows.filter(function (entry) {
    return entry.name && Number.isFinite(entry.amount) && entry.amount !== 0;
  });
}
function strategyHasTokenEvents(s) {
  return Array.isArray(s && s.investmentHistory)
    ? s.investmentHistory.some(function (entry) {
        return Array.isArray(entry && entry.tokenChanges) && entry.tokenChanges.length;
      })
    : false;
}
function strategyTokenSummary(s) {
  var map = {};
  strategyTokenEntries(s).forEach(function (entry) {
    var key = entry.name.toUpperCase();
    if (!map[key]) {
      map[key] = { name: entry.name, amount: 0, positiveAmount: 0, weightedCost: 0 };
    }
    map[key].amount += entry.amount;
    if (entry.amount > 0 && entry.entryPrice > 0) {
      map[key].positiveAmount += entry.amount;
      map[key].weightedCost += entry.amount * entry.entryPrice;
    }
  });
  return Object.values(map)
    .filter(function (entry) {
      return Math.abs(entry.amount) > 1e-9;
    })
    .map(function (entry) {
      var avgEntry = entry.positiveAmount > 0 ? entry.weightedCost / entry.positiveAmount : 0;
      return {
        name: entry.name,
        amount: entry.amount,
        entryPrice: avgEntry,
        value: avgEntry > 0 ? entry.amount * avgEntry : 0,
      };
    })
    .sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'de');
    });
}
function strategyTokenSearchText(s) {
  return strategyTokenSummary(s)
    .map(function (entry) {
      return String(entry.name || '').toLowerCase();
    })
    .join(' ');
}
function strategyTokenBadges(s) {
  return strategyTokenSummary(s)
    .map(function (entry) {
      return '<span class="tkb">' + es(entry.name) + ' ' + fn(entry.amount) + '</span>';
    })
    .join('');
}
function renderStrategyTokenChanges(entry) {
  var rows = Array.isArray(entry && entry.tokenChanges) ? entry.tokenChanges : [];
  if (!rows.length) return '';
  return '<div style="display:grid;gap:4px">' + rows
    .map(function (item) {
      var amount = parseFloat(item.amount) || 0,
        entryPrice = parseFloat(item.entryPrice) || 0,
        sign = amount > 0 ? '+' : '-';
      return (
        '<div style="font-size:12px;color:var(--t2);line-height:1.4">' +
        sign +
        ' ' +
        fn(Math.abs(amount)) +
        ' ' +
        es(item.name) +
        ' @ ' +
        (entryPrice > 0 ? fn(entryPrice) + '$' : '—') +
        '</div>'
      );
    })
    .join('') + '</div>';
}
function strategyTokenRowHtml(values) {
  values = values || {};
  return '<div class="strategy-token-row" style="margin-top:10px;padding:10px;border:1px dashed var(--bd2);border-radius:10px"><div class="fr" style="align-items:flex-end"><div class="fg"><label>Token</label><input class="strategy-token-name" value="' +
    es(values.name || '') +
    '"></div><div class="fg"><label>Menge</label><input class="strategy-token-amount" type="number" step="any" value="' +
    es(values.amount || '') +
    '"></div><div class="fg"><label>Entry ($)</label><input class="strategy-token-entry" type="number" step="any" value="' +
    es(values.entryPrice || '') +
    '"></div><button class="bt be" type="button" style="height:40px" onclick="strategyRemoveTokenRow(this)">×</button></div></div>';
}
function strategyTokenInputSection(containerId) {
  return '<div style="margin-top:8px"><button class="bt by" type="button" onclick="strategyAddTokenRow(\'' +
    containerId +
    '\')"><span style="font-size:16px">+</span> Token hinzufügen</button><div id="' +
    containerId +
    '"></div></div>';
}
function strategyAddTokenRow(containerId, values) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.insertAdjacentHTML('beforeend', strategyTokenRowHtml(values));
}
function strategyRemoveTokenRow(button) {
  var row = button && button.closest ? button.closest('.strategy-token-row') : null;
  if (row) row.remove();
}
function collectStrategyTokenRows(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return { rows: [], error: '' };
  var rows = [];
  var error = '';
  Array.from(container.querySelectorAll('.strategy-token-row')).forEach(function (row) {
    var name = (row.querySelector('.strategy-token-name') || {}).value || '',
      amountRaw = (row.querySelector('.strategy-token-amount') || {}).value || '',
      entryRaw = (row.querySelector('.strategy-token-entry') || {}).value || '',
      trimmedName = String(name || '').trim();
    if (!trimmedName && amountRaw === '' && entryRaw === '') return;
    var amount = parseFloat(amountRaw),
      entryPrice = entryRaw === '' ? 0 : parseFloat(entryRaw);
    if (!trimmedName) error = error || 'Tokenname erforderlich';
    else if (!Number.isFinite(amount) || amount === 0) error = error || 'Tokenmenge muss ungleich 0 sein';
    else if (!Number.isFinite(entryPrice) || entryPrice < 0) error = error || 'Entry-Preis ungültig';
    else rows.push({ name: trimmedName, amount: amount, entryPrice: entryPrice });
  });
  return { rows: rows, error: error };
}
function tr(s) {
  return s.rewards.reduce((a, r) => a + r.amount, 0);
}
function posFloatingPnl(p) {
  if (p.endedAt || p.type !== "hedge") return 0;
  if (!p.token) return 0;
  var pr = p.useManualPrice ? p.manualPrice : PRICES[p.token.toUpperCase()];
  if (!pr || !p.tokenAmount) return 0;
  var f = 0;
  if (p.shortExchangeId && p.entryPriceShort)
    f += (p.entryPriceShort - pr) * p.tokenAmount;
  if (p.longExchangeId && p.entryPriceLong)
    f += (pr - p.entryPriceLong) * p.tokenAmount;
  return f;
}
function frfFundingContribution(p) {
  var funding = latestFunding(p.fundingShort) + latestFunding(p.fundingLong);
  if (p && p.endedAt && p.closePnlIncludesFunding) return 0;
  return funding;
}
function posPnl(p) {
  return (
    frfFundingContribution(p) +
    (p.closePnlShort || 0) +
    (p.closePnlLong || 0) +
    posFloatingPnl(p)
  );
}
function tp(s, ia) {
  var pnl = (s.pnl || []).reduce(
    (a, p) => (ia ? (p.includeInAPR ? a + p.amount : a) : a + p.amount),
    0,
  );
  var lnk = FR.positions.filter(
    (x) =>
      x.linkedStrategyId === s.id && x.includeInStrategy && x.type === "hedge",
  );
  var hp = lnk.reduce((a, x) => a + posPnl(x), 0);
  return pnl + hp;
}
function tg(s) {
  return tr(s) + tp(s, true);
}
function bp(s, e) {
  var h = s.investmentHistory
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  var vp = (s.pnl || []).slice();
  var lnk = FR.positions.filter(
    (x) =>
      x.linkedStrategyId === s.id && x.includeInStrategy && x.type === "hedge",
  );
  lnk.forEach((x) => {
    var d = x.endedAt || new Date().toISOString();
    vp.push({ amount: posPnl(x), date: d, includeInAPR: true });
  });
  var ps = [];
  var runningInvestment = 0;
  for (var i = 0; i < h.length; i++) {
    runningInvestment += parseFloat(h[i].amount) || 0;
    var st = h[i].date,
      en = i < h.length - 1 ? h[i + 1].date : e;
    var dy = db(st, en);
    var rw = s.rewards.filter((r) => {
      var rd = new Date(r.date).getTime(),
        sd = new Date(st).getTime(),
        ed = new Date(en).getTime();
      return rd >= sd && (i < h.length - 1 ? rd < ed : rd <= ed);
    });
    var pl = vp.filter((p) => {
      if (!p.includeInAPR) return false;
      var pd = new Date(p.date).getTime(),
        sd = new Date(st).getTime(),
        ed = new Date(en).getTime();
      return pd >= sd && (i < h.length - 1 ? pd < ed : pd <= ed);
    });
    var rs = rw.reduce((a, r) => a + r.amount, 0),
      pls = pl.reduce((a, p) => a + p.amount, 0),
      gs = rs + pls,
      ap = calcApr(gs, runningInvestment, dy);
    var ch = i > 0 ? parseFloat(h[i].amount) || 0 : null;
    ps.push({
      id: h[i].id,
      amount: runningInvestment,
      date: h[i].date,
      endDate: en,
      days: dy,
      rewards: rs,
      pnl: pls,
      gains: gs,
      apr: ap,
      change: ch,
      isCurrent: i === h.length - 1,
      note: h[i].note || "",
    });
  }
  return ps;
}
function wa(s, e) {
  var ps = bp(s, e),
    tw = 0,
    td = 0;
  ps.forEach((p) => {
    tw += p.apr * p.amount * p.days;
    td += p.amount * p.days;
  });
  return td > 0 ? tw / td : 0;
}
function stratIncl(s) {
  return s.includeInTotalApr !== false;
}
function sortDirMul(dir) {
  return dir === "asc" ? 1 : -1;
}
function cmpText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "de");
}
function cmpNumber(a, b) {
  var av = Number.isFinite(a) ? a : parseFloat(a) || 0,
    bv = Number.isFinite(b) ? b : parseFloat(b) || 0;
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}
function sortIndicator(active, dir) {
  return (
    ' <span class="srt-ind">' +
    '<span class="srt-arr up' +
    (active && dir === "asc" ? ' a' : '') +
    '">▲</span>' +
    '<span class="srt-arr dn' +
    (active && dir === "desc" ? ' a' : '') +
    '">▼</span>' +
    '</span>'
  );
}
function sortableHeader(label, type, key, extraStyle) {
  var active = type === "strategy" ? STRAT_SORT === key : FRF_SORT === key,
    dir = type === "strategy" ? STRAT_SORT_DIR : FRF_SORT_DIR,
    fn = type === "strategy" ? "toggleStrategySort" : "toggleFrfSort";
  return (
    '<button class="srt-h' +
    (active ? ' a' : '') +
    '"' +
    (extraStyle ? ' style="' + extraStyle + '"' : '') +
    ' onclick="event.stopPropagation();' +
    fn +
    '(\'' +
    key +
    '\')">' +
    label +
    sortIndicator(active, dir) +
    '</button>'
  );
}
function toggleStrategySort(key) {
  if (STRAT_SORT === key) STRAT_SORT_DIR = STRAT_SORT_DIR === "desc" ? "asc" : "desc";
  else {
    STRAT_SORT = key;
    STRAT_SORT_DIR = "desc";
  }
  PG_ACT = 1;
  PG_PAST = 1;
  R();
}
function toggleFrfSort(key) {
  if (FRF_SORT === key) FRF_SORT_DIR = FRF_SORT_DIR === "desc" ? "asc" : "desc";
  else {
    FRF_SORT = key;
    FRF_SORT_DIR = "desc";
  }
  PG_FRFO = 1;
  PG_FRFC = 1;
  R();
}
function sortStrategies(arr, isPast) {
  var xs = arr.slice(),
    now = new Date().toISOString(),
    dir = sortDirMul(STRAT_SORT_DIR);
  xs.sort((a, b) => {
    var av = 0,
      bv = 0,
      cmp = 0,
      endA = isPast ? a.endedAt || now : now,
      endB = isPast ? b.endedAt || now : now;
    if (STRAT_SORT === "name") cmp = cmpText(a.name, b.name);
    else if (STRAT_SORT === "invest") cmp = cmpNumber(ci(a), ci(b));
    else if (STRAT_SORT === "rewards") cmp = cmpNumber(tg(a), tg(b));
    else if (STRAT_SORT === "pnl") cmp = cmpNumber(tp(a, false), tp(b, false));
    else if (STRAT_SORT === "apr") {
      av = wa(a, endA);
      bv = wa(b, endB);
      cmp = cmpNumber(av, bv);
    } else if (STRAT_SORT === "runtime") {
      av = db(a.startDate, endA);
      bv = db(b.startDate, endB);
      cmp = cmpNumber(av, bv);
    }
    if (cmp !== 0) return cmp * dir;
    return cmpText(a.name, b.name);
  });
  return xs;
}
function frfAprForSort(p) {
  var end = p.endedAt || new Date().toISOString(),
    dur = db(p.startDate, end),
    cap = posAprCapital(p, FR.positions, FR.exchanges, end),
    funding = frfFundingContribution(p);
  return calcApr(funding - (p.fees || 0), cap, dur);
}
function frfTotalApr(arr) {
  var totalCap = 0,
    totalWeighted = 0;
  (arr || []).forEach((p) => {
    if (!posIncl(p)) return;
    var cap = posCapital(p),
      apr = frfAprForSort(p);
    if (cap > 0 && isFinite(apr)) {
      totalCap += cap;
      totalWeighted += apr * cap;
    }
  });
  return totalCap > 0 ? totalWeighted / totalCap : 0;
}
function sortFrf(arr) {
  var xs = arr.slice(),
    dir = sortDirMul(FRF_SORT_DIR);
  xs.sort((a, b) => {
    var av = 0,
      bv = 0,
      cmp = 0;
    if (FRF_SORT === "token") cmp = cmpText(a.token, b.token);
    else if (FRF_SORT === "type") cmp = cmpText(a.type === "hedge" ? "Hedge" : "FRF", b.type === "hedge" ? "Hedge" : "FRF");
    else if (FRF_SORT === "size") cmp = cmpNumber(posLiveSize(a), posLiveSize(b));
    else if (FRF_SORT === "amount") cmp = cmpNumber(a.tokenAmount, b.tokenAmount);
    else if (FRF_SORT === "pnl") cmp = cmpNumber(posPnl(a), posPnl(b));
    else if (FRF_SORT === "apr") cmp = cmpNumber(frfAprForSort(a), frfAprForSort(b));
    else if (FRF_SORT === "runtime") cmp = cmpNumber(db(a.startDate, a.endedAt || new Date().toISOString()), db(b.startDate, b.endedAt || new Date().toISOString()));
    if (cmp !== 0) return cmp * dir;
    return cmpText(a.token, b.token);
  });
  return xs;
}
function exMargin(ex) {
  return ex.marginHistory.reduce((a, m) => a + m.amount, 0);
}
function exName(id) {
  var e = FR.exchanges.find((x) => x.id === id);
  return e ? normExchangeLabel(e.name) : "Spot";
}
function latestFunding(arr) {
  return arr && arr.length ? arr[arr.length - 1].amount : 0;
}
function posIncl(p) {
  return p.excluded !== true;
}
function runningFunding(p) {
  return (
    frfFundingContribution(p) +
    posFloatingPnl(p)
  );
}
function posLiveSize(p) {
  if (p.useManualPrice && p.manualPrice) return p.tokenAmount * p.manualPrice;
  var pr = PRICES[p.token ? p.token.toUpperCase() : ""];
  if (pr && p.tokenAmount) return p.tokenAmount * pr;
  if (p.tokenAmount && (p.entryPriceShort || p.entryPriceLong)) {
    var ep =
      p.entryPriceShort && p.entryPriceLong
        ? (p.entryPriceShort + p.entryPriceLong) / 2
        : p.entryPriceShort || p.entryPriceLong;
    return p.tokenAmount * ep;
  }
  return p.positionSizeUsd || 0;
}
function posEntrySize(p) {
  var ep =
    p.entryPriceShort && p.entryPriceLong
      ? (p.entryPriceShort + p.entryPriceLong) / 2
      : p.entryPriceShort || p.entryPriceLong || 0;
  return p.tokenAmount ? p.tokenAmount * ep : p.positionSizeUsd || 0;
}
function marginTotalAt(exchange, atIso) {
  var atMs = new Date(atIso).getTime();
  if (!exchange || !Array.isArray(exchange.marginHistory) || !Number.isFinite(atMs)) return 0;
  return exchange.marginHistory.reduce(function (sum, item) {
    var itemMs = new Date(item.date).getTime();
    if (!Number.isFinite(itemMs) || itemMs > atMs) return sum;
    return sum + (parseFloat(item.amount) || 0);
  }, 0);
}
function positionUsesExchange(position, exchangeId) {
  return (
    position.shortExchangeId === exchangeId ||
    (!position.longIsSpot && position.longExchangeId === exchangeId)
  );
}
function positionActiveAt(position, atIso) {
  var atMs = new Date(atIso).getTime(),
    startMs = new Date(position.startDate || 0).getTime(),
    endMs = position.endedAt ? new Date(position.endedAt).getTime() : Infinity;
  if (!Number.isFinite(atMs) || !Number.isFinite(startMs)) return false;
  return startMs <= atMs && atMs < endMs;
}
function posCapitalAt(position, atIso, positions, exchanges) {
  if (!position) return 0;
  var basis = posEntrySize(position) || position.positionSizeUsd || 0;
  if (!(basis > 0)) return 0;
  var cap = 0;
  var exchangeIds = [position.shortExchangeId];
  if (!position.longIsSpot && position.longExchangeId) exchangeIds.push(position.longExchangeId);
  exchangeIds.forEach(function (exchangeId) {
    var exchange = (exchanges || []).find(function (item) {
      return item.id === exchangeId;
    });
    if (!exchange) return;
    var active = (positions || []).filter(function (item) {
      return positionActiveAt(item, atIso) && positionUsesExchange(item, exchangeId);
    });
    var total = active.reduce(function (sum, item) {
      return sum + (posEntrySize(item) || item.positionSizeUsd || 0);
    }, 0);
    if (!(total > 0)) return;
    cap += marginTotalAt(exchange, atIso) * (basis / total);
  });
  return cap || basis;
}
function posAprCapital(position, positions, exchanges, nowIso) {
  if (!position) return 0;
  var startIso = position.startDate || nowIso,
    endIso = position.endedAt || nowIso;
  if (!startIso || !endIso) return posEntrySize(position) || position.positionSizeUsd || 0;
  var startMs = new Date(startIso).getTime(),
    endMs = new Date(endIso).getTime();
  var markers = [startIso, endIso];
  (exchanges || []).forEach(function (exchange) {
    if (!positionUsesExchange(position, exchange.id)) return;
    (exchange.marginHistory || []).forEach(function (entry) {
      var timeMs = new Date(entry.date).getTime();
      if (Number.isFinite(timeMs) && timeMs > startMs && timeMs < endMs) markers.push(entry.date);
    });
  });
  (positions || []).forEach(function (item) {
    if (!positionUsesExchange(item, position.shortExchangeId) && !positionUsesExchange(item, position.longExchangeId)) return;
    var itemStartMs = new Date(item.startDate || 0).getTime();
    var itemEndMs = item.endedAt ? new Date(item.endedAt).getTime() : NaN;
    if (Number.isFinite(itemStartMs) && itemStartMs > startMs && itemStartMs < endMs) markers.push(item.startDate);
    if (Number.isFinite(itemEndMs) && itemEndMs > startMs && itemEndMs < endMs) markers.push(item.endedAt);
  });
  markers = Array.from(new Set(markers)).sort(function (a, b) {
    return new Date(a) - new Date(b);
  });
  var weighted = 0,
    totalDays = 0;
  for (var i = 0; i < markers.length - 1; i++) {
    var segStart = markers[i],
      segEnd = markers[i + 1],
      days = db(segStart, segEnd);
    if (!(days > 0)) continue;
    var midIso = new Date((new Date(segStart).getTime() + new Date(segEnd).getTime()) / 2).toISOString();
    weighted += posCapitalAt(position, midIso, positions, exchanges) * days;
    totalDays += days;
  }
  return totalDays > 0 ? weighted / totalDays : posCapitalAt(position, endIso, positions, exchanges);
}
function posCapital(p) {
  if (p.longIsSpot) return posEntrySize(p) || p.positionSizeUsd || 1;
  var se = FR.exchanges.find((x) => x.id === p.shortExchangeId);
  var le = FR.exchanges.find((x) => x.id === p.longExchangeId);
  var cap = 0;
  if (se) {
    var sm = exMargin(se);
    var sPos = FR.positions.filter(
      (x) =>
        !x.endedAt &&
        (x.shortExchangeId === se.id ||
          (!x.longIsSpot && x.longExchangeId === se.id)),
    );
    var sTotal = sPos.reduce((a, x) => a + posLiveSize(x), 0);
    if (sTotal > 0) cap += sm * (posLiveSize(p) / sTotal);
  }
  if (le && !p.longIsSpot) {
    var lm = exMargin(le);
    var lPos = FR.positions.filter(
      (x) =>
        !x.endedAt &&
        (x.shortExchangeId === le.id ||
          (!x.longIsSpot && x.longExchangeId === le.id)),
    );
    var lTotal = lPos.reduce((a, x) => a + posLiveSize(x), 0);
    if (lTotal > 0) cap += lm * (posLiveSize(p) / lTotal);
  }
  return cap || posEntrySize(p) || p.positionSizeUsd || 1;
}
function roleRank(r) {
  var i = ROLE_ORDER.indexOf((r || "user").toLowerCase());
  return i < 0 ? 0 : i;
}
function hasRole(r, min) {
  return roleRank(r) >= roleRank(min);
}
function canManageMessages() {
  return AUTH.account && hasRole(AUTH.account.role, "support");
}
function canOpenAdmin() {
  return AUTH.account && hasRole(AUTH.account.role, "admin");
}
function canManageRoles() {
  return AUTH.account && hasRole(AUTH.account.role, "admin");
}
function canManageAllRoles() {
  return AUTH.account && hasRole(AUTH.account.role, "owner");
}
function roleBadge(r) {
  var rr = (r || "user").toLowerCase(),
    cls =
      rr === "owner"
        ? "ac"
        : rr === "admin"
          ? "frf"
          : rr === "support"
            ? "hdg"
            : "en";
  return '<span class="bdg ' + cls + '">' + es(rr) + "</span>";
}

function fetchPrices(opts) {
  var rerender = !(opts && opts.skipRender);
  var tokens = {};
  FR.positions.forEach((p) => {
    if (!p.endedAt && p.token) {
      var id = CG_REV[p.token.toUpperCase()] || p.coingeckoId;
      if (id) tokens[p.token.toUpperCase()] = id;
    }
  });
  LO.forEach(function (l) {
    [
      l.collateraltoken,
      l.borrowtoken,
      l.pegreferencetoken || l.pegReferenceToken,
    ].forEach(function (sym) {
      sym = (sym || "").toUpperCase();
      if (sym && CG_REV[sym]) tokens[sym] = CG_REV[sym];
    });
  });
  var modalColl = document
      .getElementById("f-lct")
      ?.value?.trim()
      ?.toUpperCase(),
    modalBorrow = document
      .getElementById("f-lbt")
      ?.value?.trim()
      ?.toUpperCase(),
    modalPegRef = document
      .getElementById("f-lpr")
      ?.value?.trim()
      ?.toUpperCase();
  if (modalColl && CG_REV[modalColl]) tokens[modalColl] = CG_REV[modalColl];
  if (modalBorrow && CG_REV[modalBorrow])
    tokens[modalBorrow] = CG_REV[modalBorrow];
  if (modalPegRef && CG_REV[modalPegRef])
    tokens[modalPegRef] = CG_REV[modalPegRef];
  var symbols = Object.keys(tokens);
  if (!symbols.length) return;
  var binanceLookup = buildBinancePriceLookup(tokens),
    binanceFetch = binanceLookup.requestPairs.length
      ? fetch(
          "https://api.binance.com/api/v3/ticker/price?symbols=" +
            encodeURIComponent(JSON.stringify(binanceLookup.requestPairs)),
        )
          .then(function (r) {
            return r.ok ? r.json() : [];
          })
          .then(function (rows) {
            applyBinancePriceRows(
              binanceLookup.symbolPairs,
              Array.isArray(rows) ? rows : [],
            );
          })
          .catch(function () {})
      : Promise.resolve();
  binanceFetch
    .then(function () {
      return fetchCoinGeckoLoopPrices(tokens);
    })
    .then(function () {
      calcLoopData();
      refreshLoopPegQuotes();
      if (rerender) R();
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function loopTokenDatalist() {
  return (
    '<datalist id="loop-token-options">' +
    LOOP_TOKEN_OPTIONS.map(function (t) {
      return '<option value="' + t + '">' + t + "</option>";
    }).join("") +
    "</datalist>"
  );
}
function loopOracleCfg(kind, token) {
  kind = kind === "borrow" ? "BORROW" : "SUPPLY";
  token = String(token || "")
    .trim()
    .toUpperCase();
  return (LOOP_ORACLE_TOKEN_MAP[kind] || {})[token] || null;
}
function loopRateKind(kind, token) {
  var cfg = loopOracleCfg(kind, token);
  return cfg && cfg.rateKind ? cfg.rateKind : "APR";
}
function apyToApr(v) {
  var n = 365,
    r = (parseFloat(v || 0) || 0) / 100;
  if (r <= -1) return -100;
  return (Math.pow(1 + r, 1 / n) - 1) * n * 100;
}
function normalizeLoopRateToApr(v, kind) {
  var num = parseFloat(v || 0) || 0;
  return kind === "APY" ? apyToApr(num) : num;
}
function loopRateLabel(kind, token) {
  var base = kind === "borrow" ? "Borrow" : "Supply";
  return base + " APR (%)";
}
function updateLoopRateLabels() {
  var ct = document.getElementById("f-lct")?.value || "",
    bt = document.getElementById("f-lbt")?.value || "",
    sl = document.getElementById("f-lsa-lbl"),
    bl = document.getElementById("f-lba-lbl");
  if (sl) sl.textContent = loopRateLabel("supply", ct);
  if (bl) bl.textContent = loopRateLabel("borrow", bt);
}
function loopPegKey(asset, reference) {
  var normRef = String(reference || "").trim().toUpperCase();
  if (normRef === 'WAVAX') normRef = 'AVAX';
  return (
    String(asset || "")
      .trim()
      .toUpperCase() +
    "__" +
    normRef
  );
}
function loopPegMarketPrice(asset, reference) {
  if (String(reference || '').trim().toUpperCase() === 'WAVAX') reference = 'AVAX';
  var assetPx = loopTokenPrice(asset, 0),
    referencePx = loopTokenPrice(reference, 0);
  return assetPx > 0 && referencePx > 0 ? assetPx / referencePx : 0;
}
function shouldFetchLoopPegQuote(asset, reference) {
  if (String(reference || '').trim().toUpperCase() === 'WAVAX') reference = 'AVAX';
  return (
    String(asset || "")
      .trim()
      .toUpperCase() === "SAVAX" &&
    String(reference || "")
      .trim()
      .toUpperCase() === "AVAX"
  );
}
function requestLoopPegQuote(asset, reference, opts) {
  asset = String(asset || "")
    .trim()
    .toUpperCase();
  reference = String(reference || "")
    .trim()
    .toUpperCase();
  if (reference === 'WAVAX') reference = 'AVAX';
  opts = opts || {};
  if (
    !asset ||
    !reference ||
    !AUTH.loggedIn ||
    IS_DEMO ||
    !shouldFetchLoopPegQuote(asset, reference)
  )
    return;
  var key = loopPegKey(asset, reference),
    now = Date.now();
  if (LOOP_PEG_LOADING[key]) return;
  if (LOOP_PEG_NEXT_AT[key] && LOOP_PEG_NEXT_AT[key] > now) return;
  LOOP_PEG_LOADING[key] = true;
  LOOP_PEG_NEXT_AT[key] = now + 300000;
  api(
    "/api/loops/peg-quote?asset=" +
      encodeURIComponent(asset) +
      "&referenceAsset=" +
      encodeURIComponent(reference),
  )
    .then(function (r) {
      if (
        r.status === 200 &&
        r.data &&
        Number.isFinite(parseFloat(r.data.value))
      ) {
        LOOP_PEG_QUOTES[key] = {
          price: parseFloat(r.data.value),
          source: r.data.source || "oracle",
          timestamp: r.data.timestamp || new Date().toISOString(),
        };
        if (opts.updatePreview !== false) updateLoopPegPreview();
        if (opts.rerender) R();
      }
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); })
    .finally(function () {
      LOOP_PEG_LOADING[key] = false;
    });
}
function refreshLoopPegQuotes() {
  var allowRerender = !(M.lcr || M.led);
  LO.forEach(function (l) {
    var asset = (l.collateraltoken || l.collateralToken || "").trim(),
      reference = (
        l.pegreferencetoken ||
        l.pegReferenceToken ||
        l.borrowtoken ||
        l.borrowToken ||
        ""
      ).trim();
    requestLoopPegQuote(asset, reference, {
      rerender: allowRerender,
      updatePreview: false,
    });
    if (String(asset || '').trim().toUpperCase() === 'SAVAX') {
      requestLoopPegQuote(asset, 'AVAX', {
        rerender: allowRerender,
        updatePreview: false,
      });
    }
  });
  var modalAsset = document.getElementById("f-lct")?.value || "",
    modalRef = (
      document.getElementById("f-lpr")?.value ||
      document.getElementById("f-lbt")?.value ||
      ""
    ).trim();
  requestLoopPegQuote(modalAsset, modalRef, {
    rerender: false,
    updatePreview: true,
  });
}
function loopPegInfo(asset, reference, entryPrice) {
  var pairAsset = String(asset || "")
      .trim()
      .toUpperCase(),
    pairReference = String(reference || "")
      .trim()
      .toUpperCase();
  if (pairReference === 'WAVAX') pairReference = 'AVAX';
  if (!pairAsset && !pairReference) return null;
  if (!pairReference && pairAsset === 'SAVAX') pairReference = 'AVAX';
  if (!pairAsset || !pairReference) return null;
  var key = loopPegKey(pairAsset, pairReference),
    cached = LOOP_PEG_QUOTES[key],
    market = loopPegMarketPrice(pairAsset, pairReference),
    current = cached && cached.price > 0 ? cached.price : market,
    entry = Number.isFinite(parseFloat(entryPrice))
      ? parseFloat(entryPrice)
      : 0;
  if (!(current > 0 || entry > 0)) return null;
  var delta = current > 0 && entry > 0 ? current - entry : 0,
    deltaPct =
      current > 0 && entry > 0 && entry !== 0 ? (delta / entry) * 100 : 0,
    source =
      cached && cached.price > 0
        ? cached.source === "benqi-unstake"
          ? "Benqi Unstake"
          : "Oracle"
        : market > 0
          ? "Marktpreis"
          : "Manuell";
  return {
    asset: pairAsset,
    reference: pairReference,
    entry: entry,
    current: current,
    delta: delta,
    deltaPct: deltaPct,
    source: source,
    timestamp: cached && cached.timestamp ? cached.timestamp : null,
  };
}
function fmtPeg(v) {
  return Number(v || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
function renderPegSummary(info) {
  if (!info) return "";
  var currentText =
    info.current > 0
      ? "1 " +
        es(info.asset) +
        " = " +
        fmtPeg(info.current) +
        " " +
        es(info.reference)
      : "—";
  var entryText =
    info.entry > 0
      ? "1 " +
        es(info.asset) +
        " = " +
        fmtPeg(info.entry) +
        " " +
        es(info.reference)
      : "—";
  var setupText =
    info.entry > 0
      ? "Peg beim Aufsetzen = " + fmtPeg(info.entry)
      : "Peg beim Aufsetzen = —";
  var deltaCls = info.delta > 0 ? "g" : info.delta < 0 ? "r" : "";
  var deltaText =
    info.entry > 0 && info.current > 0
      ? (info.delta > 0 ? "+" : "") +
        fmtPeg(info.delta) +
        " / " +
        (info.deltaPct > 0 ? "+" : "") +
        info.deltaPct.toFixed(2) +
        "%"
      : "—";
  return (
    '<div class="peg-box"><div class="peg-grid"><div class="peg-cell"><span class="peg-label">Peg Einstieg</span><span class="peg-value">' +
    entryText +
    '</span></div><div class="peg-cell" style="position:relative;padding-bottom:12px"><span class="peg-label">Aktueller Peg</span><span class="peg-value">' +
    currentText +
    '</span><div style="position:absolute;left:0;right:0;bottom:0;font-size:10px;line-height:1;color:var(--t4)">(' +
    setupText +
    ')</div></div><div class="peg-cell"><span class="peg-label">Delta</span><span class="peg-value ' +
    deltaCls +
    '">' +
    deltaText +
    '</span></div></div><div style="margin-top:8px;font-size:11px;color:var(--t4)">Quelle: ' +
    es(info.source) +
    (info.timestamp ? " • " + es(fd(info.timestamp)) : "") +
    "</div></div>"
  );
}
function updateLoopPegPreview() {
  var asset = document.getElementById("f-lct")?.value || "",
    reference = (
      document.getElementById("f-lpr")?.value ||
      document.getElementById("f-lbt")?.value ||
      ""
    ).trim(),
    entry = parseFloat(document.getElementById("f-lpe")?.value);
  requestLoopPegQuote(asset, reference, {
    rerender: false,
    updatePreview: false,
  });
  var info = loopPegInfo(asset, reference, entry),
    target = document.getElementById("f-lpeg-preview");
  if (target)
    target.innerHTML =
      renderPegSummary(info) ||
      '<div class="hnt">Peg-Vergleich optional: Referenz-Token und Einstiegspreis setzen, um Markt-/Depeg-Deltas live zu sehen.</div>';
}
function fetchLoopOracleDefaults(kind) {
  kind = kind === "borrow" ? "borrow" : "supply";
  var token = (
    document.getElementById(kind === "borrow" ? "f-lbt" : "f-lct")?.value || ""
  ).trim();
  if (!token || IS_DEMO || !AUTH.loggedIn) return;
  var cfg = loopOracleCfg(kind, token);
  if (!cfg) return;
  var reqId = ++LOOP_ORACLE_REQ;
  api(
    "/api/oracle/lookup?asset=" +
      encodeURIComponent(cfg.asset || token) +
      "&protocol=" +
      encodeURIComponent(cfg.protocol) +
      "&type=" +
      encodeURIComponent(cfg.type),
  )
    .then(function (r) {
      if (
        reqId !== LOOP_ORACLE_REQ ||
        r.status !== 200 ||
        !Array.isArray(r.data) ||
        !r.data.length
      )
        return;
      var row = r.data[0],
        input = document.getElementById(kind === "borrow" ? "f-lba" : "f-lsa");
      var aprValue = normalizeLoopRateToApr(
        row && row.value,
        row && row.rateKind
          ? row.rateKind
          : cfg && cfg.rateKind
            ? cfg.rateKind
            : "APR",
      );
      if (input && Number.isFinite(parseFloat(aprValue))) {
        input.value = (Math.round(parseFloat(aprValue) * 100) / 100).toFixed(2);
        calcLoopData();
      }
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}

function api(url, opts = {}) {
  if (
    IS_DEMO &&
    opts.method &&
    opts.method.toUpperCase() !== "GET" &&
    !url.includes("/api/auth")
  ) {
    return Promise.reject(new Error("demo_blocked"));
  }

  opts.headers = opts.headers || {};
  opts.headers["Content-Type"] = "application/json";
  if (PID) opts.headers["x-profile-id"] = PID;
  return fetch(url, opts).then((r) => {
    return r.text().then((text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Fehlerhafte Server-Antwort.");
      }
      if (r.status === 401) {
        AUTH.loggedIn = false;
        R();
        throw new Error("auth");
      }
      if (r.status === 403) {
        alert(data.error || "Zugriff verweigert");
        throw new Error("auth");
      }
      return { status: r.status, data };
    });
  });
}

function F(u, o = {}) {
  if (
    IS_DEMO &&
    o.method &&
    o.method.toUpperCase() !== "GET" &&
    !u.includes("/api/auth")
  ) {
    return Promise.reject(new Error("demo_blocked"));
  }

  o.headers = o.headers || {};
  o.headers["Content-Type"] = "application/json";
  if (PID) o.headers["x-profile-id"] = PID;
  return fetch(u, o).then((r) => {
    if (r.status === 401) {
      AUTH.loggedIn = false;
      R();
      throw new Error("auth");
    }
    if (r.status === 403) {
      alert("Zugriff verweigert");
      throw new Error("auth");
    }
    return r.json();
  });
}

function loadData() {
  api("/api/auth/status")
    .then((res) => {
      AUTH.loggedIn = res.data.loggedIn;
      if (!AUTH.loggedIn) {
        IS_DEMO = true;
        AUTH.account = { email: "demo@defitracker.com" };
        AUTH.profiles = [{ id: "demo_profile", name: "Demo Portfolio" }];
        PID = "demo_profile";
        MSG_SUM = {
          unreadCount: 0,
          importantUnreadCount: 0,
          supportUnreadCount: 0,
        };
        MSG = {
          inbox: [],
          drafts: [],
          history: [],
          users: [],
          stats: { sent30d: 0, direct30d: 0, drafts: 0, avgReadRate: 0 },
          recipients: [],
          selectedId: null,
          selectedAdminId: null,
        };

        restoreUi();
        normUi();
        api("/api/demo-data")
          .then((d) => {
            S = d.data.data || [];
            FR = d.data.frf || { exchanges: [], positions: [] };
            LO = d.data.loops || [];
            U = [];
            R();
            fetchPrices();
          })
          .catch((err) => {
            document.getElementById("app").innerHTML =
              '<div class="emp" style="color:var(--r)">Fehler beim Laden der Demo-Daten: ' +
              err.message +
              "</div>";
          });
        return;
      }

      IS_DEMO = false;
      AUTH.account = res.data.account;
      AUTH.profiles = res.data.profiles || [];
      if (PID && !AUTH.profiles.find((p) => p.id === PID)) PID = null;
      if (!PID && AUTH.profiles.length > 0) PID = AUTH.profiles[0].id;
      if (PID) localStorage.setItem("dv_pid", PID);
      else localStorage.removeItem("dv_pid");

      restoreUi();
      normUi();
      loadMessageSummary();

      if (PID) {
        Promise.all([
          api("/api/strategies"),
          api("/api/frf"),
          api("/api/undo"),
          api("/api/loops"),
        ])
          .then((d) => {
            S = d[0].data || [];
            FR = d[1].data || { exchanges: [], positions: [] };
            U = d[2].data || [];
            LO = d[3].data || [];
            if (V === "admin") loadAdmin();
            else if (V === "messages") loadMessages();
            else R();
            fetchPrices();
          })
          .catch((err) => {
            document.getElementById("app").innerHTML =
              '<div class="emp" style="color:var(--r)">Fehler beim Laden der Profildaten: ' +
              err.message +
              "</div>";
          });
      } else {
        S = [];
        FR = { exchanges: [], positions: [] };
        U = [];
        LO = [];
        if (V === "admin") loadAdmin();
        else if (V === "messages") loadMessages();
        else R();
      }
    })
    .catch((e) => {
      if (e.message !== "auth" && e.message !== "demo_blocked") {
        document.getElementById("app").innerHTML =
          '<div style="padding:40px 20px;text-align:center;color:var(--r)"><b>System-Fehler:</b><br>' +
          e.message +
          "<br><br>Bitte lade die Seite mit <b>Strg + F5</b> neu.</div>";
      }
    });
}

function wakeUi() {
  if (document.hidden) return;
  var now = Date.now();
  if (now - LAST_WAKE_AT < 1200) return;
  LAST_WAKE_AT = now;
  UD = false;
  M.usr = false;
  if (Object.keys(M).length === 0) loadData();
}
function loadLoops() {
  if (!PID || IS_DEMO) {
    LO = [];
    R();
    return;
  }
  api("/api/loops")
    .then((r) => {
      if (r.status === 200) {
        LO = r.data || [];
        if (
          LPI &&
          !LO.find(function (x) {
            return x.id === LPI;
          })
        )
          LPI = null;
        refreshLoopPegQuotes();
        R();
        return;
      }
      alert((r.data && r.data.error) || "Loops konnten nicht geladen werden.");
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function setPid(id) {
  PID = id;
  if (id) localStorage.setItem("dv_pid", id);
  else localStorage.removeItem("dv_pid");
  cm();
  loadData();
}
function logout() {
  api("/api/auth/logout", { method: "POST" }).then(() => {
    PID = null;
    localStorage.removeItem("dv_pid");
    loadData();
  });
}

function hLogin() {
  let e = document.getElementById("l-email").value,
    p = document.getElementById("l-pass").value;
  let rememberMe = !!document.getElementById("l-remember")?.checked;
  fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: e,
      password: p,
      rememberMe: rememberMe,
    }),
  })
    .then((r) => r.json().then((data) => ({ status: r.status, data })))
    .then((r) => {
      if (r.status === 200) {
        VERIFY_EMAIL = "";
        VERIFY_RETRY_AT = 0;
        cm();
        loadData();
        return;
      }
      if (
        r.status === 403 &&
        (r.data.error || "").toLowerCase().includes("verifiziert")
      ) {
        VERIFY_EMAIL = e;
        alert(r.data.error + ". Du kannst die Mail unten erneut senden.");
        R();
        return;
      }
      alert(r.data.error || "Login fehlgeschlagen");
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function hReg() {
  let e = document.getElementById("r-email").value,
    p1 = document.getElementById("r-p1").value,
    p2 = document.getElementById("r-p2").value;
  if (!e || !e.includes('@') || !e.includes('.')) {
    showFieldError('r-email', 'Bitte eine gueltige E-Mail-Adresse eingeben');
    return;
  }
  if (p1.length < 8) {
    showFieldError('r-p1', 'Passwort muss mindestens 8 Zeichen lang sein');
    return;
  }
  if (p1 !== p2) {
    showFieldError('r-p2', 'Passwörter stimmen nicht überein');
    return;
  }
  api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: e, password: p1 }),
  })
    .then((r) => {
      if (r.status === 200) {
        VERIFY_EMAIL = e;
        VERIFY_RETRY_AT = Date.now() + 10000;
        cm();
        M.login = 1;
        alert(
          "Registrierung erfolgreich! Bitte prüfe deine E-Mails für den Bestätigungslink.",
        );
        R();
      } else alert(r.data.error);
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function verifyCooldownText() {
  var ms = Math.max(0, VERIFY_RETRY_AT - Date.now());
  return ms
    ? "Erneut senden (" + Math.ceil(ms / 1000) + "s)"
    : "Registrierungsmail erneut senden";
}
function resendVerifyMail() {
  var emailInput = document.getElementById("l-email");
  if (emailInput && emailInput.value.trim())
    VERIFY_EMAIL = emailInput.value.trim();
  if (!VERIFY_EMAIL) return alert("Bitte gib zuerst deine E-Mail ein.");
  if (Date.now() < VERIFY_RETRY_AT) return R();
  fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: VERIFY_EMAIL }),
  })
    .then((r) => r.json().then((data) => ({ status: r.status, data })))
    .then((r) => {
      if (r.status === 200) {
        VERIFY_RETRY_AT = Date.now() + (r.data.retryAfterMs || 10000);
        alert("Bestätigungsmail wurde erneut gesendet.");
        R();
        return;
      }
      if (r.status === 429) {
        VERIFY_RETRY_AT = Date.now() + (r.data.retryAfterMs || 10000);
        R();
        return;
      }
      alert(r.data.error || "Versand fehlgeschlagen");
    })
    .catch(() => alert("Versand fehlgeschlagen"));
}

function dBack() {
  api("/api/backup").then((r) => {
    let blob = new Blob([JSON.stringify(r.data)], {
      type: "application/json",
    });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "DeFi_Vault_Backup_" + es(r.data.profileName) + ".json";
    a.click();
  });
}
function rBack() {
  let input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    let file = e.target.files[0];
    let reader = new FileReader();
    reader.onload = (event) => {
      try {
        let json = JSON.parse(event.target.result);
        api("/api/backup/restore", {
          method: "POST",
          body: JSON.stringify({ data: json.data, frf: json.frf }),
        }).then(() => loadData());
      } catch (err) {
        alert("Fehler beim Lesen der Datei!");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function hNewProf() {
  let n = document.getElementById("p-name").value;
  if (!validateFields([
    { id: 'p-name', test: function(v){ return v.trim().length > 0; }, msg: 'Profilname erforderlich' }
  ])) return;
  api("/api/profiles", {
    method: "POST",
    body: JSON.stringify({ name: n }),
  }).then((r) => {
    setPid(r.data.id);
  });
}
function delProf(id) {
  if (!confirm("Profil und alle zugehörigen Strategien wirklich löschen?"))
    return;
  api("/api/profiles/" + id, { method: "DELETE" }).then(() => {
    if (PID === id) setPid(null);
    else loadData();
  });
}

var ADM_SORT = "newest",
  ADM_SEARCH = "";

function loadAdmin() {
  Promise.all([api("/api/admin/accounts"), api("/api/admin/features")]).then(
    (r) => {
      M.accs = r[0].data;
      M.admFeat = r[1].data;
      R();
    },
  );
}
function adminTgl(id) {
  if (!confirm("Account Sperr-Status wirklich ändern?")) return;
  api("/api/admin/accounts/" + id + "/toggle-block", {
    method: "PUT",
  }).then(() => {
    M.adet = null;
    loadAdmin();
  });
}
function adminFeatTgl(id, status) {
  api("/api/admin/features/" + id + "/status", {
    method: "PUT",
    body: JSON.stringify({ status: status }),
  }).then(() => {
    loadAdmin();
  });
}
function adminDel(id) {
  if (
    !confirm(
      "ACHTUNG: Account und ALLE zugehörigen Daten unwiderruflich löschen?",
    )
  )
    return;
  api("/api/admin/accounts/" + id, { method: "DELETE" }).then(() => {
    M.adet = null;
    loadAdmin();
  });
}
function adminRole(id, role) {
  api("/api/admin/accounts/" + id + "/role", {
    method: "PUT",
    body: JSON.stringify({ role: role }),
  })
    .then((r) => {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) || "Rolle konnte nicht geändert werden.",
        );
        return;
      }
      if (M.adet && M.adet.acc && M.adet.acc.id === id) M.adet.acc.role = role;
      loadAdmin();
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}

var FEAT = [];
window.FEAT_META = { canVoteGlobally: true, nextReset: "" };
function loadFeatures() {
  if (!AUTH.loggedIn) return;
  api("/api/features").then((r) => {
    FEAT = r.data.list || [];
    window.FEAT_META = {
      canVoteGlobally: r.data.canVoteGlobally,
      nextReset: r.data.nextReset,
      used: r.data.weeklyVotesUsed,
    };
    R();
  });
}
function hSupport() {
  let t = document.getElementById("s-title").value,
    m = document.getElementById("s-msg").value;
  if (!validateFields([
    { id: 's-title', test: function(v){ return v.trim().length > 0; }, msg: 'Titel erforderlich' },
    { id: 's-msg', test: function(v){ return v.trim().length > 0; }, msg: 'Nachricht erforderlich' }
  ])) return;
  let btn = document.getElementById("s-btn");
  btn.disabled = true;
  btn.innerText = "Sende...";
  api("/api/support", {
    method: "POST",
    body: JSON.stringify({ title: t, message: m }),
  }).then((r) => {
    if (r.status === 200) {
      alert("Nachricht erfolgreich an den Support gesendet!");
      document.getElementById("s-title").value = "";
      document.getElementById("s-msg").value = "";
    } else alert("Fehler beim Senden.");
    btn.disabled = false;
    btn.innerText = "Senden";
  });
}

function loopPayloadFromForm() {
  var ct = document.getElementById("f-lct").value.trim(),
    bt = document.getElementById("f-lbt").value.trim();
  var d = document.getElementById("f-ld").value,
    t = document.getElementById("f-lt").value || "00:00";
  var cb = parseFloat(document.getElementById("f-lcb").value),
    cp = parseFloat(document.getElementById("f-lcp").value);
  var csm = parseFloat(document.getElementById("f-lcsm").value),
    sa = parseFloat(document.getElementById("f-lsa").value);
  var ba = parseFloat(document.getElementById("f-lba").value),
    ce = parseFloat(document.getElementById("f-lce").value),
    be = parseFloat(document.getElementById("f-lbe").value);
  var pegReferenceToken = (document.getElementById("f-lpr").value || bt).trim(),
    pegEntryPrice = parseFloat(document.getElementById("f-lpe").value),
    notes = document.getElementById("f-lno").value || "";
  if (!ct || !bt || !cb || !csm || isNaN(sa) || isNaN(ba)) return null;
  var startDate = d
    ? new Date(d + "T" + t).toISOString()
    : new Date().toISOString();
  var endColl = isNaN(ce) ? csm : ce;
  var endBorrow = isNaN(be) ? 0 : be;
  var totals = calculateLoopingTotals({
    collateralToken: ct,
    borrowToken: bt,
    startCollateral: cb,
    collateralPrice: cp,
    startCollateralAmount: csm,
    endCollateralAmount: endColl,
    supplyApy: sa,
    borrowApy: ba,
    endBorrowedAmount: endBorrow,
  });
  if (!totals.price || !totals.leverage) return null;
  return {
    name: ct + " / " + bt,
    startDate: startDate,
    collateralToken: ct,
    borrowToken: bt,
    startCollateral: cb,
    collateralPrice: totals.price,
    startCollateralAmount: csm,
    supplyApy: sa,
    borrowedAmount: endBorrow,
    borrowApy: ba,
    endCollateralAmount: endColl,
    endBorrowedAmount: endBorrow,
    leverage: totals.leverage,
    notes: notes.trim(),
    pegReferenceToken: pegReferenceToken,
    pegEntryPrice: Number.isFinite(pegEntryPrice) ? pegEntryPrice : null,
  };
}
function loopTokenPrice(sym, fallback) {
  var key = (sym || "").toUpperCase(),
    px = parseFloat(PRICES[key] || 0),
    fb = parseFloat(fallback || 0);
  if (px > 0) return px;
  if (STABLE_PRICES[key]) return STABLE_PRICES[key];
  return fb > 0 ? fb : 0;
}
function calculateLoopingTotals(l) {
  var equity = parseFloat(l.startCollateral || l.startcollateral || 0),
    startCollatAmt = parseFloat(
      l.startCollateralAmount || l.startcollateralamount || 0,
    ),
    collatAmtInput = parseFloat(
      l.endCollateralAmount ||
        l.endcollateralamount ||
        l.startCollateralAmount ||
        l.startcollateralamount ||
        0,
    ),
    borrowTokenAmtInput =
      parseFloat(
        l.endBorrowedAmount ||
          l.endborrowedamount ||
          l.borrowedAmount ||
          l.borrowedamount ||
          0,
      ) || 0,
    collToken = l.collateralToken || l.collateraltoken || "",
    borrowToken = l.borrowToken || l.borrowtoken || "",
    levInput = parseFloat(l.leverage || 0) || 0,
    collPrice = loopTokenPrice(
      collToken,
      l.collateralPrice || l.collateralprice,
    ),
    sup = Math.abs(parseFloat(l.supplyApy || l.supplyapy || 0) || 0),
    bor = Math.abs(parseFloat(l.borrowApy || l.borrowapy || 0) || 0),
    borrowPrice = loopTokenPrice(
      borrowToken,
      borrowToken &&
        borrowToken.toUpperCase() === (collToken || "").toUpperCase()
        ? collPrice
        : 0,
    ),
    collatAmt = collatAmtInput > 0 ? collatAmtInput : 0,
    borrowTokenAmt = borrowTokenAmtInput > 0 ? borrowTokenAmtInput : 0,
    supplyUsd = collPrice > 0 && collatAmt > 0 ? collatAmt * collPrice : 0,
    borrowUsd =
      borrowPrice > 0 && borrowTokenAmt > 0 ? borrowTokenAmt * borrowPrice : 0;
  if (!(supplyUsd > 0) && equity > 0 && levInput > 0)
    supplyUsd = equity * Math.max(levInput, 1);
  if (!(collatAmt > 0) && collPrice > 0 && supplyUsd > 0)
    collatAmt = supplyUsd / collPrice;
  if (!(borrowUsd > 0) && equity > 0 && levInput > 1)
    borrowUsd = equity * (levInput - 1);
  if (!(borrowTokenAmt > 0) && borrowPrice > 0 && borrowUsd > 0)
    borrowTokenAmt = borrowUsd / borrowPrice;
  var lev =
      startCollatAmt > 0 && collatAmt > 0
        ? collatAmt / startCollatAmt
        : equity > 0 && supplyUsd > 0
          ? supplyUsd / equity
          : equity > 0 && borrowUsd > 0
            ? 1 + borrowUsd / equity
            : levInput > 0
              ? levInput
              : 1,
    netApr = Math.max(lev, 1) * sup - Math.max(Math.max(lev, 1) - 1, 0) * bor;
  return {
    equity: equity,
    price: collPrice,
    borrowPrice: borrowPrice,
    collateralAmount: collatAmt,
    supplyUsd: supplyUsd,
    borrowUsd: borrowUsd,
    borrowTokenAmount: borrowTokenAmt,
    leverage: Math.max(lev, 1),
    netApr: netApr,
    supplyRateApr: sup,
    borrowRateApr: bor,
    supplyRateInput: sup,
    borrowRateInput: bor,
    supplyRateKind: "APR",
    borrowRateKind: "APR",
  };
}
function loopSupplyValue(l) {
  return calculateLoopingTotals(l).supplyUsd;
}
function loopBorrowValue(l) {
  return calculateLoopingTotals(l).borrowUsd;
}
function loopBorrowTokenAmount(l) {
  return calculateLoopingTotals(l).borrowTokenAmount;
}
function loopLeverage(l) {
  return calculateLoopingTotals(l).leverage;
}
function loopCurrentRateSummary(startAmount, currentAmount, runtimeDays, invert) {
  var start = parseFloat(startAmount || 0),
    current = parseFloat(currentAmount || 0),
    days = parseFloat(runtimeDays || 0);
  if (!(start > 0) || !(current > 0)) return { nowPct: null, avgPct: null };
  var nowPct = ((current - start) / start) * 100;
  if (invert) nowPct = -nowPct;
  var avgPct = days > 0 ? (nowPct / days) * 365 : null;
  return { nowPct: nowPct, avgPct: avgPct };
}
function loopAnnualizedRateFromChange(startValue, currentValue, runtimeDays) {
  var start = parseFloat(startValue || 0),
    current = parseFloat(currentValue || 0),
    days = parseFloat(runtimeDays || 0);
  if (!(start > 0) || !(current > 0) || !(days > 0.01)) return null;
  return (((current - start) / start) * 100 / days) * 365;
}
function loopHasManualCurrentAmounts(loop) {
  return !!(loop && (loop.currentamountsupdatedat || loop.currentAmountsUpdatedAt));
}
function loopSupplyAprSinceStart(loop, runtimeDays) {
  var asset = String((loop && (loop.collateraltoken || loop.collateralToken)) || '')
    .trim()
    .toUpperCase();
  if (asset !== 'SAVAX') return null;
  var startPeg = parseFloat((loop && (loop.supplypegstart || loop.supplyPegStart)) || 0);
  if (!(startPeg > 0)) return null;
  var info = typeof loopPegInfo === 'function' ? loopPegInfo('SAVAX', 'AVAX', startPeg) : null,
    source = String((info && info.source) || '').toLowerCase();
  if (!info || !(parseFloat(info.current) > 0)) return null;
  if (source && source.indexOf('benqi') === -1) return null;
  var aprPct = loopAnnualizedRateFromChange(startPeg, info.current, runtimeDays);
  if (aprPct === null) return null;
  return { aprPct: aprPct, source: 'benqi-peg' };
}
function loopBorrowAprSinceStart(loop, runtimeDays) {
  var startBorrow = parseFloat(
      (loop && (loop.endborrowedamount || loop.endBorrowedAmount || loop.borrowedamount || loop.borrowedAmount)) || 0,
    ),
    currentBorrow = parseFloat(
      (loop && (loop.currentborrowedamount || loop.currentBorrowedAmount || loop.endborrowedamount || loop.endBorrowedAmount)) || 0,
    );
  if (loopHasManualCurrentAmounts(loop)) {
    var realizedApr = loopAnnualizedRateFromChange(startBorrow, currentBorrow, runtimeDays);
    if (realizedApr !== null) return { aprPct: -Math.abs(realizedApr), source: 'current-amounts' };
  }
  var avgBorrowApr = parseFloat(
    (loop && (loop.avgborrowapr || loop.avgBorrowApr || loop.borrowapy || loop.borrowApy)) || 0,
  );
  if (!Number.isFinite(avgBorrowApr)) return null;
  return { aprPct: -Math.abs(avgBorrowApr), source: 'snapshot-average' };
}
function loopAprSinceStartSummary(loop, runtimeDays) {
  var supply = loopSupplyAprSinceStart(loop, runtimeDays),
    borrow = loopBorrowAprSinceStart(loop, runtimeDays);
  if (!supply || !borrow) {
    return {
      available: false,
      netApr: null,
      supplyApr: supply ? supply.aprPct : null,
      borrowApr: borrow ? borrow.aprPct : null,
      supplySource: supply ? supply.source : null,
      borrowSource: borrow ? borrow.source : null,
    };
  }
  var leverage = Math.max(parseFloat((loop && loop.leverage) || 0) || 1, 1),
    leveragedBorrow = Math.max(leverage - 1, 0),
    netApr = leverage * supply.aprPct + leveragedBorrow * borrow.aprPct;
  return {
    available: true,
    netApr: netApr,
    supplyApr: supply.aprPct,
    borrowApr: borrow.aprPct,
    supplySource: supply.source,
    borrowSource: borrow.source,
  };
}
function fmtSinceStartApr(value) {
  var numericValue = parseFloat(value);
  if (!Number.isFinite(numericValue)) return '—';
  return (numericValue > 0 ? '+' : '') + numericValue.toFixed(2) + '% APR';
}
function fmtLoopRateSummary(summary) {
  if (!summary || summary.avgPct === null)
    return 'avr. —';
  var avgText = (summary.avgPct >= 0 ? '+' : '') + summary.avgPct.toFixed(2) + '%';
  return 'avr. ' + avgText;
}
function loopNetApr(l) {
  return calculateLoopingTotals(l).netApr;
}
function calcLoopData() {
  var cb = parseFloat(document.getElementById("f-lcb")?.value) || 0,
    sa = parseFloat(document.getElementById("f-lsa")?.value) || 0,
    ba = parseFloat(document.getElementById("f-lba")?.value) || 0,
    csm = parseFloat(document.getElementById("f-lcsm")?.value) || 0,
    ce = parseFloat(document.getElementById("f-lce")?.value),
    be = parseFloat(document.getElementById("f-lbe")?.value),
    ct = document.getElementById("f-lct")?.value?.trim() || "",
    bt = document.getElementById("f-lbt")?.value?.trim() || "",
    cpEl = document.getElementById("f-lcp");
  updateLoopRateLabels();
  calculateLoopingTotals({
    collateralToken: ct,
    borrowToken: bt,
    startCollateral: cb,
    collateralPrice: parseFloat((cpEl && cpEl.value) || 0),
    startCollateralAmount: csm,
    endCollateralAmount: isNaN(ce) ? csm : ce,
    endBorrowedAmount: isNaN(be) ? 0 : be,
    supplyApy: sa,
    borrowApy: ba,
  });
  updateLoopPegPreview();
}
function hLoopCr() {
  var payload = loopPayloadFromForm();
  if (!payload) {
    var loopErrors = [
      { id: 'f-lct', test: function(v){ return v.trim().length > 0; }, msg: 'Supply Token erforderlich' },
      { id: 'f-lbt', test: function(v){ return v.trim().length > 0; }, msg: 'Borrow Token erforderlich' },
      { id: 'f-lcb', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }, msg: 'Start Invest erforderlich' },
      { id: 'f-lcsm', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }, msg: 'Start Tokenmenge erforderlich' },
      { id: 'f-lsa', test: function(v){ return !isNaN(parseFloat(v)); }, msg: 'Supply APR erforderlich' },
      { id: 'f-lba', test: function(v){ return !isNaN(parseFloat(v)); }, msg: 'Borrow APR erforderlich' }
    ];
    validateFields(loopErrors);
    return;
  }
  cm();
  api("/api/loops", { method: "POST", body: JSON.stringify(payload) })
    .then(function (r) {
      if (r.status !== 200) {
        alert((r.data && r.data.error) || "Loop konnte nicht erstellt werden.");
        return;
      }
      LO.unshift({
        id: r.data.id,
        name: payload.name,
        startdate: payload.startDate,
        collateraltoken: payload.collateralToken,
        borrowtoken: payload.borrowToken,
        startcollateral: payload.startCollateral,
        collateralprice: payload.collateralPrice,
        startcollateralamount: payload.startCollateralAmount,
        supplyapy: payload.supplyApy,
        borrowapy: payload.borrowApy,
        borrowedamount: payload.borrowedAmount,
        endcollateralamount: payload.endCollateralAmount,
        endborrowedamount: payload.endBorrowedAmount,
        leverage: payload.leverage,
        status: "active",
        notes: payload.notes || "",
        pegreferencetoken: payload.pegReferenceToken || "",
        pegentryprice: payload.pegEntryPrice,
      });
      R();
      loadLoops();
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function openLoopDetail(id) {
  var l = LO.find(function (x) {
    return x.id === id;
  });
  if (!l) return;
  if (LOOPV === 'open') {
    LPI = LPI === id ? null : id;
    R();
    return;
  }
  LPI = id;
  R();
}
function renderLoopDetailPanel(selLoop, nw, inline) {
  var selTot = calculateLoopingTotals(selLoop),
    startSupplyAmount = parseFloat(selLoop.startcollateralamount || selLoop.startCollateralAmount || 0) || 0,
    postLoopSupplyAmount = parseFloat(selLoop.endcollateralamount || selLoop.endCollateralAmount || selTot.collateralAmount || 0) || 0,
    postLoopBorrowAmount = parseFloat(selLoop.endborrowedamount || selLoop.endBorrowedAmount || selLoop.borrowedamount || selLoop.borrowedAmount || selTot.borrowTokenAmount || 0) || 0,
    currentSupplyAmount = parseFloat(selLoop.currentcollateralamount || selLoop.currentCollateralAmount || postLoopSupplyAmount || 0) || 0,
    currentBorrowAmount = parseFloat(selLoop.currentborrowedamount || selLoop.currentBorrowedAmount || postLoopBorrowAmount || 0) || 0,
    startSupplyUsd = parseFloat(selLoop.startcollateral || selLoop.startCollateral || 0) || 0,
    postLoopSupplyUsd = selTot.borrowPrice > 0 && postLoopSupplyAmount > 0 && selTot.price > 0 ? postLoopSupplyAmount * selTot.price : selTot.supplyUsd,
    postLoopBorrowUsd = selTot.borrowPrice > 0 && postLoopBorrowAmount > 0 ? postLoopBorrowAmount * selTot.borrowPrice : selTot.borrowUsd,
    selPeg = loopPegInfo(
      selLoop.collateraltoken || selLoop.collateralToken,
      selLoop.pegreferencetoken ||
        selLoop.pegReferenceToken ||
        selLoop.borrowtoken ||
      selLoop.borrowToken,
      selLoop.pegentryprice || selLoop.pegEntryPrice,
    ),
    selRuntime = db(selLoop.startdate, selLoop.enddate || selLoop.endDate || nw),
    supplyNow = loopCurrentRateSummary(
      selLoop.endcollateralamount || selLoop.endCollateralAmount || selLoop.startcollateralamount || selLoop.startCollateralAmount,
      selLoop.currentcollateralamount || selLoop.currentCollateralAmount || selLoop.endcollateralamount || selLoop.endCollateralAmount || selLoop.startcollateralamount || selLoop.startCollateralAmount,
      selRuntime,
      false,
    ),
    borrowNow = loopCurrentRateSummary(
      selLoop.endborrowedamount || selLoop.endBorrowedAmount || selLoop.borrowedamount || selLoop.borrowedAmount,
      selLoop.currentborrowedamount || selLoop.currentBorrowedAmount || selLoop.endborrowedamount || selLoop.endBorrowedAmount || selLoop.borrowedamount || selLoop.borrowedAmount,
      selRuntime,
      true,
    ),
    sinceStartApr =
      typeof loopAprSinceStartSummary === 'function'
        ? loopAprSinceStartSummary(selLoop, selRuntime)
        : { available: false, netApr: null, supplySource: null, borrowSource: null },
    supplySinceStart =
      typeof loopSupplyAprSinceStart === 'function'
        ? loopSupplyAprSinceStart(selLoop, selRuntime)
        : null,
    borrowSinceStart =
      typeof loopBorrowAprSinceStart === 'function'
        ? loopBorrowAprSinceStart(selLoop, selRuntime)
        : null,
    selStatus = selLoop.status || 'active',
    h = '';
  if (!inline)
    h += '<button class="bt bk" onclick="LPI=null;V=\'looping\';R()">← Zurück</button>';
  h +=
    '<div class="' +
    (inline ? 'ibx' : 'loop-detail') +
    '" style="' +
    (inline ? 'margin-top:12px;padding:16px;border:1px solid var(--bd);border-radius:12px;background:var(--bg2)' : 'margin-top:18px') +
    '"' +
    (inline ? ' onclick="openLoopDetail(\'' + selLoop.id + '\')"' : '') +
    '><div class="dhd" style="' +
    (inline ? 'margin-top:0' : 'margin-top:18px') +
    '"><div><div class="dhn">' +
    es(selLoop.name || 'Loop') +
    '</div><span class="bdg ' +
    (selStatus === 'closed' ? 'en' : 'ac') +
    '">' +
    es(selStatus) +
    '</span><div style="font-size:12px;color:var(--t3);margin-top:6px">Startmenge: ' +
    fn(startSupplyAmount) +
    ' ' +
    es(selLoop.collateraltoken || '') +
    '</div></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"><span class="bdg ac" style="font-size:13px;padding:5px 10px">Hebel: ' +
    selTot.leverage.toFixed(2) +
    'x</span><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><div class="dha" style="font-size:20px;color:' +
    (sinceStartApr.available && sinceStartApr.netApr > 0
      ? 'var(--g)'
      : sinceStartApr.available && sinceStartApr.netApr < 0
        ? 'var(--r)'
        : 'var(--t3)') +
    ';text-align:right">' +
    (sinceStartApr.available && sinceStartApr.netApr !== null
      ? (sinceStartApr.netApr > 0 ? '+' : '') + sinceStartApr.netApr.toFixed(2) + '%'
      : '—') +
    ' <span class="u">APR seit Aufsetzen</span></div><div style="font-size:12px;color:' +
    (selTot.netApr > 0 ? 'var(--g)' : selTot.netApr < 0 ? 'var(--r)' : 'var(--t3)') +
    ';text-align:right">' +
    (selTot.netApr > 0 ? '+' : '') +
    selTot.netApr.toFixed(2) +
    '% <span class="u">Gehebelte Live APR</span></div></div></div></div>';
  h +=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px"><div style="background:var(--g-bg);padding:12px;border-radius:8px;border:1px solid var(--g);text-align:center"><div style="font-size:10px;color:var(--g);text-transform:uppercase">Supply</div><div style="font-size:15px;font-weight:600;color:var(--t);margin-top:4px">' +
    fn(postLoopSupplyAmount) +
    ' ' +
    es(selLoop.collateraltoken || '') +
    '</div><div style="font-size:11px;color:var(--t3);margin-top:4px">Wert: ' +
    fn(postLoopSupplyUsd) +
    ' USDC</div><div style="font-size:12px;font-weight:600;color:' +
    (selTot.supplyRateApr > 0 ? 'var(--g)' : selTot.supplyRateApr < 0 ? 'var(--r)' : 'var(--t2)') +
    ';margin-top:8px;text-align:center">' +
    (selTot.supplyRateApr > 0 ? '+' : '') +
    selTot.supplyRateApr.toFixed(2) +
    '% APR</div><div style="font-size:11px;color:var(--t3);margin-top:4px;text-align:center">now: ' +
    (selTot.supplyRateApr > 0 ? '+' : '') +
    selTot.supplyRateApr.toFixed(2) +
    '% APR / avr.: ' +
    fmtSinceStartApr(supplySinceStart && supplySinceStart.aprPct) +
    '</div><div class="fg" style="margin-top:10px;text-align:left" onclick="event.stopPropagation()"><label>Aktuelle Supply-Menge</label><input id="loop-cur-supply-' +
    selLoop.id +
    '" type="number" step="any" value="' +
    es(selLoop.currentcollateralamount || selLoop.currentCollateralAmount || selLoop.endcollateralamount || selLoop.endCollateralAmount || selLoop.startcollateralamount || selLoop.startCollateralAmount || '') +
    '"></div></div><div style="background:var(--r-bg);padding:12px;border-radius:8px;border:1px solid var(--r);text-align:center"><div style="font-size:10px;color:var(--r);text-transform:uppercase">Borrow</div><div style="font-size:15px;font-weight:600;color:var(--t);margin-top:4px">' +
    fn(postLoopBorrowAmount) +
    ' ' +
    es(selLoop.borrowtoken || '') +
    '</div><div style="font-size:11px;color:var(--t3);margin-top:4px">Wert: ' +
    fn(postLoopBorrowUsd) +
    ' USDC</div><div style="font-size:12px;font-weight:600;color:' +
    (selTot.borrowRateApr > 0 ? 'var(--r)' : 'var(--t2)') +
    ';margin-top:8px;text-align:center">' +
    (selTot.borrowRateApr > 0 ? '-' : '') +
    selTot.borrowRateApr.toFixed(2) +
    '% APR</div><div style="font-size:11px;color:var(--t3);margin-top:4px;text-align:center">now: -' +
    selTot.borrowRateApr.toFixed(2) +
    '% APR / avr.: ' +
    fmtSinceStartApr(borrowSinceStart && borrowSinceStart.aprPct) +
    '</div><div class="fg" style="margin-top:10px;text-align:left" onclick="event.stopPropagation()"><label>Aktuelle Borrow-Menge</label><input id="loop-cur-borrow-' +
    selLoop.id +
    '" type="number" step="any" value="' +
    es(selLoop.currentborrowedamount || selLoop.currentBorrowedAmount || selLoop.endborrowedamount || selLoop.endBorrowedAmount || selLoop.borrowedamount || selLoop.borrowedAmount || '') +
    '"></div></div></div><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="bt by bs" onclick="event.stopPropagation();saveLoopCurrentAmounts(\'' +
    selLoop.id +
    '\')">Aktuelle Mengen speichern</button></div>';
  h += '<div style="margin-top:18px">' + (renderPegSummary(selPeg) || '<div class="peg-box"><div class="peg-grid"><div class="peg-cell"><span class="peg-label">Peg Einstieg</span><span class="peg-value">—</span></div><div class="peg-cell"><span class="peg-label">Aktueller Peg</span><span class="peg-value">—</span></div><div class="peg-cell"><span class="peg-label">Delta</span><span class="peg-value">—</span></div></div><div style="margin-top:8px;font-size:11px;color:var(--t4)">Noch kein Peg-Einstieg gesetzt. Du kannst ihn im Bearbeiten-Dialog manuell eintragen.</div></div>') + '</div>';
  if (selLoop.notes)
    h += '<div class="ibx" style="margin-top:18px"><div class="sh" style="margin:0 0 10px"><h3 class="st">Notiz</h3></div><div class="loop-note">' + es(selLoop.notes) + '</div></div>';
  h +=
    '<div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap">' +
    (selStatus === 'closed'
      ? '<button class="bt bb" onclick="event.stopPropagation();openLoopEdit(\'' + selLoop.id + '\')">Bearbeiten</button>'
      : '<button class="bt bb" onclick="event.stopPropagation();openLoopEdit(\'' + selLoop.id + '\')">Bearbeiten</button><button class="bt be" onclick="event.stopPropagation();closeLoop(\'' + selLoop.id + '\')">Schließen</button>') +
    '</div></div>';
  return h;
}
function openLoopEdit(id) {
  var l = LO.find(function (x) {
    return x.id === id;
  });
  if (!l) return;
  M.led = l;
  M.lpm = 0;
  R();
}
function hLoopUpd() {
  if (!M.led || !M.led.id) return;
  var id = M.led.id;
  var payload = loopPayloadFromForm();
  if (!payload) {
    var loopErrors = [
      { id: 'f-lct', test: function(v){ return v.trim().length > 0; }, msg: 'Supply Token erforderlich' },
      { id: 'f-lbt', test: function(v){ return v.trim().length > 0; }, msg: 'Borrow Token erforderlich' },
      { id: 'f-lcb', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }, msg: 'Start Invest erforderlich' },
      { id: 'f-lcsm', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }, msg: 'Start Tokenmenge erforderlich' },
      { id: 'f-lsa', test: function(v){ return !isNaN(parseFloat(v)); }, msg: 'Supply APR erforderlich' },
      { id: 'f-lba', test: function(v){ return !isNaN(parseFloat(v)); }, msg: 'Borrow APR erforderlich' }
    ];
    validateFields(loopErrors);
    return;
  }
  cm();
  api("/api/loops/" + id, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
    .then(function (r) {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) || "Loop konnte nicht gespeichert werden.",
        );
        return;
      }
      loadLoops();
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function saveLoopCurrentAmounts(id) {
  var loop = LO.find(function (x) {
    return x.id === id;
  });
  if (!loop) return;
  var supplyId = 'loop-cur-supply-' + id,
    borrowId = 'loop-cur-borrow-' + id,
    supplyValue = parseFloat(document.getElementById(supplyId)?.value),
    borrowValue = parseFloat(document.getElementById(borrowId)?.value);
  if (!Number.isFinite(supplyValue) || !(supplyValue > 0)) {
    return showFieldError(supplyId, 'Aktuelle Supply-Menge erforderlich');
  }
  if (!Number.isFinite(borrowValue) || borrowValue < 0) {
    return showFieldError(borrowId, 'Aktuelle Borrow-Menge erforderlich');
  }
  api('/api/loops/' + id, {
    method: 'PUT',
    body: JSON.stringify({
      currentCollateralAmount: supplyValue,
      currentBorrowedAmount: borrowValue,
    }),
  }).then(function (r) {
    if (r.status !== 200) {
      alert((r.data && r.data.error) || 'Loop konnte nicht gespeichert werden.');
      return;
    }
    loadLoops();
  }).catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function closeLoop(id) {
  var l = LO.find(function (x) {
    return x.id === id;
  });
  if (!l || !confirm("Loop wirklich schließen?")) return;
  var totals = calculateLoopingTotals(l);
  api("/api/loops/" + id + "/close", {
    method: "POST",
    body: JSON.stringify({
      endDate: new Date().toISOString(),
      endCollateralAmount: totals.collateralAmount,
      endBorrowedAmount: totals.borrowTokenAmount,
    }),
  }).then(() => {
    loadLoops();
  });
}
function updateLoopName() {
  var ct = document.getElementById("f-lct")?.value || "",
    bt = document.getElementById("f-lbt")?.value || "";
  var nameEl = document.getElementById("f-ln-auto"),
    refEl = document.getElementById("f-lpr");
  if (ct && bt) {
    nameEl.textContent = ct + " / " + bt;
    nameEl.style.color = "var(--g)";
  } else {
    nameEl.textContent = "Collateral Token / Borrow Token";
    nameEl.style.color = "var(--t4)";
  }
  if (refEl && !refEl.value && bt) refEl.value = bt;
  updateLoopRateLabels();
  updateLoopPegPreview();
}
function renderLoopModal(le, isEdit) {
  var sd = isEdit ? le.startdate || "" : "";
  var vCb = isEdit ? le.startcollateral || "" : "",
    vCt = isEdit ? le.collateraltoken || "" : "",
    vCsm = isEdit ? le.startcollateralamount || "" : "",
    vCp = isEdit ? le.collateralprice || "" : "",
    vSa = isEdit ? le.supplyapy || "" : "",
    vBt = isEdit ? le.borrowtoken || "" : "",
    vBa = isEdit ? le.borrowapy || le.borrowapr || "" : "",
    vCe = isEdit ? le.endcollateralamount || "" : "",
    vBe = isEdit ? le.endborrowedamount || le.borrowedamount || "" : "";
  var vNotes = isEdit ? le.notes || "" : "",
    vPegRef = isEdit
      ? le.pegreferencetoken || le.pegReferenceToken || le.borrowtoken || ""
      : vBt || "",
    vPegEntry = isEdit ? le.pegentryprice || le.pegEntryPrice || "" : "";
  var pegPreview =
    renderPegSummary(loopPegInfo(vCt, vPegRef, vPegEntry)) ||
    '<div class="hnt">Peg-Vergleich optional: Referenz-Token und Einstiegspreis setzen, um Markt-/Depeg-Deltas live zu sehen.</div>';
  return `<div class="ov" onclick="cm();R()"><div class="mdl" style="max-width:620px" onclick="event.stopPropagation()"><div class="mdt">${isEdit ? "Loop bearbeiten" : "Neuen Loop erstellen"}</div><div style="background:var(--bg3);padding:12px;border-radius:8px;margin-bottom:16px;border:1px solid var(--bd)"><div style="font-size:11px;color:var(--t4);margin-bottom:6px">LOOP NAME (automatisch)</div><div style="font-size:16px;font-weight:600;color:var(--g)" id="f-ln-auto">${vCt && vBt ? es(vCt) + " / " + es(vBt) : "Supply Token / Borrow Token"}</div></div>${loopTokenDatalist()}<div class="fr"><div class="fg"><label>Start Datum (leer = jetzt)</label><input id="f-ld" type="date" value="${sd ? fds(sd) : ""}"></div><div class="fg"><label>Start Uhrzeit</label><input id="f-lt" type="time" value="${sd ? fts(sd) : ""}"></div></div><div class="fg"><label>Start Invest in USDC</label><input id="f-lcb" type="number" step="any" placeholder="1000" value="${vCb}" oninput="calcLoopData()"><div class="hnt">Hier gibst du das Kapital ein, mit dem du den Loop aufsetzt.</div></div><div style="background:var(--g-bg);border:1px solid rgba(0,255,163,0.22);border-radius:12px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--g);font-weight:600;margin-bottom:10px">📥 SUPPLY</div><div class="fr"><div class="fg"><label>Supply Token</label><input id="f-lct" list="loop-token-options" placeholder="ETH" value="${es(vCt)}" oninput="updateLoopName();calcLoopData()" onchange="fetchLoopOracleDefaults('supply')"></div><div class="fg"><label id="f-lsa-lbl">${es(loopRateLabel("supply", vCt))}</label><input id="f-lsa" type="number" step="0.01" placeholder="8.5" value="${vSa}" oninput="calcLoopData()"></div></div><div class="fr" style="margin-top:10px"><div class="fg"><label>Start Tokenmenge</label><input id="f-lcsm" type="number" step="any" placeholder="0.42" value="${vCsm}" oninput="calcLoopData()"></div><div class="fg"><label>Tokenpreis beim Kauf</label><input id="f-lcp" type="number" step="any" value="${vCp}" oninput="calcLoopData()"></div></div></div><div style="background:var(--rb);border:1px solid var(--r);border-radius:8px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--r);font-weight:600;margin-bottom:10px">📤 BORROW</div><div class="fr"><div class="fg"><label>Borrow Token</label><input id="f-lbt" list="loop-token-options" placeholder="USDC" value="${es(vBt)}" oninput="updateLoopName();calcLoopData()" onchange="fetchLoopOracleDefaults('borrow')"></div><div class="fg"><label id="f-lba-lbl">${es(loopRateLabel("borrow", vBt))}</label><input id="f-lba" type="number" step="0.01" placeholder="3.5" value="${vBa}" oninput="calcLoopData()"></div></div></div><div style="background:rgba(255,214,102,0.08);border:1px solid rgba(255,214,102,0.28);border-radius:12px;padding:12px;margin:16px 0"><div style="font-size:11px;color:#ffd666;font-weight:600;margin-bottom:10px">🟨 Aktuelle Mengen</div><div class="fr"><div class="fg"><label>Collateral Menge gelooped</label><input id="f-lce" type="number" step="any" placeholder="optional" value="${vCe}" oninput="calcLoopData()"></div><div class="fg"><label>Borrow Menge gelooped</label><input id="f-lbe" type="number" step="any" placeholder="optional" value="${vBe}" oninput="calcLoopData()"></div></div></div><div style="background:var(--pb);border:1px solid var(--p);border-radius:8px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--p);font-weight:600;margin-bottom:10px">PEG / DEPEG</div><div class="fr"><div class="fg"><label>Peg Referenz-Token</label><input id="f-lpr" list="loop-token-options" placeholder="AVAX" value="${es(vPegRef)}" oninput="calcLoopData()"></div><div class="fg"><label>Depeg Einstieg (1 ${es(vCt || "Asset")} = x Referenz)</label><input id="f-lpe" type="number" step="any" placeholder="1.25" value="${vPegEntry}" oninput="calcLoopData()"></div></div><div id="f-lpeg-preview">${pegPreview}</div></div><div class="fg"><label>Notiz</label><textarea id="f-lno" rows="3" placeholder="Warum wurde der Loop eröffnet? Worauf achtest du?">${es(vNotes)}</textarea></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="${isEdit ? "hLoopUpd()" : "hLoopCr()"}">${isEdit ? "Speichern" : "Erstellen"}</button></div></div></div>`;
}
function hFeature() {
  let t = document.getElementById("f-title").value,
    m = document.getElementById("f-desc").value;
  if (!validateFields([
    { id: 'f-title', test: function(v){ return v.trim().length > 0; }, msg: 'Titel erforderlich' },
    { id: 'f-desc', test: function(v){ return v.trim().length > 0; }, msg: 'Beschreibung erforderlich' }
  ])) return;
  api("/api/features", {
    method: "POST",
    body: JSON.stringify({ title: t, description: m }),
  }).then((r) => {
    if (r.status === 200) {
      alert(
        "Vorschlag erfolgreich eingereicht. Er wird bald vom Admin geprüft und veröffentlicht.",
      );
      M.fnew = 0;
      loadFeatures();
    } else alert("Fehler beim Einreichen.");
  });
}
function hVote(id) {
  api("/api/features/" + id + "/vote", { method: "POST" }).then(() =>
    loadFeatures(),
  );
}
function openAdminDetail(accId) {
  var acc = (M.accs || []).find((a) => a.id === accId);
  if (!acc) return;
  M.adet = { acc: acc, stats: [], tf: 30 }; // tf = timeframe in days
  R();
  api("/api/admin/accounts/" + accId + "/stats").then((r) => {
    if (M.adet && M.adet.acc.id === accId) {
      M.adet.stats = r.data || [];
      R();
      setTimeout(renderAdminChart, 50);
    }
  });
}
function renderAdminChart() {
  if (!M.adet || !document.getElementById("admin-chart")) return;
  var cvs = document.getElementById("admin-chart"),
    ctx = cvs.getContext("2d");
  cvs.width = cvs.offsetWidth * 2;
  cvs.height = cvs.offsetHeight * 2;
  ctx.scale(2, 2);
  var w = cvs.offsetWidth,
    h = cvs.offsetHeight;
  ctx.clearRect(0, 0, w, h);

  var tf = M.adet.tf,
    stats = M.adet.stats;
  var counts = [],
    labels = [],
    maxC = 0,
    now = Date.now();
  for (var i = tf - 1; i >= 0; i--) {
    let dObj = new Date(now - i * 864e5);
    let dStr = dObj.toISOString().split("T")[0];
    let lbl =
      dObj.getDate().toString().padStart(2, "0") +
      "." +
      (dObj.getMonth() + 1).toString().padStart(2, "0") +
      ".";
    let c = stats.filter((s) => s.startsWith(dStr)).length;
    counts.push(c);
    labels.push(lbl);
    if (c > maxC) maxC = c;
  }

  if (maxC === 0) {
    ctx.fillStyle = "#a0a0a0";
    ctx.font = '12px "Inter", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Keine Aktivität in diesem Zeitraum", w / 2, h / 2);
    return;
  }

  var barW = w / tf - 4;
  if (barW < 4) barW = 4;
  var bottomPadding = 24,
    topPadding = 20;
  var maxH = h - bottomPadding - topPadding;

  counts.forEach((c, idx) => {
    var bx = idx * (w / tf) + 2;
    var rawBh = (c / maxC) * maxH;
    var bh = c === 0 ? 0 : Math.max(4, rawBh);
    var by = h - bottomPadding - bh;

    // Bar
    ctx.fillStyle = c > 0 ? "#00ffa3" : "rgba(255,255,255,0.12)";
    if (c === 0) {
      ctx.fillRect(bx, h - bottomPadding - 4, barW, 4);
    } else {
      ctx.fillRect(bx, by, barW, bh);
    }

    // Count text inside/above bar
    if (c > 0 && barW > 14) {
      ctx.fillStyle = bh > 20 ? "#050505" : "#00ffa3";
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let ty = bh > 20 ? by + 10 : by - 8;
      ctx.fillText(c.toString(), bx + barW / 2, ty);
    }

    // X-Axis Date (only show if enough space or every Nth label)
    if (barW > 24 || idx % Math.ceil(tf / 7) === 0) {
      ctx.fillStyle = "#7a7a7a";
      ctx.font = '10px "Inter", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(labels[idx], bx + barW / 2, h - bottomPadding + 6);
    }
  });
}

// Handlers
function endS(id) {
  F("/api/strategies/" + id + "/end", { method: "PUT" }).then(() => {
    if (SI === id) {
      SI = null;
      V = "past";
    }
    loadData();
  });
}
function reaS(id) {
  F("/api/strategies/" + id + "/reactivate", { method: "PUT" }).then(loadData);
}
function delS(id) {
  if (!confirm("Strategie löschen?")) return;
  F("/api/strategies/" + id, { method: "DELETE" }).then(() => {
    if (SI === id) {
      SI = null;
      V = "active";
    }
    loadData();
  });
}
function delR(sid, rid) {
  F("/api/strategies/" + sid + "/rewards/" + rid, {
    method: "DELETE",
  }).then(loadData);
}
function delP(sid, pid) {
  F("/api/strategies/" + sid + "/pnl/" + pid, { method: "DELETE" }).then(
    loadData,
  );
}
function togP(sid, pid) {
  var s = S.find((x) => x.id === sid);
  if (s) {
    var p = (s.pnl || []).find((x) => x.id === pid);
    if (p) p.includeInAPR = !p.includeInAPR;
  }
  R();
  F("/api/strategies/" + sid + "/pnl/" + pid + "/toggle", {
    method: "PUT",
  }).then(loadData);
}
function togStratApr(id) {
  var s = S.find((x) => x.id === id);
  if (s) s.includeInTotalApr = !stratIncl(s);
  R();
  F("/api/strategies/" + id + "/toggle-total-apr", {
    method: "PUT",
  }).then(loadData);
}
function doUndo(idx) {
  F("/api/undo/" + idx, { method: "POST" }).then(() => {
    UD = false;
    loadData();
  });
}
function frfDelEx(id) {
  if (!confirm("Börse löschen?")) return;
  F("/api/frf/exchanges/" + id, { method: "DELETE" }).then(loadData);
}
function frfDelPos(id) {
  if (!confirm("Position löschen?")) return;
  F("/api/frf/positions/" + id, { method: "DELETE" }).then(loadData);
}
function frfDelFund(pid, side, fid) {
  F("/api/frf/positions/" + pid + "/funding/" + side + "/" + fid, {
    method: "DELETE",
  }).then(loadData);
}
function frfClosePos(id) {
  M.fclose = { id: id };
  R();
}
function frfToggleCloseFunding(id, nextValue) {
  F("/api/frf/positions/" + id, {
    method: "PUT",
    body: JSON.stringify({ closePnlIncludesFunding: !!nextValue }),
  }).then(loadData);
}
function frfTogPos(id) {
  F("/api/frf/positions/" + id + "/toggle", { method: "PUT" }).then(loadData);
}
function frfTogStrat(id) {
  F("/api/frf/positions/" + id + "/toggle-strategy", {
    method: "PUT",
  }).then(loadData);
}
function frfReopenPos(id) {
  F("/api/frf/positions/" + id + "/reopen", { method: "PUT" }).then(loadData);
}
function linkedTargetValue(p) {
  return p && p.linkedLoopId
    ? "loop:" + p.linkedLoopId
    : p && p.linkedStrategyId
      ? "strategy:" + p.linkedStrategyId
      : "";
}
function linkedTargetOptions(selectedValue) {
  var opts = ['<option value="">-- Keine --</option>'];
  S.filter(function (s) {
    return !s.endedAt;
  }).forEach(function (s) {
    opts.push(
      '<option value="strategy:' +
        s.id +
        '"' +
        (selectedValue === "strategy:" + s.id ? " selected" : "") +
        ">Strategie: " +
        es(s.name) +
        "</option>",
    );
  });
  LO.filter(function (l) {
    return l.status === "active" || !l.status;
  }).forEach(function (l) {
    opts.push(
      '<option value="loop:' +
        l.id +
        '"' +
        (selectedValue === "loop:" + l.id ? " selected" : "") +
        ">Loop: " +
        es(l.name) +
        "</option>",
    );
  });
  return opts.join("");
}
function linkedTargetPayload(selectId) {
  var value = document.getElementById(selectId).value || "";
  return {
    linkedStrategyId: value.indexOf("strategy:") === 0 ? value.slice(9) : "",
    linkedLoopId: value.indexOf("loop:") === 0 ? value.slice(5) : "",
  };
}
var CUSTOM_EXCHANGE_PRESET = "__custom__";
var CURATED_EXCHANGE_PRESETS = [
  { value: "bybit", label: "Bybit", aliases: ["bybit"] },
  { value: "phemex", label: "Phemex", aliases: ["phemex"] },
  {
    value: "hyperliquid",
    label: "Hyperliquid",
    aliases: ["hyperliquid"],
  },
  {
    value: "variational",
    label: "Variational",
    aliases: ["variational"],
  },
  { value: "extended", label: "Extended", aliases: ["extended", "extendet"] },
  { value: "grvt", label: "GRVT", aliases: ["grvt", "grvt.io"] },
];
function matchesExchangeAlias(value, alias) {
  return (
    value === alias ||
    value.indexOf(alias + " ") === 0 ||
    value.indexOf(alias + "-") === 0 ||
    value.indexOf(alias + "_") === 0
  );
}
function findCuratedExchangePreset(name) {
  var value = String(name || "").trim().toLowerCase();
  if (!value) return null;
  for (var i = 0; i < CURATED_EXCHANGE_PRESETS.length; i++) {
    var preset = CURATED_EXCHANGE_PRESETS[i];
    for (var j = 0; j < preset.aliases.length; j++) {
      if (matchesExchangeAlias(value, preset.aliases[j])) return preset;
    }
  }
  return null;
}
function exchangePresetValueForName(name) {
  var preset = findCuratedExchangePreset(name);
  return preset ? preset.value : CUSTOM_EXCHANGE_PRESET;
}
function resolveExchangeFormName(rawName, presetValue) {
  var preset = CURATED_EXCHANGE_PRESETS.find(function (item) {
    return item.value === presetValue;
  });
  if (preset) return preset.label;
  return String(rawName || "").trim();
}
function frfResolveExchangeSelection(exchanges, rawValue, side) {
  var value = String(rawValue || "").trim();
  if (!value) return null;
  if (side === "long" && value.toLowerCase() === "spot") {
    return { id: "_spot", label: "Spot" };
  }
  var normalized = value.toLowerCase();
  var match = (Array.isArray(exchanges) ? exchanges : []).find(function (exchange) {
    var label = normExchangeLabel(exchange && exchange.name).toLowerCase();
    var raw = String((exchange && exchange.name) || "").trim().toLowerCase();
    return label === normalized || raw === normalized;
  });
  return match
    ? { id: match.id, label: normExchangeLabel(match.name) }
    : null;
}
function frfFilterExchangeOptions(exchanges, query, side) {
  var items = [];
  if (side === "long") items.push({ id: "_spot", label: "Spot" });
  var seen = new Set();
  (Array.isArray(exchanges) ? exchanges : []).forEach(function (exchange) {
    var label = normExchangeLabel(exchange && exchange.name);
    if (!label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    items.push({ id: exchange.id, label: label });
  });
  var normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter(function (item) {
    return String(item.label || "").toLowerCase().indexOf(normalizedQuery) !== -1;
  });
}
function exchangePresetOptionsHtml(selectedName) {
  var selectedValue = exchangePresetValueForName(selectedName);
  var opts = CURATED_EXCHANGE_PRESETS.map(function (preset) {
    return (
      '<option value="' +
      preset.value +
      '"' +
      (selectedValue === preset.value ? " selected" : "") +
      ">" +
      preset.label +
      "</option>"
    );
  });
  opts.push(
    '<option value="' +
      CUSTOM_EXCHANGE_PRESET +
      '"' +
      (selectedValue === CUSTOM_EXCHANGE_PRESET ? " selected" : "") +
      ">Eigene Börse...</option>",
  );
  return opts.join("");
}
function exchangePresetFieldIds(mode) {
  return mode === "edit"
    ? { preset: "f-eexp", name: "f-eexn" }
    : { preset: "f-exp", name: "f-exn" };
}
function syncExchangePreset(mode) {
  var ids = exchangePresetFieldIds(mode),
    preset = document.getElementById(ids.preset),
    input = document.getElementById(ids.name);
  if (!preset || !input) return;
  if (preset.value === CUSTOM_EXCHANGE_PRESET) {
    input.readOnly = false;
    input.placeholder = "z.B. Kraken";
    return;
  }
  input.value = resolveExchangeFormName(input.value, preset.value);
  input.readOnly = true;
  input.placeholder = "Name aus Auswahl";
}
function frfExchangeFieldIds(mode, side) {
  if (mode === "edit" && side === "short") {
    return { input: "f-esex", hidden: "f-epsh", box: "f-esex-sug" };
  }
  if (mode === "edit" && side === "long") {
    return { input: "f-elex", hidden: "f-eplg", box: "f-elex-sug" };
  }
  if (side === "short") {
    return { input: "f-psex", hidden: "f-psh", box: "f-psex-sug" };
  }
  return { input: "f-plex", hidden: "f-plg", box: "f-plex-sug" };
}
function frfExchangeChoice(mode, side) {
  var ids = frfExchangeFieldIds(mode, side),
    input = document.getElementById(ids.input),
    hidden = document.getElementById(ids.hidden);
  var display = input && input.value ? input.value.trim() : "";
  var resolved = frfResolveExchangeSelection(FR.exchanges, display, side);
  return {
    display: display,
    exchangeId: hidden && hidden.value ? hidden.value : resolved ? resolved.id : "",
    label: resolved ? resolved.label : display,
  };
}
function frfRenderExchangeSuggestions(mode, side, html) {
  var ids = frfExchangeFieldIds(mode, side),
    box = document.getElementById(ids.box);
  if (box) box.innerHTML = html || "";
}
function frfExchangeSelect(mode, side, exchangeId, label) {
  var ids = frfExchangeFieldIds(mode, side),
    input = document.getElementById(ids.input),
    hidden = document.getElementById(ids.hidden);
  if (input) input.value = label || "";
  if (hidden) hidden.value = exchangeId || "";
  frfRenderExchangeSuggestions(mode, side, "");
  frfTokenReset(mode, side);
  frfTokenSuggest(mode, side);
}
function frfExchangeSuggestSection(mode, side, items) {
  if (!items.length) return '<div class="tok-suggest-empty">Keine passenden Börsen gefunden.</div>';
  return (
    '<div class="tok-suggest-panel"><div class="tok-suggest-scroll"><div class="tok-suggest-section"><div class="tok-suggest-meta">Verfügbare Börsen</div><div class="tok-suggest-list">' +
    items
      .map(function (item) {
        return (
          '<button type="button" class="tok-suggest-item" onclick="frfExchangeSelect(\'' +
          mode +
          '\',\'' +
          side +
          '\',\'' +
          es(item.id || "") +
          '\',\'' +
          es(item.label || "") +
          '\')"><span>' +
          es(item.label || "") +
          '</span><small>' +
          (item.id === "_spot" ? "Spot ohne Hebel" : "Vorhandene Börse verwenden") +
          '</small></button>'
        );
      })
      .join("") +
    "</div></div></div></div>"
  );
}
function frfExchangeSuggest(mode, side, forceAll) {
  var ids = frfExchangeFieldIds(mode, side),
    input = document.getElementById(ids.input),
    hidden = document.getElementById(ids.hidden),
    query = forceAll ? "" : input && input.value ? input.value.trim() : "";
  if (!input || !hidden) return;
  var resolved = frfResolveExchangeSelection(FR.exchanges, query, side);
  hidden.value = resolved ? resolved.id : "";
  frfRenderExchangeSuggestions(
    mode,
    side,
    frfExchangeSuggestSection(mode, side, frfFilterExchangeOptions(FR.exchanges, query, side)),
  );
}
function frfCloseExchangeSuggestions() {
  frfRenderExchangeSuggestions("new", "short", "");
  frfRenderExchangeSuggestions("new", "long", "");
  frfRenderExchangeSuggestions("edit", "short", "");
  frfRenderExchangeSuggestions("edit", "long", "");
}
function normExchangeLabel(name) {
  var v = String(name || "").trim();
  if (!v) return "";
  var preset = findCuratedExchangePreset(v);
  if (preset) return preset.label;
  return v;
}
function frfTokenFieldIds(mode, side) {
  var p = mode === "edit" ? "f-e" : "f-p",
    k = side === "long" ? "l" : "s";
  return {
    input: p + k + "tk",
    asset: p + k + "asset",
    market: p + k + "mkt",
    exchange:
      side === "long"
        ? mode === "edit"
          ? "f-eplg"
          : "f-plg"
        : mode === "edit"
          ? "f-epsh"
          : "f-psh",
    box: p + k + "tk-sug",
  };
}
function frfCounterSide(side) {
  return side === "short" ? "long" : "short";
}
function frfTokenSuggestBox(mode, side) {
  var ids = frfTokenFieldIds(mode, side);
  return document.getElementById(ids.box);
}
function frfRenderTokenSuggestions(mode, html, side) {
  var box = frfTokenSuggestBox(mode, side);
  if (box) box.innerHTML = html || "";
}
function frfTokenChoice(mode, side) {
  var ids = frfTokenFieldIds(mode, side),
    input = document.getElementById(ids.input),
    asset = document.getElementById(ids.asset),
    market = document.getElementById(ids.market);
  return {
    display: input && input.value ? input.value.trim() : "",
    asset: asset && asset.value ? asset.value.trim() : "",
    market: market && market.value ? market.value.trim() : "",
    exchangeId: (document.getElementById(ids.exchange) || {}).value || "",
  };
}
function frfTokenReset(mode, side) {
  var ids = frfTokenFieldIds(mode, side),
    input = document.getElementById(ids.input),
    asset = document.getElementById(ids.asset),
    market = document.getElementById(ids.market);
  if (input) input.value = "";
  if (asset) asset.value = "";
  if (market) market.value = "";
  frfRenderTokenSuggestions(mode, "", side);
}
function frfTokenSelect(mode, side, assetSymbol, marketSymbol) {
  var ids = frfTokenFieldIds(mode, side),
    input = document.getElementById(ids.input),
    asset = document.getElementById(ids.asset),
    market = document.getElementById(ids.market);
  if (input) input.value = marketSymbol || assetSymbol || "";
  if (asset) asset.value = assetSymbol || "";
  if (market) market.value = marketSymbol || assetSymbol || "";
  frfRenderTokenSuggestions(mode, "", side);
  var other = frfCounterSide(side),
    otherChoice = frfTokenChoice(mode, other);
  if (otherChoice.asset && otherChoice.asset !== assetSymbol)
    frfTokenReset(mode, other);
}
function frfCloseTokenSuggestions() {
  frfRenderTokenSuggestions("new", "", "short");
  frfRenderTokenSuggestions("new", "", "long");
  frfRenderTokenSuggestions("edit", "", "short");
  frfRenderTokenSuggestions("edit", "", "long");
}
function frfTokenSuggestSection(mode, side, group) {
  var items = Array.isArray(group && group.items) ? group.items : [];
  if (!items.length) return "";
  var ex = normExchangeLabel(group.exchangeName || "Börse"),
    provider = normExchangeLabel(group.provider || ""),
    meta =
      provider && provider.toLowerCase() !== ex.toLowerCase()
        ? ex + " - " + provider
        : ex;
  return (
    '<div class="tok-suggest-section"><div class="tok-suggest-meta">' +
    es(meta) +
    '</div><div class="tok-suggest-list">' +
    items
      .map(function (item) {
        var asset = es(item.symbol || ""),
          market = es(item.market || item.symbol || ""),
          label = es(item.label || item.market || item.symbol || "");
        return (
          '<button type="button" class="tok-suggest-item" onclick="frfTokenSelect(\'' +
          mode +
          "','" +
          side +
          "','" +
          asset +
          "','" +
          market +
          "')\"><span>" +
          market +
          "</span><small>" +
          label +
          "</small></button>"
        );
      })
      .join("") +
    "</div></div>"
  );
}
function frfTokenSuggest(mode, side) {
  var ids = frfTokenFieldIds(mode, side),
    input = document.getElementById(ids.input),
    query = input && input.value ? input.value.trim() : "",
    exchangeId = (document.getElementById(ids.exchange) || {}).value || "",
    other = frfTokenChoice(mode, frfCounterSide(side)),
    reqId = ++FRF_TOKEN_REQ[mode];
  if (!input) return;
  if (!query && !other.asset) {
    frfRenderTokenSuggestions(mode, "", side);
    return;
  }
  if (!exchangeId || exchangeId === "_spot") {
    frfRenderTokenSuggestions(
      mode,
      '<div class="tok-suggest-note">Erst die zugehörige Börse wählen, dann lade ich passende Token-Vorschläge.</div>',
      side,
    );
    return;
  }
  frfRenderTokenSuggestions(
    mode,
    '<div class="tok-suggest-empty">Suche Token auf der gewählten Börse ...</div>',
    side,
  );
  api(
    "/api/frf/exchanges/" +
      encodeURIComponent(exchangeId) +
      "/symbols?q=" +
      encodeURIComponent(query || other.asset),
  )
    .then(function (r) {
      if (reqId !== FRF_TOKEN_REQ[mode]) return;
      if (r.status !== 200) {
        frfRenderTokenSuggestions(
          mode,
          '<div class="tok-suggest-empty">' +
            es((r.data && r.data.error) || "Keine Vorschläge verfügbar") +
            "</div>",
          side,
        );
        return;
      }
      var data = r.data || {},
        items = Array.isArray(data.items) ? data.items : [];
      if (other.asset)
        items = items.filter(function (item) {
          return (
            String(item.symbol || "").toUpperCase() ===
            other.asset.toUpperCase()
          );
        });
      if (!items.length) {
        frfRenderTokenSuggestions(
          mode,
          '<div class="tok-suggest-empty">Keine passenden Token auf der gewählten Börse gefunden.</div>',
          side,
        );
        return;
      }
      frfRenderTokenSuggestions(
        mode,
        '<div class="tok-suggest-panel"><div class="tok-suggest-scroll">' +
          frfTokenSuggestSection(mode, side, {
            exchangeName: data.exchangeName || "Börse",
            provider: data.provider || "",
            items: items,
          }) +
          "</div></div>",
        side,
      );
    })
    .catch(function (err) {
      if (reqId !== FRF_TOKEN_REQ[mode]) return;
      frfRenderTokenSuggestions(
        mode,
        '<div class="tok-suggest-empty">' +
          es(
            err && err.message
              ? err.message
              : "Vorschläge konnten nicht geladen werden",
          ) +
          "</div>",
        side,
      );
    });
}
function frfLiveQuote(id) {
  return FRF_LIVE_QUOTES[id] || null;
}
function frfLiveRemaining(id) {
  return Math.max(0, (FRF_LIVE_NEXT_AT[id] || 0) - Date.now());
}
function frfLiveButtonLabel(id) {
  if (FRF_LIVE_LOADING[id]) return "Laedt...";
  var sec = Math.ceil(frfLiveRemaining(id) / 1000);
  return sec > 0 ? "Live (" + sec + "s)" : "Live";
}
function frfScheduleLiveTick(id) {
  if (!id) return;
  if (FRF_LIVE_TIMER[id]) {
    clearTimeout(FRF_LIVE_TIMER[id]);
    delete FRF_LIVE_TIMER[id];
  }
  if (frfLiveRemaining(id) <= 0) return;
  FRF_LIVE_TIMER[id] = setTimeout(function () {
    delete FRF_LIVE_TIMER[id];
    if (FPI === id) R();
    if (frfLiveRemaining(id) > 0) frfScheduleLiveTick(id);
  }, 1000);
}
function frfEnsureLive(id) {
  if (!id || FRF_LIVE_QUOTES[id] || FRF_LIVE_LOADING[id]) return;
  setTimeout(function () {
    if (FPI === id) frfFetchLive(id, true);
  }, 0);
}
function frfFetchLive(id) {
  var force = arguments.length > 1 ? !!arguments[1] : false;
  if (!id || FRF_LIVE_LOADING[id]) return;
  if (!force && frfLiveRemaining(id) > 0) {
    frfScheduleLiveTick(id);
    R();
    return;
  }
  FRF_LIVE_LOADING[id] = 1;
  R();
  api("/api/frf/positions/" + encodeURIComponent(id) + "/live")
    .then(function (r) {
      delete FRF_LIVE_LOADING[id];
      FRF_LIVE_NEXT_AT[id] = Date.now() + 5000;
      FRF_LIVE_QUOTES[id] =
        r.status === 200
          ? r.data || {}
          : {
              error:
                (r.data && r.data.error) ||
                "Livepreis konnte nicht geladen werden",
            };
      frfScheduleLiveTick(id);
      R();
    })
    .catch(function (err) {
      delete FRF_LIVE_LOADING[id];
      FRF_LIVE_NEXT_AT[id] = Date.now() + 5000;
      FRF_LIVE_QUOTES[id] = {
        error:
          err && err.message
            ? err.message
            : "Livepreis konnte nicht geladen werden",
      };
      frfScheduleLiveTick(id);
      R();
    });
}
function frfFundingPct(v) {
  var n = parseFloat(v);
  return Number.isFinite(n) ? (n * 100).toFixed(4) + "%" : "—";
}
function frfFundingAnnualRate(v, sec) {
  var n = parseFloat(v),
    s = parseFloat(sec || 0);
  if (!Number.isFinite(n) || !(s > 0)) return null;
  return n * ((365 * 24 * 3600) / s);
}
function frfFundingAnnualDisplay(v) {
  var n = parseFloat(v);
  return Number.isFinite(n) ? (n * 100).toFixed(2) + "% p.a." : "—";
}
function frfFundingAnnualPct(v, sec) {
  var a = frfFundingAnnualRate(v, sec);
  return a === null ? "—" : (a * 100).toFixed(2) + "% p.a.";
}
function frfFundingPeriod(sec) {
  var s = parseFloat(sec || 0);
  if (!(s > 0)) return "—";
  if (Math.abs(s / 3600 - Math.round(s / 3600)) < 0.001)
    return Math.round(s / 3600) + "h";
  if (Math.abs(s / 60 - Math.round(s / 60)) < 0.001)
    return Math.round(s / 60) + "m";
  return s.toFixed(0) + "s";
}
function frfFundingRowsHtml(rows) {
  var list = Array.isArray(rows) ? rows : [];
  if (!list.length)
    return '<div class="emp" style="margin:10px 0 0">Noch keine Settlement-Fundingdaten für die letzten 72h vorhanden.</div>';
  return (
    '<div class="tbl" style="margin-top:10px"><div class="tblh"><span style="flex:2">Zeit</span><span style="flex:1.8;text-align:right">Settlement p.a.</span></div>' +
    list
      .map(function (row) {
        var dt = row && row.time ? fd(row.time) : "—",
          annual = frfFundingAnnualRate(
            row.fundingRate,
            row.intervalSeconds || 0,
          );
        return (
          '<div class="tblr"><span style="flex:2;color:var(--t2);font-size:12px">' +
          dt +
          "</span><span style=\"flex:1.8;text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;color:" +
          (annual === null
            ? "var(--t3)"
            : annual >= 0
              ? "var(--g)"
              : "var(--r)") +
          '">' +
          frfFundingAnnualPct(row.fundingRate, row.intervalSeconds || 0) +
          "</span></div>"
        );
      })
      .join("") +
    "</div>"
  );
}
function frfFundingSection(title, key, funding) {
  if (
    !funding ||
    funding.error ||
    funding.currentRate === null ||
    funding.currentRate === undefined
  )
    return "";
  var open = !!EXP[key],
    list = Array.isArray(funding.settledRates72h8h)
      ? funding.settledRates72h8h
      : [],
    avg = list.length
      ? list.reduce(function (sum, row) {
          var annual = frfFundingAnnualRate(
            row.fundingRate,
            row.intervalSeconds || funding.intervalSeconds || 0,
          );
          return sum + (annual === null ? 0 : annual);
        }, 0) / list.length
      : null;
  return (
    '<button class="col-btn' +
    (open ? " open" : "") +
    '" onclick="tgl(\'' +
    key +
    '\')" style="margin-top:12px"><span class="arr">▼</span> ' +
    title +
    ": " +
    frfFundingAnnualPct(funding.currentRate, funding.intervalSeconds) +
    " / " +
    frfFundingPeriod(funding.intervalSeconds) +
    '</button><div class="col-ct' +
    (open ? " open" : "") +
    '"><div class="ibx" style="margin-top:10px"><div class="igr"><div class="iti"><span class="itl">Ø Settlement 72h (p.a.)</span><span class="itv" style="color:' +
    (avg === null ? "var(--t3)" : avg >= 0 ? "var(--g)" : "var(--r)") +
    '">' +
    (avg === null ? "—" : frfFundingAnnualDisplay(avg)) +
    '</span></div><div class="iti"><span class="itl">Periode</span><span class="itv">' +
    frfFundingPeriod(funding.intervalSeconds) +
    "</span></div></div></div>" +
    frfFundingRowsHtml(list) +
    "</div>"
  );
}
function frfLiveUnavailable(data) {
  return !!(
    !data ||
    data.error ||
    !Number.isFinite(parseFloat(data.price)) ||
    !(parseFloat(data.price) > 0)
  );
}
function frfFundingUnavailable(funding) {
  return !!(
    !funding ||
    funding.error ||
    funding.currentRate === null ||
    funding.currentRate === undefined
  );
}

function hCr() {
  var n = document.getElementById("f-n").value.trim(),
    d = document.getElementById("f-d").value,
    t = document.getElementById("f-t").value || "00:00",
    i = parseFloat(document.getElementById("f-i").value);
  if (!validateFields([
    { id: 'f-n', test: function(v){ return v.trim().length > 0; }, msg: 'Name ist erforderlich' },
    { id: 'f-d', test: function(v){ return v.length > 0; }, msg: 'Datum ist erforderlich' },
    { id: 'f-i', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }, msg: 'Investition muss > 0 sein' }
  ])) return;
  var no = document.getElementById("f-no").value || "",
    tokenRead = collectStrategyTokenRows('f-token-create-rows');
  if (tokenRead.error) return alert(tokenRead.error);
  cm();
  F("/api/strategies", {
    method: "POST",
    body: JSON.stringify({
      name: n,
      startDate: new Date(d + "T" + t).toISOString(),
      investment: i,
      notes: no,
      tokenChanges: tokenRead.rows,
    }),
  }).then(loadData);
}
function hRw() {
  var a = parseFloat(document.getElementById("f-ra").value);
  if (!SI) return;
  if (!validateFields([
    { id: 'f-ra', test: function(v){ return !isNaN(parseFloat(v)) && parseFloat(v) !== 0; }, msg: 'Betrag erforderlich' }
  ])) return;
  var d = document.getElementById("f-rd").value,
    t = document.getElementById("f-rt").value,
    nt = document.getElementById("f-rn").value || "";
  var dt = d ? new Date(d + "T" + (t || "00:00")).toISOString() : null;
  cm();
  F("/api/strategies/" + SI + "/rewards", {
    method: "POST",
    body: JSON.stringify({ amount: a, date: dt, note: nt }),
  }).then(loadData);
}
function hIv() {
  var rawAmount = document.getElementById("f-ni").value,
    a = rawAmount === '' ? NaN : parseFloat(rawAmount),
    tokenRead = collectStrategyTokenRows('f-token-invest-rows');
  if (!SI) return;
  if (tokenRead.error) return alert(tokenRead.error);
  if (Number.isNaN(a) && !tokenRead.rows.length) {
    return showFieldError('f-ni', 'Betrag oder Token erforderlich');
  }
  cm();
  F("/api/strategies/" + SI + "/investment", {
    method: "POST",
    body: JSON.stringify({
      amount: Number.isNaN(a) ? '' : a,
      note: document.getElementById("f-nin").value || "",
      tokenChanges: tokenRead.rows,
    }),
  }).then(loadData);
}
function hPl() {
  var a = parseFloat(document.getElementById("f-pa").value);
  if (!SI) return;
  if (!validateFields([
    { id: 'f-pa', test: function(v){ return v !== '' && !isNaN(parseFloat(v)); }, msg: 'Betrag erforderlich' }
  ])) return;
  cm();
  F("/api/strategies/" + SI + "/pnl", {
    method: "POST",
    body: JSON.stringify({
      amount: a,
      note: document.getElementById("f-pn").value || "",
    }),
  }).then(loadData);
}
function hNo() {
  if (!SI) return;
  cm();
  F("/api/strategies/" + SI + "/notes", {
    method: "PUT",
    body: JSON.stringify({
      notes: document.getElementById("f-ne").value || "",
    }),
  }).then(loadData);
}
function hTk() {
  if (!SI) return;
  cm();
  F("/api/strategies/" + SI + "/token", {
    method: "PUT",
    body: JSON.stringify({
      name: document.getElementById("f-etn").value,
      amount: document.getElementById("f-eta").value,
      entryPrice: document.getElementById("f-etp").value,
    }),
  }).then(loadData);
}
function hEd() {
  if (!SI) return;
  var d = document.getElementById("f-edd").value;
  if (!validateFields([
    { id: 'f-edd', test: function(v){ return v.length > 0; }, msg: 'Datum erforderlich' }
  ])) return;
  cm();
  F("/api/strategies/" + SI + "/enddate", {
    method: "PUT",
    body: JSON.stringify({
      endedAt: new Date(
        d + "T" + (document.getElementById("f-edt").value || "00:00"),
      ).toISOString(),
    }),
  }).then(loadData);
}
function hEr() {
  var o = M.er;
  if (!o) return;
  cm();
  F("/api/strategies/" + o.sid + "/rewards/" + o.rid, {
    method: "PUT",
    body: JSON.stringify({
      amount: parseFloat(document.getElementById("f-era").value),
      note: document.getElementById("f-ern").value || "",
      date: new Date(
        document.getElementById("f-erd").value +
          "T" +
          (document.getElementById("f-ert").value || "00:00"),
      ).toISOString(),
    }),
  }).then(loadData);
}
function hEp() {
  var o = M.ep;
  if (!o) return;
  cm();
  F("/api/strategies/" + o.sid + "/pnl/" + o.pid, {
    method: "PUT",
    body: JSON.stringify({
      amount: parseFloat(document.getElementById("f-epa").value),
      note: document.getElementById("f-epn").value || "",
      date: new Date(
        document.getElementById("f-epd").value +
          "T" +
          (document.getElementById("f-ept").value || "00:00"),
      ).toISOString(),
    }),
  }).then(loadData);
}
function hEi() {
  var o = M.ei;
  if (!o) return;
  cm();
  F("/api/strategies/" + o.sid + "/investment/" + o.eid, {
    method: "PUT",
    body: JSON.stringify({
      amount: parseFloat(document.getElementById("f-eia").value),
      note: document.getElementById("f-ein").value || "",
      date: new Date(
        document.getElementById("f-eid").value +
          "T" +
          (document.getElementById("f-eit").value || "00:00"),
      ).toISOString(),
    }),
  }).then(loadData);
}

function hFex() {
  var n = resolveExchangeFormName(
      document.getElementById("f-exn").value,
      (document.getElementById("f-exp") || {}).value || CUSTOM_EXCHANGE_PRESET,
    ),
    m = parseFloat(document.getElementById("f-exm").value) || 0;
  if (!validateFields([
    { id: 'f-exn', test: function(v){ return v.trim().length > 0; }, msg: 'Name ist erforderlich' }
  ])) return;
  cm();
  F("/api/frf/exchanges", {
    method: "POST",
    body: JSON.stringify({ name: n, margin: m }),
  }).then(loadData);
}
function hFeex() {
  var o = M.feex,
    n = resolveExchangeFormName(
      document.getElementById("f-eexn").value,
      (document.getElementById("f-eexp") || {}).value || CUSTOM_EXCHANGE_PRESET,
    );
  cm();
  F("/api/frf/exchanges/" + o.id, {
    method: "PUT",
    body: JSON.stringify({
      name: n,
      margin: parseFloat(document.getElementById("f-eexm").value),
    }),
  }).then(loadData);
}
function hFexm() {
  var o = M.fexm;
  var a = parseFloat(document.getElementById("f-exma").value);
  if (!validateFields([
    { id: 'f-exma', test: function(v){ return v !== '' && !isNaN(parseFloat(v)); }, msg: 'Betrag erforderlich' }
  ])) return;
  cm();
  F("/api/frf/exchanges/" + o.id + "/margin", {
    method: "POST",
    body: JSON.stringify({
      amount: a,
      note: document.getElementById("f-exmn").value || "",
    }),
  }).then(loadData);
}
function hFemm() {
  var o = M.femm;
  cm();
  F("/api/frf/exchanges/" + o.eid + "/margin/" + o.mid, {
    method: "PUT",
    body: JSON.stringify({
      amount: parseFloat(document.getElementById("f-fmma").value),
      note: document.getElementById("f-fmmn").value || "",
      date: new Date(
        document.getElementById("f-fmmd").value +
          "T" +
          (document.getElementById("f-fmmt").value || "00:00"),
      ).toISOString(),
    }),
  }).then(loadData);
}
function hFpos() {
  var shortExchange = frfExchangeChoice("new", "short"),
    longExchange = frfExchangeChoice("new", "long"),
    lg = longExchange.exchangeId,
    shortChoice = frfTokenChoice("new", "short"),
    longChoice = frfTokenChoice("new", "long");
  if (!shortExchange.exchangeId) {
    return showFieldError("f-psex", "Short-Börse eingeben oder auswählen");
  }
  if (!longExchange.exchangeId) {
    return showFieldError("f-plex", "Long-Börse eingeben oder auswählen");
  }
  // Fallback: wenn kein Suggestion-Klick erfolgte aber der User Text eingetippt hat,
  // werden display-Wert als asset/market genutzt (direkte Eingabe ohne Autocomplete).
  if (!shortChoice.asset && shortChoice.display) {
    shortChoice.asset = shortChoice.display.toUpperCase();
    shortChoice.market = shortChoice.display.toUpperCase();
  }
  if (!longChoice.asset && longChoice.display) {
    longChoice.asset = longChoice.display.toUpperCase();
    longChoice.market = longChoice.display.toUpperCase();
  }
  var asset = (shortChoice.asset || longChoice.asset || "").trim(),
    coingeckoKey = (
      asset ||
      shortChoice.display ||
      longChoice.display ||
      ""
    ).toUpperCase();
  if (!asset) {
    return showFieldError('f-pstk', 'Token-Symbol eingeben (z.B. BTC, ETH)');
  }
  if (!shortChoice.market) {
    return showFieldError('f-pstk', 'Short-Token eingeben');
  }
  if (!(lg === "_spot" ? longChoice.market || asset : longChoice.market)) {
    return showFieldError('f-pltk', 'Long-Token eingeben');
  }
  var sd = document.getElementById("f-psd").value,
    st = document.getElementById("f-pst").value;
  var startDate = sd
    ? new Date(sd + "T" + (st || "00:00")).toISOString()
    : null;
  var link = linkedTargetPayload("f-pls");
  cm();
  F("/api/frf/positions", {
    method: "POST",
    body: JSON.stringify({
      type: document.getElementById("f-pt").value,
      token: asset,
      coingeckoId: CG_REV[coingeckoKey] || "",
      shortAssetSymbol: shortChoice.asset || asset,
      longAssetSymbol: longChoice.asset || asset,
      shortMarketSymbol: shortChoice.market || shortChoice.display || asset,
      longMarketSymbol:
        lg === "_spot"
          ? longChoice.market || longChoice.display || asset
          : longChoice.market || asset,
      tokenAmount: parseFloat(document.getElementById("f-pta").value) || 0,
      positionSizeUsd: 0,
      entryPriceShort: parseFloat(document.getElementById("f-ptes").value) || 0,
      entryPriceLong: parseFloat(document.getElementById("f-ptel").value) || 0,
      shortExchangeId: shortExchange.exchangeId,
      longExchangeId: lg === "_spot" ? "" : lg,
      longIsSpot: lg === "_spot",
      fees: parseFloat(document.getElementById("f-pfe").value) || 0,
      linkedStrategyId: link.linkedStrategyId,
      linkedLoopId: link.linkedLoopId,
      startDate: startDate,
    }),
  }).then(loadData);
}
function hFepos() {
  var o = M.fepos;
  var fp = FR.positions.find((x) => x.id === o.id);
  if (!fp) return;
  var tp = document.getElementById("f-eptype").value;
  var shortExchange = frfExchangeChoice("edit", "short"),
    longExchange = frfExchangeChoice("edit", "long"),
    lg = longExchange.exchangeId,
    shortChoice = frfTokenChoice("edit", "short"),
    longChoice = frfTokenChoice("edit", "long");
  if (!shortExchange.exchangeId) {
    return showFieldError("f-esex", "Short-Börse eingeben oder auswählen");
  }
  if (!longExchange.exchangeId) {
    return showFieldError("f-elex", "Long-Börse eingeben oder auswählen");
  }
  // Fallback: direkte Eingabe ohne Autocomplete-Auswahl
  if (!shortChoice.asset && shortChoice.display) {
    shortChoice.asset = shortChoice.display.toUpperCase();
    shortChoice.market = shortChoice.display.toUpperCase();
  }
  if (!longChoice.asset && longChoice.display) {
    longChoice.asset = longChoice.display.toUpperCase();
    longChoice.market = longChoice.display.toUpperCase();
  }
  var asset = (shortChoice.asset || longChoice.asset || fp.token || "").trim(),
    coingeckoKey = (asset || fp.token || "").toUpperCase();
  var sd = document.getElementById("f-epsd").value,
    st = document.getElementById("f-epst").value;
  var startDate = sd
    ? new Date(sd + "T" + (st || "00:00")).toISOString()
    : fp.startDate;
  var link = linkedTargetPayload("f-epls");
  cm();
  F("/api/frf/positions/" + o.id, {
    method: "PUT",
    body: JSON.stringify({
      type: tp,
      token: asset,
      coingeckoId: CG_REV[coingeckoKey] || fp.coingeckoId,
      shortAssetSymbol: shortChoice.asset || asset,
      longAssetSymbol: longChoice.asset || asset,
      shortMarketSymbol:
        shortChoice.market ||
        shortChoice.display ||
        fp.shortMarketSymbol ||
        asset,
      longMarketSymbol:
        lg === "_spot"
          ? longChoice.market ||
            longChoice.display ||
            fp.longMarketSymbol ||
            asset
          : longChoice.market || fp.longMarketSymbol || asset,
      tokenAmount: parseFloat(document.getElementById("f-epta").value),
      positionSizeUsd: parseFloat(document.getElementById("f-epts").value) || 0,
      entryPriceShort: parseFloat(document.getElementById("f-eptes").value),
      entryPriceLong: parseFloat(document.getElementById("f-eptel").value),
      shortExchangeId: shortExchange.exchangeId,
      longExchangeId: lg === "_spot" ? "" : lg,
      longIsSpot: lg === "_spot",
      fees: parseFloat(document.getElementById("f-epfe").value) || 0,
      linkedStrategyId: link.linkedStrategyId,
      linkedLoopId: link.linkedLoopId,
      startDate: startDate,
    }),
  }).then(loadData);
}
function hFfund() {
  var o = M.ffund;
  var a = parseFloat(document.getElementById("f-ffa").value);
  if (!validateFields([
    { id: 'f-ffa', test: function(v){ return v !== '' && !isNaN(parseFloat(v)); }, msg: 'Betrag erforderlich' }
  ])) return;
  cm();
  F("/api/frf/positions/" + o.pid + "/funding/" + o.side, {
    method: "POST",
    body: JSON.stringify({
      amount: a,
      note: document.getElementById("f-ffn").value || "",
    }),
  }).then(loadData);
}
function hFefund() {
  var o = M.fefund;
  var amt = parseFloat(document.getElementById("f-fefa").value);
  if (isNaN(amt)) return alert("Bitte einen gueltigen Betrag eingeben.");
  var d = document.getElementById("f-fefd").value,
    t = document.getElementById("f-feft").value || "00:00",
    iso = o.dt || new Date().toISOString();
  if (d) {
    var dt = new Date(d + "T" + t);
    if (isNaN(dt.getTime()))
      return alert("Bitte ein gueltiges Datum/Uhrzeit eingeben.");
    iso = dt.toISOString();
  }
  cm();
  api("/api/frf/positions/" + o.pid + "/funding/" + o.side + "/" + o.fid, {
    method: "PUT",
    body: JSON.stringify({
      amount: amt,
      note: document.getElementById("f-fefn").value || "",
      date: iso,
    }),
  })
    .then(function (r) {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) ||
            "Funding konnte nicht gespeichert werden.",
        );
        return;
      }
      loadData();
    })
    .catch((err) => console.warn('Request fehlgeschlagen:', err.message || err));
}
function hFclose() {
  var o = M.fclose;
  cm();
  F("/api/frf/positions/" + o.id + "/close", {
    method: "PUT",
    body: JSON.stringify({
      closePnlShort: parseFloat(document.getElementById("f-fcs").value) || 0,
      closePnlLong: parseFloat(document.getElementById("f-fcl").value) || 0,
      closePnlIncludesFunding: !!(document.getElementById("f-fci") && document.getElementById("f-fci").checked),
      fees: parseFloat(document.getElementById("f-fcf").value) || 0,
      closeNote: document.getElementById("f-fcn").value || "",
    }),
  }).then(() => {
    if (FPI === o.id) {
      FPI = null;
      V = "frf";
    }
    loadData();
  });
}
function hFprc() {
  var ump = document.getElementById("f-ump").checked;
  var mp = ump ? parseFloat(document.getElementById("f-mp").value) : 0;
  cm();
  F("/api/frf/positions/" + FPI + "/price", {
    method: "PUT",
    body: JSON.stringify({ useManualPrice: ump, manualPrice: mp }),
  }).then(loadData);
}

function loadMessageSummary() {
  if (!AUTH.loggedIn || IS_DEMO) {
    MSG_SUM = {
      unreadCount: 0,
      importantUnreadCount: 0,
      supportUnreadCount: 0,
    };
    return Promise.resolve(MSG_SUM);
  }
  return api("/api/messages/summary")
    .then(function (r) {
      MSG_SUM =
        r.status === 200
          ? r.data || {
              unreadCount: 0,
              importantUnreadCount: 0,
              supportUnreadCount: 0,
            }
          : {
              unreadCount: 0,
              importantUnreadCount: 0,
              supportUnreadCount: 0,
            };
      R();
      return MSG_SUM;
    })
    .catch(function () {
      MSG_SUM = {
        unreadCount: 0,
        importantUnreadCount: 0,
        supportUnreadCount: 0,
      };
      return MSG_SUM;
    });
}
function hintAttr(txt) {
  return SHOW_HINTS && txt ? ' title="' + es(txt) + '"' : "";
}
function msgTs(m) {
  return new Date(m.sentAt || m.createdAt || 0).getTime() || 0;
}
function msgFmt(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function msgIso(v) {
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function msgCatCls(c) {
  if (c === "security") return "security";
  if (c === "maintenance") return "maintenance";
  if (c === "support") return "support";
  if (c === "system") return "system";
  return "info";
}
function msgCatLbl(c) {
  if (c === "security") return "Sicherheit";
  if (c === "maintenance") return "Wartung";
  if (c === "support") return "Support";
  if (c === "system") return "System";
  return "Update";
}
function msgPriLbl(p) {
  if (p === "urgent") return "Dringend";
  if (p === "important") return "Wichtig";
  return "Info";
}
function msgThreads() {
  var map = {},
    xs = (MSG.inbox || []).slice().sort(function (a, b) {
      return msgTs(b) - msgTs(a);
    });
  xs.forEach(function (m) {
    var k = m.conversationId || m.id;
    if (!map[k]) map[k] = { id: k, messages: [], latest: m, unreadCount: 0 };
    map[k].messages.push(m);
    if (msgTs(m) > msgTs(map[k].latest)) map[k].latest = m;
    if (!m.isOwn && !m.isRead) map[k].unreadCount++;
  });
  var arr = Object.values(map);
  arr.forEach(function (t) {
    t.messages.sort(function (a, b) {
      return msgTs(a) - msgTs(b);
    });
  });
  arr.sort(function (a, b) {
    return msgTs(b.latest) - msgTs(a.latest);
  });
  return arr;
}
function msgFilteredThreads() {
  var q = (MSG_SEARCH || "").trim().toLowerCase();
  return msgThreads().filter(function (t) {
    var l = t.latest,
      txt = (
        (l.title || "") +
        " " +
        (l.body || "") +
        " " +
        (l.senderEmail || "") +
        " " +
        (l.targetEmail || "")
      ).toLowerCase();
    if (q && txt.indexOf(q) === -1) return false;
    if (MSG_FILTER === "unread" && t.unreadCount < 1) return false;
    if (
      MSG_FILTER === "pinned" &&
      !t.messages.some(function (m) {
        return m.isPinned;
      })
    )
      return false;
    if (
      MSG_FILTER === "support" &&
      !t.messages.some(function (m) {
        return m.category === "support";
      })
    )
      return false;
    return true;
  });
}
function msgSelectedThread() {
  var ts = msgFilteredThreads();
  if (!ts.length) return null;
  if (
    !MSG.selectedId ||
    !ts.find(function (t) {
      return t.id === MSG.selectedId;
    })
  )
    MSG.selectedId = ts[0].id;
  return (
    ts.find(function (t) {
      return t.id === MSG.selectedId;
    }) || ts[0]
  );
}
function msgAdminSelected() {
  var xs = MSG.history || [];
  if (!xs.length) return null;
  if (
    !MSG.selectedAdminId ||
    !xs.find(function (m) {
      return m.id === MSG.selectedAdminId;
    })
  )
    MSG.selectedAdminId = xs[0].id;
  return (
    xs.find(function (m) {
      return m.id === MSG.selectedAdminId;
    }) || xs[0]
  );
}
function msgResetCompose(
  mode,
  targetId,
  targetEmail,
  conversationId,
  parentMessageId,
) {
  MC = {
    id: null,
    targetType: mode || "all",
    targetAccountId: targetId || "",
    targetEmail: targetEmail || "",
    conversationId: conversationId || "",
    parentMessageId: parentMessageId || "",
    title: "",
    body: "",
    priority: "info",
    category: mode === "direct" ? "support" : "system",
    linkUrl: "",
    isPinned: false,
    expiresAt: "",
    status: "draft",
    scheduledAt: "",
    readTracking: true,
    emailMirror: false,
    audiencePreset: "all_users",
  };
  MSG_VIEW = canManageMessages() ? "admin" : "inbox";
}
function msgComposeAll() {
  msgResetCompose("all");
  V = "messages";
  M.usr = false;
  loadMessages();
}
function msgComposeUser(id, email) {
  msgResetCompose("direct", id, email || "");
  V = "messages";
  MSG_VIEW = canManageMessages() ? "admin" : "inbox";
  M.usr = false;
  loadMessages();
}
function msgLoadDraft(id) {
  var d = (MSG.drafts || []).find(function (x) {
    return x.id === id;
  });
  if (!d) return;
  MC = {
    id: d.id,
    targetType: d.targetType || "all",
    targetAccountId: d.targetAccountId || "",
    targetEmail: d.targetEmail || "",
    conversationId: d.conversationId || "",
    parentMessageId: d.parentMessageId || "",
    title: d.title || "",
    body: d.body || "",
    priority: d.priority || "info",
    category: d.category || "system",
    linkUrl: d.linkUrl || "",
    isPinned: !!d.isPinned,
    expiresAt: d.expiresAt ? d.expiresAt.slice(0, 16) : "",
    status: d.status || "draft",
    scheduledAt: d.scheduledAt ? d.scheduledAt.slice(0, 16) : "",
    readTracking: d.readTracking !== false,
    emailMirror: !!d.emailMirror,
    audiencePreset: d.audiencePreset || "all_users",
  };
  MSG_VIEW = "admin";
  V = "messages";
  R();
}
function msgPreview() {
  if (!MC.title || !MC.body)
    return alert("Bitte Betreff und Nachricht ausfüllen.");
  if (MC.targetType === "direct" && !MC.targetAccountId)
    return alert("Bitte einen Empfänger wählen.");
  if (MC.status === "scheduled" && !MC.scheduledAt)
    return alert("Bitte einen Zeitpunkt für den geplanten Versand setzen.");
  M.msgprev = 1;
  R();
}
function msgPayload(status) {
  return {
    targetType: MC.targetType,
    targetAccountId: MC.targetType === "direct" ? MC.targetAccountId : null,
    audiencePreset: MC.targetType === "segment" ? MC.audiencePreset : null,
    title: MC.title || "",
    body: MC.body || "",
    priority: MC.priority || "info",
    category: MC.category || "system",
    linkUrl: MC.linkUrl || "",
    isPinned: !!MC.isPinned,
    expiresAt: msgIso(MC.expiresAt),
    status: status || MC.status || "draft",
    scheduledAt:
      (status || MC.status) === "scheduled" ? msgIso(MC.scheduledAt) : null,
    readTracking: !!MC.readTracking,
    emailMirror: !!MC.emailMirror,
    conversationId: MC.conversationId || null,
    parentMessageId: MC.parentMessageId || null,
  };
}
function msgSave(status) {
  var payload = msgPayload(status);
  if (!payload.title || !payload.body)
    return alert("Bitte Betreff und Nachricht ausfüllen.");
  if (payload.targetType === "direct" && !payload.targetAccountId)
    return alert("Bitte einen Empfänger wählen.");
  if (payload.status === "scheduled" && !payload.scheduledAt)
    return alert("Bitte einen Zeitpunkt setzen.");
  var meth = MC.id ? "PUT" : "POST",
    url = "/api/messages" + (MC.id ? "/" + MC.id : "");
  api(url, { method: meth, body: JSON.stringify(payload) })
    .then(function (r) {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) ||
            "Nachricht konnte nicht gespeichert werden.",
        );
        return;
      }
      M.msgprev = 0;
      msgResetCompose(
        payload.targetType,
        payload.targetAccountId,
        MC.targetEmail,
        payload.conversationId,
        payload.parentMessageId,
      );
      loadMessages();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function msgDelete(id) {
  if (!confirm("Nachricht/Entwurf wirklich entfernen?")) return;
  api("/api/messages/" + id, { method: "DELETE" })
    .then(function (r) {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) || "Nachricht konnte nicht entfernt werden.",
        );
        return;
      }
      if (MC.id === id) msgResetCompose("all");
      loadMessages();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function msgOpenThread(id) {
  MSG.selectedId = id;
  var th = msgThreads().find(function (t) {
    return t.id === id;
  });
  R();
  if (!th) return;
  var unread = th.messages.filter(function (m) {
    return !m.isOwn && !m.isRead;
  });
  if (!unread.length) return;
  Promise.all(
    unread.map(function (m) {
      return api("/api/messages/" + m.id + "/read", { method: "PUT" });
    }),
  )
    .then(function () {
      loadMessages();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function msgMarkAllRead() {
  api("/api/messages/read-all", { method: "POST" })
    .then(function () {
      loadMessages();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function msgReplyOpen() {
  var th = msgSelectedThread();
  if (!th) return;
  var last = th.messages[th.messages.length - 1],
    tid = last.isOwn ? last.targetAccountId : last.senderAccountId,
    tem = last.isOwn ? last.targetEmail : last.senderEmail;
  if (!tid) return;
  if (canManageMessages()) {
    msgComposeUser(tid, tem);
    MC.conversationId = th.id;
    MC.parentMessageId = last.id;
    MC.title = "Re: " + (th.latest.title || "Nachricht");
    R();
    return;
  }
  M.msgreply = {
    targetId: tid,
    targetEmail: tem,
    conversationId: th.id,
    parentMessageId: last.id,
    title: "Re: " + (th.latest.title || "Nachricht"),
  };
  R();
}
function hMsgReply() {
  if (!M.msgreply) return;
  var title = document.getElementById("msg-r-title").value.trim(),
    body = document.getElementById("msg-r-body").value.trim();
  if (!validateFields([
    { id: 'msg-r-title', test: function(v){ return v.trim().length > 0; }, msg: 'Betreff erforderlich' },
    { id: 'msg-r-body', test: function(v){ return v.trim().length > 0; }, msg: 'Nachricht erforderlich' }
  ])) return;
  api("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      targetType: "direct",
      targetAccountId: M.msgreply.targetId,
      conversationId: M.msgreply.conversationId,
      parentMessageId: M.msgreply.parentMessageId,
      title: title,
      body: body,
      priority: "info",
      category: "support",
      status: "sent",
    }),
  })
    .then(function (r) {
      if (r.status !== 200) {
        alert(
          (r.data && r.data.error) || "Antwort konnte nicht gesendet werden.",
        );
        return;
      }
      cm();
      loadMessages();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function msgSelectAdmin(id) {
  MSG.selectedAdminId = id;
  loadMessageRecipients(id);
  R();
}
function loadMessageRecipients(id) {
  if (!AUTH.loggedIn || !canManageMessages()) return;
  api("/api/admin/messages/" + id + "/recipients")
    .then(function (r) {
      MSG.recipients = r.status === 200 ? r.data || [] : [];
      R();
    })
    .catch(function () {
      MSG.recipients = [];
      R();
    });
}
function loadMessages() {
  if (!AUTH.loggedIn || IS_DEMO) return;
  var calls = [api("/api/messages/summary"), api("/api/messages/inbox")];
  if (canManageMessages()) calls.push(api("/api/admin/messages/overview"));
  Promise.all(calls)
    .then(function (rs) {
      MSG_SUM = rs[0].status === 200 ? rs[0].data || MSG_SUM : MSG_SUM;
      MSG.inbox = rs[1].status === 200 ? rs[1].data || [] : [];
      if (rs[2] && rs[2].status === 200) {
        MSG.drafts = rs[2].data.drafts || [];
        MSG.history = rs[2].data.history || [];
        MSG.users = rs[2].data.users || [];
        MSG.stats = rs[2].data.stats || MSG.stats;
        if (MSG.selectedAdminId) loadMessageRecipients(MSG.selectedAdminId);
        else if (MSG.history[0]) {
          MSG.selectedAdminId = MSG.history[0].id;
          loadMessageRecipients(MSG.selectedAdminId);
        }
      } else {
        MSG.drafts = [];
        MSG.history = [];
        MSG.users = [];
        MSG.recipients = [];
        MSG.stats = {
          sent30d: 0,
          direct30d: 0,
          drafts: 0,
          avgReadRate: 0,
        };
      }
      R();
    })
    .catch(function (err) { console.warn('Request fehlgeschlagen:', err.message || err); });
}
function openMessages(tab) {
  MSG_VIEW = tab || (canManageMessages() ? "admin" : "inbox");
  V = "messages";
  SI = null;
  FPI = null;
  UD = false;
  M.usr = false;
  loadMessages();
}
function renderMsgBadges(m) {
  var h =
    '<span class="msg-bad ' +
    msgPriLbl(m.priority).toLowerCase().replace("ä", "a") +
    " priority-" +
    (m.priority || "info") +
    '">' +
    msgPriLbl(m.priority) +
    "</span>";
  h +=
    '<span class="msg-bad ' +
    msgCatCls(m.category) +
    '">' +
    msgCatLbl(m.category) +
    "</span>";
  if (m.isPinned) h += '<span class="msg-bad maintenance">Pinned</span>';
  return h;
}
function renderMessagesView() {
  var h = "",
    threads = msgFilteredThreads(),
    th = msgSelectedThread(),
    isAdmin = canManageMessages();
  h += '<div class="msg-shell">';
  h += '<div class="msg-hero">';
  h += '<div class="msg-card">';
  h += '<div class="msg-ey">Nachrichten Dashboard</div>';
  h += "<h2>Inbox, Broadcasts und Direktnachrichten an einem Ort.</h2>";
  h +=
    "<p>Hier siehst du Systemmeldungen, Antworten und wichtige Hinweise. Admins koennen Broadcasts, Direktnachrichten, Segmente, Entwuerfe und Read-Analytics verwalten.</p>";
  h += '<div class="msg-btns">';
  h +=
    '<button class="bt bp"' +
    hintAttr("Markiert alle empfangenen Nachrichten auf einmal als gelesen.") +
    ' onclick="msgMarkAllRead()">Alle als gelesen</button>';
  if (isAdmin) {
    h +=
      '<button class="bt bb"' +
      hintAttr(
        "Oeffnet direkt den Composer fuer eine neue Broadcast-Nachricht an alle User.",
      ) +
      ' onclick="msgComposeAll()">An alle senden</button>';
    h +=
      '<button class="bt by"' +
      hintAttr("Springt zur Admin-Userliste fuer gezielte Direktnachrichten.") +
      " onclick=\"V='admin';loadAdmin()\">Zur Userliste</button>";
  } else {
    h +=
      '<button class="bt bb"' +
      hintAttr("Antwortet auf den aktuell geoeffneten Nachrichten-Thread.") +
      ' onclick="msgReplyOpen()">Auf Nachricht antworten</button>';
  }
  h += "</div>";
  h += '<div class="msg-kpis">';
  h +=
    '<div class="msg-kpi"' +
    hintAttr("Alle noch nicht gelesenen Nachrichten in deiner Inbox.") +
    '><span class="sl">Ungelesen</span><strong>' +
    (MSG_SUM.unreadCount || 0) +
    "</strong><span>gesamt in deiner Inbox</span></div>";
  h +=
    '<div class="msg-kpi"' +
    hintAttr("Pinned oder als wichtig/dringend markierte Nachrichten.") +
    '><span class="sl">Wichtig</span><strong>' +
    (MSG_SUM.importantUnreadCount || 0) +
    "</strong><span>dringend oder gepinnt</span></div>";
  h +=
    '<div class="msg-kpi"' +
    hintAttr("Support-Antworten und direkte Rueckfragen vom Team.") +
    '><span class="sl">Support</span><strong>' +
    (MSG_SUM.supportUnreadCount || 0) +
    "</strong><span>Antworten / Rueckfragen</span></div>";
  h +=
    '<div class="msg-kpi"' +
    hintAttr("Anzahl der sichtbaren Konversationen nach aktuellem Filter.") +
    '><span class="sl">Threads</span><strong>' +
    threads.length +
    "</strong><span>sichtbare Konversationen</span></div>";
  h += "</div>";
  h += "</div>";
  h += "</div>";

  if (isAdmin) {
    h +=
      '<div class="msg-bar"><div><h2 class="st" style="font-size:16px">Nachrichtenbereich</h2><div style="font-size:12px;color:var(--t4);margin-top:4px">Inbox fuer Konversationen, Admin fuer Versand und Analytics.</div></div><div class="msg-tabs"><button class="' +
      (MSG_VIEW === "inbox" ? "a" : "") +
      '"' +
      hintAttr("Zeigt die Inbox-Sicht mit Konversationen und Antworten.") +
      ' onclick="MSG_VIEW=\'inbox\';R()">Inbox</button><button class="' +
      (MSG_VIEW === "admin" ? "a" : "") +
      '"' +
      hintAttr("Oeffnet Composer, Entwuerfe, Historie und Read-Analytics.") +
      " onclick=\"MSG_VIEW='admin';R()\">Admin</button></div></div>";
  }

  if (isAdmin && MSG_VIEW === "admin") {
    var ah = msgAdminSelected();
    h += '<div class="msg-work">';
    h +=
      '<div class="msg-pane"><div class="msg-head"><h3>Composer</h3><span>' +
      (MC.id ? "Entwurf bearbeiten" : "Neue Nachricht") +
      "</span></div>";
    h +=
      '<div class="msg-tabs" style="margin-bottom:10px"><button class="' +
      (MC.targetType === "all" ? "a" : "") +
      '"' +
      hintAttr("Nachricht an alle verifizierten User senden.") +
      " onclick=\"msgResetCompose('all');MSG_VIEW='admin';R()\">An alle</button><button class=\"" +
      (MC.targetType === "direct" ? "a" : "") +
      '"' +
      hintAttr("Direktnachricht an einen einzelnen User verfassen.") +
      " onclick=\"msgResetCompose('direct');MSG_VIEW='admin';R()\">An User</button><button class=\"" +
      (MC.targetType === "segment" ? "a" : "") +
      '"' +
      hintAttr("Nachricht an ein gefiltertes Segment schicken.") +
      " onclick=\"msgResetCompose('segment');MSG_VIEW='admin';R()\">An Segment</button></div>";
    if (MC.targetType === "direct") {
      h +=
        '<div class="msg-row"><div><div class="sl" style="margin-bottom:6px">Empfaenger</div><select class="msg-select" onchange="MC.targetAccountId=this.value;MC.targetEmail=(MSG.users.find(function(u){return u.id===this.value}.bind(this))||{}).email||\'\';R()"><option value="">-- User waehlen --</option>' +
        MSG.users
          .filter(function (u) {
            return u.role !== "admin";
          })
          .map(function (u) {
            return (
              '<option value="' +
              u.id +
              '"' +
              (MC.targetAccountId === u.id ? " selected" : "") +
              ">" +
              es(u.email) +
              "</option>"
            );
          })
          .join("") +
        "</select></div></div>";
    }
    if (MC.targetType === "segment") {
      h +=
        '<div><div class="sl" style="margin-bottom:6px">Segment</div><select class="msg-select" onchange="MC.audiencePreset=this.value;R()"><option value="all_users"' +
        (MC.audiencePreset === "all_users" ? " selected" : "") +
        '>Alle verifizierten User</option><option value="active_7d"' +
        (MC.audiencePreset === "active_7d" ? " selected" : "") +
        '>Aktive User 7 Tage</option><option value="active_30d"' +
        (MC.audiencePreset === "active_30d" ? " selected" : "") +
        '>Aktive User 30 Tage</option><option value="new_14d"' +
        (MC.audiencePreset === "new_14d" ? " selected" : "") +
        '>Neue Accounts 14 Tage</option><option value="verified_users"' +
        (MC.audiencePreset === "verified_users" ? " selected" : "") +
        '>Alle freigeschalteten User</option><option value="admins"' +
        (MC.audiencePreset === "admins" ? " selected" : "") +
        ">Nur Admins</option></select></div>";
    }
    h +=
      '<div class="msg-row" style="margin-top:10px"><input class="msg-input" placeholder="Betreff" value="' +
      es(MC.title || "") +
      '" oninput="MC.title=this.value"><select class="msg-select" onchange="MC.priority=this.value"><option value="info"' +
      (MC.priority === "info" ? " selected" : "") +
      '>Info</option><option value="important"' +
      (MC.priority === "important" ? " selected" : "") +
      '>Wichtig</option><option value="urgent"' +
      (MC.priority === "urgent" ? " selected" : "") +
      ">Dringend</option></select></div>";
    h +=
      '<div class="msg-row" style="margin-top:10px"><select class="msg-select" onchange="MC.category=this.value"><option value="system"' +
      (MC.category === "system" ? " selected" : "") +
      '>System</option><option value="update"' +
      (MC.category === "update" ? " selected" : "") +
      '>Update</option><option value="maintenance"' +
      (MC.category === "maintenance" ? " selected" : "") +
      '>Wartung</option><option value="security"' +
      (MC.category === "security" ? " selected" : "") +
      '>Sicherheit</option><option value="support"' +
      (MC.category === "support" ? " selected" : "") +
      '>Support</option></select><select class="msg-select" onchange="MC.status=this.value;R()"><option value="draft"' +
      (MC.status === "draft" ? " selected" : "") +
      '>Entwurf</option><option value="sent"' +
      (MC.status === "sent" ? " selected" : "") +
      '>Jetzt senden</option><option value="scheduled"' +
      (MC.status === "scheduled" ? " selected" : "") +
      ">Geplant</option></select></div>";
    h +=
      '<div class="msg-row" style="margin-top:10px"><input class="msg-input" placeholder="Link (optional)" value="' +
      es(MC.linkUrl || "") +
      '" oninput="MC.linkUrl=this.value"><input class="msg-input" type="datetime-local" placeholder="Laufzeit / Ablauf" value="' +
      es(MC.expiresAt || "") +
      '" oninput="MC.expiresAt=this.value"></div>';
    if (MC.status === "scheduled")
      h +=
        '<div style="margin-top:10px"><input class="msg-input" type="datetime-local" value="' +
        es(MC.scheduledAt || "") +
        '" oninput="MC.scheduledAt=this.value"></div>';
    h +=
      '<div style="margin-top:10px"><textarea class="msg-text" placeholder="Nachricht..." oninput="MC.body=this.value">' +
      es(MC.body || "") +
      "</textarea></div>";
    h +=
      '<div class="msg-filters"><label class="msg-chip ' +
      (MC.isPinned ? "a" : "") +
      '"><input type="checkbox" ' +
      (MC.isPinned ? "checked" : "") +
      ' onchange="MC.isPinned=this.checked;R()"> Pinned</label><label class="msg-chip ' +
      (MC.readTracking ? "a" : "") +
      '"><input type="checkbox" ' +
      (MC.readTracking ? "checked" : "") +
      ' onchange="MC.readTracking=this.checked;R()"> Read Tracking</label><label class="msg-chip ' +
      (MC.emailMirror ? "a" : "") +
      '"><input type="checkbox" ' +
      (MC.emailMirror ? "checked" : "") +
      ' onchange="MC.emailMirror=this.checked;R()"> E-Mail Mirror</label></div>';
    h +=
      '<div class="msg-note">Entwuerfe bleiben bearbeitbar. Gesendete Nachrichten koennen bearbeitet werden, solange noch niemand sie gelesen hat. Rueckzug ist moeglich, solange noch nicht alle Empfaenger gelesen haben.</div>';
    h +=
      '<div class="msg-actions" style="margin-top:12px"><button class="bt bp" onclick="msgSave(MC.status||\'draft\')">' +
      (MC.status === "sent" ? "Senden" : "Speichern") +
      '</button><button class="bt bb" onclick="msgPreview()">Vorschau</button>' +
      (MC.id
        ? '<button class="bt be" onclick="msgDelete(\'' +
          MC.id +
          "')\">Loeschen / Zurueckziehen</button>"
        : "") +
      "</div></div>";

    h +=
      '<div class="msg-pane"><div class="msg-head"><h3>Historie & Entwuerfe</h3><span>' +
      (MSG.history.length || 0) +
      ' gesendet</span></div><div class="msg-tabs" style="margin-bottom:10px"><button class="' +
      ((window.MSG_H_TAB || "history") === "history" ? "a" : "") +
      '" onclick="window.MSG_H_TAB=\'history\';R()">Gesendet</button><button class="' +
      ((window.MSG_H_TAB || "history") === "drafts" ? "a" : "") +
      '" onclick="window.MSG_H_TAB=\'drafts\';R()">Entwuerfe</button></div><div class="msg-list">' +
      (((window.MSG_H_TAB || "history") === "drafts"
        ? MSG.drafts || []
        : MSG.history || []
      )
        .map(function (m) {
          return (
            '<div class="msg-item ' +
            (((window.MSG_H_TAB || "history") === "history" &&
              ah &&
              ah.id === m.id) ||
            ((window.MSG_H_TAB || "history") === "drafts" && MC.id === m.id)
              ? "a"
              : "") +
            '" onclick="' +
            ((window.MSG_H_TAB || "history") === "drafts"
              ? "msgLoadDraft('" + m.id + "')"
              : "msgSelectAdmin('" + m.id + "')") +
            '"><div class="msg-top"><div class="msg-title">' +
            es(m.title) +
            "</div><div>" +
            renderMsgBadges(m) +
            '</div></div><div class="msg-copy">' +
            es((m.body || "").slice(0, 120)) +
            (m.body && m.body.length > 120 ? "..." : "") +
            '</div><div class="msg-meta"><span>' +
            msgFmt(m.sentAt || m.updatedAt) +
            "</span><span>" +
            (m.recipientCount || 0) +
            " Empf. / " +
            (m.readCount || 0) +
            " gelesen</span></div></div>"
          );
        })
        .join("") ||
        '<div class="emp" style="padding:24px 14px">Noch keine Nachrichten.</div>') +
      "</div></div>";

    h +=
      '<div><div class="msg-analytics" style="margin-bottom:14px"><h3>Analytics</h3><div class="msg-stats" style="margin-top:10px"><div class="msg-stat"><span class="sl">Broadcasts 30d</span><strong>' +
      (MSG.stats.sent30d || 0) +
      '</strong><span>gesendete Nachrichten</span></div><div class="msg-stat"><span class="sl">Direkt 30d</span><strong>' +
      (MSG.stats.direct30d || 0) +
      '</strong><span>direkte User-Nachrichten</span></div><div class="msg-stat"><span class="sl">Entwuerfe</span><strong>' +
      (MSG.stats.drafts || 0) +
      '</strong><span>inkl. geplant</span></div><div class="msg-stat"><span class="sl">Read Rate</span><strong>' +
      (MSG.stats.avgReadRate || 0) +
      '%</strong><span>ueber gesendete Nachrichten</span></div></div></div><div class="msg-pane"><div class="msg-head"><h3>Userliste</h3><span>Direktnachricht</span></div><input class="msg-search" placeholder="User suchen..." value="' +
      es(MSG_ADMIN_SEARCH) +
      '" oninput="MSG_ADMIN_SEARCH=this.value;R()"><div style="margin-top:8px">' +
      (MSG.users || [])
        .filter(function (u) {
          return (
            !MSG_ADMIN_SEARCH ||
            u.email.toLowerCase().indexOf(MSG_ADMIN_SEARCH.toLowerCase()) !== -1
          );
        })
        .map(function (u) {
          return (
            '<div class="msg-user"><div><div class="msg-title">' +
            es(u.email) +
            "</div><em>" +
            onlineBadge(u.lastSeenAt) +
            " • " +
            (u.directUnreadCount || 0) +
            ' ungelesen</em></div><div class="msg-actions"><button class="bt bb bs" onclick="event.stopPropagation();msgComposeUser(\'' +
            es(u.id) +
            "','" +
            es(u.email) +
            "')\">Nachricht</button></div></div>"
          );
        })
        .join("") +
      "</div>" +
      (ah
        ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)"><div class="msg-head"><h3>Empfaengerstatus</h3><span>' +
          (ah.readCount || 0) +
          "/" +
          (ah.recipientCount || 0) +
          " gelesen</span></div>" +
          (MSG.recipients || [])
            .slice(0, 20)
            .map(function (r) {
              return (
                '<div class="msg-rcpt"><div><div class="msg-title">' +
                es(r.email) +
                '</div><div class="meta">' +
                onlineBadge(r.lastSeenAt) +
                '</div></div><div class="meta">' +
                (r.readAt ? "Gelesen " + msgFmt(r.readAt) : "Ungelesen") +
                "</div></div>"
              );
            })
            .join("") +
          (ah.unreadCount > 20
            ? '<div class="meta" style="margin-top:8px">Weitere Empfaenger im Datensatz vorhanden.</div>'
            : "") +
          (ah.unreadCount > 0
            ? '<div class="msg-actions" style="margin-top:12px"><button class="bt be" onclick="msgDelete(\'' +
              ah.id +
              "')\">Zurueckziehen</button></div>"
            : "") +
          "</div>"
        : "") +
      "</div></div>";
    h += "</div>";
  } else {
    h +=
      '<div class="msg-work" style="grid-template-columns:320px minmax(0,1fr)">';
    h +=
      '<div class="msg-pane"><div class="msg-head"><h3>Inbox</h3><span>' +
      (MSG_SUM.unreadCount || 0) +
      ' ungelesen</span></div><input class="msg-search"' +
      hintAttr(
        "Suche nach Betreff, Text oder Absender in deinen Nachrichten.",
      ) +
      ' placeholder="Suche in Nachrichten..." value="' +
      es(MSG_SEARCH) +
      '" oninput="MSG_SEARCH=this.value;R()"><div class="msg-filters"><button class="msg-chip ' +
      (MSG_FILTER === "all" ? "a" : "") +
      '"' +
      hintAttr("Zeigt alle sichtbaren Threads.") +
      ' onclick="MSG_FILTER=\'all\';R()">Alle</button><button class="msg-chip ' +
      (MSG_FILTER === "unread" ? "a" : "") +
      '"' +
      hintAttr(
        "Filtert auf Threads mit mindestens einer ungelesenen Nachricht.",
      ) +
      ' onclick="MSG_FILTER=\'unread\';R()">Ungelesen</button><button class="msg-chip ' +
      (MSG_FILTER === "pinned" ? "a" : "") +
      '"' +
      hintAttr("Zeigt nur angeheftete oder besonders wichtige Hinweise.") +
      ' onclick="MSG_FILTER=\'pinned\';R()">Pinned</button><button class="msg-chip ' +
      (MSG_FILTER === "support" ? "a" : "") +
      '"' +
      hintAttr("Zeigt nur Support- und Direktnachrichten-Konversationen.") +
      ' onclick="MSG_FILTER=\'support\';R()">Support</button></div><div class="msg-list">' +
      (threads
        .map(function (t) {
          var m = t.latest;
          return (
            '<div class="msg-item ' +
            (th && th.id === t.id ? "a" : "") +
            '" onclick="msgOpenThread(\'' +
            t.id +
            '\')"><div class="msg-top"><div class="msg-title">' +
            (!m.isOwn && t.unreadCount ? '<span class="msg-dot"></span>' : "") +
            es(m.title) +
            "</div><div>" +
            renderMsgBadges(m) +
            '</div></div><div class="msg-copy">' +
            es((m.body || "").slice(0, 120)) +
            (m.body && m.body.length > 120 ? "..." : "") +
            '</div><div class="msg-meta"><span>' +
            (m.isOwn ? "Von dir" : es(m.senderEmail || "")) +
            " • " +
            msgFmt(m.sentAt || m.createdAt) +
            "</span><span>" +
            (t.unreadCount ? String(t.unreadCount) + " neu" : "Thread") +
            "</span></div></div>"
          );
        })
        .join("") ||
        '<div class="emp" style="padding:24px 14px">Keine Nachrichten gefunden.</div>') +
      "</div></div>";
    h +=
      '<div class="msg-pane">' +
      (th
        ? '<div class="msg-detail"><div class="msg-h"><div class="msg-actions">' +
          renderMsgBadges(th.latest) +
          (th.unreadCount
            ? '<span class="msg-bad priority-important">' +
              th.unreadCount +
              " neu</span>"
            : "") +
          "</div><h3>" +
          es(th.latest.title) +
          "</h3><p>" +
          es(th.latest.body) +
          '</p></div><div class="msg-grid"><div class="msg-info"' +
          hintAttr(
            "Absender der zuletzt geoeffneten Nachricht in diesem Thread.",
          ) +
          '><span class="sl">Absender</span><strong>' +
          es(th.latest.senderEmail || "System") +
          '</strong></div><div class="msg-info"' +
          hintAttr("Zeitpunkt der letzten Nachricht im Thread.") +
          '><span class="sl">Zuletzt</span><strong>' +
          msgFmt(th.latest.sentAt || th.latest.createdAt) +
          '</strong></div><div class="msg-info"' +
          hintAttr("Optionales Ablaufdatum fuer zeitkritische Hinweise.") +
          '><span class="sl">Ablauf</span><strong>' +
          (th.latest.expiresAt ? msgFmt(th.latest.expiresAt) : "Offen") +
          '</strong></div></div><div class="msg-thread">' +
          th.messages
            .map(function (m) {
              return (
                '<div class="msg-bub ' +
                (m.isOwn ? "me" : "") +
                '"><div class="msg-top"><div class="msg-title">' +
                es(m.isOwn ? "Du" : m.senderEmail || "Admin") +
                '</div><div class="meta">' +
                msgFmt(m.sentAt || m.createdAt) +
                "</div></div><p>" +
                es(m.body) +
                "</p>" +
                (m.linkUrl
                  ? '<div style="margin-top:8px"><a href="' +
                    es(m.linkUrl) +
                    '" target="_blank" rel="noopener noreferrer" style="color:var(--bl)">Link oeffnen</a></div>'
                  : "") +
                "</div>"
              );
            })
            .join("") +
          '</div><div class="msg-actions"><button class="bt bb"' +
          hintAttr(
            "Antwortet auf den aktuellen Thread an den letzten Absender.",
          ) +
          ' onclick="msgReplyOpen()">Antworten</button><button class="bt bcn"' +
          hintAttr(
            "Markiert alle sichtbaren Nachrichten in deiner Inbox als gelesen.",
          ) +
          ' onclick="msgMarkAllRead()">Alle lesen</button></div></div>'
        : '<div class="emp" style="padding:36px 20px">Bitte links einen Thread auswaehlen.</div>') +
      "</div>";
    h += "</div>";
  }
  h += "</div>";
  return h;
}

function renderGlobalBackground() {
  if (typeof S === "undefined" || !Array.isArray(S)) return;
  var loops = Array.isArray(LO) ? LO : [],
    hasData = S.length > 0 || loops.length > 0,
    existingBg = document.getElementById("dynamic-bg"),
    existingStyle = document.getElementById("dynamic-bg-style");

  if (!existingStyle) {
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style id="dynamic-bg-style">#app{position:relative;z-index:1;isolation:isolate}#dynamic-bg{position:fixed;top:-20%;left:-10%;width:120%;height:140%;z-index:0;pointer-events:none;transform:rotate(-8deg) scale(1.1);transform-origin:center center;overflow:hidden}#dynamic-bg .dyn-grid{position:absolute;inset:0;opacity:.05;background-image:linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px),linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px);background-size:60px 60px;mask-image:radial-gradient(circle at center, black 10%, transparent 80%);-webkit-mask-image:radial-gradient(circle at center, black 10%, transparent 80%)}#dynamic-bg .dyn-logo{mix-blend-mode:screen}@keyframes dynPanChart{0%{transform:translateX(0)}100%{transform:translateX(-1500px)}} </style>',
    );
  }

  var items = [];
  (S || []).forEach(function (s) {
    items.push({
      name: s.name,
      val: (window.wa ? wa(s) : 0).toFixed(2) + "% APR",
      status: s.endedAt ? "Beendet" : "Aktiv",
    });
  });
  loops.forEach(function (l) {
    var totals = window.calculateLoopingTotals ? calculateLoopingTotals(l) : null;
    items.push({
      name:
        (l.collateraltoken || l.collateralToken || "") +
        " / " +
        (l.borrowtoken || l.borrowToken || ""),
      val: ((totals && totals.netApr) || 0).toFixed(2) + "% APR",
      status: l.status,
    });
  });
  var isReal = items.length > 0;

  if (!items.length) {
    items.push({ name: "Aborean USDC/WETH", val: "12.5% APR", status: "Aktiv" });
    items.push({ name: "Paradex Vault", val: "8.2% APR", status: "Aktiv" });
    items.push({ name: "Aero cbBTC", val: "15.0% APR", status: "Aktiv" });
    items.push({ name: "Avax Loop", val: "9.1% APR", status: "Aktiv" });
  }

  function getL(n) {
    var t = (n || "").toLowerCase();
    if (t.indexOf("usdc") > -1) return "usd-coin-usdc-logo.svg";
    if (t.indexOf("usdt") > -1) return "tether-usdt-logo.svg";
    if (t.indexOf("eth") > -1) return "ethereum-eth-logo.svg";
    if (t.indexOf("btc") > -1) return "bitcoin-btc-logo.svg";
    if (t.indexOf("avax") > -1) return "avalanche-avax-logo.svg";
    if (t.indexOf("sol") > -1) return "solana-sol-logo.svg";
    if (t.indexOf("aave") > -1) return "aave-aave-logo.svg";
    if (t.indexOf("pendle") > -1) return "pendle-pendle-logo.svg";
    if (t.indexOf("link") > -1 || t.indexOf("chainlink") > -1) return "chainlink-link-logo.svg";
    if (t.indexOf("arb") > -1) return "arbitrum-arb-logo.svg";
    if (t.indexOf("op") > -1) return "optimism-op-logo.svg";
    if (t.indexOf("uni") > -1) return "uniswap-uni-logo.svg";
    return null;
  }

  var signature = JSON.stringify({
    real: isReal,
    items: items.map(function (item) {
      return [item.name, item.val, item.status];
    }),
  });

  if (existingBg && BG_SIGNATURE === signature) return;

  if (existingBg) existingBg.remove();

  var pathPoints = [
      { x: 80, y: 380 },
      { x: 180, y: 290 },
      { x: 280, y: 360 },
      { x: 380, y: 410 },
      { x: 480, y: 490 },
      { x: 580, y: 460 },
      { x: 680, y: 410 },
      { x: 780, y: 260 },
      { x: 880, y: 310 },
      { x: 980, y: 340 },
      { x: 1080, y: 440 },
      { x: 1180, y: 410 },
      { x: 1280, y: 360 },
      { x: 1380, y: 440 },
      { x: 1480, y: 410 },
    ],
    nodesHtml = "",
    displayItems = items.slice();

  if (displayItems.length > 15) displayItems = displayItems.slice(0, 15);

  displayItems.forEach(function (item, i) {
    var idx = Math.floor((i / displayItems.length) * pathPoints.length),
      pt = pathPoints[idx] || pathPoints[0],
      dur = 3 + (i % 4) + i * 0.12,
      isEnded = item.status === "Beendet" || item.status === "closed",
      color = isEnded ? "#5a5a5a" : "#00ffa3",
      logo = getL(item.name),
      logoHtml = logo
        ? '<image class="dyn-logo" href="https://cryptologos.cc/logos/' +
          logo +
          '?v=025" x="' +
          (pt.x - 9) +
          '" y="' +
          (pt.y - 39) +
          '" width="18" height="18" opacity="' +
          (isEnded ? "0.1" : "0.25") +
          '" />'
        : "",
      textY = pt.y - (logo ? 45 : 20),
      safeName = typeof es === "function" ? es(item.name) : item.name,
      safeVal = typeof es === "function" ? es(item.val) : item.val;
    nodesHtml +=
      '<circle cx="' +
      pt.x +
      '" cy="' +
      pt.y +
      '" r="12" fill="' +
      color +
      '" opacity="0.05"><animate attributeName="r" values="8;18;8" dur="' +
      dur +
      's" repeatCount="indefinite"/></circle><circle cx="' +
      pt.x +
      '" cy="' +
      pt.y +
      '" r="3" fill="#050505" stroke="' +
      color +
      '" stroke-width="1.5" opacity="0.5"/>' +
      logoHtml +
      '<text x="' +
      pt.x +
      '" y="' +
      textY +
      '" fill="#7A7A7A" font-size="10px" font-family="monospace" text-anchor="middle" opacity="0.42">' +
      safeName +
      '</text><text x="' +
      pt.x +
      '" y="' +
      (pt.y - 6) +
      '" fill="' +
      color +
      '" font-size="10px" font-weight="bold" text-anchor="middle" opacity="0.5">' +
      (isEnded ? "(Beendet)" : safeVal) +
      '</text>';
  });

  var svgPath =
      "M 0 400 C 100 350, 200 280, 300 350 C 400 420, 500 500, 600 450 C 700 400, 800 250, 900 300 C 1000 350, 1100 450, 1200 400 C 1300 350, 1400 450, 1500 400",
    segment =
      '<g><path d="' +
      svgPath +
      ' L 1500 800 L 0 800 Z" fill="url(#areaGradient)" /><path d="' +
      svgPath +
      '" fill="none" stroke="#00ffa3" stroke-width="1.5" opacity="0.1" stroke-linecap="round" stroke-linejoin="round" />' +
      nodesHtml +
      "</g>",
    bgHtml =
      '<div id="dynamic-bg" data-real="' +
      (isReal ? "true" : "false") +
      '"><div class="dyn-grid"></div><svg width="200%" height="100%" viewBox="0 0 3000 800" preserveAspectRatio="none" style="filter:drop-shadow(0 0 12px rgba(0,255,163,0.1));position:absolute;bottom:0;left:0"><defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#00ffa3" stop-opacity="0.05" /><stop offset="100%" stop-color="#050505" stop-opacity="0" /></linearGradient></defs><g style="animation:dynPanChart 180s linear infinite;will-change:transform">' +
      segment +
      '<g transform="translate(1500, 0)">' +
      segment +
      '</g></g></svg></div>';

  BG_SIGNATURE = signature;
  document.body.insertAdjacentHTML("afterbegin", bgHtml);
}

// Render HTML structure
function R(options) {
  options = options || {};
  var renderScope = options.scope || "all";
  normUi();
  saveUi();
  renderGlobalBackground();
  let nw = new Date().toISOString(),
    av = S.filter((s) => !s.endedAt),
    pa = S.filter((s) => s.endedAt),
    se = S.find((s) => s.id === SI);
  av = sortStrategies(av, false);
  pa = sortStrategies(pa, true);

  var avShown = av.filter(stratIncl),
    ti = avShown.reduce((s, x) => s + ci(x), 0),
    trw = avShown.reduce((s, x) => s + tg(x), 0),
    avApr = avShown,
    tiApr = avApr.reduce((s, x) => s + ci(x), 0);
  var wA =
    avApr.length > 0 && tiApr > 0
      ? avApr.reduce((s, x) => s + wa(x, nw) * ci(x), 0) / tiApr
      : 0;
  var pbp = function (d) {
    var co = new Date(Date.now() - d * 864e5).toISOString(),
      rl = pa.filter((s) => s.endedAt >= co);
    if (!rl.length) return { r: 0, a: 0, c: 0 };
    var inv = rl.reduce((s, x) => s + ci(x), 0);
    var aa =
      inv > 0 ? rl.reduce((s, x) => s + wa(x, x.endedAt) * ci(x), 0) / inv : 0;
    var rw = rl.reduce((s, x) => s + tg(x), 0);
    return { r: rw, a: aa, c: rl.length };
  };

  function cardH(s, isP) {
    var d = db(s.startDate, isP ? s.endedAt : nw),
      a = wa(s, isP ? s.endedAt : nw),
      c = ci(s),
      tk = strategyTokenBadges(s),
      pv = tp(s, false),
      rw = tr(s),
      incl = stratIncl(s);
    var tgl = `<span style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--t4)" onclick="event.stopPropagation()"><label class="sw"><input type="checkbox" ${incl ? "checked" : ""} onchange="togStratApr('${s.id}')"><span class="sl2"></span></label></span>`;
      if (VW === "list") {
        var hl = `<div class="lt-row${incl ? "" : " pia"}" style="column-gap:16px" onclick="SI='${s.id}';V='detail';R()"><span class="lt-name">${es(s.name)}${tk}</span><span class="lt-val">${fn(c)}</span><span class="lt-val ${rw > 0 ? "g" : rw < 0 ? "r" : ""}">${rw > 0 ? "+" : ""}${fn(rw)}</span><span class="lt-val ${pv >= 0 ? "g" : "r"}">${pv !== 0 ? (pv >= 0 ? "+" : "") + fn(pv) : "-"}</span><span class="lt-val" style="padding-right:16px">${d.toFixed(1)} T</span>`;
        hl += `<span class="lt-apr${a > 0 ? "" : a < 0 ? " mt" : " z"}">${a.toFixed(2)}%</span>`;
        hl += `<span class="lt-act">${tgl}`;
        if (!isP)
          hl += `<button class="bt be" onclick="event.stopPropagation();endS('${s.id}')">End</button>`;
        else
          hl += `<button class="bt be" onclick="event.stopPropagation();delS('${s.id}')">X</button>`;
        hl += "</span></div>";
        return hl;
      }
    var hc = `<div class="cd${incl ? "" : " pia"}" onclick="SI='${s.id}';V='detail';R()"><div class="cdh"><h3 class="cdn">${es(s.name)}${tk}</h3><span class="cda${a > 0 ? "" : a < 0 ? " mt" : " z"}">${a.toFixed(2)}%</span></div><div class="cdb">`;
    hc += `<div class="cdr"><span class="cdl">Investment</span><span class="cdv">${fn(c)}</span></div>`;
    hc += `<div class="cdr"><span class="cdl">Rewards</span><span class="cdv ${rw > 0 ? "g" : rw < 0 ? "r" : ""}">${rw > 0 ? "+" : ""}${fn(rw)}</span></div>`;
    hc += `<div class="cdr"><span class="cdl">PNL</span><span class="cdv ${pv >= 0 ? "g" : "r"}">${pv !== 0 ? (pv >= 0 ? "+" : "") + fn(pv) : "0,00"}</span></div>`;
    hc += `<div class="cdr"><span class="cdl">Laufzeit</span><span class="cdv">${d.toFixed(1)} T</span></div>`;
    if (isP)
      hc += `<div class="cdr"><span class="cdl">Beendet</span><span class="cdv">${fd(s.endedAt)}</span></div>`;
    else
      hc += `<div class="cdr"><span class="cdl">Im Gesamtblick</span><span class="cdv ${incl ? "g" : ""}">${incl ? "Aktiv" : "Aus"}</span></div>`;
    hc += `</div><div class="cdf">${tgl}<div class="cdf-actions">`;
    if (!isP)
      hc += `<button class="bt be" onclick="event.stopPropagation();endS('${s.id}')">Beenden</button>`;
    else
      hc += `<button class="bt be" onclick="event.stopPropagation();delS('${s.id}')">Löschen</button>`;
    hc += `<span style="font-size:11px;color:var(--t5)">→</span></div></div></div>`;
    return hc;
  }

  function pgNav(total, curPg, setPgFn) {
    if (total <= ITEMS_PER_PAGE) return "";
    var m = Math.ceil(total / ITEMS_PER_PAGE);
    var h =
      '<div style="display:flex;gap:4px;justify-content:center;margin-top:20px">';
    h +=
      '<button class="bt" style="padding:4px 8px;font-size:12px;background:var(--bg2)" ' +
      (curPg <= 1 ? "disabled" : "") +
      ' onclick="' +
      setPgFn +
      "(" +
      (curPg - 1) +
      ')">←</button>';
    h +=
      '<span style="font-size:12px;color:var(--t2);padding:4px 8px">' +
      curPg +
      " / " +
      m +
      "</span>";
    h +=
      '<button class="bt" style="padding:4px 8px;font-size:12px;background:var(--bg2)" ' +
      (curPg >= m ? "disabled" : "") +
      ' onclick="' +
      setPgFn +
      "(" +
      (curPg + 1) +
      ')">→</button>';
    return h + "</div>";
  }

  let h = SECTION_MARKERS.header;
  if (IS_DEMO) {
    h +=
      '<div style="background:rgba(255,255,255,0.05);color:var(--t);padding:10px 16px;text-align:center;font-size:13px;font-weight:600;display:flex;justify-content:center;align-items:center;gap:16px;z-index:100;position:relative;border:1px solid rgba(255,255,255,0.12);box-shadow:var(--shadow-panel);backdrop-filter:blur(10px);">Du befindest dich im Demo-Modus. Bitte logge dich ein oder erstelle einen Account, um deine eigenen Daten zu verwalten und Fortschritte zu speichern! <button class="bt bp" style="padding:4px 12px;font-size:12px;" onclick="M.login=1;R()">Login / Register</button></div>';
  }

  h +=
    '<header class="hdr"><div class="hl"><div><svg width="26" height="26" viewBox="0 0 28 28"><rect x="2" y="2" width="24" height="24" rx="6" stroke="#00ffa3" stroke-width="2" fill="none"/><path d="M8 18L12 10L16 15L20 8" stroke="#00ffa3" stroke-width="2" stroke-linecap="round"/></svg></div><div><div class="tt">DeFi Vault' +
    (IS_DEMO ? " (DEMO)" : "") +
    '</div><div class="su">Secure Tracker</div></div></div><div class="hr">';

  if (!AUTH.loggedIn && !IS_DEMO) {
    h +=
      '<button class="bt bp" onclick="M.login=1;R()">Login / Registrieren</button></div></header>' +
      SECTION_MARKERS.view +
      '<main class="mn">';
  } else {
    h +=
      '<div class="undo-wrap"><button class="undo-btn' +
      (U.length ? "" : '" disabled') +
      '" onclick="UD=!UD;M.usr=false;R()">↩' +
      (U.length ? " (" + U.length + ")" : "") +
      "</button>";
    if (UD && U.length) {
      h += '<div class="undo-dd">';
      U.slice()
        .reverse()
        .forEach((u) => {
          h +=
            '<div class="undo-item" onclick="event.stopPropagation();doUndo(' +
            u.index +
            ')"><span class="undo-label">' +
            es(u.label) +
            '</span><span class="undo-time">' +
            fd(u.time) +
            "</span></div>";
        });
      h += "</div>";
    }
    h += "</div>";

    h += '<nav class="nv">';
    h +=
      '<button class="' +
      (V === "active" || (V === "detail" && se && !se.endedAt) ? "a" : "") +
      '" onclick="V=\'active\';SI=null;FPI=null;UD=false;M.usr=false;R()">Aktiv</button>';
    h +=
      '<button class="' +
      (V === "past" || (V === "detail" && se && se.endedAt) ? "a" : "") +
      '" onclick="V=\'past\';SI=null;FPI=null;UD=false;M.usr=false;R()">Vergangen</button>';
    h +=
      '<button class="' +
      (V === "frf" || V === "frf_pos" ? "a" : "") +
      "\" onclick=\"FRFV='open';V='frf';SI=null;FPI=null;UD=false;M.usr=false;R()\">FRF</button>";
    h +=
      '<button class="' +
      (V === "looping" ? "a" : "") +
      '" onclick="V=\'looping\';SI=null;FPI=null;LPI=null;UD=false;M.usr=false;loadLoops()">Looping</button>';
    if (AUTH.loggedIn && !IS_DEMO)
      h +=
        '<button class="' +
        (V === "community" ? "a" : "") +
        '" onclick="V=\'community\';SI=null;FPI=null;M.usr=false;loadFeatures();">Community</button>';
    if (canOpenAdmin())
      h +=
        '<button class="' +
        (V === "admin" ? "a" : "") +
        '" onclick="V=\'admin\';SI=null;FPI=null;M.usr=false;loadAdmin();">Admin</button>';
    h += "</nav>";

    let activeP = AUTH.profiles.find((p) => p.id === PID);
    h +=
      '<div style="position:relative"><button class="bt bcn bs" onclick="event.stopPropagation();M.usr=!M.usr;UD=false;R()" style="display:flex;align-items:center;gap:6px"><span class="bdg ac" style="margin:0">' +
      (activeP ? es(activeP.name) : "Kein Profil") +
      '</span><span style="font-size:10px;color:var(--t4)">▼</span></button>';
    if (M.usr) {
      h +=
        '<div class="undo-dd" style="right:0;top:calc(100% + 6px);padding:8px;display:flex;flex-direction:column;gap:4px;min-width:240px" onclick="event.stopPropagation()">';
      if (!IS_DEMO) {
        h +=
          '<button class="bt bcn bs" style="justify-content:space-between;width:100%;padding:10px 12px" onclick="M.usr=false;openMessages(\'inbox\')"><span>Nachrichten Dashboard</span><span class="bdg ' +
          (MSG_SUM.unreadCount || 0 ? "ac" : "en") +
          '" style="margin:0">' +
          (MSG_SUM.unreadCount || 0 ? MSG_SUM.unreadCount + " neu" : "leer") +
          "</span></button>";
        h +=
          '<button class="bt bp" style="justify-content:center;margin-bottom:6px" onclick="cm();M.np=1;R()">+ Neues Profil / Wallet</button>';
        AUTH.profiles.forEach((p) => {
          let sel = p.id === PID;
          h +=
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg2);border-radius:6px;cursor:pointer;border:1px solid ' +
            (sel ? "var(--g)" : "var(--bd)") +
            '" onclick="setPid(\'' +
            p.id +
            '\')"><span style="font-size:13px;color:var(--t2);font-weight:' +
            (sel ? "600" : "400") +
            '">' +
            es(p.name) +
            '</span><div style="display:flex;gap:4px"><button class="bt bed" onclick="event.stopPropagation();M.usr=false;M.eu={id:\'' +
            p.id +
            "',name:'" +
            es(p.name) +
            '\'};R()">✎</button><button class="bt bic" onclick="event.stopPropagation();M.usr=false;delProf(\'' +
            p.id +
            "')\">✕</button></div></div>";
        });
        h += '<div style="height:1px;background:var(--bd);margin:4px 0"></div>';
        h +=
          '<div style="font-size:10px;color:var(--t4);text-align:center;margin-bottom:4px">' +
          es(AUTH.account.email) +
          "</div>";
        h +=
          '<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px;color:var(--t2);margin-bottom:6px;cursor:pointer"><span>Hinweise / Tooltips</span><input type="checkbox" ' +
          (SHOW_HINTS ? "checked" : "") +
          ' onchange="SHOW_HINTS=this.checked;saveUi();R()"></label>';
        if (activeP) {
          h +=
            '<div style="display:flex;gap:4px"><button class="bt bb bs" style="flex:1;justify-content:center" onclick="dBack()">Backup ↓</button><button class="bt by bs" style="flex:1;justify-content:center" onclick="rBack()">Restore ↑</button></div>';
          h +=
            '<button class="bt bp bs" style="margin-top:4px;width:100%;justify-content:center;background:var(--gb);color:var(--g)" onclick="window.location.href=\'/api/export/excel\'">Excel Export (XLSX) ↓</button>';
        }
        h +=
          '<button class="bt bk" style="margin:0;font-size:12px;padding:6px;margin-top:4px" onclick="logout()">Abmelden</button>';
      } else {
        h +=
          '<div style="font-size:13px;color:var(--t2);padding:10px;text-align:center;">Du bist im Demo-Modus.</div>';
        h +=
          '<button class="bt bp" style="justify-content:center" onclick="M.login=1;R()">Login / Register</button>';
      }
      h += "</div>";
    }
    h +=
      '</div></div></header>' + SECTION_MARKERS.view + '<main class="mn">';

    if (!PID && V !== "admin" && V !== "messages")
      h +=
        '<div class="emp">Bitte wähle rechts oben ein Profil (Wallet) aus oder erstelle ein neues.</div>';
    else if (V === "admin") {
      window.ADM_TAB = window.ADM_TAB || "accs";
      h +=
        '<div class="sh" style="margin-bottom:16px"><div style="display:flex;gap:12px;align-items:center"><h2 class="st">Admin Dashboard</h2><div class="vtg"><button class="' +
        (window.ADM_TAB === "accs" ? "a" : "") +
        '" onclick="window.ADM_TAB=\'accs\';R()">Accounts</button><button class="' +
        (window.ADM_TAB === "feats" ? "a" : "") +
        '" onclick="window.ADM_TAB=\'feats\';R()">Feature Requests</button></div></div></div>';

      if (window.ADM_TAB === "accs") {
        h +=
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:16px"><input id="src-adm" type="text" placeholder="Suche (Email)..." value="' +
          es(ADM_SEARCH) +
          '" oninput="ADM_SEARCH=this.value;R()" style="width:180px;padding:8px 12px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg2);color:var(--t)"><select style="width:160px" onchange="ADM_SORT=this.value;R()"><option value="newest" ' +
          (ADM_SORT === "newest" ? "selected" : "") +
          '>Neueste zuerst</option><option value="az" ' +
          (ADM_SORT === "az" ? "selected" : "") +
          '>A-Z</option><option value="usage" ' +
          (ADM_SORT === "usage" ? "selected" : "") +
          '>Häufigste Nutzung</option></select></div><div class="tbl"><div class="tblh"><span style="flex:3">E-Mail</span><span style="flex:1">Status</span><span style="flex:1">Online</span><span style="flex:1">Profile</span><span style="flex:1">Logins (30d)</span><span style="flex:1">Rolle</span><span style="width:84px;text-align:right">Msg</span></div>';
        var shownAccs = (M.accs || []).filter(
          (a) =>
            !ADM_SEARCH ||
            a.email.toLowerCase().includes(ADM_SEARCH.toLowerCase()),
        );
        shownAccs.sort((a, b) => {
          if (ADM_SORT === "newest")
            return (
              new Date(b.createdat).getTime() - new Date(a.createdat).getTime()
            );
          if (ADM_SORT === "az") return a.email.localeCompare(b.email);
          if (ADM_SORT === "usage")
            return (b.loginCount30d || 0) - (a.loginCount30d || 0);
          return 0;
        });
        shownAccs.forEach((a) => {
          h +=
            '<div class="tblr" style="cursor:pointer" onclick="openAdminDetail(\'' +
            a.id +
            '\')"><span style="flex:3;font-size:13px;color:var(--t2)">' +
            es(a.email) +
            '</span><span style="flex:1;font-size:12px">' +
            (a.isverified
              ? '<span style="color:var(--g)">Aktiv</span>'
              : '<span style="color:var(--y)">Wartend</span>') +
            " " +
            (a.isblocked ? '<b style="color:var(--r)">(Gesperrt)</b>' : "") +
            '</span><span style="flex:1;font-size:12px;color:var(--t2)">' +
            onlineBadge(a.lastSeenAt) +
            '</span><span style="flex:1;font-size:12px;color:var(--t2)">' +
            a.profileCount +
            '</span><span style="flex:1;font-size:12px;color:var(--t2)">' +
            (a.loginCount30d || 0) +
            '</span><span style="flex:1;font-size:12px;color:var(--t4)">' +
            roleBadge(a.role) +
            '</span><span style="width:84px;text-align:right"><button class="bt bb bs" onclick="event.stopPropagation();msgComposeUser(\'' +
            es(a.id) +
            "','" +
            es(a.email) +
            "')\">Nachricht</button></span></div>";
        });
        h += "</div>";
      } else {
        h +=
          '<div class="tbl"><div class="tblh"><span style="flex:2">Ersteller</span><span style="flex:3">Titel & Text</span><span style="width:100px;text-align:center">Votes</span><span style="width:140px;text-align:right">Aktion</span></div>';
        (M.admFeat || []).forEach((f) => {
          h +=
            '<div class="tblr"><span style="flex:2;font-size:12px;color:var(--t3)">' +
            es(f.author) +
            '<br><span style="color:var(--t4);font-size:10px">' +
            fd(f.createdat) +
            '</span></span><span style="flex:3;font-size:13px"><b>' +
            es(f.title) +
            '</b><br><span style="color:var(--t2);font-size:12px;white-space:pre-wrap">' +
            es(f.description) +
            "</span></span><span style=\"width:100px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--bp)\">" +
            f.votes +
            '</span><span style="width:140px;text-align:right"><select style="font-size:12px;padding:4px" onchange="adminFeatTgl(\'' +
            f.id +
            '\', this.value)"><option value="pending" ' +
            (f.status === "pending" ? "selected" : "") +
            '>Pending</option><option value="approved" ' +
            (f.status === "approved" ? "selected" : "") +
            '>Approved</option><option value="planned" ' +
            (f.status === "planned" ? "selected" : "") +
            '>Planned</option><option value="implemented" ' +
            (f.status === "implemented" ? "selected" : "") +
            '>Implemented</option><option value="rejected" ' +
            (f.status === "rejected" ? "selected" : "") +
            ">Rejected</option></select></span></div>";
        });
        h += "</div>";
      }
    } else if (V === "active") {
      var openFrfAct = FR.positions.filter(function (p) {
          return !p.endedAt && posIncl(p);
        }),
        frfCapAct = openFrfAct.reduce(function (a, p) {
          return a + posCapital(p);
        }, 0),
        frfAprAct = frfTotalApr(openFrfAct),
        mixCap = tiApr + frfCapAct,
        mixApr = mixCap > 0 ? (wA * tiApr + frfAprAct * frfCapAct) / mixCap : 0;
      h +=
        '<div class="sm"><div class="sc"><span class="sl">Investment</span><span class="sv">' +
        fn(ti) +
        ' <span class="u">USDC</span></span></div><div class="sc"><span class="sl">Gains</span><span class="sv ' +
        (trw > 0 ? "g" : trw < 0 ? "r" : "") +
        '">' +
        (trw > 0 ? "+" : "") +
        fn(trw) +
        ' <span class="u">USDC</span></span></div><div class="sc"><span class="sl">APR gesamt</span><span class="sv ' +
        (wA > 0 ? "g" : wA < 0 ? "r" : "") +
        '">' +
        wA.toFixed(2) +
        '%</span></div><div class="sc"><span class="sl">APR Strat + FRF</span><span class="sv ' +
        (mixApr > 0 ? "g" : mixApr < 0 ? "r" : "") +
        '">' +
        (mixApr > 0 ? "+" : "") +
        mixApr.toFixed(2) +
        "%</span></div></div>";
      h +=
        '<div class="sh"><h2 class="st">Aktive Strategien</h2><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="src-act" type="text" placeholder="Suche..." value="' +
        es(SEARCH_ACT) +
        '" oninput="SEARCH_ACT=this.value;PG_ACT=1;R()" style="width:140px;padding:6px 12px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg2);color:var(--t);font-size:13px"><div class="vtg"><button class="' +
        (VW === "grid" ? "a" : "") +
        '" onclick="VW=\'grid\';R()">▦</button><button class="' +
        (VW === "list" ? "a" : "") +
        '" onclick="VW=\'list\';R()">☰</button></div><button class="bt bp" onclick="M.cr=1;R()"><span style="font-size:17px">+</span> Neu</button></div></div>';
      var fAV = SEARCH_ACT
        ? av.filter(
            (s) =>
              s.name.toLowerCase().includes(SEARCH_ACT.toLowerCase()) ||
              strategyTokenSearchText(s).includes(SEARCH_ACT.toLowerCase()),
          )
        : av;
      if (!fAV.length)
        h += '<div class="emp">Keine aktiven Strategien gefunden.</div>';
      else {
        var pgAV = fAV.slice(
          (PG_ACT - 1) * ITEMS_PER_PAGE,
          PG_ACT * ITEMS_PER_PAGE,
        );
        if (VW === "list") {
          h +=
            '<div class="lt"><div class="lt-hdr" style="column-gap:16px">' +
            sortableHeader('Name', 'strategy', 'name') +
            sortableHeader('Invest', 'strategy', 'invest', 'text-align:right') +
            sortableHeader('Rewards', 'strategy', 'rewards', 'text-align:right') +
            sortableHeader('PNL', 'strategy', 'pnl', 'text-align:right') +
            sortableHeader('Laufzeit', 'strategy', 'runtime', 'text-align:right;padding-right:16px') +
            sortableHeader('APR', 'strategy', 'apr', 'text-align:center') +
            '<span></span></div>';
          pgAV.forEach(function (s) {
            h += cardH(s, false);
          });
          h += "</div>";
        } else {
          h += '<div class="gd">';
          pgAV.forEach(function (s) {
            h += cardH(s, false);
          });
          h += "</div>";
        }
        h += pgNav(fAV.length, PG_ACT, "setPgAct");
      }
    } else if (V === "past") {
      var paIncl = pa.filter(stratIncl),
        _tInv = paIncl.reduce((s, x) => s + ci(x), 0),
        _tRw = paIncl.reduce((s, x) => s + tg(x), 0),
        _tApr =
          _tInv > 0
            ? paIncl.reduce((s, x) => s + wa(x, x.endedAt) * ci(x), 0) / _tInv
            : 0;
      h +=
        '<h2 class="st" style="margin-bottom:14px">Vergangene Strategien</h2><div class="pgd">';
      h +=
        '<div class="pcd"><span class="pcl" style="font-size:14px">APR gesamt</span><span class="pca ' +
        (_tApr > 0 ? "g" : _tApr < 0 ? "r" : "") +
        '" style="font-size:24px">' +
        _tApr.toFixed(2) +
        '%</span><span class="pcc" style="font-size:12px">' +
        paIncl.length +
        " aktiv in APR</span></div>";
      h +=
        '<div class="pcd" style="grid-column:span 2;min-width:200px"><span class="pcl" style="font-size:14px">Rewards</span><span class="pca ' +
        (_tRw > 0 ? "g" : _tRw < 0 ? "r" : "") +
        '" style="font-size:22px;line-height:1.1;word-break:break-word">' +
        (_tRw > 0 ? "+" : "") +
        fn(_tRw) +
        '</span><span class="pcc" style="font-size:12px">' +
        paIncl.length +
        " im Gesamtblick</span></div></div>";
      h +=
        '<div class="sh"><div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="src-past" type="text" placeholder="Suche..." value="' +
        es(SEARCH_PAST) +
        '" oninput="SEARCH_PAST=this.value;PG_PAST=1;R()" style="width:140px;padding:6px 12px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg2);color:var(--t);font-size:13px"><div class="vtg"><button class="' +
        (VW === "grid" ? "a" : "") +
        '" onclick="VW=\'grid\';R()">▦</button><button class="' +
        (VW === "list" ? "a" : "") +
        '" onclick="VW=\'list\';R()">☰</button></div></div></div>';
      var fPA = SEARCH_PAST
        ? pa.filter(
            (s) =>
              s.name.toLowerCase().includes(SEARCH_PAST.toLowerCase()) ||
              strategyTokenSearchText(s).includes(SEARCH_PAST.toLowerCase()),
          )
        : pa;
      if (!fPA.length)
        h += '<div class="emp">Keine vergangenen Strategien gefunden.</div>';
      else {
        var pgPA = fPA.slice(
          (PG_PAST - 1) * ITEMS_PER_PAGE,
          PG_PAST * ITEMS_PER_PAGE,
        );
        if (VW === "list") {
          h +=
            '<div class="lt"><div class="lt-hdr" style="column-gap:16px">' +
            sortableHeader('Name', 'strategy', 'name') +
            sortableHeader('Invest', 'strategy', 'invest', 'text-align:right') +
            sortableHeader('Rewards', 'strategy', 'rewards', 'text-align:right') +
            sortableHeader('PNL', 'strategy', 'pnl', 'text-align:right') +
            sortableHeader('Laufzeit', 'strategy', 'runtime', 'text-align:right;padding-right:16px') +
            sortableHeader('APR', 'strategy', 'apr', 'text-align:center') +
            '<span></span></div>';
          pgPA.forEach(function (s) {
            h += cardH(s, true);
          });
          h += "</div>";
        } else {
          h += '<div class="gd">';
          pgPA.forEach(function (s) {
            h += cardH(s, true);
          });
          h += "</div>";
        }
        h += pgNav(fPA.length, PG_PAST, "setPgPast");
      }
    } else if (V === "detail" && se) {
      var _ci = ci(se),
        _tr = tr(se),
        _tp = tp(se, false),
        _d = db(se.startDate, se.endedAt || nw),
        _a = wa(se, se.endedAt || nw),
        ps = bp(se, se.endedAt || nw);
      h +=
        '<button class="bt bk" onclick="SI=null;V=\'' +
        (se.endedAt ? "past" : "active") +
        "';R()\">← Zurück</button>";
      h +=
        '<div class="dhd"><div><div class="dhn">' +
        es(se.name) +
        '</div><span class="bdg ' +
        (se.endedAt ? "en" : "ac") +
        '">' +
        (se.endedAt ? "Beendet" : "Aktiv") +
        '</span>' +
        (se.endedAt
          ? '<button class="bt bb bs" style="margin-left:8px" onclick="reaS(\'' +
            se.id +
            '\')">Reaktivieren</button>'
          : '') +
        "";
      var linkedPos = FR.positions.filter(function (p) {
        return p.linkedStrategyId === se.id;
      });
      linkedPos.forEach(function (lp) {
        h +=
          '<span class="bdg ' +
          (lp.type === "frf" ? "frf" : "hdg") +
          '" style="cursor:pointer;margin-left:4px" onclick="FPI=\'' +
          lp.id +
          "';V='frf_pos';R()\">↗ " +
          (lp.type === "frf" ? "FRF" : "Hedge") +
          ": " +
          es(lp.token) +
          "</span>";
      });
      h +=
        '</div><div class="dha" style="color:' +
        (_a > 0 ? "var(--g)" : _a < 0 ? "var(--r)" : "var(--t3") +
        '">' +
        _a.toFixed(2) +
        '% <span class="u">APR</span></div></div>';
      h +=
        '<div class="dsg"><div class="dsi"><span class="dsl">Investment</span><span class="dsv">' +
        fn(_ci) +
        '</span></div><div class="dsi"><span class="dsl">Rewards</span><span class="dsv ' +
        (_tr > 0 ? "g" : _tr < 0 ? "r" : "") +
        '">' +
        (_tr > 0 ? "+" : "") +
        fn(_tr) +
        '</span></div><div class="dsi"><span class="dsl">PNL</span><span class="dsv ' +
        (_tp >= 0 ? "g" : "r") +
        '">' +
        (_tp >= 0 ? "+" : "") +
        fn(_tp) +
        '</span></div><div class="dsi"><span class="dsl">Laufzeit</span><span class="dsv">' +
        _d.toFixed(1) +
        " T</span></div></div>";
      var tokenSummary = strategyTokenSummary(se),
        legacyTokenOnly = !!(se.token && se.token.name) && !strategyHasTokenEvents(se);
      h +=
        '<div class="sh" style="margin-top:24px"><h3 class="st">Token</h3>' +
        (legacyTokenOnly ? '<button class="bt by" onclick="M.tk=1;R()">✎</button>' : '') +
        '</div>';
      if (tokenSummary.length) {
        h += '<div style="display:grid;gap:10px">';
        tokenSummary.forEach(function (token) {
          h +=
            '<div class="ibx"><div class="igr"><div class="iti"><span class="itl">Token</span><span class="itv">' +
            es(token.name) +
            '</span></div><div class="iti"><span class="itl">Gesamtmenge</span><span class="itv">' +
            fn(token.amount) +
            '</span></div><div class="iti"><span class="itl">Ø Entry</span><span class="itv">' +
            (token.entryPrice > 0 ? '$' + fn(token.entryPrice) : '—') +
            '</span></div><div class="iti"><span class="itl">Wert</span><span class="itv">' +
            (token.entryPrice > 0 ? '$' + fn(token.value) : '—') +
            '</span></div></div></div>';
        });
        h += '</div>';
      } else h += '<div class="ibx"><span class="nem">Kein Token</span></div>';
      h +=
        '<div class="sh" style="margin-top:24px"><h3 class="st">Notizen</h3><button class="bt bb" onclick="M.no=1;R()">✎</button></div>';
      h += se.notes
        ? '<div class="nbx">' + es(se.notes) + "</div>"
        : '<div class="nbx"><span class="nem">Keine Notizen</span></div>';
      var ek1 = "inv_" + se.id,
        isO1 = EXP[ek1];
      h +=
        '<div class="sh" style="margin-top:24px"><h3 class="st">Investment: ' +
        fn(_ci) +
        " USDC</h3>" +
        (!se.endedAt
          ? '<button class="bt by" onclick="M.iv=1;R()">✎</button>'
          : "") +
        "</div>";
      var curP = ps[ps.length - 1],
        prevPs = ps.slice(0, -1);
      if (curP) {
        h +=
          '<div class="tln"><div class="tli cur"><div class="tld"></div><div class="tlc"><div class="tlh"><div><span class="tla">' +
          fn(curP.amount) +
          "</span>" +
          (curP.change !== null
            ? curP.change >= 0
              ? '<span class="tlch up">+' + fn(curP.change) + "</span>"
              : '<span class="tlch dn">' + fn(curP.change) + "</span>"
            : "") +
          '</div><div style="display:flex;gap:6px;align-items:center"><span class="tlap" style="color:' +
          (curP.apr > 0
            ? "var(--g)"
            : curP.apr < 0
              ? "var(--r)"
              : "var(--t4)") +
          ";background:" +
          (curP.apr > 0
            ? "var(--gb)"
            : curP.apr < 0
              ? "var(--rb)"
              : "rgba(138,143,152,.08)") +
          '">' +
          curP.apr.toFixed(2) +
          '%</span><button class="bt bed" onclick="event.stopPropagation();M.ei={sid:\'' +
          se.id +
          "',eid:'" +
          curP.id +
          "',amt:" +
          curP.amount +
          ",dt:'" +
          curP.date +
          "',nt:'" +
          es(
            (se.investmentHistory.find((x) => x.id === curP.id) || {}).note ||
              "",
          ) +
          "'};R()\">✎</button></div></div>";
        h +=
          '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px"><div class="tlm" style="flex:1;min-width:200px"><div class="tlmi"><span class="tlml">Von</span><span class="tlmv">' +
          fd(curP.date) +
          '</span></div><div class="tlmi"><span class="tlml">Bis</span><span class="tlmv">' +
          (se.endedAt ? fd(curP.endDate) : "Jetzt") +
          '</span></div><div class="tlmi"><span class="tlml">Dauer</span><span class="tlmv">' +
          curP.days.toFixed(1) +
          ' T</span></div><div class="tlmi"><span class="tlml">Rew</span><span class="tlmv" style="color:' +
          (curP.rewards > 0
            ? "var(--g)"
            : curP.rewards < 0
              ? "var(--r)"
              : "var(--t2)") +
          '">' +
          (curP.rewards > 0 ? "+" : "") +
          fn(curP.rewards) +
          "</span></div></div>";
        var curN = (se.investmentHistory.find((x) => x.id === curP.id) || {})
          .note;
        var curTokens = renderStrategyTokenChanges(se.investmentHistory.find((x) => x.id === curP.id) || {});
        if (curN)
          h +=
            '<div style="flex:1;min-width:140px;border-left:1px solid var(--bd2);padding-left:14px"><div style="font-size:10px;color:var(--t4);text-transform:uppercase;margin-bottom:2px">Notiz:</div><div style="font-size:12px;color:var(--t2);line-height:1.4">' +
            es(curN) +
            "</div></div>";
        if (curTokens)
          h +=
            '<div style="flex-basis:100%;margin-top:10px"><div style="font-size:10px;color:var(--t4);text-transform:uppercase;margin-bottom:4px">Tokenänderungen</div><div>' +
            curTokens +
            '</div></div>';
        h += "</div></div></div></div>";
      }
      if (prevPs.length > 0) {
        h +=
          '<button class="col-btn' +
          (isO1 ? " open" : "") +
          '" onclick="tgl(\'' +
          ek1 +
          '\')"><span class="arr">▼</span> ' +
          prevPs.length +
          ' vorherige Phasen</button><div class="col-ct' +
          (isO1 ? " open" : "") +
          '">';
      }
      if (isO1 && prevPs.length > 0) {
        h += '<div class="tln">';
        ps.slice()
          .reverse()
          .forEach(function (p) {
            var ct =
              p.change !== null
                ? p.change >= 0
                  ? '<span class="tlch up">+' + fn(p.change) + "</span>"
                  : '<span class="tlch dn">' + fn(p.change) + "</span>"
                : "";
            h +=
              '<div class="tli' +
              (p.isCurrent ? " cur" : "") +
              '"><div class="tld"></div><div class="tlc"><div class="tlh"><div><span class="tla">' +
              fn(p.amount) +
              "</span>" +
              ct +
              '</div><div style="display:flex;gap:6px;align-items:center"><span class="tlap" style="color:' +
              (p.apr > 0 ? "var(--g)" : p.apr < 0 ? "var(--r)" : "var(--t4)") +
              ";background:" +
              (p.apr > 0
                ? "var(--gb)"
                : p.apr < 0
                  ? "var(--rb)"
                  : "rgba(138,143,152,.08)") +
              '">' +
              p.apr.toFixed(2) +
              '%</span><button class="bt bed" onclick="event.stopPropagation();M.ei={sid:\'' +
              se.id +
              "',eid:'" +
              p.id +
              "',amt:" +
              p.amount +
              ",dt:'" +
              p.date +
              "',nt:'" +
              es(
                (se.investmentHistory.find((x) => x.id === p.id) || {}).note ||
                  "",
              ) +
              "'};R()\">✎</button></div></div>";
            h +=
              '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px"><div class="tlm" style="flex:1;min-width:200px"><div class="tlmi"><span class="tlml">Von</span><span class="tlmv">' +
              fd(p.date) +
              '</span></div><div class="tlmi"><span class="tlml">Bis</span><span class="tlmv">' +
              (p.isCurrent && !se.endedAt ? "Jetzt" : fd(p.endDate)) +
              '</span></div><div class="tlmi"><span class="tlml">Dauer</span><span class="tlmv">' +
              p.days.toFixed(1) +
              ' T</span></div><div class="tlmi"><span class="tlml">Rew</span><span class="tlmv" style="color:' +
              (p.rewards > 0
                ? "var(--g)"
                : p.rewards < 0
                  ? "var(--r)"
                  : "var(--t2)") +
              '">' +
              (p.rewards > 0 ? "+" : "") +
              fn(p.rewards) +
              "</span></div></div>";
            var invN = (se.investmentHistory.find((x) => x.id === p.id) || {})
              .note;
            var invTokens = renderStrategyTokenChanges(se.investmentHistory.find((x) => x.id === p.id) || {});
            if (invN)
              h +=
                '<div style="flex:1;min-width:140px;border-left:1px solid var(--bd2);padding-left:14px"><div style="font-size:10px;color:var(--t4);text-transform:uppercase;margin-bottom:2px">Notiz:</div><div style="font-size:12px;color:var(--t2);line-height:1.4">' +
                es(invN) +
                "</div></div>";
            if (invTokens)
              h +=
                '<div style="flex-basis:100%;margin-top:10px"><div style="font-size:10px;color:var(--t4);text-transform:uppercase;margin-bottom:4px">Tokenänderungen</div><div>' +
                invTokens +
                '</div></div>';
            h += "</div></div></div>";
          });
        h += "</div>";
      }
      if (ps.length > 1) h += "</div>";
      var ek2 = "pnl_" + se.id,
        isO2 = EXP[ek2],
        pnlCt = (se.pnl || []).length;
      h +=
        '<div class="sh" style="margin-top:24px"><h3 class="st">PNL: ' +
        (_tp >= 0 ? "+" : "") +
        fn(_tp) +
        '</h3><button class="bt bpr bs" onclick="M.pl=1;R()"><span style="font-size:16px">+</span> PNL</button></div>';
      if (pnlCt > 0) {
        h +=
          '<button class="col-btn' +
          (isO2 ? " open" : "") +
          '" onclick="tgl(\'' +
          ek2 +
          '\')"><span class="arr">▼</span> ' +
          pnlCt +
          ' Einträge</button><div class="col-ct' +
          (isO2 ? " open" : "") +
          '">';
        h +=
          '<div class="tbl"><div class="tblh"><span style="flex:2">Datum</span><span style="flex:2">Notiz</span><span style="flex:1;text-align:right">Betrag</span><span style="width:50px;text-align:center">APR</span><span style="width:56px"></span></div>';
        se.pnl
          .slice()
          .reverse()
          .forEach(function (p) {
            var cl = p.amount >= 0 ? "var(--g)" : "var(--r)",
              ia = p.includeInAPR;
            h +=
              '<div class="tblr' +
              (ia ? "" : " pia") +
              '"><span style="flex:2;color:var(--t2);font-size:12px">' +
              fd(p.date) +
              '</span><span style="flex:2;color:var(--t3);font-size:12px">' +
              es(p.note || "") +
              '</span><span style="flex:1;text-align:right;color:' +
              cl +
              ";font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px\">" +
              (p.amount >= 0 ? "+" : "") +
              fn(p.amount) +
              '</span><span style="width:50px;text-align:center"><label class="sw"><input type="checkbox" ' +
              (ia ? "checked" : "") +
              " onchange=\"togP('" +
              se.id +
              "','" +
              p.id +
              '\')"><span class="sl2"></span></label></span><span style="width:56px;text-align:right;display:flex;gap:2px"><button class="bt bed" onclick="M.ep={sid:\'' +
              se.id +
              "',pid:'" +
              p.id +
              "',amt:" +
              p.amount +
              ",nt:'" +
              es(p.note || "") +
              "',dt:'" +
              p.date +
              '\'};R()">✎</button><button class="bt bic" onclick="delP(\'' +
              se.id +
              "','" +
              p.id +
              "')\">✕</button></span></div>";
          });
        h += "</div></div>";
      }
      var ek3 = "rew_" + se.id,
        isO3 = EXP[ek3],
        rwCt = se.rewards.length;
      h +=
        '<div class="sh" style="margin-top:24px"><h3 class="st" style="color:' +
        (_tr > 0 ? "var(--g)" : _tr < 0 ? "var(--r)" : "var(--t2") +
        '">Rewards: ' +
        (_tr > 0 ? "+" : "") +
        fn(_tr) +
        '</h3><button class="bt bp bs" onclick="M.rw=1;R()"><span style="font-size:16px">+</span> Reward</button></div>';
      if (rwCt > 0) {
        h +=
          '<button class="col-btn' +
          (isO3 ? " open" : "") +
          '" onclick="tgl(\'' +
          ek3 +
          '\')"><span class="arr">▼</span> ' +
          rwCt +
          ' Einträge</button><div class="col-ct' +
          (isO3 ? " open" : "") +
          '">';
        h +=
          '<div class="tbl"><div class="tblh"><span style="flex:2">Datum</span><span style="flex:2">Notiz</span><span style="flex:1;text-align:right">Betrag</span><span style="width:56px"></span></div>';
        se.rewards
          .slice()
          .reverse()
          .forEach(function (r) {
            h +=
              '<div class="tblr"><span style="flex:2;color:var(--t2);font-size:13px">' +
              fd(r.date) +
              '</span><span style="flex:2;color:var(--t3);font-size:12px">' +
              es(r.note || "") +
              '</span><span style="flex:1;text-align:right;color:' +
              (r.amount > 0
                ? "var(--g)"
                : r.amount < 0
                  ? "var(--r)"
                  : "var(--t2") +
              ";font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px\">" +
              (r.amount > 0 ? "+" : "") +
              fn(r.amount) +
              '</span><span style="width:56px;text-align:right;display:flex;gap:2px"><button class="bt bed" onclick="M.er={sid:\'' +
              se.id +
              "',rid:'" +
              r.id +
              "',amt:" +
              r.amount +
              ",nt:'" +
              es(r.note || "") +
              "',dt:'" +
              r.date +
              '\'};R()">✎</button><button class="bt bic" onclick="delR(\'' +
              se.id +
              "','" +
              r.id +
              "')\">✕</button></span></div>";
          });
        h += "</div></div>";
      }
      h += '<div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap">';
      if (!se.endedAt)
        h +=
          '<button class="bt be" style="padding:10px 22px;font-size:13px" onclick="endS(\'' +
          se.id +
          "')\">Beenden</button>";
      if (se.endedAt) {
        h +=
          '<button class="bt by" style="padding:10px 22px;font-size:13px" onclick="M.ed=1;R()">Enddatum</button>';
      }
      h += "</div>";
    } else if (V === "frf") {
      var openPos = FR.positions.filter(function (p) {
          return !p.endedAt;
        }),
        openCalc = openPos.filter(posIncl),
        closedPos = FR.positions.filter(function (p) {
          return p.endedAt;
        });
      var totalMargin = FR.exchanges.reduce(function (a, e) {
        return a + exMargin(e);
      }, 0);
      var totalPosSize = FR.exchanges.reduce(function (a, ex) {
        var exPos = openCalc.filter(function (p) {
          return (
            p.shortExchangeId === ex.id ||
            (!p.longIsSpot && p.longExchangeId === ex.id)
          );
        });
        return (
          a +
          exPos.reduce(function (acc, p) {
            return acc + posLiveSize(p);
          }, 0)
        );
      }, 0);
      var totalLev = totalMargin > 0 ? totalPosSize / totalMargin : 0;
      var totalFrfApr = frfTotalApr(openCalc);
      var totalFundAll = FR.positions.filter(posIncl).reduce(function (a, p) {
        return (
          a + runningFunding(p) + (p.closePnlShort || 0) + (p.closePnlLong || 0)
        );
      }, 0);
      var totalFrfPnl = openCalc.reduce(function (a, p) {
        return a + runningFunding(p);
      }, 0);
      h +=
        '<div class="sm"><div class="sc"><span class="sl">Gesamt Margin</span><span class="sv">' +
        fn(totalMargin) +
        ' <span class="u">USDC</span></span></div><div class="sc"><span class="sl">Pos. Volumen</span><span class="sv">' +
        fn(totalPosSize) +
        ' <span class="u">USDC</span></span></div><div class="sc"><span class="sl">Ges. Hebel</span><span class="sv">' +
        totalLev.toFixed(2) +
        'x</span></div><div class="sc"><span class="sl">APR Gesamt</span><span class="sv ' +
        (totalFrfApr > 0 ? "g" : totalFrfApr < 0 ? "r" : "") +
        '">' +
        totalFrfApr.toFixed(2) +
        "%</span></div></div>";
      var ekFA = "frf_all",
        isFA = EXP[ekFA];
      h +=
        '<button class="col-btn' +
        (isFA ? " open" : "") +
        '" onclick="tgl(\'' +
        ekFA +
        '\')"><span class="arr">▼</span> Gesamt (inkl. geschlossen): ' +
        (totalFundAll >= 0 ? "+" : "") +
        fn(totalFundAll) +
        ' USDC</button><div class="col-ct' +
        (isFA ? " open" : "") +
        '" style="margin-bottom:20px"><div class="ibx"><div class="igr"><div class="iti"><span class="itl">Aktive</span><span class="itv" style="color:' +
        (totalFrfPnl >= 0 ? "var(--g)" : "var(--r)") +
        '">' +
        (totalFrfPnl >= 0 ? "+" : "") +
        fn(totalFrfPnl) +
        '</span></div><div class="iti"><span class="itl">Geschlossene</span><span class="itv">' +
        fn(totalFundAll - totalFrfPnl) +
        '</span></div><div class="iti"><span class="itl">Gesamt</span><span class="itv" style="color:' +
        (totalFundAll >= 0 ? "var(--g)" : "var(--r)") +
        '">' +
        (totalFundAll >= 0 ? "+" : "") +
        fn(totalFundAll) +
        "</span></div></div></div></div>";
      h +=
        '<div class="sh"><h2 class="st">Börsen</h2><button class="bt bp bs" onclick="M.fex=1;R()"><span style="font-size:17px">+</span> Börse</button></div>';
      if (!FR.exchanges.length)
        h += '<div class="emp">Keine Börsen angelegt.</div>';
      FR.exchanges.forEach(function (ex) {
        var mg = exMargin(ex);
        var exPos = openPos.filter(function (p) {
          return (
            p.shortExchangeId === ex.id ||
            (!p.longIsSpot && p.longExchangeId === ex.id)
          );
        });
        var exVol = exPos.reduce(function (a, p) {
          return a + posLiveSize(p);
        }, 0);
        var lev = mg > 0 ? exVol / mg : 0;
        var ek = "ex_" + ex.id,
          isO = EXP[ek];
        h +=
          '<div class="exc"><div class="exc-h"><span class="exc-n">' +
          es(ex.name) +
          '</span><div style="display:flex;gap:6px"><button class="bt by bs" onclick="M.fexm={id:\'' +
          ex.id +
          '\'};R()">+ Margin</button>' +
          (ex.marginHistory.length > 1
            ? '<button class="bt bcn bs" title="Margin-Historie" onclick="tgl(\'' +
              ek +
              '\')">▾</button>'
            : '') +
          '<button class="bt bed" onclick="M.feex={id:\'' +
          ex.id +
          "',name:'" +
          es(ex.name) +
          "',margin:" +
          mg +
          '};R()">✎</button><button class="bt bic" onclick="frfDelEx(\'' +
          ex.id +
          "')\">✕</button></div></div>";
        h +=
          '<div class="exc-stats"><div class="exc-stat"><span class="exc-sl">Margin</span><span class="exc-sv">' +
          fn(mg) +
          '</span></div><div class="exc-stat"><span class="exc-sl">Pos. Vol.</span><span class="exc-sv">' +
          fn(exVol) +
          '</span></div><div class="exc-stat"><span class="exc-sl">Hebel</span><span class="exc-sv">' +
          lev.toFixed(2) +
          'x</span></div><div class="exc-stat"><span class="exc-sl">Positionen</span><span class="exc-sv">' +
          exPos.length +
          "</span></div></div>";
        if (ex.marginHistory.length > 1) {
          h +=
            '<div class="col-ct' +
            (isO ? " open" : "") +
            '" style="margin-top:10px">';
          h +=
            '<div class="tbl" style="margin-top:8px"><div class="tblh"><span style="flex:1">Datum</span><span style="flex:1">Notiz</span><span style="flex:1;text-align:right">Betrag</span><span style="width:56px"></span></div>';
          ex.marginHistory
            .slice()
            .reverse()
            .forEach(function (m) {
              h +=
                '<div class="tblr"><span style="flex:1;font-size:12px;color:var(--t2)">' +
                fd(m.date) +
                '</span><span style="flex:1;font-size:12px;color:var(--t3)">' +
                es(m.note || "") +
                "</span><span style=\"flex:1;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;color:" +
                (m.amount >= 0 ? "var(--g)" : "var(--r)") +
                '">' +
                (m.amount >= 0 ? "+" : "") +
                fn(m.amount) +
                '</span><span style="width:56px;text-align:right;display:flex;gap:2px"><button class="bt bed" onclick="M.femm={eid:\'' +
                ex.id +
                "',mid:'" +
                m.id +
                "',amt:" +
                m.amount +
                ",nt:'" +
                es(m.note || "") +
                "',dt:'" +
                m.date +
                '\'};R()">✎</button><button class="bt bic" onclick="F(\'/api/frf/exchanges/' +
                ex.id +
                "/margin/" +
                m.id +
                "',{method:'DELETE'}).then(loadData)\">✕</button></span></div>";
            });
          h += "</div></div>";
        }
        h += "</div>";
      });
      h +=
        '<div class="sh" style="margin-top:24px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2 class="st">Positionen</h2><div class="vtg" style="margin-left:8px"><button class="' +
        (window.FRFV === "open" ? "a" : "") +
        '" onclick="window.FRFV=\'open\';PG_FRFO=1;PG_FRFC=1;R()">Offen (' +
        openPos.length +
        ')</button><button class="' +
        (window.FRFV === "closed" ? "a" : "") +
        '" onclick="window.FRFV=\'closed\';PG_FRFO=1;PG_FRFC=1;R()">Vergangen (' +
        closedPos.length +
        ')</button></div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="src-frf" type="text" placeholder="Suche..." value="' +
        es(SEARCH_FRF) +
        '" oninput="SEARCH_FRF=this.value;PG_FRFO=1;PG_FRFC=1;R()" style="width:140px;padding:6px 12px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg2);color:var(--t);font-size:13px"><button class="bt bo" onclick="M.fpos=1;R()"><span style="font-size:17px">+</span> Position</button></div></div>';
      var shownPos = sortFrf(window.FRFV === "open" ? openPos : closedPos);
      if (SEARCH_FRF)
        shownPos = shownPos.filter((p) =>
          (p.token || "").toLowerCase().includes(SEARCH_FRF.toLowerCase()),
        );

      if (!shownPos.length)
        h +=
          '<div class="emp">' +
          (window.FRFV === "open"
            ? "Keine offenen Positionen gefunden."
            : "Keine vergangenen Positionen gefunden.") +
          "</div>";
      else {
        var isO = window.FRFV === "open";
        var pgFRF = shownPos.slice(
          ((isO ? PG_FRFO : PG_FRFC) - 1) * ITEMS_PER_PAGE,
          (isO ? PG_FRFO : PG_FRFC) * ITEMS_PER_PAGE,
        );
        h +=
          '<div class="lt"><div class="lt-hdr" style="grid-template-columns:1fr .7fr 1.1fr 1fr .88fr 90px;column-gap:18px">' +
          sortableHeader('Token', 'frf', 'token') +
          sortableHeader('Typ', 'frf', 'type', 'text-align:center') +
          sortableHeader('Pos.-Größe', 'frf', 'size', 'text-align:right') +
          sortableHeader('Tokenmenge', 'frf', 'amount', 'text-align:right') +
          sortableHeader('PNL aktuell', 'frf', 'pnl', 'text-align:right;padding-right:14px') +
          sortableHeader('APR', 'frf', 'apr', 'text-align:center') +
          '</div>';
        pgFRF.forEach(function (p) {
          var pnl = posPnl(p),
            d = db(p.startDate, p.endedAt || nw),
            cap = posAprCapital(p, FR.positions, FR.exchanges, p.endedAt || nw),
            fundingAprBase = frfFundingContribution(p),
            a = calcApr(fundingAprBase - (p.fees || 0), cap, d),
            liveSize = posLiveSize(p),
            ty = p.type === "hedge" ? "Hedge" : "FRF";
          h +=
            '<div class="lt-row' +
            (posIncl(p) ? "" : " pia") +
            '" style="grid-template-columns:1fr .7fr 1.1fr 1fr .88fr 90px;column-gap:18px" onclick="FPI=\'' +
            p.id +
            "';V='frf_pos';R()\"><span class=\"lt-name\">" +
            es(p.token) +
            (p.endedAt ? '<span class="tkb">zu</span>' : "") +
            '</span><span style="text-align:center"><span class="bdg ' +
            (p.type === "hedge" ? "hdg" : "frf") +
            '" style="margin:0">' +
            ty +
            '</span></span><span class="lt-val">' +
            fn(liveSize) +
            '</span><span class="lt-val">' +
            fn(p.tokenAmount) +
            '</span><span class="lt-val ' +
            (pnl >= 0 ? "g" : "r") +
            '" style="padding-right:14px">' +
            (pnl >= 0 ? "+" : "") +
            fn(pnl) +
            '</span><span class="lt-apr' +
            (a > 0 ? "" : a < 0 ? " mt" : " z") +
            '">' +
            a.toFixed(2) +
            "%</span></div>";
        });
        h += "</div>";
        h += pgNav(
          shownPos.length,
          isO ? PG_FRFO : PG_FRFC,
          isO ? "setPgFrfO" : "setPgFrfC",
        );
      }
    } else if (V === "frf_pos" && FPI) {
        var fp = FR.positions.find((x) => x.id === FPI);
        if (fp) {
          var pnl = posPnl(fp),
            d = db(fp.startDate, fp.endedAt || nw),
            cap = posCapital(fp),
            aprCap = posAprCapital(fp, FR.positions, FR.exchanges, fp.endedAt || nw),
            fundingAprBase = frfFundingContribution(fp),
            a = calcApr(fundingAprBase - fp.fees, aprCap, d),
            pr = PRICES[fp.token ? fp.token.toUpperCase() : ""],
            liveSize = posLiveSize(fp),
            rpnl = runningFunding(fp),
          isClosed = !!fp.endedAt;
        if (!isClosed) frfEnsureLive(fp.id);
        var linkedS = fp.linkedStrategyId
          ? S.find((s) => s.id === fp.linkedStrategyId)
          : null;
        var linkedL = fp.linkedLoopId
          ? LO.find((l) => l.id === fp.linkedLoopId)
          : null;
        var live = isClosed ? null : frfLiveQuote(fp.id),
          liveErr = live && live.error ? live.error : "",
          liveTs =
            live && live.fetchedAt
              ? new Date(live.fetchedAt).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "",
          shortLive = live && live.short ? live.short : null,
          longLive = live && live.long ? live.long : null;
        var liveBtn = frfLiveButtonLabel(fp.id);
        var shortLivePrice =
          !frfLiveUnavailable(shortLive)
            ? "$" + fpr(parseFloat(shortLive.price))
            : "nicht verfügbar";
        var longLivePrice =
          !frfLiveUnavailable(longLive)
            ? "$" + fpr(parseFloat(longLive.price))
            : "nicht verfügbar";
        var shortLivePnl =
          shortLive &&
          !shortLive.error &&
          Number.isFinite(parseFloat(shortLive.pnl))
            ? parseFloat(shortLive.pnl)
            : null;
        var longLivePnl =
          longLive &&
          !longLive.error &&
          Number.isFinite(parseFloat(longLive.pnl))
            ? parseFloat(longLive.pnl)
            : null;
        var shortLiveMeta =
          shortLive && shortLive.market ? es(shortLive.market) : "";
        var longLiveMeta =
          longLive && longLive.market ? es(longLive.market) : "";
        var shortFunding =
            shortLive && shortLive.funding ? shortLive.funding : null,
          longFunding = longLive && longLive.funding ? longLive.funding : null;
        var shortFundingKey = "ffr_s_" + fp.id,
          longFundingKey = "ffr_l_" + fp.id;
        h +=
          '<button class="bt bk" onclick="FPI=null;V=\'frf\';R()">← Zurück</button>';
        h +=
          '<div class="dhd"><div><div class="dhn">' +
          es(fp.token) +
          '</div><span class="bdg ' +
          (fp.type === "frf" ? "frf" : "hdg") +
          '">' +
          es(fp.type === "frf" ? "FRF" : "Hedge") +
          "</span>";
        if (fp.endedAt) h += '<span class="bdg en">Geschlossen</span>';
        if (linkedS) {
          h +=
            '<span class="bdg ac" style="cursor:pointer;margin-left:4px" onclick="SI=\'' +
            linkedS.id +
            "';V='detail';R()\">↗ " +
            es(linkedS.name) +
            "</span>";
          if (fp.type === "hedge") {
            h +=
              '<label class="sw" style="vertical-align:middle;margin-left:12px;margin-right:4px"><input type="checkbox" ' +
              (fp.includeInStrategy ? "checked" : "") +
              " onchange=\"frfTogStrat('" +
              fp.id +
              '\')"><span class="sl2"></span></label><span style="font-size:11px;color:var(--t4);font-weight:500">In Strat-APR einbeziehen</span>';
          }
        }
        if (linkedL) {
          h +=
            '<span class="bdg frf" style="cursor:pointer;margin-left:4px" onclick="V=\'looping\';R()">↗ Loop: ' +
            es(linkedL.name) +
            "</span>";
        }
        h +=
          '</div><div class="dha" style="color:' +
          (a > 0 ? "var(--g)" : a < 0 ? "var(--r)" : "var(--t3") +
          '">' +
          a.toFixed(2) +
          '% <span class="u">APR</span></div></div>';
        h +=
          '<div class="dsg"><div class="dsi"><span class="dsl">Token</span><span class="dsv">' +
          fn(fp.tokenAmount) +
          " " +
          es(fp.token) +
          (pr ? ' <span class="price-live">$' + fn(pr) + "</span>" : "") +
          '</span></div><div class="dsi"><span class="dsl">Pos. Größe</span><span class="dsv">' +
          fn(liveSize) +
          ' USDC</span></div><div class="dsi"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="dsl">Livepreis-Abruf</span>' +
          (!isClosed
            ? '<button type="button" class="bt bb bs" style="padding:5px 10px;font-size:11px" onclick="event.stopPropagation();frfFetchLive(\'' +
              fp.id +
              "')\" " +
              (frfLiveRemaining(fp.id) > 0 && !FRF_LIVE_LOADING[fp.id]
                ? "disabled"
                : "") +
              ">" +
              liveBtn +
              "</button>"
            : "") +
          "</div>" +
          (isClosed
            ? '<div style="font-size:10px;color:var(--t4);margin-top:6px">Position ist geschlossen</div>'
            : liveTs
              ? '<div style="font-size:10px;color:var(--t4);margin-top:6px">Live aktualisiert: ' +
                es(liveTs) +
                "</div>"
              : '<div style="font-size:10px;color:var(--t4);margin-top:6px">Live aktualisiert: —</div>') +
          (liveErr && !isClosed
            ? '<div style="font-size:10px;color:var(--r);margin-top:6px">' +
              es(liveErr) +
              "</div>"
            : "") +
          '</div><div class="dsi"><span class="dsl">Kapital (prop.)</span><span class="dsv">' +
          fn(cap) +
          '</span></div><div class="dsi"><span class="dsl">Lfd. PNL</span><span class="dsv ' +
          (rpnl >= 0 ? "g" : "r") +
          '">' +
          (rpnl >= 0 ? "+" : "") +
          fn(rpnl) +
          '</span></div><div class="dsi"><span class="dsl">Ges. PNL</span><span class="dsv ' +
          (pnl >= 0 ? "g" : "r") +
          '">' +
          (pnl >= 0 ? "+" : "") +
          fn(pnl) +
          '</span></div><div class="dsi"><span class="dsl">Fees</span><span class="dsv r">-' +
          fn(fp.fees) +
          '</span></div><div class="dsi"><span class="dsl">Start</span><span class="dsv">' +
          fd(fp.startDate) +
          '</span></div><div class="dsi"><span class="dsl">Laufzeit</span><span class="dsv">' +
          d.toFixed(1) +
          " T</span></div></div>";
        h +=
          '<div class="ibx" style="margin-top:20px"><div class="igr"><div class="iti"><span class="itl">Short</span><span class="itv">' +
          es(exName(fp.shortExchangeId)) +
          " @ $" +
          fpr(fp.entryPriceShort) +
          "</span>" +
          (!isClosed
            ? '<span class="itv" style="font-size:12px;color:var(--t3)">Live: ' +
              (frfLiveUnavailable(shortLive)
                ? "nicht verfügbar"
                : shortLivePrice) +
              (shortLiveMeta
                ? ' <span style="font-size:10px;color:var(--t4)">(' +
                  shortLiveMeta +
                  ")</span>"
                : "") +
              '</span><span class="itv" style="color:' +
              (shortLivePnl === null
                ? "var(--t3)"
                : shortLivePnl >= 0
                  ? "var(--g)"
                  : "var(--r)") +
              '">PNL: ' +
              (shortLivePnl === null
                ? "—"
                : (shortLivePnl >= 0 ? "+" : "") + fn(shortLivePnl) + " USDC") +
              "</span>" +
              (!frfFundingUnavailable(shortFunding)
                ? '<span class="itv" style="font-size:12px;color:var(--y);cursor:pointer" onclick="tgl(\'' +
                  shortFundingKey +
                  "')\">Funding: " +
                  frfFundingAnnualPct(
                    shortFunding.currentRate,
                    shortFunding.intervalSeconds,
                  ) +
                  " / " +
                  frfFundingPeriod(shortFunding.intervalSeconds) +
                  "</span>"
                : '<span class="itv" style="font-size:12px;color:var(--t3)">Funding: nicht verfügbar</span>')
            : "") +
          '</div><div class="iti"><span class="itl">Long</span><span class="itv">' +
          (fp.longIsSpot ? "Spot" : es(exName(fp.longExchangeId))) +
          " @ $" +
          fpr(fp.entryPriceLong) +
          "</span>" +
          (!isClosed
            ? '<span class="itv" style="font-size:12px;color:var(--t3)">Live: ' +
              (frfLiveUnavailable(longLive)
                ? "nicht verfügbar"
                : longLivePrice) +
              (longLiveMeta
                ? ' <span style="font-size:10px;color:var(--t4)">(' +
                  longLiveMeta +
                  ")</span>"
                : "") +
              '</span><span class="itv" style="color:' +
              (longLivePnl === null
                ? "var(--t3)"
                : longLivePnl >= 0
                  ? "var(--g)"
                  : "var(--r)") +
              '">PNL: ' +
              (longLivePnl === null
                ? "—"
                : (longLivePnl >= 0 ? "+" : "") + fn(longLivePnl) + " USDC") +
              "</span>" +
              (!fp.longIsSpot && !frfFundingUnavailable(longFunding)
                ? '<span class="itv" style="font-size:12px;color:var(--y);cursor:pointer" onclick="tgl(\'' +
                  longFundingKey +
                  "')\">Funding: " +
                  frfFundingAnnualPct(
                    longFunding.currentRate,
                    longFunding.intervalSeconds,
                  ) +
                  " / " +
                  frfFundingPeriod(longFunding.intervalSeconds) +
                  "</span>"
                : !fp.longIsSpot
                  ? '<span class="itv" style="font-size:12px;color:var(--t3)">Funding: nicht verfügbar</span>'
                  : "")
            : "") +
          "</div></div></div>";
        if (!isClosed && !frfFundingUnavailable(shortFunding))
          h += frfFundingSection(
            "Short Funding",
            shortFundingKey,
            shortFunding,
          );
        if (!isClosed && !frfFundingUnavailable(longFunding))
          h += frfFundingSection("Long Funding", longFundingKey, longFunding);
        if (fp.endedAt) {
          h +=
            '<div class="ibx"><div class="igr"><div class="iti"><span class="itl">Close PNL Short</span><span class="itv" style="color:' +
            (fp.closePnlShort >= 0 ? "var(--g)" : "var(--r)") +
            '">' +
            (fp.closePnlShort >= 0 ? "+" : "") +
            fn(fp.closePnlShort || 0) +
            '</span></div><div class="iti"><span class="itl">Close PNL Long</span><span class="itv" style="color:' +
            (fp.closePnlLong >= 0 ? "var(--g)" : "var(--r)") +
            '">' +
            (fp.closePnlLong >= 0 ? "+" : "") +
            fn(fp.closePnlLong || 0) +
            '</span></div><div class="iti"><span class="itl">Funding in Close PNL</span><span class="itv">' +
            '<label class="sw" style="vertical-align:middle;margin-right:6px"><input type="checkbox" ' +
            (fp.closePnlIncludesFunding ? 'checked' : '') +
            ' onchange="frfToggleCloseFunding(\'' +
            fp.id +
            '\',this.checked)"><span class="sl2"></span></label>' +
            (fp.closePnlIncludesFunding ? 'Aktiv' : 'Getrennt') +
            '</span></div></div></div>';
        }
        var fsArr = fp.fundingShort || [],
          flArr = fp.fundingLong || [],
          ek4s = "ffs_" + fp.id,
          isO4s = EXP[ek4s],
          ek4l = "ffl_" + fp.id,
          isO4l = EXP[ek4l];
        h +=
          '<div class="sh" style="margin-top:24px"><h3 class="st">Funding Short: ' +
          (latestFunding(fsArr) >= 0 ? "+" : "") +
          fn(latestFunding(fsArr)) +
          "</h3>" +
          (!fp.endedAt
            ? '<button class="bt bpr bs" onclick="M.ffund={pid:\'' +
              fp.id +
              "',side:'short'};R()\"><span style=\"font-size:16px\">+</span> Funding</button>"
            : "") +
          "</div>";
        if (fsArr.length) {
          h +=
            '<button class="col-btn' +
            (isO4s ? " open" : "") +
            '" onclick="tgl(\'' +
            ek4s +
            '\')"><span class="arr">▼</span> ' +
            fsArr.length +
            ' Einträge</button><div class="col-ct' +
            (isO4s ? " open" : "") +
            '"><div class="tbl"><div class="tblh"><span style="flex:2">Datum</span><span style="flex:2">Notiz</span><span style="flex:1;text-align:right">Betrag</span><span style="width:56px"></span></div>';
          fsArr
            .slice()
            .reverse()
            .forEach(function (f) {
              h +=
                '<div class="tblr"><span style="flex:2;color:var(--t2);font-size:12px">' +
                fd(f.date) +
                '</span><span style="flex:2;color:var(--t3);font-size:12px">' +
                es(f.note || "") +
                '</span><span style="flex:1;text-align:right;color:' +
                (f.amount >= 0 ? "var(--g)" : "var(--r)") +
                ";font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px\">" +
                (f.amount >= 0 ? "+" : "") +
                fn(f.amount) +
                '</span><span style="width:56px;text-align:right;display:flex;gap:2px"><button class="bt bed" onclick="M.fefund={pid:\'' +
                fp.id +
                "',side:'short',fid:'" +
                f.id +
                "',amt:" +
                f.amount +
                ",nt:'" +
                es(f.note || "") +
                "',dt:'" +
                f.date +
                '\'};R()">✎</button><button class="bt bic" onclick="frfDelFund(\'' +
                fp.id +
                "','short','" +
                f.id +
                "')\">✕</button></span></div>";
            });
          h += "</div></div>";
        } else
          h +=
            '<div class="emp" style="margin-bottom:12px">Keine Funding-Short-Einträge.</div>';
        h +=
          '<div class="sh" style="margin-top:24px"><h3 class="st">Funding Long: ' +
          (latestFunding(flArr) >= 0 ? "+" : "") +
          fn(latestFunding(flArr)) +
          "</h3>" +
          (!fp.endedAt
            ? '<button class="bt bpr bs" onclick="M.ffund={pid:\'' +
              fp.id +
              "',side:'long'};R()\"><span style=\"font-size:16px\">+</span> Funding</button>"
            : "") +
          "</div>";
        if (flArr.length) {
          h +=
            '<button class="col-btn' +
            (isO4l ? " open" : "") +
            '" onclick="tgl(\'' +
            ek4l +
            '\')"><span class="arr">▼</span> ' +
            flArr.length +
            ' Einträge</button><div class="col-ct' +
            (isO4l ? " open" : "") +
            '"><div class="tbl"><div class="tblh"><span style="flex:2">Datum</span><span style="flex:2">Notiz</span><span style="flex:1;text-align:right">Betrag</span><span style="width:56px"></span></div>';
          flArr
            .slice()
            .reverse()
            .forEach(function (f) {
              h +=
                '<div class="tblr"><span style="flex:2;color:var(--t2);font-size:12px">' +
                fd(f.date) +
                '</span><span style="flex:2;color:var(--t3);font-size:12px">' +
                es(f.note || "") +
                '</span><span style="flex:1;text-align:right;color:' +
                (f.amount >= 0 ? "var(--g)" : "var(--r)") +
                ";font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px\">" +
                (f.amount >= 0 ? "+" : "") +
                fn(f.amount) +
                '</span><span style="width:56px;text-align:right;display:flex;gap:2px"><button class="bt bed" onclick="M.fefund={pid:\'' +
                fp.id +
                "',side:'long',fid:'" +
                f.id +
                "',amt:" +
                f.amount +
                ",nt:'" +
                es(f.note || "") +
                "',dt:'" +
                f.date +
                '\'};R()">✎</button><button class="bt bic" onclick="frfDelFund(\'' +
                fp.id +
                "','long','" +
                f.id +
                "')\">✕</button></span></div>";
            });
          h += "</div></div>";
        } else
          h +=
            '<div class="emp" style="margin-bottom:12px">Keine Funding-Long-Einträge.</div>';
        h +=
          '<div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap">';
        if (!fp.endedAt) {
          h +=
            '<button class="bt be" style="padding:10px 22px;font-size:13px" onclick="frfClosePos(\'' +
            fp.id +
            "')\">Schließen</button>";
          h +=
            '<button class="bt by" style="padding:10px 22px;font-size:13px" onclick="M.fepos={id:\'' +
            fp.id +
            "'};R()\">Bearbeiten</button>";
        } else {
          h +=
            '<button class="bt bb" style="padding:10px 22px;font-size:13px" onclick="frfReopenPos(\'' +
            fp.id +
            "')\">Reopnen</button>";
          h +=
            '<button class="bt be" style="padding:10px 22px;font-size:13px" onclick="frfDelPos(\'' +
            fp.id +
            "')\">Löschen</button>";
        }
        h += "</div>";
      }
    } else if (V === "looping") {
      h +=
        '<div style="background:rgba(255,255,255,0.05);color:var(--t);padding:12px 20px;border-radius:14px;margin-bottom:20px;font-weight:600;text-align:center;font-size:14px;border:1px solid rgba(255,255,255,0.12);box-shadow:var(--shadow-panel);backdrop-filter:blur(10px)">🚧 Looping noch im Aufbau - BETA - Funktionen können sich ändern 🚧</div>';
      var activeL = LO.filter((l) => l.status === "active" || !l.status);
      var closedL = LO.filter((l) => l.status === "closed");
      var selLoop = LPI
        ? LO.find(function (l) {
            return l.id === LPI;
          })
        : null;
      if (selLoop && LOOPV === "closed") {
        h += renderLoopDetailPanel(selLoop, nw, false);
      } else {
        var activeCalc = activeL.map(function (l) {
          return { loop: l, totals: calculateLoopingTotals(l) };
        });
        var totalCollat = activeCalc.reduce(
          (s, x) => s + (x.totals.supplyUsd || 0),
          0,
        );
        var avgLeverage =
          activeCalc.length > 0
            ? activeCalc.reduce((s, x) => s + x.totals.leverage, 0) /
              activeCalc.length
            : 0;
        var netApr =
          totalCollat > 0
            ? activeCalc.reduce(
                (s, x) => s + x.totals.netApr * (x.totals.supplyUsd || 0),
                0,
              ) / totalCollat
            : 0;
        h +=
          '<div class="sm"><div class="sc"><span class="sl">Aktive Loops</span><span class="sv">' +
          activeL.length +
          '</span></div><div class="sc"><span class="sl">Gesamt Collateral</span><span class="sv">' +
          fn(totalCollat) +
          ' <span class="u">USDC</span></span></div><div class="sc"><span class="sl">Ø Hebel</span><span class="sv">' +
          avgLeverage.toFixed(1) +
          'x</span></div><div class="sc"><span class="sl">Netto APR</span><span class="sv ' +
          (netApr > 0 ? "g" : netApr < 0 ? "r" : "") +
          '">' +
          (netApr > 0 ? "+" : "") +
          netApr.toFixed(2) +
          "%</span></div></div>";
        h +=
          '<div class="sh"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2 class="st">Loops</h2><div class="vtg" style="margin-left:8px"><button class="' +
          (LOOPV === "open" ? "a" : "") +
          '" onclick="LOOPV=\'open\';LPI=null;R()">Offen (' +
          activeL.length +
          ')</button><button class="' +
          (LOOPV === "closed" ? "a" : "") +
          '" onclick="LOOPV=\'closed\';LPI=null;R()">Vergangen (' +
          closedL.length +
          ')</button></div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          (LOOPV === "open"
            ? '<button class="bt bp" onclick="M.lcr=1;R()"><span style="font-size:17px">+</span> Neuer Loop</button>'
            : "") +
          "</div></div>";
        if (LOOPV === "open") {
          if (!activeL.length)
            h += '<div class="emp">Keine aktiven Loops.</div>';
          else {
            h +=
              '<div class="lt"><div class="lt-hdr" style="grid-template-columns:2fr 110px 90px 1fr 1fr"><span>Name</span><span style="text-align:right">Start</span><span style="text-align:right">Laufzeit</span><span style="text-align:right">Hebel</span><span style="text-align:center">APR</span></div>';
            activeCalc.forEach(function (entry) {
              var l = entry.loop,
                tot = entry.totals;
              h +=
                '<div class="lt-row loop-row' +
                (LPI === l.id ? ' open' : '') +
                '" style="grid-template-columns:2fr 110px 90px 1fr 1fr" onclick="openLoopDetail(\'' +
                l.id +
                '\')"><span class="lt-name">' +
                es(l.name || 'Loop') +
                '</span><span class="lt-val">' +
                new Date(l.startdate).toLocaleDateString('de-DE') +
                '</span><span class="lt-val">' +
                db(l.startdate, nw).toFixed(1) +
                ' T</span><span class="lt-val">' +
                tot.leverage.toFixed(2) +
                'x</span><span class="lt-apr' +
                (tot.netApr > 0 ? '' : tot.netApr < 0 ? ' mt' : ' z') +
                '">' +
                (tot.netApr > 0 ? '+' : '') +
                tot.netApr.toFixed(2) +
                '%</span></div>';
              if (LPI === l.id) {
                h +=
                  '<div style="margin:0 0 16px">' +
                  renderLoopDetailPanel(l, nw, true) +
                  '</div>';
              }
            });
            h += '</div>';
          }
        } else {
          if (!closedL.length)
            h += '<div class="emp">Keine vergangenen Loops.</div>';
          else {
            var pastLoops = closedL.slice().sort(function (a, b) {
              return (
                new Date(b.enddate || b.endDate || b.startdate) -
                new Date(a.enddate || a.endDate || a.startdate)
              );
            });
            h +=
              '<div class="lt"><div class="lt-hdr" style="grid-template-columns:2fr 1fr 1fr 1fr 90px"><span>Name</span><span>Start</span><span>Ende</span><span>Hebel</span><span>Details</span></div>';
            pastLoops.forEach(function (l) {
              var lev = parseFloat(l.leverage || 1) || 1;
              h +=
                '<div class="lt-row" style="grid-template-columns:2fr 1fr 1fr 1fr 90px" onclick="openLoopDetail(\'' +
                l.id +
                '\')"><span class="lt-name">' +
                es(l.name || "Loop") +
                '</span><span class="lt-val">' +
                fd(l.startdate) +
                '</span><span class="lt-val">' +
                fd(l.enddate || l.endDate) +
                '</span><span class="lt-val">' +
                lev.toFixed(2) +
                'x</span><span class="lt-apr z">Details</span></div>';
            });
            h += "</div>";
          }
        }
      }
    } else if (V === "messages") {
      h += renderMessagesView();
    } else if (V === "community") {
      window.COM_TAB = window.COM_TAB || "vote";
      h +=
        '<div class="sh" style="margin-bottom:16px"><h2 class="st">Community & Support</h2><div class="vtg"><button class="' +
        (window.COM_TAB === "vote" ? "a" : "") +
        '" onclick="window.COM_TAB=\'vote\';R()">🗳️ Feature Vorschläge</button><button class="' +
        (window.COM_TAB === "support" ? "a" : "") +
        '" onclick="window.COM_TAB=\'support\';R()">💬 Support kontaktieren</button></div></div>';

      if (window.COM_TAB === "support") {
        h +=
          '<div style="max-width:600px;margin-top:24px;background:var(--bg2);padding:24px;border:1px solid var(--bd);border-radius:12px"><h3 style="margin-bottom:8px;font-size:16px;color:var(--t)">Support Anfrage Senden</h3><p style="margin-bottom:20px;font-size:13px;color:var(--t3);line-height:1.5">Hast du ein Problem mit dem Tracker oder eine Frage an den Support? Schreibe eine Nachricht, der Admin wird sich per E-Mail bei dir zurückmelden.</p><div class="fg"><label>Titel / Anliegen</label><input id="s-title" type="text" placeholder="Bsp: Problem beim Einloggen"></div><div class="fg"><label>Nachricht</label><textarea id="s-msg" style="width:100%;height:140px;padding:12px;border-radius:8px;border:1px solid var(--bd2);background:var(--bg);color:var(--t);font-family:inherit;font-size:14px;resize:vertical" placeholder="Bitte beschreibe dein Problem genauer..."></textarea></div><button id="s-btn" class="bt bp" style="width:100%;justify-content:center;padding:12px" onclick="hSupport()">Senden</button></div>';
      } else {
        let meta = window.FEAT_META || {};
        let resetStr = meta.nextReset
          ? new Date(meta.nextReset).toLocaleString([], {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        let infoStr = meta.canVoteGlobally
          ? '<span style="color:var(--g)">1 verbleibende Stimme für diese Woche</span>'
          : '<span style="color:var(--y)">Limit erreicht. Nächste Stimme ab: ' +
            resetStr +
            "</span>";

        h +=
          '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px"><div style="flex:1"><h3 style="font-size:16px;margin-bottom:4px;color:var(--t)">Top Vorschläge</h3><p style="font-size:13px;color:var(--t3)">Gib eine Stimme für die Features ab, die du dir am meisten wünschst. <br><b style="font-weight:600;margin-top:4px;display:inline-block">' +
          infoStr +
          '</b></p></div><button class="bt bp" style="background:#191c24;border:1px solid var(--bd2);color:var(--g)" onclick="M.fnew=1;R()">+ Neuer Vorschlag</button></div>';
        if (FEAT.length === 0)
          h +=
            '<div class="emp">Noch keine bewilligten Vorschläge vorhanden.</div>';
        else {
          h += '<div style="display:flex;flex-direction:column;gap:16px">';
          FEAT.forEach((f) => {
            let bdg = "";
            if (f.status === "planned")
              bdg =
                '<span style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase;background:var(--gb);color:var(--g)">In Entwicklung</span>';
            if (f.status === "implemented")
              bdg =
                '<span style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase;background:var(--bp-bg);color:var(--bp)">Erledigt</span>';

            let btnDisabled =
              !f.has_voted && !meta.canVoteGlobally
                ? "opacity:0.3;cursor:not-allowed;"
                : "cursor:pointer;";
            let btnAction =
              !f.has_voted && !meta.canVoteGlobally
                ? ""
                : "onclick=\"hVote('" + f.id + "')\"";

            h +=
              '<div style="display:flex;background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:20px;gap:24px;align-items:flex-start"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:' +
              (f.has_voted ? "var(--gb)" : "var(--bg3)") +
              ";padding:12px;border-radius:12px;min-width:64px;border:1px solid " +
              (f.has_voted ? "rgba(0,255,163,0.22)" : "transparent") +
              '"><button style="background:none;border:none;font-size:20px;color:' +
              (f.has_voted ? "var(--bp)" : "var(--t4)") +
              ";" +
              btnDisabled +
              '" ' +
              btnAction +
              '>▲</button><span style="font-weight:700;font-size:16px;color:' +
              (f.has_voted ? "var(--bp)" : "var(--t)") +
              ";font-family:'JetBrains Mono',monospace\">" +
              f.votes +
              '</span></div><div style="flex:1"><div style="font-size:18px;font-weight:600;color:var(--t);margin-bottom:8px;display:flex;align-items:center;gap:12px">' +
              es(f.title) +
              " " +
              bdg +
              '</div><div style="font-size:14px;color:var(--t2);line-height:1.6;margin-bottom:16px;white-space:pre-wrap">' +
              es(f.description) +
              '</div><div style="display:flex;gap:16px;align-items:center;font-size:12px;color:var(--t4);border-top:1px solid var(--bd);padding-top:16px"><span>Einreicher: ' +
              es(f.author) +
              "</span><span>•</span><span>" +
              fd(f.createdat) +
              "</span></div></div></div>";
          });
          h += "</div>";
        }
      }
    }
  }

  h += "</main>";
  h += SECTION_MARKERS.modals;

  if (M.login) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Login</div><div class="fg"><label>E-Mail</label><input id="l-email" type="email" value="' +
      es(VERIFY_EMAIL || "") +
      '"></div><div class="fg"><label>Passwort</label><div class="pw-box"><input id="l-pass" type="password"><button class="pw-btn" onclick="document.getElementById(\'l-pass\').type=document.getElementById(\'l-pass\').type===\'password\'?\'text\':\'password\'">👁</button></div></div><div style="display:flex;align-items:center;gap:8px;margin:8px 0 2px"><input id="l-remember" type="checkbox" style="width:16px;height:16px;accent-color:var(--g)"><label for="l-remember" style="font-size:12px;color:var(--t3);cursor:pointer">7 Tage eingeloggt bleiben</label></div>' +
      (VERIFY_EMAIL
        ? '<div style="margin:6px 0 0;padding:10px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px;color:var(--t3)">E-Mail noch nicht verifiziert?<button class="bt bcn" style="margin-left:8px;padding:6px 10px;font-size:12px" ' +
          (Date.now() < VERIFY_RETRY_AT ? "disabled" : "") +
          ' onclick="resendVerifyMail()">' +
          verifyCooldownText() +
          "</button></div>"
        : "") +
      '<div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bb" style="flex:1;justify-content:center" onclick="hLogin()">Einloggen</button></div><div style="text-align:center;margin-top:16px;font-size:12px;color:var(--t4)">Noch keinen Account? <a href="#" style="color:var(--g)" onclick="M.login=false;M.reg=1;R()">Registrieren</a></div></div></div>';
  }
  if (M.reg) {
    h +=
      '<div class="ov"><div class="mdl"><div class="mdt">Account Registrieren</div><div class="fg"><label>E-Mail</label><input id="r-email" type="email"></div><div class="fg"><label>Passwort</label><div class="pw-box"><input id="r-p1" type="password"><button class="pw-btn" onclick="document.getElementById(\'r-p1\').type=document.getElementById(\'r-p1\').type===\'password\'?\'text\':\'password\'">👁</button></div></div><div class="fg"><label>Passwort wiederholen</label><input id="r-p2" type="password"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" style="flex:1;justify-content:center" onclick="hReg()">Registrieren</button></div></div></div>';
  }
  if (M.np) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Neues Profil (Wallet)</div><div class="fg"><label>Name</label><input id="p-name" placeholder="z.B. Main Wallet"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hNewProf()">Erstellen</button></div></div></div>';
  }
  if (M.eu) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Profil umbenennen</div><div class="fg"><label>Neuer Name</label><input id="f-eun" value="' +
      es(M.eu.name) +
      '"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="api(\'/api/profiles/' +
      M.eu.id +
      "',{method:'PUT',body:JSON.stringify({name:document.getElementById('f-eun').value})}).then(()=>{loadData();cm()})\">Speichern</button></div></div></div>";
  }

  if (M.cr) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Neue Strategie</div><div class="fg"><label>Name</label><input id="f-n" placeholder="z.B. Aave USDC"></div><div class="fr"><div class="fg"><label>Startdatum</label><input id="f-d" type="date" value="' + fds(new Date()) + '"></div><div class="fg"><label>Uhrzeit</label><input id="f-t" type="time" value="' + fts(new Date()) + '"></div></div><div class="fg"><label>Investment (USDC)</label><input id="f-i" type="number" step="0.01"></div><div style="font-size:11px;color:var(--t4);margin:8px 0 6px">Token (optional)</div>' + strategyTokenInputSection('f-token-create-rows') + '<div class="fg"><label>Notizen</label><textarea id="f-no" rows="2"></textarea></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hCr()">Erstellen</button></div></div></div>';
  }
  if (M.rw) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Reward</div><div class="fg"><label>Betrag (USDC)</label><input id="f-ra" type="number" step="0.000001"></div><div class="fg"><label>Notiz</label><input id="f-rn"></div><div style="font-size:11px;color:var(--t4);margin:8px 0 6px">Datum (leer=jetzt)</div><div class="fr"><div class="fg"><label>Datum</label><input id="f-rd" type="date"></div><div class="fg"><label>Uhrzeit</label><input id="f-rt" type="time"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hRw()">Speichern</button></div></div></div>';
  }
  if (M.iv && se) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Investment ändern</div><div class="hnt">Aktuell: ' +
      fn(ci(se)) +
      '</div><div class="fg"><label>Investment hinzufügen / abziehen (USDC)</label><input id="f-ni" type="number" step="0.01"></div><div class="hnt">Positive Werte addieren zum Investment, negative Werte ziehen davon ab.</div><div style="font-size:11px;color:var(--t4);margin:8px 0 6px">Tokenänderungen (optional)</div>' + strategyTokenInputSection('f-token-invest-rows') + '<div class="fg"><label>Notiz</label><input id="f-nin"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hIv()">Buchen</button></div></div></div>';
  }
  if (M.pl) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">PNL</div><div class="fg"><label>Betrag (USDC)</label><input id="f-pa" type="number" step="0.01"></div><div class="fg"><label>Notiz</label><input id="f-pn"></div><p style="color:var(--t4);font-size:11px;margin-top:4px">APR per Schiebeschalter in der Liste.</p><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hPl()">Speichern</button></div></div></div>';
  }
  if (M.no && se) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Notizen</div><div class="fg"><textarea id="f-ne" rows="5">' +
      es(se.notes || "") +
      '</textarea></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hNo()">Speichern</button></div></div></div>';
  }
  if (M.tk && se) {
    var tk = se.token || {};
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Token</div><div class="fg"><label>Token</label><input id="f-etn" value="' +
      es(tk.name || "") +
      '"></div><div class="fr"><div class="fg"><label>Menge</label><input id="f-eta" type="number" step="any" value="' +
      (tk.amount || "") +
      '"></div><div class="fg"><label>Entry ($)</label><input id="f-etp" type="number" step="any" value="' +
      (tk.entryPrice || "") +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hTk()">Speichern</button></div></div></div>';
  }
  if (M.ed && se && se.endedAt) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Enddatum</div><div class="fr"><div class="fg"><label>Datum</label><input id="f-edd" type="date" value="' +
      fds(se.endedAt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-edt" type="time" value="' +
      fts(se.endedAt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hEd()">Speichern</button></div></div></div>';
  }

  if (M.adet) {
    var ad = M.adet.acc,
      isSelf = AUTH.account && AUTH.account.email === ad.email,
      canEditRole =
        canManageRoles() &&
        (canManageAllRoles() ||
          (!hasRole(ad.role, "admin") && !hasRole(ad.role, "owner"))),
      roleOpts = (
        canManageAllRoles()
          ? ["user", "support", "admin", "owner"]
          : ["user", "support"]
      )
        .map(function (r) {
          return (
            '<option value="' +
            r +
            '"' +
            ((ad.role || "user") === r ? " selected" : "") +
            ">" +
            r +
            "</option>"
          );
        })
        .join("");
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" style="max-width:620px" onclick="event.stopPropagation()"><div class="mdt">Account Details</div><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap"><div style="font-size:16px;font-weight:600">' +
      es(ad.email) +
      "</div><div>" +
      roleBadge(ad.role) +
      '</div></div><div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap"><div style="flex:1;background:var(--bg2);padding:12px;border-radius:8px;border:1px solid var(--bd2)"><div style="font-size:11px;color:var(--t4)">Status</div><div style="font-size:14px">' +
      (ad.isverified
        ? '<span style="color:var(--g)">Aktiv</span>'
        : '<span style="color:var(--y)">Wartend</span>') +
      '</div></div><div style="flex:1;background:var(--bg2);padding:12px;border-radius:8px;border:1px solid var(--bd2)"><div style="font-size:11px;color:var(--t4)">Erstellt</div><div style="font-size:14px">' +
      fd(ad.createdat) +
      '</div></div><div style="flex:1;background:var(--bg2);padding:12px;border-radius:8px;border:1px solid var(--bd2)"><div style="font-size:11px;color:var(--t4)">Gesperrt</div><div style="font-size:14px">' +
      (ad.isblocked ? '<span style="color:var(--r)">Ja</span>' : "Nein") +
      "</div></div></div>" +
      (canManageRoles()
        ? '<div style="background:var(--bg2);padding:14px;border-radius:10px;border:1px solid var(--bd2);margin-bottom:18px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><div style="font-size:11px;color:var(--t4);margin-bottom:6px">Rolle & Berechtigungen</div><div style="font-size:13px;color:var(--t3)">User = Standard, Support = Nachrichten/Admin-Support, Admin = Verwaltung, Owner = volle Rechte inkl. Rollen.</div></div>' +
          (canEditRole
            ? '<div style="display:flex;gap:8px;align-items:center"><select id="adm-role" style="width:auto;padding:8px 10px;font-size:12px">' +
              roleOpts +
              '</select><button class="bt bp bs" onclick="adminRole(\'' +
              ad.id +
              "',document.getElementById('adm-role').value)\">Rolle speichern</button></div>"
            : '<div style="font-size:12px;color:var(--t4)">' +
              (isSelf
                ? "Eigene Rolle wird hier nicht abgesenkt."
                : "Nur Owner kann Admin/Owner-Rollen verwalten.") +
              "</div>") +
          "</div></div>"
        : "") +
      '<div class="sh" style="margin-bottom:12px"><h3 class="st">Nutzung / Logins</h3><select style="width:auto;padding:4px 8px;font-size:12px" onchange="M.adet.tf=parseInt(this.value);renderAdminChart()"><option value="7" ' +
      (M.adet.tf === 7 ? "selected" : "") +
      '>7 Tage</option><option value="14" ' +
      (M.adet.tf === 14 ? "selected" : "") +
      '>14 Tage</option><option value="30" ' +
      (M.adet.tf === 30 ? "selected" : "") +
      '>30 Tage</option><option value="90" ' +
      (M.adet.tf === 90 ? "selected" : "") +
      '>90 Tage</option><option value="365" ' +
      (M.adet.tf === 365 ? "selected" : "") +
      '>1 Jahr</option></select></div><div style="width:100%;height:140px;background:var(--bg2);border-radius:8px;margin-bottom:24px;position:relative"><canvas id="admin-chart" style="width:100%;height:100%"></canvas></div><div style="display:flex;gap:12px;padding-top:16px;border-top:1px solid var(--bd2);flex-wrap:wrap">' +
      (!hasRole(ad.role, "owner") &&
      (canManageAllRoles() || !hasRole(ad.role, "admin"))
        ? '<button class="bt by" style="flex:1;justify-content:center" onclick="adminTgl(\'' +
          ad.id +
          "')\">" +
          (ad.isblocked ? "Entsperren" : "Account Sperren") +
          '</button><button class="bt be" style="flex:1;justify-content:center" onclick="adminDel(\'' +
          ad.id +
          "')\">Löschen</button>"
        : '<span style="color:var(--t4);font-size:12px;flex:1;min-width:220px">Dieser Account kann mit deiner aktuellen Rolle nicht gesperrt oder gelöscht werden.</span>') +
      '<button class="bt bk" style="flex:1;justify-content:center" onclick="M.adet=null;R()">Schließen</button></div></div></div>';
  }
  if (M.er) {
    var er2 = M.er;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Reward bearbeiten</div><div class="fg"><label>Betrag</label><input id="f-era" type="number" step="0.000001" value="' +
      er2.amt +
      '"></div><div class="fg"><label>Notiz</label><input id="f-ern" value="' +
      es(er2.nt) +
      '"></div><div class="fr"><div class="fg"><label>Datum</label><input id="f-erd" type="date" value="' +
      fds(er2.dt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-ert" type="time" value="' +
      fts(er2.dt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hEr()">Speichern</button></div></div></div>';
  }
  if (M.ep) {
    var ep2 = M.ep;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">PNL bearbeiten</div><div class="fg"><label>Betrag</label><input id="f-epa" type="number" step="0.01" value="' +
      ep2.amt +
      '"></div><div class="fg"><label>Notiz</label><input id="f-epn" value="' +
      es(ep2.nt) +
      '"></div><div class="fr"><div class="fg"><label>Datum</label><input id="f-epd" type="date" value="' +
      fds(ep2.dt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-ept" type="time" value="' +
      fts(ep2.dt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hEp()">Speichern</button></div></div></div>';
  }
  if (M.ei) {
    var ei2 = M.ei;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Investment bearbeiten</div><div class="fg"><label>Betrag</label><input id="f-eia" type="number" step="0.01" value="' +
      ei2.amt +
      '"></div><div class="fg"><label>Notiz</label><input id="f-ein" value="' +
      es(ei2.nt) +
      '"></div><div class="fr"><div class="fg"><label>Datum</label><input id="f-eid" type="date" value="' +
      fds(ei2.dt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-eit" type="time" value="' +
      fts(ei2.dt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hEi()">Speichern</button></div></div></div>';
  }

  if (M.fex) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Börse hinzufügen</div><div class="fg"><label>Unsere Börsen</label><select id="f-exp" onchange="syncExchangePreset(\'new\')">' +
      exchangePresetOptionsHtml('Bybit') +
      '</select></div><div class="fg"><label>Name</label><input id="f-exn" value="Bybit" placeholder="Name aus Auswahl" readonly><div class="hnt">Wähle eine unterstützte Börse oder nutze "Eigene Börse..." für freie Eingabe.</div></div><div class="fg"><label>Anfangs-Margin (USDC)</label><input id="f-exm" type="number" step="0.01" placeholder="0.00"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFex()">Erstellen</button></div></div></div>';
  }
  if (M.feex) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Börse bearbeiten</div><div class="fg"><label>Unsere Börsen</label><select id="f-eexp" onchange="syncExchangePreset(\'edit\')">' +
      exchangePresetOptionsHtml(M.feex.name) +
      '</select></div><div class="fg"><label>Name</label><input id="f-eexn" value="' +
      es(normExchangeLabel(M.feex.name)) +
      '"' +
      (exchangePresetValueForName(M.feex.name) === CUSTOM_EXCHANGE_PRESET ? '' : ' readonly') +
      ' placeholder="' +
      (exchangePresetValueForName(M.feex.name) === CUSTOM_EXCHANGE_PRESET ? 'z.B. Kraken' : 'Name aus Auswahl') +
      '"><div class="hnt">Unterstützte Börsen werden vereinheitlicht angezeigt. Für Sonderfälle bleibt freie Eingabe möglich.</div></div><div class="fg"><label>Aktuelle Margin (USDC)</label><input id="f-eexm" type="number" step="0.01" value="' +
      (M.feex.margin || 0) +
      '"></div><p style="color:var(--t4);font-size:11px;margin:-2px 0 10px">Bei Änderung wird automatisch ein Korrektur-Eintrag in Margin-Historie angelegt.</p><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFeex()">Speichern</button></div></div></div>';
  }
  if (M.fexm) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Margin ändern</div><div class="fg"><label>Betrag (positiv=Einzahlung, negativ=Auszahlung)</label><input id="f-exma" type="number" step="0.01"></div><div class="fg"><label>Notiz</label><input id="f-exmn" placeholder="optional"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFexm()">Speichern</button></div></div></div>';
  }
  if (M.femm) {
    var fm2 = M.femm;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Margin bearbeiten</div><div class="fg"><label>Betrag</label><input id="f-fmma" type="number" step="0.01" value="' +
      fm2.amt +
      '"></div><div class="fg"><label>Notiz</label><input id="f-fmmn" value="' +
      es(fm2.nt) +
      '"></div><div class="fr"><div class="fg"><label>Datum</label><input id="f-fmmd" type="date" value="' +
      fds(fm2.dt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-fmmt" type="time" value="' +
      fts(fm2.dt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFemm()">Speichern</button></div></div></div>';
  }
  if (M.fpos) {
    var linkOpts = linkedTargetOptions("");
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation();(function(t){if(!((t.closest&&t.closest(\'#f-psex\'))||(t.closest&&t.closest(\'#f-plex\'))||(t.closest&&t.closest(\'#f-psex-sug\'))||(t.closest&&t.closest(\'#f-plex-sug\'))||(t.closest&&t.closest(\'#f-pstk\'))||(t.closest&&t.closest(\'#f-pltk\'))||(t.closest&&t.closest(\'#f-pstk-sug\'))||(t.closest&&t.closest(\'#f-pltk-sug\')))) { frfCloseExchangeSuggestions(); frfCloseTokenSuggestions(); }})(event.target)"><div class="mdt">Neue Position</div><div class="fg"><label>Typ</label><select id="f-pt"><option value="frf">FRF</option><option value="hedge">Absicherung</option></select></div><div class="fr"><div class="fg"><label>Short Börse</label><input id="f-psex" placeholder="Short-Börse eingeben" autocomplete="off" oninput="frfExchangeSuggest(\'new\',\'short\')" onclick="frfExchangeSuggest(\'new\',\'short\', true)" onfocus="frfExchangeSuggest(\'new\',\'short\', true)"><input id="f-psh" type="hidden"><div id="f-psex-sug" class="tok-suggest"></div></div><div class="fg"><label>Long Börse</label><input id="f-plex" value="Spot" placeholder="Long-Börse eingeben" autocomplete="off" oninput="frfExchangeSuggest(\'new\',\'long\')" onclick="frfExchangeSuggest(\'new\',\'long\', true)" onfocus="frfExchangeSuggest(\'new\',\'long\', true)"><input id="f-plg" type="hidden" value="_spot"><div id="f-plex-sug" class="tok-suggest"></div></div></div><div class="fr"><div class="fg"><label>Short Token</label><input id="f-pstk" placeholder="Markt auf Short Börse" autocomplete="off" oninput="frfTokenSuggest(\'new\',\'short\')" onfocus="frfTokenSuggest(\'new\',\'short\')"><input id="f-psasset" type="hidden"><input id="f-psmkt" type="hidden"><div id="f-pstk-sug" class="tok-suggest"></div></div><div class="fg"><label>Long Token</label><input id="f-pltk" placeholder="Markt auf Long Börse" autocomplete="off" oninput="frfTokenSuggest(\'new\',\'long\')" onfocus="frfTokenSuggest(\'new\',\'long\')"><input id="f-plasset" type="hidden"><input id="f-plmkt" type="hidden"><div id="f-pltk-sug" class="tok-suggest"></div></div></div><div class="fg"><label>Token-Menge</label><input id="f-pta" type="number" step="any"></div><div class="fr"><div class="fg"><label>Entry Short ($)</label><input id="f-ptes" type="number" step="any"></div><div class="fg"><label>Entry Long ($)</label><input id="f-ptel" type="number" step="any"></div></div><p style="color:var(--t4);font-size:11px;margin:-4px 0 8px">Pos. = Menge × Entry</p><div style="font-size:11px;color:var(--t4);margin:8px 0 6px">Startdatum (leer = jetzt)</div><div class="fr"><div class="fg"><label>Datum</label><input id="f-psd" type="date"></div><div class="fg"><label>Uhrzeit</label><input id="f-pst" type="time"></div></div><div class="fg"><label>Fees</label><input id="f-pfe" type="number" step="0.01" value="0"></div><div class="fg"><label>Verknüpfung</label><select id="f-pls">' +
      linkOpts +
      '</select></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFpos()">Erstellen</button></div></div></div>';
  }
  if (M.fepos) {
    var fp2 = FR.positions.find((x) => x.id === M.fepos.id);
    if (fp2) {
      var shortExchangeName = normExchangeLabel(exchangeName(fp2.shortExchangeId) || ""),
        longExchangeName = fp2.longIsSpot
          ? "Spot"
          : normExchangeLabel(exchangeName(fp2.longExchangeId) || ""),
        linkOpts2 = linkedTargetOptions(linkedTargetValue(fp2)),
        shortAsset = es(fp2.shortAssetSymbol || fp2.token || ""),
        shortMarket = es(fp2.shortMarketSymbol || fp2.token || ""),
        longAsset = es(fp2.longAssetSymbol || fp2.token || ""),
        longMarket = es(fp2.longMarketSymbol || fp2.token || "");
      h +=
        '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation();(function(t){if(!((t.closest&&t.closest(\'#f-esex\'))||(t.closest&&t.closest(\'#f-elex\'))||(t.closest&&t.closest(\'#f-esex-sug\'))||(t.closest&&t.closest(\'#f-elex-sug\'))||(t.closest&&t.closest(\'#f-estk\'))||(t.closest&&t.closest(\'#f-eltk\'))||(t.closest&&t.closest(\'#f-estk-sug\'))||(t.closest&&t.closest(\'#f-eltk-sug\')))) { frfCloseExchangeSuggestions(); frfCloseTokenSuggestions(); }})(event.target)"><div class="mdt">Position bearbeiten</div><div class="fg"><label>Typ</label><select id="f-eptype"><option value="frf" ' +
        (fp2.type === "frf" ? "selected" : "") +
        '>FRF</option><option value="hedge" ' +
        (fp2.type === "hedge" ? "selected" : "") +
        '</option></select></div><div class="fr"><div class="fg"><label>Short Börse</label><input id="f-esex" value="' +
        es(shortExchangeName) +
        '" autocomplete="off" oninput="frfExchangeSuggest(\'edit\',\'short\')" onclick="frfExchangeSuggest(\'edit\',\'short\', true)" onfocus="frfExchangeSuggest(\'edit\',\'short\', true)"><input id="f-epsh" type="hidden" value="' +
        es(fp2.shortExchangeId || "") +
        '"><div id="f-esex-sug" class="tok-suggest"></div></div><div class="fg"><label>Long Börse</label><input id="f-elex" value="' +
        es(longExchangeName) +
        '" autocomplete="off" oninput="frfExchangeSuggest(\'edit\',\'long\')" onclick="frfExchangeSuggest(\'edit\',\'long\', true)" onfocus="frfExchangeSuggest(\'edit\',\'long\', true)"><input id="f-eplg" type="hidden" value="' +
        es(fp2.longIsSpot ? '_spot' : fp2.longExchangeId || "") +
        '"><div id="f-elex-sug" class="tok-suggest"></div></div></div><div class="fr"><div class="fg"><label>Short Token</label><input id="f-estk" value="' +
        shortMarket +
        '" autocomplete="off" oninput="frfTokenSuggest(\'edit\',\'short\')" onfocus="frfTokenSuggest(\'edit\',\'short\')"><input id="f-esasset" type="hidden" value="' +
        shortAsset +
        '"><input id="f-esmkt" type="hidden" value="' +
        shortMarket +
        '"><div id="f-estk-sug" class="tok-suggest"></div></div><div class="fg"><label>Long Token</label><input id="f-eltk" value="' +
        longMarket +
        '" autocomplete="off" oninput="frfTokenSuggest(\'edit\',\'long\')" onfocus="frfTokenSuggest(\'edit\',\'long\')"><input id="f-elasset" type="hidden" value="' +
        longAsset +
        '"><input id="f-elmkt" type="hidden" value="' +
        longMarket +
        '"><div id="f-eltk-sug" class="tok-suggest"></div></div></div><div class="fr"><div class="fg"><label>Menge</label><input id="f-epta" type="number" step="any" value="' +
        fp2.tokenAmount +
        '"></div><div class="fg"><label>Pos. USDC</label><input id="f-epts" type="number" step="0.01" value="' +
        fp2.positionSizeUsd +
        '"></div></div><div class="fr"><div class="fg"><label>Entry Short ($)</label><input id="f-eptes" type="number" step="any" value="' +
        fp2.entryPriceShort +
        '"></div><div class="fg"><label>Entry Long ($)</label><input id="f-eptel" type="number" step="any" value="' +
        fp2.entryPriceLong +
        '"></div></div><div style="font-size:11px;color:var(--t4);margin:8px 0 6px">Startdatum</div><div class="fr"><div class="fg"><label>Datum</label><input id="f-epsd" type="date" value="' +
        fds(fp2.startDate) +
        '"></div><div class="fg"><label>Uhrzeit</label><input id="f-epst" type="time" value="' +
        fts(fp2.startDate) +
        '"></div></div><div class="fg"><label>Fees</label><input id="f-epfe" type="number" step="0.01" value="' +
        fp2.fees +
        '"></div><div class="fg"><label>Verknüpfung</label><select id="f-epls">' +
        linkOpts2 +
        '</select></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFepos()">Speichern</button></div></div></div>';
    }
  }
  if (M.ffund) {
    var _fs = M.ffund.side === "short" ? "Short" : "Long";
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Funding ' +
      _fs +
      ' aktualisieren</div><p style="color:var(--t3);font-size:12px;margin-bottom:14px">Aktuell aufgelaufener Funding-Betrag (kumuliert)</p><div class="fg"><label>Aktueller Funding-Stand (USDC)</label><input id="f-ffa" type="number" step="0.01"></div><div class="fg"><label>Notiz</label><input id="f-ffn" placeholder="optional"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFfund()">Speichern</button></div></div></div>';
  }
  if (M.fefund) {
    var fef = M.fefund;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Funding bearbeiten</div><div class="fg"><label>Betrag (kumuliert)</label><input id="f-fefa" type="number" step="0.01" value="' +
      fef.amt +
      '"></div><div class="fg"><label>Notiz</label><input id="f-fefn" value="' +
      es(fef.nt) +
      '"></div><div class="fr"><div class="fg"><label>Datum</label><input id="f-fefd" type="date" value="' +
      fds(fef.dt) +
      '"></div><div class="fg"><label>Uhrzeit</label><input id="f-feft" type="time" value="' +
      fts(fef.dt) +
      '"></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFefund()">Speichern</button></div></div></div>';
  }
  if (M.fclose) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Position schließen</div><div class="fg"><label>PNL Short-Seite (USDC)</label><input id="f-fcs" type="number" step="0.01"></div><div class="fg"><label>PNL Long-Seite (USDC / Spot)</label><input id="f-fcl" type="number" step="0.01"></div><div class="fg"><label class="sw"><input type="checkbox" id="f-fci"><span class="sl2"></span></label> <span style="font-size:13px;margin-left:8px;vertical-align:super">PNL inkl. Fundings</span><div class="hnt">Standard ist aus. Dann bleiben Fundings separat und werden nicht in die Close-PNL eingerechnet.</div></div><div class="fg"><label>Fees (optional)</label><input id="f-fcf" type="number" step="0.01" value="0"></div><div class="fg"><label>Notiz</label><input id="f-fcn"></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt be" style="flex:1;justify-content:center" onclick="hFclose()">Schließen</button></div></div></div>';
  }
  if (M.fprc) {
    var ump = M.fprc.ump;
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Tokenpreis manuell setzen</div><div class="fg"><label class="sw"><input type="checkbox" id="f-ump" ' +
      (ump ? "checked" : "") +
      ' onchange="M.fprc.ump=this.checked?1:0;R()"><span class="sl2"></span></label> <span style="font-size:13px;margin-left:8px;vertical-align:super">Manuellen Preis verwenden</span></div>';
    if (ump) {
      h +=
        '<div class="fg" style="margin-top:10px"><label>Preis ($)</label><input id="f-mp" type="number" step="any" value="' +
        M.fprc.mp +
        '"></div>';
    }
    h +=
      '<div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFprc()">Speichern</button></div></div></div>';
  }
  if (M.lcr || M.led) {
    var le = M.led || {},
      isEdit = !!M.led;
    h += renderLoopModal(le, isEdit);
    setTimeout(function () {
      calcLoopData();
      fetchPrices({ skipRender: true });
      fetchLoopOracleDefaults("supply");
      fetchLoopOracleDefaults("borrow");
      updateLoopPegPreview();
    }, 0);
  }

  if (false && M.lcr) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" style="max-width:520px" onclick="event.stopPropagation()"><div class="mdt">Neuen Loop erstellen</div><div style="background:var(--bg3);padding:12px;border-radius:8px;margin-bottom:16px;border:1px solid var(--bd)"><div style="font-size:11px;color:var(--t4);margin-bottom:6px">LOOP NAME (automatisch)</div><div style="font-size:16px;font-weight:600;color:var(--g)" id="f-ln-auto">Collateral Token / Borrow Token</div></div><div class="fr"><div class="fg"><label>Start Datum (leer = jetzt)</label><input id="f-ld" type="date"></div><div class="fg"><label>Start Uhrzeit</label><input id="f-lt" type="time"></div></div><div style="background:var(--g-bg);border:1px solid rgba(0,255,163,0.22);border-radius:12px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--g);font-weight:600;margin-bottom:10px">📥 START COLLATERAL</div><div class="fr"><div class="fg"><label>Investment in USDC</label><input id="f-lcb" type="number" step="any" placeholder="1000" oninput="calcLoopData()"></div><div class="fg"><label>Collateral Token</label><input id="f-lct" placeholder="ETH" oninput="updateLoopName()"></div></div><div class="fr" style="margin-top:10px"><div class="fg"><label>Tokenmenge</label><input id="f-lcsm" type="number" step="any" placeholder="0.42" oninput="calcLoopData()"></div><div class="fg"><label>Tokenpreis ($, auto)</label><input id="f-lcp" type="number" step="any" readonly style="background:var(--bg3);color:var(--t3)"></div></div><div class="fr" style="margin-top:10px"><div class="fg"><label>Supply APY (%)</label><input id="f-lsa" type="number" step="0.01" placeholder="8.5"></div></div></div><div style="background:var(--rb);border:1px solid var(--r);border-radius:8px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--r);font-weight:600;margin-bottom:10px">📤 BORROW</div><div class="fr"><div class="fg"><label>Borrow Token</label><input id="f-lbt" placeholder="USDC" oninput="updateLoopName()"></div><div class="fg"><label>Borrow APY (%)</label><input id="f-lba" type="number" step="0.01" placeholder="3.2"></div></div></div><div style="background:rgba(77,163,255,0.08);border:1px solid var(--bl);border-radius:8px;padding:12px;margin:16px 0"><div style="font-size:11px;color:var(--bl);font-weight:600;margin-bottom:10px">📊 OFFENE POSITION</div><div class="fr"><div class="fg"><label>Collateral Tokenmenge aktuell</label><input id="f-lce" type="number" step="any" placeholder="1.12"></div><div class="fg"><label>Borrow Tokenmenge aktuell</label><input id="f-lbe" type="number" step="any" placeholder="500"></div></div><div class="hnt" style="margin:4px 0 0">Hebel und gehebelte APY werden erst in der offenen Position angezeigt.</div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hLoopCr()">Erstellen</button></div></div></div>';
  }
  if (M.fnew) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Neuer Feature-Vorschlag</div><p style="font-size:12px;color:var(--t4);margin-bottom:16px">Beschreibe deine Idee so genau wie möglich. Ein Admin wird den Vorschlag prüfen und zur Abstimmung freigeben.</p><div class="fg"><label>Titel (Kurz & Bündig)</label><input id="f-title" placeholder="z.B. Dark Mode Option"></div><div class="fg"><label>Details / Beschreibung</label><textarea id="f-desc" style="width:100%;height:100px;padding:8px 12px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg);color:var(--t);font-family:inherit;font-size:13px;resize:vertical" placeholder="Ich hätte gerne..."></textarea></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hFeature()">Einreichen</button></div></div></div>';
  }
  if (M.msgreply) {
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" onclick="event.stopPropagation()"><div class="mdt">Antwort senden</div><div class="hnt">An: ' +
      es(M.msgreply.targetEmail || "Admin") +
      '</div><div class="fg"><label>Betreff</label><input id="msg-r-title" value="' +
      es(M.msgreply.title || "Re: Nachricht") +
      '"></div><div class="fg"><label>Nachricht</label><textarea id="msg-r-body" rows="6"></textarea></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Abbrechen</button><button class="bt bp" onclick="hMsgReply()">Senden</button></div></div></div>';
  }
  if (M.msgprev) {
    var mp = msgPayload(MC.status || "draft");
    h +=
      '<div class="ov" onclick="cm();R()"><div class="mdl" style="max-width:560px" onclick="event.stopPropagation()"><div class="mdt">Nachrichten Vorschau</div><div class="msg-actions" style="margin-bottom:12px">' +
      renderMsgBadges({
        priority: mp.priority,
        category: mp.category,
        isPinned: mp.isPinned,
      }) +
      '</div><div style="font-size:22px;font-weight:700;margin-bottom:10px">' +
      es(mp.title) +
      '</div><div style="font-size:13px;color:var(--t3);line-height:1.7;white-space:pre-wrap">' +
      es(mp.body) +
      '</div><div class="msg-grid" style="margin-top:16px"><div class="msg-info"><span class="sl">Ziel</span><strong>' +
      (mp.targetType === "all"
        ? "Alle User"
        : mp.targetType === "segment"
          ? "Segment: " + es(MC.audiencePreset)
          : es(MC.targetEmail || "Direktnachricht")) +
      '</strong></div><div class="msg-info"><span class="sl">Versand</span><strong>' +
      (mp.status === "scheduled" && mp.scheduledAt
        ? msgFmt(mp.scheduledAt)
        : mp.status === "sent"
          ? "Sofort"
          : "Entwurf") +
      '</strong></div><div class="msg-info"><span class="sl">Ablauf</span><strong>' +
      (mp.expiresAt ? msgFmt(mp.expiresAt) : "Kein Ablauf") +
      '</strong></div></div><div class="mda"><button class="bt bcn" onclick="cm();R()">Zurück</button><button class="bt bp" onclick="msgSave(MC.status||\'draft\')">' +
      ((MC.status || "draft") === "sent" ? "Jetzt senden" : "Speichern") +
      "</button></div></div></div>";
  }

  var activeId = document.activeElement ? document.activeElement.id : null,
    selStart = null,
    selEnd = null;
  if (
    activeId &&
    (document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA")
  ) {
    try {
      selStart = document.activeElement.selectionStart;
      selEnd = document.activeElement.selectionEnd;
    } catch (e) {}
  }

  mountLegacyHtml(document.getElementById("app"), h, renderScope);
  LAST_RENDER_AT = Date.now();

  if (activeId) {
    var restored = document.getElementById(activeId);
    if (restored) {
      restored.focus();
      if (selStart !== null) {
        try {
          restored.setSelectionRange(selStart, selEnd);
        } catch (e) {}
      }
    }
  }
  if (M.login && VERIFY_EMAIL && Date.now() < VERIFY_RETRY_AT) {
    setTimeout(function () {
      if (M.login) R();
    }, 1000);
  }

  var foc = {
    p: "p-name",
    eu: "f-eun",
    cr: "f-n",
    rw: "f-ra",
    iv: "f-ni",
    pl: "f-pa",
    no: "f-ne",
    tk: "f-etn",
    ed: "f-edd",
    er: "f-era",
    ep: "f-epa",
    ei: "f-eia",
    fex: "f-exp",
    fexm: "f-exma",
    fpos: "f-ptk",
    ffund: "f-ffa",
    fefund: "f-fefa",
    fclose: "f-fcs",
    femm: "f-fmma",
    feex: "f-eexp",
    fepos: "f-eptk",
    fprc: "f-mp",
    login: "l-email",
    reg: "r-email",
    lcr: "f-lcb",
    led: "f-lcb",
  };
  for (var k in foc)
    if (M[k]) {
      setTimeout(
        (function (id) {
          return function () {
            var el = document.getElementById(id);
            if (el) el.focus();
          };
        })(foc[k]),
        50,
      );
      break;
    }
}

function render() {
  return R();
}

function renderHeader() {
  return R({ scope: "header" });
}

function renderView() {
  return R({ scope: "view" });
}

function renderModals() {
  return R({ scope: "modals" });
}

function renderViewOnly() {
  return renderView();
}

function renderModalOnly() {
  return renderModals();
}

document.addEventListener("click", (e) => {
  var t = e && e.target;
  if (
    t &&
    !(
      (t.closest && t.closest("#f-pstk")) ||
      (t.closest && t.closest("#f-pltk")) ||
      (t.closest && t.closest("#f-estk")) ||
      (t.closest && t.closest("#f-eltk")) ||
      (t.closest && t.closest("#f-pstk-sug")) ||
      (t.closest && t.closest("#f-pltk-sug")) ||
      (t.closest && t.closest("#f-estk-sug")) ||
      (t.closest && t.closest("#f-eltk-sug"))
    )
  )
    frfCloseTokenSuggestions();
  if (M.usr) {
    M.usr = false;
    R();
  }
});

setInterval(function () {
  if (!document.hidden && !Object.keys(M).length && AUTH.loggedIn) loadData();
}, 30000);
setInterval(function () {
  if (!document.hidden && !Object.keys(M).length && AUTH.loggedIn)
    fetchPrices();
}, 120000);
window.addEventListener("focus", wakeUi);
window.addEventListener("pageshow", wakeUi);
window.addEventListener("online", wakeUi);
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) wakeUi();
});
document.addEventListener(
  "pointerdown",
  function () {
    if (!document.hidden && Date.now() - LAST_RENDER_AT > 180000) wakeUi();
  },
  true,
);
const legacyBindings = {
  AUTH: { get: () => AUTH, set: (value) => (AUTH = value) },
  PID: { get: () => PID, set: (value) => (PID = value) },
  S: { get: () => S, set: (value) => (S = value) },
  FR: { get: () => FR, set: (value) => (FR = value) },
  U: { get: () => U, set: (value) => (U = value) },
  LO: { get: () => LO, set: (value) => (LO = value) },
  V: { get: () => V, set: (value) => (V = value) },
  FRFV: { get: () => FRFV, set: (value) => (FRFV = value) },
  LOOPV: { get: () => LOOPV, set: (value) => (LOOPV = value) },
  SI: { get: () => SI, set: (value) => (SI = value) },
  FPI: { get: () => FPI, set: (value) => (FPI = value) },
  LPI: { get: () => LPI, set: (value) => (LPI = value) },
  UD: { get: () => UD, set: (value) => (UD = value) },
  VW: { get: () => VW, set: (value) => (VW = value) },
  STRAT_SORT: { get: () => STRAT_SORT, set: (value) => (STRAT_SORT = value) },
  FRF_SORT: { get: () => FRF_SORT, set: (value) => (FRF_SORT = value) },
  M: { get: () => M, set: (value) => (M = value) },
  PRICES: { get: () => PRICES, set: (value) => (PRICES = value) },
  EXP: { get: () => EXP, set: (value) => (EXP = value) },
  MSG_SUM: { get: () => MSG_SUM, set: (value) => (MSG_SUM = value) },
  MSG: { get: () => MSG, set: (value) => (MSG = value) },
  MSG_VIEW: { get: () => MSG_VIEW, set: (value) => (MSG_VIEW = value) },
  MSG_FILTER: { get: () => MSG_FILTER, set: (value) => (MSG_FILTER = value) },
  MSG_SEARCH: { get: () => MSG_SEARCH, set: (value) => (MSG_SEARCH = value) },
  MSG_ADMIN_SEARCH: {
    get: () => MSG_ADMIN_SEARCH,
    set: (value) => (MSG_ADMIN_SEARCH = value),
  },
  MSG_SEGMENT: {
    get: () => MSG_SEGMENT,
    set: (value) => (MSG_SEGMENT = value),
  },
  MC: { get: () => MC, set: (value) => (MC = value) },
  SHOW_HINTS: { get: () => SHOW_HINTS, set: (value) => (SHOW_HINTS = value) },
  LAST_WAKE_AT: {
    get: () => LAST_WAKE_AT,
    set: (value) => (LAST_WAKE_AT = value),
  },
  VERIFY_EMAIL: {
    get: () => VERIFY_EMAIL,
    set: (value) => (VERIFY_EMAIL = value),
  },
  VERIFY_RETRY_AT: {
    get: () => VERIFY_RETRY_AT,
    set: (value) => (VERIFY_RETRY_AT = value),
  },
  FRF_TOKEN_REQ: {
    get: () => FRF_TOKEN_REQ,
    set: (value) => (FRF_TOKEN_REQ = value),
  },
  FRF_LIVE_QUOTES: {
    get: () => FRF_LIVE_QUOTES,
    set: (value) => (FRF_LIVE_QUOTES = value),
  },
  FRF_LIVE_LOADING: {
    get: () => FRF_LIVE_LOADING,
    set: (value) => (FRF_LIVE_LOADING = value),
  },
  FRF_LIVE_NEXT_AT: {
    get: () => FRF_LIVE_NEXT_AT,
    set: (value) => (FRF_LIVE_NEXT_AT = value),
  },
  FRF_LIVE_TIMER: {
    get: () => FRF_LIVE_TIMER,
    set: (value) => (FRF_LIVE_TIMER = value),
  },
  LOOP_PEG_QUOTES: {
    get: () => LOOP_PEG_QUOTES,
    set: (value) => (LOOP_PEG_QUOTES = value),
  },
  LOOP_PEG_LOADING: {
    get: () => LOOP_PEG_LOADING,
    set: (value) => (LOOP_PEG_LOADING = value),
  },
  LOOP_PEG_NEXT_AT: {
    get: () => LOOP_PEG_NEXT_AT,
    set: (value) => (LOOP_PEG_NEXT_AT = value),
  },
  PG_ACT: { get: () => PG_ACT, set: (value) => (PG_ACT = value) },
  PG_PAST: { get: () => PG_PAST, set: (value) => (PG_PAST = value) },
  PG_FRFO: { get: () => PG_FRFO, set: (value) => (PG_FRFO = value) },
  PG_FRFC: { get: () => PG_FRFC, set: (value) => (PG_FRFC = value) },
  PG_LOOP: { get: () => PG_LOOP, set: (value) => (PG_LOOP = value) },
  SEARCH_ACT: { get: () => SEARCH_ACT, set: (value) => (SEARCH_ACT = value) },
  SEARCH_PAST: {
    get: () => SEARCH_PAST,
    set: (value) => (SEARCH_PAST = value),
  },
  SEARCH_FRF: { get: () => SEARCH_FRF, set: (value) => (SEARCH_FRF = value) },
  SEARCH_LOOP: {
    get: () => SEARCH_LOOP,
    set: (value) => (SEARCH_LOOP = value),
  },
  ITEMS_PER_PAGE: {
    get: () => ITEMS_PER_PAGE,
    set: (value) => (ITEMS_PER_PAGE = value),
  },
  IS_DEMO: { get: () => IS_DEMO, set: (value) => (IS_DEMO = value) },
  ROLE_ORDER: { get: () => ROLE_ORDER, set: (value) => (ROLE_ORDER = value) },
  STABLE_PRICES: {
    get: () => STABLE_PRICES,
    set: (value) => (STABLE_PRICES = value),
  },
  LOOP_TOKEN_OPTIONS: {
    get: () => LOOP_TOKEN_OPTIONS,
    set: (value) => (LOOP_TOKEN_OPTIONS = value),
  },
  LOOP_ORACLE_TOKEN_MAP: {
    get: () => LOOP_ORACLE_TOKEN_MAP,
    set: (value) => (LOOP_ORACLE_TOKEN_MAP = value),
  },
  LOOP_ORACLE_REQ: {
    get: () => LOOP_ORACLE_REQ,
    set: (value) => (LOOP_ORACLE_REQ = value),
  },
  UI_KEY_BASE: {
    get: () => UI_KEY_BASE,
    set: (value) => (UI_KEY_BASE = value),
  },
  LAST_RENDER_AT: {
    get: () => LAST_RENDER_AT,
    set: (value) => (LAST_RENDER_AT = value),
  },
  CG_MAP: { get: () => CG_MAP, set: (value) => (CG_MAP = value) },
  CG_REV: { get: () => CG_REV, set: (value) => (CG_REV = value) },
};

for (const [key, descriptor] of Object.entries(legacyBindings)) {
  Object.defineProperty(window, key, {
    configurable: true,
    get: descriptor.get,
    set: descriptor.set,
  });
}

const _legacyRegistry = {
  setPgAct, setPgPast, setPgFrfO, setPgFrfC, uiKey, saveUi, restoreUi, normUi,
  cm, tgl, fd, fds, fts, db, calcApr, fn, fpr, es, onlineMeta, onlineBadge,
  ci, strategyHasTokenEvents, strategyTokenEntries, strategyTokenSummary, strategyTokenSearchText,
  strategyTokenBadges, renderStrategyTokenChanges, strategyTokenRowHtml, strategyTokenInputSection,
  strategyAddTokenRow, strategyRemoveTokenRow, collectStrategyTokenRows, tr, posFloatingPnl, posPnl, tp, tg, bp, wa,
  stratIncl, sortDirMul, cmpText, cmpNumber, sortIndicator, sortableHeader,
  toggleStrategySort, toggleFrfSort, sortStrategies, frfAprForSort, frfTotalApr, sortFrf,
  exMargin, exName, latestFunding, posIncl, runningFunding, posLiveSize, posEntrySize, posCapital,
  roleRank, hasRole, canManageMessages, canOpenAdmin, canManageRoles, canManageAllRoles, roleBadge,
  fetchPrices, loopTokenDatalist, loopOracleCfg, loopRateKind, apyToApr, normalizeLoopRateToApr,
  loopRateLabel, updateLoopRateLabels, loopPegKey, loopPegMarketPrice, shouldFetchLoopPegQuote,
  requestLoopPegQuote, refreshLoopPegQuotes, loopPegInfo, fmtPeg, renderPegSummary,
  updateLoopPegPreview, fetchLoopOracleDefaults,
  api, F, loadData, wakeUi, loadLoops, setPid, logout, hLogin, hReg,
  verifyCooldownText, resendVerifyMail, dBack, rBack, hNewProf, delProf,
  loadAdmin, adminTgl, adminFeatTgl, adminDel, adminRole, loadFeatures, hSupport,
  loopPayloadFromForm, loopTokenPrice, calculateLoopingTotals, loopSupplyValue,
  loopBorrowValue, loopBorrowTokenAmount, loopLeverage, loopNetApr, loopAnnualizedRateFromChange,
  loopHasManualCurrentAmounts, loopSupplyAprSinceStart, loopBorrowAprSinceStart, loopAprSinceStartSummary, calcLoopData,
  hLoopCr, openLoopDetail, openLoopEdit, hLoopUpd, saveLoopCurrentAmounts, closeLoop, updateLoopName, renderLoopModal,
  hFeature, hVote, openAdminDetail, renderAdminChart,
  endS, reaS, delS, delR, delP, togP, togStratApr, doUndo,
  frfDelEx, frfDelPos, frfDelFund, frfClosePos, frfToggleCloseFunding,
  frfTogPos, frfTogStrat, frfReopenPos,
  linkedTargetValue, linkedTargetOptions, linkedTargetPayload,
  exchangePresetValueForName, resolveExchangeFormName, exchangePresetOptionsHtml,
  exchangePresetFieldIds, syncExchangePreset,
  frfResolveExchangeSelection, frfFilterExchangeOptions, frfExchangeFieldIds,
  frfExchangeChoice, frfRenderExchangeSuggestions, frfExchangeSelect,
  frfExchangeSuggestSection, frfExchangeSuggest, frfCloseExchangeSuggestions,
  normExchangeLabel, frfTokenFieldIds, frfCounterSide, frfTokenSuggestBox,
  frfRenderTokenSuggestions, frfTokenChoice, frfTokenReset, frfTokenSelect,
  frfCloseTokenSuggestions, frfTokenSuggestSection, frfTokenSuggest,
  frfLiveQuote, frfLiveRemaining, frfLiveButtonLabel, frfScheduleLiveTick,
  frfEnsureLive, frfFetchLive,
  frfFundingPct, frfFundingAnnualRate, frfFundingAnnualDisplay, frfFundingAnnualPct,
  frfFundingPeriod, frfFundingRowsHtml, frfFundingSection,
  hCr, hRw, hIv, hPl, hNo, hTk, hEd, hEr, hEp, hEi,
  hFex, hFeex, hFexm, hFemm, hFpos, hFepos, hFfund, hFefund, hFclose, hFprc,
  loadMessageSummary, hintAttr, msgTs, msgFmt, msgIso, msgCatCls, msgCatLbl, msgPriLbl,
  msgThreads, msgFilteredThreads, msgSelectedThread, msgAdminSelected,
  msgResetCompose, msgComposeAll, msgComposeUser, msgLoadDraft, msgPreview,
  msgPayload, msgSave, msgDelete, msgOpenThread, msgMarkAllRead, msgReplyOpen,
  hMsgReply, msgSelectAdmin, loadMessageRecipients, loadMessages, openMessages,
  render, renderHeader, renderView, renderModals, renderViewOnly, renderModalOnly,
  renderMsgBadges, renderMessagesView, R,
};

for (const [name, value] of Object.entries(_legacyRegistry)) {
  window[name] = value;
}

loadData();
