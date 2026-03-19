function registerAuthRoutes(app, deps) {
  const {
    APP_URL,
    SESSION_COOKIE,
    SESSION_COOKIE_OPTS,
    VERIFY_RESEND_LIMIT_MS,
    crypto,
    db,
    gid,
    hashPassAsync,
    jwt,
    jwtSecret,
    normalizeRole,
    sendMail,
    timingSafeCompare,
    touchPresence,
    verifyResendCooldowns,
  } = deps;

  app.get('/api/auth/status', async (req, res) => {
    try {
      if (!req.account) return res.json({ loggedIn: false });
      const { rows: profiles } = await db.query('SELECT id, name FROM profiles WHERE accountid = $1', [req.account.id]);
      res.json({ loggedIn: true, account: { email: req.account.email, role: req.account.role }, profiles });
    } catch (error) {
      console.error('auth/status error:', error.message);
      res.status(500).json({ error: 'Interner Fehler' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !email.includes('@') || !password || password.length < 8) return res.status(400).json({ error: 'Ungültige Daten' });

      const { rows: existing } = await db.query('SELECT id FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
      if (existing.length > 0) return res.status(400).json({ error: 'E-Mail existiert bereits' });

      const salt = crypto.randomBytes(16).toString('hex');
      const verifyToken = gid();
      const accId = gid();
      const passHash = await hashPassAsync(password, salt);

      await db.query(
        'INSERT INTO accounts (id, email, salt, passHash, role, isVerified, verifyToken, isBlocked) VALUES ($1, $2, $3, $4, $5, false, $6, false)',
        [accId, email, salt, passHash, 'user', verifyToken],
      );

      const link = `${APP_URL}/verify.html?token=${verifyToken}`;
      await sendMail(email, 'DeFi Vault - Bitte verifiziere deine E-Mail', `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('register error:', error.message);
      if (error.code === '23505') return res.status(400).json({ error: 'E-Mail existiert bereits' });
      res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  });

  app.post('/api/auth/verify', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token fehlt' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE verifyToken = $1', [token]);
      if (rows.length === 0) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link' });

      const acc = rows[0];
      await db.query('UPDATE accounts SET isVerified = true, verifyToken = NULL WHERE id = $1', [acc.id]);
      await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [gid(), acc.id, 'Main Wallet']);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('verify error:', error.message);
      res.status(500).json({ error: 'Verifizierung fehlgeschlagen' });
    }
  });

  app.post('/api/auth/resend-verification', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return res.status(400).json({ error: 'Ungültige E-Mail' });

      const now = Date.now();
      const lastSentAt = verifyResendCooldowns.get(email) || 0;
      const waitMs = VERIFY_RESEND_LIMIT_MS - (now - lastSentAt);
      if (waitMs > 0) return res.status(429).json({ error: 'Bitte warte kurz vor dem nächsten Versand', retryAfterMs: waitMs });

      const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
      if (rows.length === 0) return res.status(400).json({ error: 'Anfrage konnte nicht verarbeitet werden' });

      const acc = rows[0];
      if (acc.isverified) return res.status(400).json({ error: 'E-Mail ist bereits verifiziert' });

      const verifyToken = acc.verifytoken || gid();
      if (!acc.verifytoken) await db.query('UPDATE accounts SET verifyToken = $1 WHERE id = $2', [verifyToken, acc.id]);

      const link = `${APP_URL}/verify.html?token=${verifyToken}`;
      await sendMail(acc.email, 'DeFi Vault - Bitte verifiziere deine E-Mail', `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
      verifyResendCooldowns.set(email, now);
      res.json({ ok: 1, retryAfterMs: VERIFY_RESEND_LIMIT_MS });
    } catch (error) {
      console.error('resend-verification error:', error.message);
      res.status(500).json({ error: 'Interner Fehler' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password, rememberMe } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
      const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
      if (rows.length === 0) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });

      const acc = rows[0];
      const computedHash = await hashPassAsync(password, acc.salt);
      if (!timingSafeCompare(acc.passhash, computedHash)) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
      if (acc.isblocked) return res.status(403).json({ error: 'Account ist blockiert' });
      if (!acc.isverified) return res.status(403).json({ error: 'E-Mail noch nicht verifiziert' });

      const today = new Date().toISOString().split('T')[0];
      await db.query(
        'INSERT INTO account_logins (id, accountId, loginDate) VALUES ($1, $2, $3) ON CONFLICT (accountId, loginDate) DO NOTHING',
        [gid(), acc.id, today],
      ).catch((error) => console.error('Fehler beim Login Tracking:', error));
      touchPresence(acc.id);

      const token = jwt.sign({ accountId: acc.id }, jwtSecret, { expiresIn: '7d' });
      const cookieOpts = rememberMe ? { ...SESSION_COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 } : { ...SESSION_COOKIE_OPTS };
      res.cookie(SESSION_COOKIE, token, cookieOpts);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('login error:', error.message);
      res.status(500).json({ error: 'Interner Fehler' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTS);
    res.json({ ok: 1 });
  });
}

module.exports = { registerAuthRoutes };
