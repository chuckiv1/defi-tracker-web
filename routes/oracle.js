function registerOracleRoutes(app, deps) {
  const { benqiProvider, externalApiLimiter, normalizeLoopTokenInput, oracle, requireAuth } = deps;

  app.get('/api/oracle/lookup', requireAuth, externalApiLimiter, async (req, res) => {
    try {
      const asset = String(req.query.asset || '').trim().slice(0, 32);
      const protocol = String(req.query.protocol || '').trim().slice(0, 40);
      const type = String(req.query.type || '').trim().toUpperCase();
      if (!asset) return res.status(400).json({ error: 'Asset fehlt' });
      if (protocol && !/^[a-zA-Z0-9._-]{1,40}$/.test(protocol)) return res.status(400).json({ error: 'Ungueltiges Protokoll' });
      if (type && !['SUPPLY', 'BORROW', 'PRICE'].includes(type)) return res.status(400).json({ error: 'Ungueltiger Typ' });
      const rows = await oracle.queryOracleData({ asset, protocol: protocol || undefined, type: type || undefined });
      res.json(rows);
    } catch (error) {
      console.error('oracle lookup:', error.message);
      res.status(500).json({ error: 'Oracle-Daten konnten nicht geladen werden' });
    }
  });

  app.get('/api/loops/peg-quote', requireAuth, externalApiLimiter, async (req, res) => {
    try {
      const asset = normalizeLoopTokenInput(req.query.asset);
      const referenceAsset = normalizeLoopTokenInput(req.query.referenceAsset);
      if (!asset || !referenceAsset) return res.status(400).json({ error: 'Asset und Referenz fehlen' });

      if (asset === 'SAVAX' && referenceAsset === 'AVAX') {
        const quote = await benqiProvider.fetchPegQuote();
        if (!quote) return res.status(502).json({ error: 'Benqi Peg-Quote konnte nicht geladen werden' });
        return res.json(quote);
      }

      res.json({ asset, referenceAsset, protocol: 'market-ratio', type: 'PEG', source: 'market-ratio', value: null, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('loop peg quote:', error.message);
      res.status(500).json({ error: 'Peg-Quote konnte nicht geladen werden' });
    }
  });
}

module.exports = { registerOracleRoutes };
