const benqiProvider = require('./providers/benqi');

const providers = [benqiProvider];

function normAsset(v) {
  return String(v || '').trim().toUpperCase();
}

function normProtocol(v) {
  return String(v || '').trim().toLowerCase();
}

function normType(v) {
  return String(v || '').trim().toUpperCase();
}

async function collectOracleData() {
  const settled = await Promise.allSettled(providers.map((provider) => provider.fetchOracleData()));
  const rows = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      result.value.forEach((row) => rows.push(row));
    } else if (result.status === 'rejected') {
      console.error('[oracle:aggregator] provider failed:', providers[index].providerName, result.reason && result.reason.message ? result.reason.message : result.reason);
    }
  });

  return rows;
}

async function queryOracleData(filters = {}) {
  const rows = await collectOracleData();
  const asset = filters.asset ? normAsset(filters.asset) : '';
  const protocol = filters.protocol ? normProtocol(filters.protocol) : '';
  const type = filters.type ? normType(filters.type) : '';

  return rows.filter((row) => {
    if (asset && normAsset(row.asset) !== asset) return false;
    if (protocol && normProtocol(row.protocol) !== protocol) return false;
    if (type && normType(row.type) !== type) return false;
    return true;
  });
}

module.exports = {
  collectOracleData,
  queryOracleData
};
