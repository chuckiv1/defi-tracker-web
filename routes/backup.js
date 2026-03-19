function registerBackupRoutes(app, deps) {
  const { attachProfile, isValidFrfPayload, isValidStrategy, requireAuth, saveProfile } = deps;

  app.get('/api/backup', requireAuth, attachProfile, (req, res) => {
    res.json({ backupVersion: '9.0', profileName: req.profile.name, timestamp: new Date().toISOString(), data: req.profile.data, frf: req.profile.frf });
  });

  app.post('/api/backup/restore', requireAuth, attachProfile, async (req, res) => {
    const { data, frf } = req.body;
    if (!Array.isArray(data) || !data.every(isValidStrategy) || !isValidFrfPayload(frf)) {
      return res.status(400).json({ error: 'Ungültige Backup-Datei' });
    }
    req.profile.data = data;
    req.profile.frf = frf;
    await saveProfile(req);
    res.json({ ok: 1 });
  });
}

module.exports = { registerBackupRoutes };
