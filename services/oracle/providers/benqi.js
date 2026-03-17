const BENQI_SAVAX_APR_URL = 'https://api.benqi.fi/liquidstaking/apr';
const BENQI_SAVAX_CONTRACT = '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE';
const BENQI_RPC_URL = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const GET_POOLED_AVAX_BY_SHARES_SELECTOR = '0x4a36d6c1';
const CACHE_MS = 5 * 60 * 1000;

let cache = { expiresAt: 0, data: [] };
let pegCache = { expiresAt: 0, quote: null };

function encodeUint256(value) {
  const hex = BigInt(value).toString(16);
  return hex.padStart(64, '0');
}

function formatWeiRatio(rawValue) {
  const scale = 1000000n;
  const numerator = BigInt(rawValue) * scale;
  const scaled = numerator / 1000000000000000000n;
  return Number(scaled) / Number(scale);
}

async function fetchOracleData() {
  const now = Date.now();
  if (cache.expiresAt > now) return cache.data;

  try {
    const resp = await fetch(BENQI_SAVAX_APR_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) throw new Error(`BENQI APR HTTP ${resp.status}`);
    const json = await resp.json();
    const aprRaw = Number(json && json.apr);
    if (!Number.isFinite(aprRaw)) throw new Error('BENQI APR payload invalid');

    const timestamp = new Date().toISOString();
    const data = [{
      asset: 'sAVAX',
      protocol: 'Benqi',
      type: 'SUPPLY',
      rateKind: 'APR',
      value: aprRaw * 100,
      timestamp
    }];

    cache = { expiresAt: now + CACHE_MS, data };
    return data;
  } catch (err) {
    console.error('[oracle:benqi] fetch failed:', err.message);
    return [];
  }
}

async function fetchPegQuote() {
  const now = Date.now();
  if (pegCache.expiresAt > now && pegCache.quote) return pegCache.quote;

  try {
    const response = await fetch(BENQI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{
          to: BENQI_SAVAX_CONTRACT,
          data: `${GET_POOLED_AVAX_BY_SHARES_SELECTOR}${encodeUint256('1000000000000000000')}`,
        }, 'latest'],
      }),
    });

    if (!response.ok) throw new Error(`BENQI peg HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !payload.result || payload.error) throw new Error('BENQI peg payload invalid');

    const ratio = formatWeiRatio(payload.result);
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('BENQI peg ratio invalid');

    const quote = {
      asset: 'sAVAX',
      referenceAsset: 'AVAX',
      protocol: 'Benqi',
      type: 'PEG',
      source: 'benqi-unstake',
      value: ratio,
      timestamp: new Date().toISOString(),
    };

    pegCache = { expiresAt: now + CACHE_MS, quote };
    return quote;
  } catch (err) {
    console.error('[oracle:benqi] peg fetch failed:', err.message);
    return null;
  }
}

module.exports = {
  providerName: 'benqi',
  fetchOracleData,
  fetchPegQuote,
};
