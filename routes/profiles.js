function registerProfileRoutes(app, deps) {
  const { db, gid, requireAuth } = deps;

  app.post('/api/profiles', requireAuth, async (req, res) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 100);
      if (!name) return res.status(400).json({ error: 'Name fehlt' });
      const profileId = gid();
      await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [profileId, req.account.id, name]);
      res.json({ id: profileId, accountId: req.account.id, name });
    } catch (error) {
      console.error('profile create error:', error.message);
      res.status(500).json({ error: 'Fehler beim Erstellen' });
    }
  });

  app.put('/api/profiles/:id', requireAuth, async (req, res) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 100);
      if (!name) return res.status(400).json({ error: 'Name fehlt' });
      const { rowCount } = await db.query('UPDATE profiles SET name = $1 WHERE id = $2 AND accountid = $3', [name, req.params.id, req.account.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'Profil nicht gefunden' });
      res.json({ id: req.params.id, name });
    } catch (error) {
      console.error('profile update error:', error.message);
      res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  });

  app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM profiles WHERE accountid = $1', [req.account.id]);
      const profileCount = rows[0] ? Number(rows[0].count) : 0;
      if (profileCount <= 1) {
        return res.status(400).json({ error: 'Es muss mindestens ein Profil bestehen bleiben' });
      }
      const { rowCount } = await db.query('DELETE FROM profiles WHERE id = $1 AND accountid = $2', [req.params.id, req.account.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'Profil nicht gefunden' });
      res.json({ ok: 1 });
    } catch (error) {
      console.error('profile delete error:', error.message);
      res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  });
}

module.exports = { registerProfileRoutes };
