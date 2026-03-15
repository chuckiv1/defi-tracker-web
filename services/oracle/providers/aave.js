const AAVE_GRAPHQL_URL = 'https://api.v3.aave.com/graphql';
const AAVE_AVALANCHE_V3_MARKET = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const WAVAX_ADDRESS = '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7';
const CACHE_MS = 5 * 60 * 1000;

const RESERVE_QUERY = `
  query Reserve($request: ReserveRequest!) {
    reserve(request: $request) {
      underlyingToken { symbol }
      borrowInfo {
        apy { value }
        borrowingState
      }
    }
  }
`;

let cache = { expiresAt: 0, data: [] };

async function fetchOracleData() {
  const now = Date.now();
  if (cache.expiresAt > now) return cache.data;

  try {
    const resp = await fetch(AAVE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        query: RESERVE_QUERY,
        variables: {
          request: {
            market: AAVE_AVALANCHE_V3_MARKET,
            underlyingToken: WAVAX_ADDRESS,
            chainId: 43114
          }
        }
      })
    });

    if (!resp.ok) throw new Error(`Aave reserve HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message || 'Aave GraphQL error');

    const reserve = json && json.data && json.data.reserve;
    const apyRaw = Number(reserve && reserve.borrowInfo && reserve.borrowInfo.apy && reserve.borrowInfo.apy.value);
    const borrowingState = String(reserve && reserve.borrowInfo && reserve.borrowInfo.borrowingState || '').trim();
    if (!Number.isFinite(apyRaw)) throw new Error('Aave WAVAX borrow APY missing');
    if (borrowingState && borrowingState !== 'ENABLED') throw new Error(`Aave WAVAX borrowing state ${borrowingState}`);

    const timestamp = new Date().toISOString();
    const data = [{
      asset: 'WAVAX',
      protocol: 'Aave',
      type: 'BORROW',
      rateKind: 'APY',
      value: apyRaw * 100,
      timestamp
    }];

    cache = { expiresAt: now + CACHE_MS, data };
    return data;
  } catch (err) {
    console.error('[oracle:aave] fetch failed:', err.message);
    return [];
  }
}

module.exports = {
  providerName: 'aave',
  fetchOracleData
};
