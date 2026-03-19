function createAuthMiddleware({ db, jwt, jwtSecret, sessionCookie, normalizeRole, hasRole, touchPresence }) {
  async function attachAccount(req, res, next) {
    const token = req.cookies[sessionCookie];
    if (!token) return next();

    try {
      const decoded = jwt.verify(token, jwtSecret);
      const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [decoded.accountId]);
      if (rows.length > 0) {
        req.account = rows[0];
        req.account.role = normalizeRole(req.account.role);
        touchPresence(req.account.id);
      }
    } catch (error) {
      // Ungueltiger oder abgelaufener Token
    }

    next();
  }

  function requireAuth(req, res, next) {
    if (!req.account) return res.status(401).json({ error: 'Nicht eingeloggt' });
    if (req.account.isblocked) return res.status(403).json({ error: 'Account blockiert' });
    if (!req.account.isverified) return res.status(403).json({ error: 'E-Mail nicht verifiziert' });
    next();
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (!hasRole(req.account, 'admin')) return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
      next();
    });
  }

  function requireSupport(req, res, next) {
    requireAuth(req, res, () => {
      if (!hasRole(req.account, 'support')) return res.status(403).json({ error: 'Support-Rechte erforderlich' });
      next();
    });
  }

  function requireOwner(req, res, next) {
    requireAuth(req, res, () => {
      if (!hasRole(req.account, 'owner')) return res.status(403).json({ error: 'Owner-Rechte erforderlich' });
      next();
    });
  }

  async function attachProfile(req, res, next) {
    const profileId = req.headers['x-profile-id'];
    if (!profileId) return res.status(400).json({ error: 'Kein Profil ausgewählt' });

    try {
      const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1 AND accountid = $2', [profileId, req.account.id]);
      if (rows.length === 0) return res.status(403).json({ error: 'Profil Zugriff verweigert' });
      req.profile = rows[0];
      if (!req.profile.data) req.profile.data = [];
      if (!req.profile.frf) req.profile.frf = { exchanges: [], positions: [] };
      if (!req.profile.undo) req.profile.undo = [];
      next();
    } catch (error) {
      res.status(500).json({ error: 'Fehler beim Laden des Profils' });
    }
  }

  return {
    attachAccount,
    attachProfile,
    requireAdmin,
    requireAuth,
    requireOwner,
    requireSupport,
  };
}

module.exports = { createAuthMiddleware };
