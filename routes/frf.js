function registerFrfRoutes(app, deps) {
  const { attachProfile, express, getExchangeFunding, getExchangeQuote, getFrfSpotFallback, gid, profileExchangeById, requireAuth, saveProfile, searchSymbolsForExchange, svU } = deps;

  function parseRequiredNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  app.get('/api/frf', requireAuth, attachProfile, (req, res) => { res.json(req.profile.frf); });

  const router = express.Router();
  app.use('/api', requireAuth, attachProfile, router);

  router.get('/frf/exchanges/:id/symbols', async (req, res) => {
    try {
      const exchangeId = String(req.params.id || '').trim().slice(0, 100);
      const query = String(req.query.q || '').trim().slice(0, 30);
      if (!exchangeId) return res.status(400).json({ error: 'Boerse erforderlich' });
      const exchange = profileExchangeById(req.profile, exchangeId);
      if (!exchange) return res.status(404).json({ error: 'Boerse nicht gefunden' });
      const result = await searchSymbolsForExchange(exchange.name, query);
      return res.json({ exchangeId, exchangeName: exchange.name, provider: result.provider, items: result.items });
    } catch (error) {
      console.error('frf exchange symbols:', error.message);
      return res.status(500).json({ error: error.message || 'Symbolsuche fehlgeschlagen' });
    }
  });

  router.get('/frf/positions/:id/live', async (req, res) => {
    try {
      const positionId = String(req.params.id || '').trim().slice(0, 100);
      if (!positionId) return res.status(400).json({ error: 'Position erforderlich' });
      const position = req.profile.frf.positions.find((item) => item.id === positionId);
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
          getExchangeQuote(shortExchange.name, position.shortMarketSymbol || position.token, 'perp'),
          getExchangeFunding(shortExchange.name, position.shortMarketSymbol || position.token, 'perp'),
        ]);
        shortData = { ...quote, funding, entryPrice: shortEntry, pnl: tokenAmount > 0 && shortEntry > 0 && quote.price > 0 ? (shortEntry - quote.price) * tokenAmount : 0 };
      } catch (error) {
        shortData = { exchangeName: shortExchange ? shortExchange.name : 'Short', error: error.message || 'Short-Livepreis fehlgeschlagen', funding: null, entryPrice: shortEntry, pnl: 0 };
      }
      try {
        if (!position.longIsSpot && !longExchange) throw new Error('Long-Boerse nicht gefunden');
        const quote = position.longIsSpot ? await getFrfSpotFallback(position.longMarketSymbol || position.token, shortExchange ? shortExchange.name : '', shortData && !shortData.error ? shortData : null) : await getExchangeQuote(longExchange ? longExchange.name : '', position.longMarketSymbol || position.token, 'perp');
        const funding = position.longIsSpot ? null : await getExchangeFunding(longExchange ? longExchange.name : '', position.longMarketSymbol || position.token, 'perp');
        longData = { ...quote, funding, exchangeName: position.longIsSpot ? (quote.exchangeName || 'Spot') : quote.exchangeName, entryPrice: longEntry, pnl: tokenAmount > 0 && longEntry > 0 && quote.price > 0 ? (quote.price - longEntry) * tokenAmount : 0 };
      } catch (error) {
        longData = { exchangeName: position.longIsSpot ? 'Spot' : (longExchange ? longExchange.name : 'Long'), error: error.message || 'Long-Livepreis fehlgeschlagen', funding: null, entryPrice: longEntry, pnl: 0 };
      }
      return res.json({ token: position.token, fetchedAt: new Date().toISOString(), short: shortData, long: longData, totalPnl: (shortData && !shortData.error ? shortData.pnl : 0) + (longData && !longData.error ? longData.pnl : 0) });
    } catch (error) {
      console.error('frf live quote:', error.message);
      return res.status(500).json({ error: error.message || 'Livepreise konnten nicht geladen werden' });
    }
  });

  router.post('/frf/exchanges', async (req, res) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 100);
      const margin = parseRequiredNumber(req.body.margin);
      if (!name) return res.status(400).json({ error: 'Börsenname erforderlich' });
      if (Number.isNaN(margin)) return res.status(400).json({ error: 'Ungültiger Margin-Betrag' });
      svU(req, 'Börse+');
      const frf = req.profile.frf;
      frf.exchanges.push({
        id: gid(),
        name,
        marginHistory: [{ id: gid(), amount: margin, date: new Date().toISOString(), note: 'Ersteinzahlung' }],
      });
      await saveProfile(req);
      res.json(frf);
    } catch (error) {
      console.error('exchange create:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });
  router.delete('/frf/exchanges/:id', async (req, res) => { try { svU(req, 'Börse del'); const frf = req.profile.frf; frf.exchanges = frf.exchanges.filter((item) => item.id !== req.params.id); await saveProfile(req); res.json(frf); } catch (error) { console.error('exchange del:', error.message); res.status(500).json({ error: 'Fehler' }); } });
  router.post('/frf/exchanges/:id/margin', async (req, res) => { try { const frf = req.profile.frf; const exchange = frf.exchanges.find((item) => item.id === req.params.id); if (!exchange) return res.status(404).json({ error: 'Börse nicht gefunden' }); const amount = parseFloat(req.body.amount); if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungültiger Betrag' }); svU(req, 'Margin+'); exchange.marginHistory.push({ id: gid(), amount, date: new Date().toISOString(), note: req.body.note || '' }); await saveProfile(req); res.json(frf); } catch (error) { console.error('margin:', error.message); res.status(500).json({ error: 'Fehler' }); } });

  router.put('/frf/exchanges/:id', async (req, res) => {
    svU(req, 'Borse~');
    const frf = req.profile.frf;
    const exchange = frf.exchanges.find((item) => item.id === req.params.id);
    if (!exchange) return res.status(404).json({ error: 'Boerse nicht gefunden' });
    if (typeof req.body.name === 'string' && req.body.name.trim()) exchange.name = req.body.name.trim().slice(0, 100);
    const margin = parseFloat(req.body.margin);
    if (!Number.isNaN(margin)) {
      const current = (exchange.marginHistory || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const delta = margin - current;
      if (Math.abs(delta) > 0.000001) {
        exchange.marginHistory = exchange.marginHistory || [];
        exchange.marginHistory.push({ id: gid(), amount: delta, date: new Date().toISOString(), note: 'Korrektur (Bearbeitung)' });
      }
    }
    await saveProfile(req);
    res.json(frf);
  });

  router.put('/frf/exchanges/:id/margin/:mid', async (req, res) => {
    svU(req, 'Margin~');
    const frf = req.profile.frf;
    const exchange = frf.exchanges.find((item) => item.id === req.params.id);
    if (!exchange) return res.status(404).json({ error: 'Boerse nicht gefunden' });
    const margin = (exchange.marginHistory || []).find((item) => item.id === req.params.mid);
    if (!margin) return res.status(404).json({ error: 'Margin-Eintrag nicht gefunden' });
    const amount = parseFloat(req.body.amount);
    if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
    const date = req.body.date ? new Date(req.body.date) : null;
    if (date && Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
    margin.amount = amount;
    margin.note = req.body.note || '';
    if (date) margin.date = date.toISOString();
    await saveProfile(req);
    res.json(frf);
  });

  router.delete('/frf/exchanges/:id/margin/:mid', async (req, res) => {
    svU(req, 'Margin-');
    const frf = req.profile.frf;
    const exchange = frf.exchanges.find((item) => item.id === req.params.id);
    if (!exchange) return res.status(404).json({ error: 'Boerse nicht gefunden' });
    exchange.marginHistory = (exchange.marginHistory || []).filter((item) => item.id !== req.params.mid);
    await saveProfile(req);
    res.json(frf);
  });

  router.post('/frf/positions', async (req, res) => {
    svU(req, 'Pos+');
    const frf = req.profile.frf;
    frf.positions.push({ id: gid(), type: req.body.type, token: req.body.token, coingeckoId: req.body.coingeckoId || '', shortAssetSymbol: req.body.shortAssetSymbol || req.body.token || '', longAssetSymbol: req.body.longAssetSymbol || req.body.token || '', shortMarketSymbol: req.body.shortMarketSymbol || req.body.token || '', longMarketSymbol: req.body.longMarketSymbol || req.body.token || '', tokenAmount: parseFloat(req.body.tokenAmount) || 0, positionSizeUsd: parseFloat(req.body.positionSizeUsd) || 0, entryPriceShort: parseFloat(req.body.entryPriceShort) || 0, entryPriceLong: parseFloat(req.body.entryPriceLong) || 0, shortExchangeId: req.body.shortExchangeId, longExchangeId: req.body.longExchangeId, longIsSpot: req.body.longIsSpot, fees: parseFloat(req.body.fees) || 0, linkedStrategyId: req.body.linkedStrategyId || '', linkedLoopId: req.body.linkedLoopId || '', startDate: req.body.startDate || new Date().toISOString(), endedAt: null, closePnlShort: null, closePnlLong: null, closePnlIncludesFunding: false, closeNote: '', manualPrice: 0, useManualPrice: false, includeInStrategy: false, excluded: false, fundingShort: [], fundingLong: [] });
    await saveProfile(req);
    res.json(frf);
  });

  router.delete('/frf/positions/:id', async (req, res) => { svU(req, 'Pos del'); const frf = req.profile.frf; frf.positions = frf.positions.filter((item) => item.id !== req.params.id); await saveProfile(req); res.json(frf); });

  router.put('/frf/positions/:id', async (req, res) => {
    svU(req, 'Pos~');
    const frf = req.profile.frf;
    const position = frf.positions.find((item) => item.id === req.params.id);
    if (!position) return res.status(404).json({ error: 'Position nicht gefunden' });
    position.type = req.body.type || position.type;
    position.token = req.body.token || position.token;
    position.coingeckoId = req.body.coingeckoId || position.coingeckoId || '';
    if (typeof req.body.shortAssetSymbol === 'string') position.shortAssetSymbol = req.body.shortAssetSymbol;
    if (typeof req.body.longAssetSymbol === 'string') position.longAssetSymbol = req.body.longAssetSymbol;
    if (typeof req.body.shortMarketSymbol === 'string') position.shortMarketSymbol = req.body.shortMarketSymbol;
    if (typeof req.body.longMarketSymbol === 'string') position.longMarketSymbol = req.body.longMarketSymbol;
    if (!Number.isNaN(parseFloat(req.body.tokenAmount))) position.tokenAmount = parseFloat(req.body.tokenAmount);
    if (!Number.isNaN(parseFloat(req.body.positionSizeUsd))) position.positionSizeUsd = parseFloat(req.body.positionSizeUsd);
    if (!Number.isNaN(parseFloat(req.body.entryPriceShort))) position.entryPriceShort = parseFloat(req.body.entryPriceShort);
    if (!Number.isNaN(parseFloat(req.body.entryPriceLong))) position.entryPriceLong = parseFloat(req.body.entryPriceLong);
    if (typeof req.body.shortExchangeId === 'string') position.shortExchangeId = req.body.shortExchangeId;
    if (typeof req.body.longExchangeId === 'string') position.longExchangeId = req.body.longExchangeId;
    if (typeof req.body.longIsSpot === 'boolean') position.longIsSpot = req.body.longIsSpot;
    if (!Number.isNaN(parseFloat(req.body.fees))) position.fees = parseFloat(req.body.fees);
    if (typeof req.body.closePnlIncludesFunding === 'boolean') position.closePnlIncludesFunding = req.body.closePnlIncludesFunding;
    if (typeof req.body.linkedStrategyId === 'string') position.linkedStrategyId = req.body.linkedStrategyId;
    if (typeof req.body.linkedLoopId === 'string') position.linkedLoopId = req.body.linkedLoopId;
    if (req.body.startDate) {
      const date = new Date(req.body.startDate);
      if (!Number.isNaN(date.getTime())) position.startDate = date.toISOString();
    }
    await saveProfile(req);
    res.json(frf);
  });

  router.put('/frf/positions/:id/close', async (req, res) => {
    try {
      svU(req, 'Pos close');
      const frf = req.profile.frf;
      const position = frf.positions.find((item) => item.id === req.params.id);
      if (!position) return res.status(404).json({ error: 'Position nicht gefunden' });
      position.endedAt = new Date().toISOString();
      position.closePnlShort = parseFloat(req.body.closePnlShort) || 0;
      position.closePnlLong = parseFloat(req.body.closePnlLong) || 0;
      position.closePnlIncludesFunding = !!req.body.closePnlIncludesFunding;
      position.fees = parseFloat(req.body.fees) || 0;
      position.closeNote = req.body.closeNote || '';
      if (position.closePnlShort !== 0 && position.shortExchangeId) { const exchange = frf.exchanges.find((item) => item.id === position.shortExchangeId); if (exchange) exchange.marginHistory.push({ id: gid(), amount: position.closePnlShort, date: position.endedAt, note: `Auto-Close PNL: ${position.token}` }); }
      if (position.closePnlLong !== 0 && !position.longIsSpot && position.longExchangeId) { const exchange = frf.exchanges.find((item) => item.id === position.longExchangeId); if (exchange) exchange.marginHistory.push({ id: gid(), amount: position.closePnlLong, date: position.endedAt, note: `Auto-Close PNL: ${position.token}` }); }
      await saveProfile(req);
      res.json(frf);
    } catch (error) {
      console.error('pos close:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.put('/frf/positions/:id/toggle-strategy', async (req, res) => { try { svU(req, 'Toggle Strat'); const position = req.profile.frf.positions.find((item) => item.id === req.params.id); if (!position) return res.status(404).json({ error: 'Position nicht gefunden' }); position.includeInStrategy = !position.includeInStrategy; await saveProfile(req); res.json(req.profile.frf); } catch (error) { console.error('toggle strat:', error.message); res.status(500).json({ error: 'Fehler' }); } });
  router.put('/frf/positions/:id/price', async (req, res) => { svU(req, 'Price~'); const position = req.profile.frf.positions.find((item) => item.id === req.params.id); if (!position) return res.status(404).json({ error: 'Position nicht gefunden' }); position.useManualPrice = !!req.body.useManualPrice; position.manualPrice = !Number.isNaN(parseFloat(req.body.manualPrice)) ? parseFloat(req.body.manualPrice) : 0; await saveProfile(req); res.json(req.profile.frf); });
  router.post('/frf/positions/:id/funding/:side', async (req, res) => { try { const position = req.profile.frf.positions.find((item) => item.id === req.params.id); if (!position) return res.status(404).json({ error: 'Position nicht gefunden' }); if (req.params.side !== 'short' && req.params.side !== 'long') return res.status(400).json({ error: 'Ungültige Seite' }); const amount = parseFloat(req.body.amount); if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungültiger Betrag' }); svU(req, 'Fund+'); const list = req.params.side === 'short' ? position.fundingShort : position.fundingLong; list.push({ id: gid(), amount, date: new Date().toISOString(), note: req.body.note || '' }); await saveProfile(req); res.json(req.profile.frf); } catch (error) { console.error('funding add:', error.message); res.status(500).json({ error: 'Fehler' }); } });
  router.put('/frf/positions/:id/funding/:side/:fid', async (req, res) => { svU(req, 'Fund~'); const position = req.profile.frf.positions.find((item) => item.id === req.params.id); if (!position) return res.status(404).json({ error: 'Position nicht gefunden' }); if (req.params.side !== 'short' && req.params.side !== 'long') return res.status(400).json({ error: 'Ungueltige Seite' }); const list = req.params.side === 'short' ? position.fundingShort : position.fundingLong; const funding = list.find((item) => item.id === req.params.fid); if (!funding) return res.status(404).json({ error: 'Funding-Eintrag nicht gefunden' }); const amount = parseFloat(req.body.amount); if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' }); let dateIso = funding.date || new Date().toISOString(); if (req.body.date) { const date = new Date(req.body.date); if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' }); dateIso = date.toISOString(); } funding.amount = amount; funding.note = req.body.note || ''; funding.date = dateIso; await saveProfile(req); res.json(req.profile.frf); });
  router.delete('/frf/positions/:id/funding/:side/:fid', async (req, res) => { try { const position = req.profile.frf.positions.find((item) => item.id === req.params.id); if (!position) return res.status(404).json({ error: 'Position nicht gefunden' }); svU(req, 'Fund-'); if (req.params.side === 'short') position.fundingShort = (position.fundingShort || []).filter((item) => item.id !== req.params.fid); else position.fundingLong = (position.fundingLong || []).filter((item) => item.id !== req.params.fid); await saveProfile(req); res.json(req.profile.frf); } catch (error) { console.error('funding del:', error.message); res.status(500).json({ error: 'Fehler' }); } });
}

module.exports = { registerFrfRoutes };
