const BENQI_SAVAX_APR_URL = 'https://api.benqi.fi/liquidstaking/apr';
const CACHE_MS = 5 * 60 * 1000;

let cache = { expiresAt: 0, data: [] };

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

module.exports = {
  providerName: 'benqi',
  fetchOracleData
};
