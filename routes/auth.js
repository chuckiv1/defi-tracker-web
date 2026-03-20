function registerAuthRoutes(app, deps) {
  const {
    APP_URL,
    SESSION_COOKIE,
    SESSION_COOKIE_OPTS,
    VERIFY_RESEND_LIMIT_MS,
    checkAndReportLoginAttempt,
    crypto,
    db,
    gid,
    hashPassAsync,
    jwt,
    jwtSecret,
    normalizeRole,
    onFailedLogin,
    resetLoginAttempt,
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
      if (existing.length > 0) return res.status(400).json({ error: 'Ungültige Anmeldedaten' });

      const salt = crypto.randomBytes(16).toString('hex');
      const verifyToken = gid();
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      const accId = gid();
      const passHash = await hashPassAsync(password, salt);

      await db.query(
        'INSERT INTO accounts (id, email, salt, passHash, role, isVerified, isBlocked) VALUES ($1, $2, $3, $4, $5, false, false)',
        [accId, email, salt, passHash, 'user'],
      );

      await db.query(
        'INSERT INTO email_verification_logs (id, accountId, tokenHash, expiresAt) VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL \'1 day\')',
        [gid(), accId, tokenHash],
      );

      const link = `${APP_URL}/verify.html?token=${verifyToken}`;
      await sendMail(email, 'DeFi Vault - Bitte verifiziere deine E-Mail', `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
      res.json({ ok: 1 });
    } catch (error) {
      console.error('register error:', error.message);
      if (error.code === '23505') return res.status(400).json({ error: 'Ungültige Anmeldedaten' });
      res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  });

  app.post('/api/auth/verify', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token fehlt' });

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const { rows } = await db.query(
        'SELECT vl.*, a.id as accId FROM email_verification_logs vl JOIN accounts a ON a.id = vl.accountId WHERE vl.tokenHash = $1 AND vl.expiresAt > CURRENT_TIMESTAMP AND vl.usedAt IS NULL',
        [tokenHash]
      );
      if (rows.length === 0) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link' });

      const logEntry = rows[0];
      await db.query('UPDATE email_verification_logs SET usedAt = CURRENT_TIMESTAMP WHERE id = $1', [logEntry.id]);
      await db.query('UPDATE accounts SET isVerified = true WHERE id = $1', [logEntry.accId]);
      await db.query('DELETE FROM email_verification_logs WHERE accountId = $1 AND usedAt IS NULL AND id <> $2', [logEntry.accId, logEntry.id]);
      await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [gid(), logEntry.accId, 'Main Wallet']);
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
      if (acc.isverified) {
        // Silently return success to prevent email enumeration
        verifyResendCooldowns.set(email, now);
        return res.json({ ok: 1, retryAfterMs: VERIFY_RESEND_LIMIT_MS });
      }

      // Invalidate all existing unused tokens for this account
      await db.query('UPDATE email_verification_logs SET usedAt = CURRENT_TIMESTAMP WHERE accountId = $1 AND usedAt IS NULL', [acc.id]);

      // Create new verification token
      const verifyToken = gid();
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await db.query(
        'INSERT INTO email_verification_logs (id, accountId, tokenHash, expiresAt) VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL \'1 day\')',
        [gid(), acc.id, tokenHash]
      );

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
      
      // Account-based rate limiting
      const rateCheck = checkAndReportLoginAttempt(acc.id, req.ip);
      if (!rateCheck.allowed) {
        return res.status(429).json({ error: 'Zu viele Login-Versuche. Bitte warte kurz.', retryAfterMs: rateCheck.retryAfterMs });
      }
      
      const computedHash = await hashPassAsync(password, acc.salt);
      if (!timingSafeCompare(acc.passhash, computedHash)) {
        onFailedLogin(acc.id, req.ip);
        return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
      }
      if (acc.isblocked) return res.status(403).json({ error: 'Account ist blockiert' });
      if (!acc.isverified) return res.status(403).json({ error: 'E-Mail noch nicht verifiziert' });

      // Reset login attempts on successful login
      resetLoginAttempt(acc.id);

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
