function registerLoopRoutes(app, deps) {
  const { attachProfile, benqiProvider, db, gid, normalizeLoopTokenInput, oracle, requireAuth } = deps;

  const LOOP_BORROW_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;

  function apyToApr(value) {
    const dailyPeriods = 365;
    const rate = (parseFloat(value || 0) || 0) / 100;
    if (rate <= -1) return -100;
    return (Math.pow(1 + rate, 1 / dailyPeriods) - 1) * dailyPeriods * 100;
  }

  function normalizeRateToApr(value, rateKind) {
    const numericValue = parseFloat(value || 0) || 0;
    return String(rateKind || 'APR').toUpperCase() === 'APY' ? apyToApr(numericValue) : numericValue;
  }

  function normalizeLoopToken(value) {
    return typeof normalizeLoopTokenInput === 'function'
      ? normalizeLoopTokenInput(value)
      : String(value || '').trim().toUpperCase();
  }

  function parseRequiredNumber(value, label) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      const error = new Error(`${label} ist ungültig`);
      error.statusCode = 400;
      throw error;
    }
    return parsed;
  }

  function loadBorrowOracleConfig(token) {
    const normalizedToken = normalizeLoopToken(token);
    if (normalizedToken === 'AVAX' || normalizedToken === 'WAVAX') {
      return { asset: 'WAVAX', protocol: 'Aave', type: 'BORROW', rateKind: 'APY' };
    }
    return null;
  }

  async function insertBorrowAprSnapshot(loopId, profileId, capturedAt, borrowApr, source) {
    if (!loopId || !profileId || !capturedAt || !Number.isFinite(parseFloat(borrowApr))) return;
    await db.query(
      `INSERT INTO loop_borrow_rate_snapshots (id, loopId, profileId, capturedAt, borrowApr, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [gid(), loopId, profileId, capturedAt, parseFloat(borrowApr), source || null],
    );
  }

  async function fetchSupplyPegSnapshot(collateralToken) {
    if (normalizeLoopToken(collateralToken) !== 'SAVAX' || !benqiProvider || typeof benqiProvider.fetchPegQuote !== 'function') {
      return { value: null, timestamp: null };
    }
    const quote = await benqiProvider.fetchPegQuote();
    if (!quote || !Number.isFinite(parseFloat(quote.value))) {
      return { value: null, timestamp: null };
    }
    return {
      value: parseFloat(quote.value),
      timestamp: quote.timestamp || new Date().toISOString(),
    };
  }

  async function fetchLiveBorrowApr(loop) {
    const cfg = loadBorrowOracleConfig(loop.borrowtoken || loop.borrowToken);
    if (!cfg || !oracle || typeof oracle.queryOracleData !== 'function') return null;
    const rows = await oracle.queryOracleData({ asset: cfg.asset, protocol: cfg.protocol, type: cfg.type });
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];
    const aprValue = normalizeRateToApr(row && row.value, row && row.rateKind ? row.rateKind : cfg.rateKind);
    return Number.isFinite(parseFloat(aprValue)) ? parseFloat(aprValue) : null;
  }

  async function captureDueBorrowSnapshots(loops) {
    const activeLoops = Array.isArray(loops)
      ? loops.filter((loop) => String(loop.status || 'active').toLowerCase() === 'active')
      : [];
    if (!activeLoops.length) return;

    const loopIds = activeLoops.map((loop) => loop.id).filter(Boolean);
    if (!loopIds.length) return;

    const { rows: latestRows } = await db.query(
      `SELECT DISTINCT ON (loopId) loopId, capturedAt
       FROM loop_borrow_rate_snapshots
       WHERE loopId = ANY($1::text[])
       ORDER BY loopId, capturedAt DESC`,
      [loopIds],
    );
    const latestByLoopId = new Map(
      latestRows.map((row) => [row.loopid || row.loopId, row.capturedat || row.capturedAt]),
    );

    for (const loop of activeLoops) {
      const lastCapturedAt = latestByLoopId.get(loop.id);
      if (lastCapturedAt) {
        const lastCapturedMs = new Date(lastCapturedAt).getTime();
        if (Number.isFinite(lastCapturedMs) && Date.now() - lastCapturedMs < LOOP_BORROW_SNAPSHOT_INTERVAL_MS) {
          continue;
        }
      }
      const borrowApr = await fetchLiveBorrowApr(loop);
      if (!Number.isFinite(parseFloat(borrowApr))) continue;
      await insertBorrowAprSnapshot(loop.id, loop.profileid || loop.profileId, new Date().toISOString(), borrowApr, 'oracle-sync');
    }
  }

  async function loadLoopsWithStats(profileId) {
    const { rows } = await db.query(
      `SELECT loops.*, stats.avgBorrowApr, stats.snapshotCount, stats.lastCapturedAt
       FROM loops
       LEFT JOIN LATERAL (
         SELECT AVG(borrowApr) AS avgBorrowApr,
                COUNT(*) AS snapshotCount,
                MAX(capturedAt) AS lastCapturedAt
         FROM loop_borrow_rate_snapshots
         WHERE loopId = loops.id
       ) stats ON true
       WHERE profileId = $1
       ORDER BY startDate DESC`,
      [profileId],
    );
    return rows;
  }

  app.get('/api/loops', requireAuth, attachProfile, async (req, res) => {
    try {
      let rows = await loadLoopsWithStats(req.profile.id);
      try {
        await captureDueBorrowSnapshots(rows);
        rows = await loadLoopsWithStats(req.profile.id);
      } catch (snapshotError) {
        console.error('loop borrow snapshot:', snapshotError.message || snapshotError);
      }
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Laden' });
    }
  });

  app.post('/api/loops', requireAuth, attachProfile, async (req, res) => {
    try {
      const body = req.body || {};
      const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, startCollateralAmount, supplyApy, borrowedAmount, borrowApy, endCollateralAmount, endBorrowedAmount, currentCollateralAmount, currentBorrowedAmount, leverage, notes, pegReferenceToken, pegEntryPrice } = body;
      if (!name || !startDate || !collateralToken || !borrowToken || startCollateral == null || collateralPrice == null || startCollateralAmount == null || supplyApy == null || borrowApy == null) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen' });
      }

      const numericStartCollateral = parseRequiredNumber(startCollateral, 'Startkapital');
      const numericCollateralPrice = parseRequiredNumber(collateralPrice, 'Collateral-Preis');
      const numericStartCollateralAmount = parseRequiredNumber(startCollateralAmount, 'Collateral-Menge');
      const numericSupplyApy = parseRequiredNumber(supplyApy, 'Supply-APY');
      const numericBorrowApy = parseRequiredNumber(borrowApy, 'Borrow-APY');
      const loopId = gid();
      const numericLeverage = Number.isFinite(parseFloat(leverage)) ? parseFloat(leverage) : 1;
      const numericBorrowedAmount = parseFloat(borrowedAmount);
      const numericEndBorrowedAmount = parseFloat(endBorrowedAmount);
      const borrowAmountValue = Number.isFinite(numericBorrowedAmount) ? numericBorrowedAmount : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : 0);
      const supplyAmountValue = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : numericStartCollateralAmount;
      const currentSupplyAmountValue = Number.isFinite(parseFloat(currentCollateralAmount)) ? parseFloat(currentCollateralAmount) : supplyAmountValue;
      const currentBorrowAmountValue = Number.isFinite(parseFloat(currentBorrowedAmount)) ? parseFloat(currentBorrowedAmount) : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue);
      const loopNotes = String(notes || '').trim().slice(0, 4000);
      const normalizedPegReferenceToken = normalizeLoopTokenInput(pegReferenceToken || borrowToken);
      const numericPegEntryPrice = Number.isFinite(parseFloat(pegEntryPrice)) ? parseFloat(pegEntryPrice) : null;
      const supplyPegSnapshot = await fetchSupplyPegSnapshot(collateralToken);

      await db.query(
        `INSERT INTO loops (id, profileId, name, startDate, collateralToken, borrowToken, initialCollateral, supplyApy, borrowApr, supplyAmount, borrowAmount, startCollateral, collateralPrice, startCollateralAmount, borrowedAmount, borrowApy, endCollateralAmount, endBorrowedAmount, currentCollateralAmount, currentBorrowedAmount, leverage, status, notes, pegReferenceToken, pegEntryPrice, supplyPegStart, supplyPegStartAt, currentAmountsUpdatedAt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
        [loopId, req.profile.id, name, startDate, collateralToken, borrowToken, numericStartCollateral, numericSupplyApy, numericBorrowApy, supplyAmountValue, borrowAmountValue, numericStartCollateral, numericCollateralPrice, numericStartCollateralAmount, borrowAmountValue, numericBorrowApy, endCollateralAmount || numericStartCollateralAmount, Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue, currentSupplyAmountValue, currentBorrowAmountValue, numericLeverage, 'active', loopNotes || null, normalizedPegReferenceToken || null, numericPegEntryPrice, supplyPegSnapshot.value, supplyPegSnapshot.timestamp, null],
      );
      await insertBorrowAprSnapshot(loopId, req.profile.id, startDate, numericBorrowApy, 'initial');
      res.json({ id: loopId, ok: 1 });
    } catch (error) {
      console.error(error);
      const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
      res.status(statusCode).json({ error: statusCode === 400 ? error.message : 'Fehler beim Erstellen' });
    }
  });

  app.put('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
    try {
      const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, startCollateralAmount, supplyApy, borrowApy, leverage, endCollateralAmount, endBorrowedAmount, currentCollateralAmount, currentBorrowedAmount, status, notes, pegReferenceToken, pegEntryPrice } = req.body;
      const nStartColl = Number.isFinite(parseFloat(startCollateral)) ? parseFloat(startCollateral) : null;
      const nCollPrice = Number.isFinite(parseFloat(collateralPrice)) ? parseFloat(collateralPrice) : null;
      const nStartAmt = Number.isFinite(parseFloat(startCollateralAmount)) ? parseFloat(startCollateralAmount) : null;
      const nSupplyApy = Number.isFinite(parseFloat(supplyApy)) ? parseFloat(supplyApy) : null;
      const nBorrowApy = Number.isFinite(parseFloat(borrowApy)) ? parseFloat(borrowApy) : null;
      const nLev = Number.isFinite(parseFloat(leverage)) ? parseFloat(leverage) : null;
      const nEndColl = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : null;
      const nEndBorrow = Number.isFinite(parseFloat(endBorrowedAmount)) ? parseFloat(endBorrowedAmount) : null;
      const nCurrentColl = Number.isFinite(parseFloat(currentCollateralAmount)) ? parseFloat(currentCollateralAmount) : null;
      const nCurrentBorrow = Number.isFinite(parseFloat(currentBorrowedAmount)) ? parseFloat(currentBorrowedAmount) : null;
      const loopNotes = typeof notes === 'string' ? notes.trim().slice(0, 4000) : null;
      const normalizedPegReferenceToken = pegReferenceToken === '' ? '' : (pegReferenceToken == null ? null : normalizeLoopTokenInput(pegReferenceToken));
      const nPegEntry = pegEntryPrice === '' ? null : (Number.isFinite(parseFloat(pegEntryPrice)) ? parseFloat(pegEntryPrice) : null);
      const currentAmountsUpdatedAt = nCurrentColl !== null || nCurrentBorrow !== null ? new Date().toISOString() : null;

      const { rowCount } = await db.query(
        `UPDATE loops SET name = COALESCE($1,name), startDate = COALESCE($2,startDate), collateralToken = COALESCE($3,collateralToken), borrowToken = COALESCE($4,borrowToken),
         initialCollateral = COALESCE($5,initialCollateral), startCollateral = COALESCE($5,startCollateral), collateralPrice = COALESCE($6,collateralPrice), startCollateralAmount = COALESCE($7,startCollateralAmount),
         supplyApy = COALESCE($8,supplyApy), borrowApr = COALESCE($9,borrowApr), borrowApy = COALESCE($9,borrowApy), leverage = COALESCE($10,leverage),
         supplyAmount = COALESCE($11,supplyAmount), borrowAmount = COALESCE($12,borrowAmount), endCollateralAmount = COALESCE($11,endCollateralAmount), endBorrowedAmount = COALESCE($12,endBorrowedAmount),
         currentCollateralAmount = COALESCE($13,currentCollateralAmount), currentBorrowedAmount = COALESCE($14,currentBorrowedAmount),
         currentAmountsUpdatedAt = COALESCE($15,currentAmountsUpdatedAt), status = COALESCE($16,status), notes = COALESCE($17,notes), pegReferenceToken = CASE WHEN $18 = '' THEN NULL ELSE COALESCE($18, pegReferenceToken) END,
         pegEntryPrice = COALESCE($19, pegEntryPrice), updatedAt = CURRENT_TIMESTAMP WHERE id = $20 AND profileId = $21`,
        [name || null, startDate || null, collateralToken || null, borrowToken || null, nStartColl, nCollPrice, nStartAmt, nSupplyApy, nBorrowApy, nLev, nEndColl, nEndBorrow, nCurrentColl, nCurrentBorrow, currentAmountsUpdatedAt, status || null, loopNotes, normalizedPegReferenceToken, nPegEntry, req.params.id, req.profile.id],
      );

      if (rowCount === 0) return res.status(404).json({ error: 'Loop nicht gefunden' });
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  });

  app.delete('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
    try {
      await db.query('DELETE FROM loops WHERE id = $1 AND profileId = $2', [req.params.id, req.profile.id]);
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  });

  app.post('/api/loops/:id/close', requireAuth, attachProfile, async (req, res) => {
    try {
      const { endDate, endCollateralAmount, endBorrowedAmount } = req.body;
      const nextEndCollateralAmount = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : null;
      const nextEndBorrowedAmount = Number.isFinite(parseFloat(endBorrowedAmount)) ? parseFloat(endBorrowedAmount) : null;
      await db.query(
        `UPDATE loops SET status = 'closed', endDate = $1, supplyAmount = COALESCE($2, supplyAmount, endCollateralAmount), borrowAmount = COALESCE($3, borrowAmount, endBorrowedAmount),
         endCollateralAmount = COALESCE($2, endCollateralAmount, supplyAmount), endBorrowedAmount = COALESCE($3, endBorrowedAmount, borrowAmount),
         currentCollateralAmount = COALESCE(currentCollateralAmount, COALESCE($2, endCollateralAmount, supplyAmount)), currentBorrowedAmount = COALESCE(currentBorrowedAmount, COALESCE($3, endBorrowedAmount, borrowAmount)), updatedAt = CURRENT_TIMESTAMP
         WHERE id = $4 AND profileId = $5`,
        [endDate, nextEndCollateralAmount, nextEndBorrowedAmount, req.params.id, req.profile.id],
      );
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Schließen' });
    }
  });
}

module.exports = { registerLoopRoutes };
