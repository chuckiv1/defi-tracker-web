function registerStrategyRoutes(app, deps) {
  const { attachProfile, express, gid, requireAuth, saveProfile, svU } = deps;

  function normalizeTokenChangesInput(body) {
    const directRows = Array.isArray(body && body.tokenChanges) ? body.tokenChanges : [];
    const legacyToken = body && body.token && body.token.name ? [body.token] : [];
    return [...directRows, ...legacyToken]
      .map((entry) => {
        const name = String((entry && entry.name) || '').trim();
        const amount = parseFloat(entry && entry.amount);
        const entryPrice = parseFloat(entry && entry.entryPrice);
        if (!name && !Number.isFinite(amount) && !Number.isFinite(entryPrice)) return null;
        return {
          id: gid(),
          name,
          amount: Number.isFinite(amount) ? amount : NaN,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
        };
      })
      .filter(Boolean);
  }

  function validateTokenChanges(tokenChanges) {
    for (const entry of tokenChanges) {
      if (!entry.name) return 'Tokenname erforderlich';
      if (!Number.isFinite(entry.amount) || entry.amount === 0) return 'Tokenmenge muss ungleich 0 sein';
      if (!Number.isFinite(entry.entryPrice) || entry.entryPrice < 0) return 'Entry-Preis ungültig';
    }
    return '';
  }

  app.get('/api/undo', requireAuth, attachProfile, (req, res) => {
    res.json(req.profile.undo.map((entry, index) => ({ index, label: entry.label, time: entry.time })));
  });

  app.post('/api/undo/:index', requireAuth, attachProfile, async (req, res) => {
    try {
      const undo = req.profile.undo;
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index) || index < 0 || index >= undo.length) return res.status(400).json({ error: 'Ungültiger Index' });
      req.profile.data = undo[index].data;
      if (undo[index].frf) req.profile.frf = undo[index].frf;
      req.profile.undo = undo.slice(0, index);
      await saveProfile(req);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('undo error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.get('/api/strategies', requireAuth, attachProfile, (req, res) => { res.json(req.profile.data); });

  const router = express.Router();
  app.use('/api', requireAuth, attachProfile, router);

  router.post('/strategies', async (req, res) => {
    try {
      const investment = parseFloat(req.body.investment);
      if (Number.isNaN(investment)) return res.status(400).json({ error: 'Ungültiges Investment' });
      const tokenChanges = normalizeTokenChangesInput(req.body);
      const tokenError = validateTokenChanges(tokenChanges);
      if (tokenError) return res.status(400).json({ error: tokenError });
      svU(req, 'Neue Strategie');
      const data = req.profile.data;
      data.push({ id: gid(), name: String(req.body.name || '').slice(0, 200), startDate: req.body.startDate, notes: req.body.notes || '', token: tokenChanges.length ? null : (req.body.token || null), includeInTotalApr: true, investmentHistory: [{ id: gid(), amount: investment, date: req.body.startDate, note: '', tokenChanges }], rewards: [], pnl: [], endedAt: null });
      req.profile.data = data;
      await saveProfile(req);
      res.json(data[data.length - 1]);
    } catch (error) {
      console.error('strategy create:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.delete('/strategies/:id', async (req, res) => {
    try {
      svU(req, 'Strat del');
      req.profile.data = req.profile.data.filter((strategy) => strategy.id !== req.params.id);
      await saveProfile(req);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('strategy delete:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.put('/strategies/:id/:action', async (req, res) => {
    try {
      const validActions = ['end', 'reactivate', 'enddate', 'notes', 'token', 'toggle-total-apr'];
      if (!validActions.includes(req.params.action)) return res.status(400).json({ error: 'Ungültige Aktion' });
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Strategie nicht gefunden' });
      svU(req, 'Strat Edit');
      if (req.params.action === 'end') strategy.endedAt = new Date().toISOString();
      if (req.params.action === 'reactivate') strategy.endedAt = null;
      if (req.params.action === 'enddate') strategy.endedAt = req.body.endedAt || new Date().toISOString();
      if (req.params.action === 'notes') strategy.notes = req.body.notes || '';
      if (req.params.action === 'token') strategy.token = req.body.name ? { name: req.body.name, amount: parseFloat(req.body.amount) || 0, entryPrice: parseFloat(req.body.entryPrice) || 0 } : null;
      if (req.params.action === 'toggle-total-apr') strategy.includeInTotalApr = !strategy.includeInTotalApr;
      await saveProfile(req);
      res.json(strategy);
    } catch (error) {
      console.error('strategy edit:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.post('/strategies/:id/investment', async (req, res) => {
    try {
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Nicht gefunden' });
      const tokenChanges = normalizeTokenChangesInput(req.body);
      const tokenError = validateTokenChanges(tokenChanges);
      if (tokenError) return res.status(400).json({ error: tokenError });
      const parsedAmount = parseFloat(req.body.amount);
      const amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
      if (Number.isNaN(parsedAmount) && !tokenChanges.length) return res.status(400).json({ error: 'Ungültiger Betrag' });
      svU(req, 'Invest+');
      strategy.investmentHistory.push({ id: gid(), amount, date: new Date().toISOString(), note: req.body.note || '', tokenChanges });
      await saveProfile(req);
      res.json(strategy);
    } catch (error) {
      console.error('invest:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.post('/strategies/:id/rewards', async (req, res) => {
    try {
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Nicht gefunden' });
      const amount = parseFloat(req.body.amount);
      if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungültiger Betrag' });
      svU(req, 'Reward+');
      strategy.rewards.push({ id: gid(), amount, date: req.body.date || new Date().toISOString(), note: req.body.note || '' });
      await saveProfile(req);
      res.json(strategy);
    } catch (error) {
      console.error('reward:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  router.post('/strategies/:id/pnl', async (req, res) => {
    try {
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Nicht gefunden' });
      const amount = parseFloat(req.body.amount);
      if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungültiger Betrag' });
      svU(req, 'PNL+');
      strategy.pnl.push({ id: gid(), amount, note: req.body.note || '', date: new Date().toISOString(), includeInAPR: false });
      await saveProfile(req);
      res.json(strategy);
    } catch (error) {
      console.error('pnl:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  function updateNestedStrategyEntry(kind) {
    return async (req, res) => {
      svU(req, kind === 'investment' ? 'Invest~' : kind === 'rewards' ? 'Reward~' : 'PNL~');
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Strategie nicht gefunden' });
      const list = strategy[kind] || [];
      const entry = list.find((item) => item.id === req.params.itemId);
      if (!entry) return res.status(404).json({ error: kind === 'investment' ? 'Investment-Eintrag nicht gefunden' : kind === 'rewards' ? 'Reward-Eintrag nicht gefunden' : 'PNL-Eintrag nicht gefunden' });
      const amount = parseFloat(req.body.amount);
      if (Number.isNaN(amount)) return res.status(400).json({ error: 'Ungueltiger Betrag' });
      const date = req.body.date ? new Date(req.body.date) : null;
      if (date && Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ungueltiges Datum' });
      entry.amount = amount;
      entry.note = req.body.note || '';
      if (date) entry.date = date.toISOString();
      await saveProfile(req);
      res.json(strategy);
    };
  }

  router.put('/strategies/:id/investment/:itemId', updateNestedStrategyEntry('investment'));
  router.put('/strategies/:id/rewards/:itemId', updateNestedStrategyEntry('rewards'));
  router.put('/strategies/:id/pnl/:itemId', updateNestedStrategyEntry('pnl'));

  router.put('/strategies/:id/pnl/:itemId/toggle', async (req, res) => {
    svU(req, 'PNL toggle');
    const strategy = req.profile.data.find((item) => item.id === req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Strategie nicht gefunden' });
    const entry = (strategy.pnl || []).find((item) => item.id === req.params.itemId);
    if (!entry) return res.status(404).json({ error: 'PNL-Eintrag nicht gefunden' });
    entry.includeInAPR = !entry.includeInAPR;
    await saveProfile(req);
    res.json(strategy);
  });

  router.delete('/strategies/:id/:type/:itemId', async (req, res) => {
    try {
      const validTypes = ['rewards', 'pnl'];
      if (!validTypes.includes(req.params.type)) return res.status(400).json({ error: 'Ungültiger Typ' });
      const strategy = req.profile.data.find((item) => item.id === req.params.id);
      if (!strategy) return res.status(404).json({ error: 'Strategie nicht gefunden' });
      svU(req, 'Item del');
      if (req.params.type === 'rewards') strategy.rewards = (strategy.rewards || []).filter((item) => item.id !== req.params.itemId);
      if (req.params.type === 'pnl') strategy.pnl = (strategy.pnl || []).filter((item) => item.id !== req.params.itemId);
      await saveProfile(req);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('item del:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });
}

module.exports = { registerStrategyRoutes };
