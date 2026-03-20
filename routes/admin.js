function registerAdminRoutes(app, deps) {
  const { db, hasRole, logAuditEvent, normalizeRole, requireAdmin, VALID_ROLES, validateRole } = deps;

  app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT a.id, a.email, a.role, a.isverified, a.isblocked, a.createdat,
               COUNT(DISTINCT p.id) as "profileCount", COUNT(DISTINCT l.id) as "loginCount30d",
               MAX(ap.lastseen) as "lastSeenAt"
        FROM accounts a
        LEFT JOIN profiles p ON a.id = p.accountid
        LEFT JOIN account_logins l ON a.id = l.accountid AND l.logindate >= CURRENT_DATE - INTERVAL '30 days'
        LEFT JOIN account_presence ap ON a.id = ap.accountid
        GROUP BY a.id ORDER BY a.createdat DESC
      `);
      res.json(rows);
    } catch (error) {
      console.error('admin accounts error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.get('/api/admin/accounts/:id/stats', requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT logindate as date FROM account_logins
        WHERE accountId = $1 AND logindate >= CURRENT_DATE - INTERVAL '365 days'
        ORDER BY logindate ASC
      `, [req.params.id]);
      res.json(rows.map((row) => row.date));
    } catch (error) {
      console.error('admin stats error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.put('/api/admin/accounts/:id/toggle-block', requireAdmin, async (req, res) => {
    try {
      if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht sperren' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
      const target = rows[0];
      const targetRole = normalizeRole(target.role);
      if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gesperrt werden' });
      if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins sperren' });
      
      await db.query('UPDATE accounts SET isblocked = NOT isblocked WHERE id = $1', [req.params.id]);
      
      await logAuditEvent({
        action: 'toggle_block',
        actorId: req.account.id,
        targetId: req.params.id,
        tableRef: 'accounts',
        beforeData: { isBlocked: target.isblocked },
        afterData: { isBlocked: !target.isblocked },
        req
      });
      
      res.json({ ok: 1 });
    } catch (error) {
      console.error('admin toggle-block error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
    try {
      if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
      const target = rows[0];
      const targetRole = normalizeRole(target.role);
      if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gelöscht werden' });
      if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins löschen' });
      
      await db.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
      
      await logAuditEvent({
        action: 'delete_account',
        actorId: req.account.id,
        targetId: req.params.id,
        tableRef: 'accounts',
        beforeData: { email: target.email, role: target.role },
        afterData: null,
        req
      });
      
      res.json({ ok: 1 });
    } catch (error) {
      console.error('admin delete error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.put('/api/admin/accounts/:id/role', requireAdmin, async (req, res) => {
    const nextRole = validateRole(req.body.role);
    if (nextRole === null) {
      return res.status(400).json({ error: 'Ungültige Rolle. Gültig: ' + VALID_ROLES.join(', ') });
    }
    const { rows } = await db.query('SELECT id, email, role FROM accounts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account nicht gefunden' });
    const target = rows[0];
    const currentRole = normalizeRole(target.role);
    if (req.account.id === target.id && nextRole !== 'owner') return res.status(400).json({ error: 'Eigene Owner-Rolle kann nicht entfernt werden' });
    if (!hasRole(req.account, 'owner')) {
      if (currentRole === 'admin' || currentRole === 'owner' || nextRole === 'admin' || nextRole === 'owner') {
        return res.status(403).json({ error: 'Nur Owner kann Admin/Owner-Rollen verwalten' });
      }
    }
    
    await db.query('UPDATE accounts SET role = $1 WHERE id = $2', [nextRole, target.id]);
    
    await logAuditEvent({
      action: 'change_role',
      actorId: req.account.id,
      targetId: target.id,
      tableRef: 'accounts',
      beforeData: { role: currentRole },
      afterData: { role: nextRole },
      req
    });
    
    res.json({ ok: 1, role: nextRole });
  });

  app.get('/api/admin/accounts/:id/stats', requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT logindate as date FROM account_logins
        WHERE accountId = $1 AND logindate >= CURRENT_DATE - INTERVAL '365 days'
        ORDER BY logindate ASC
      `, [req.params.id]);
      res.json(rows.map((row) => row.date));
    } catch (error) {
      console.error('admin stats error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.put('/api/admin/accounts/:id/toggle-block', requireAdmin, async (req, res) => {
    try {
      if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht sperren' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
      const targetRole = normalizeRole(rows[0].role);
      if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gesperrt werden' });
      if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins sperren' });
      await db.query('UPDATE accounts SET isblocked = NOT isblocked WHERE id = $1', [req.params.id]);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('admin toggle-block error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
    try {
      if (req.params.id === req.account.id) return res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Account nicht gefunden' });
      const targetRole = normalizeRole(rows[0].role);
      if (targetRole === 'owner') return res.status(400).json({ error: 'Owner kann nicht gelöscht werden' });
      if (targetRole === 'admin' && !hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Nur Owner kann Admins löschen' });
      await db.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('admin delete error:', error.message);
      res.status(500).json({ error: 'Fehler' });
    }
  });

  app.put('/api/admin/accounts/:id/role', requireAdmin, async (req, res) => {
    const nextRole = normalizeRole(req.body.role);
    const { rows } = await db.query('SELECT id, email, role FROM accounts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account nicht gefunden' });
    const target = rows[0];
    const currentRole = normalizeRole(target.role);
    if (req.account.id === target.id && nextRole !== 'owner') return res.status(400).json({ error: 'Eigene Owner-Rolle kann nicht entfernt werden' });
    if (!hasRole(req.account, 'owner')) {
      if (currentRole === 'admin' || currentRole === 'owner' || nextRole === 'admin' || nextRole === 'owner') {
        return res.status(403).json({ error: 'Nur Owner kann Admin/Owner-Rollen verwalten' });
      }
    }
    await db.query('UPDATE accounts SET role = $1 WHERE id = $2', [nextRole, target.id]);
    res.json({ ok: 1, role: nextRole });
  });

  app.get('/api/admin/features', requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT r.id, r.title, r.description, r.status, r.createdat, a.email as author,
               (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) as votes
        FROM feature_requests r
        JOIN accounts a ON r.account_id = a.id
        ORDER BY r.createdat DESC
      `);
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 1 });
    }
  });

  app.put('/api/admin/features/:id/status', requireAdmin, async (req, res) => {
    try {
      const validStatuses = ['pending', 'approved', 'planned', 'implemented', 'rejected'];
      const status = String(req.body.status || '').trim();
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
      await db.query('UPDATE feature_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 1 });
    }
  });
}

module.exports = { registerAdminRoutes };
