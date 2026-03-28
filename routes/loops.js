function registerLoopRoutes(app, deps) {
  const { attachProfile, db, gid, normalizeLoopTokenInput, requireAuth } = deps;

  app.get('/api/loops', requireAuth, attachProfile, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM loops WHERE profileId = $1 ORDER BY startDate DESC', [req.profile.id]);
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Laden' });
    }
  });

  app.post('/api/loops', requireAuth, attachProfile, async (req, res) => {
    try {
      const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, startCollateralAmount, supplyApy, borrowedAmount, borrowApy, endCollateralAmount, endBorrowedAmount, currentCollateralAmount, currentBorrowedAmount, leverage, notes, pegReferenceToken, pegEntryPrice } = req.body;
      if (!name || !startDate || !collateralToken || !borrowToken || !startCollateral || !collateralPrice || !startCollateralAmount || !supplyApy || !borrowApy) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen' });
      }

      const loopId = gid();
      const numericLeverage = parseFloat(leverage) || 1;
      const numericBorrowedAmount = parseFloat(borrowedAmount);
      const numericEndBorrowedAmount = parseFloat(endBorrowedAmount);
      const borrowAmountValue = Number.isFinite(numericBorrowedAmount) ? numericBorrowedAmount : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : 0);
      const supplyAmountValue = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : parseFloat(startCollateralAmount);
      const currentSupplyAmountValue = Number.isFinite(parseFloat(currentCollateralAmount)) ? parseFloat(currentCollateralAmount) : supplyAmountValue;
      const currentBorrowAmountValue = Number.isFinite(parseFloat(currentBorrowedAmount)) ? parseFloat(currentBorrowedAmount) : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue);
      const loopNotes = String(notes || '').trim().slice(0, 4000);
      const normalizedPegReferenceToken = normalizeLoopTokenInput(pegReferenceToken || borrowToken);
      const numericPegEntryPrice = Number.isFinite(parseFloat(pegEntryPrice)) ? parseFloat(pegEntryPrice) : null;

      await db.query(
        `INSERT INTO loops (id, profileId, name, startDate, collateralToken, borrowToken, initialCollateral, supplyApy, borrowApr, supplyAmount, borrowAmount, startCollateral, collateralPrice, startCollateralAmount, borrowedAmount, borrowApy, endCollateralAmount, endBorrowedAmount, currentCollateralAmount, currentBorrowedAmount, leverage, status, notes, pegReferenceToken, pegEntryPrice)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
        [loopId, req.profile.id, name, startDate, collateralToken, borrowToken, startCollateral, supplyApy, borrowApy, supplyAmountValue, borrowAmountValue, startCollateral, collateralPrice, startCollateralAmount, borrowAmountValue, borrowApy, endCollateralAmount || startCollateralAmount, Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue, currentSupplyAmountValue, currentBorrowAmountValue, numericLeverage, 'active', loopNotes || null, normalizedPegReferenceToken || null, numericPegEntryPrice],
      );
      res.json({ id: loopId, ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Fehler beim Erstellen' });
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

      const { rowCount } = await db.query(
        `UPDATE loops SET name = COALESCE($1,name), startDate = COALESCE($2,startDate), collateralToken = COALESCE($3,collateralToken), borrowToken = COALESCE($4,borrowToken),
         initialCollateral = COALESCE($5,initialCollateral), startCollateral = COALESCE($5,startCollateral), collateralPrice = COALESCE($6,collateralPrice), startCollateralAmount = COALESCE($7,startCollateralAmount),
         supplyApy = COALESCE($8,supplyApy), borrowApr = COALESCE($9,borrowApr), borrowApy = COALESCE($9,borrowApy), leverage = COALESCE($10,leverage),
         supplyAmount = COALESCE($11,supplyAmount), borrowAmount = COALESCE($12,borrowAmount), endCollateralAmount = COALESCE($11,endCollateralAmount), endBorrowedAmount = COALESCE($12,endBorrowedAmount),
         currentCollateralAmount = COALESCE($13,currentCollateralAmount), currentBorrowedAmount = COALESCE($14,currentBorrowedAmount),
         status = COALESCE($15,status), notes = COALESCE($16,notes), pegReferenceToken = CASE WHEN $17 = '' THEN NULL ELSE COALESCE($17, pegReferenceToken) END,
         pegEntryPrice = COALESCE($18, pegEntryPrice), updatedAt = CURRENT_TIMESTAMP WHERE id = $19 AND profileId = $20`,
        [name || null, startDate || null, collateralToken || null, borrowToken || null, nStartColl, nCollPrice, nStartAmt, nSupplyApy, nBorrowApy, nLev, nEndColl, nEndBorrow, nCurrentColl, nCurrentBorrow, status || null, loopNotes, normalizedPegReferenceToken, nPegEntry, req.params.id, req.profile.id],
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
