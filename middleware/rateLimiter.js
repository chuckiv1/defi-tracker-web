function createAuthLimiter(rateLimit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' },
  });
}

function createExternalApiLimiter(rateLimit) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.account?.id || rateLimit.ipKeyGenerator(req.ip),
    handler: (req, res) => {
      res.status(429).json({ error: 'Zu viele Anfragen an externe APIs. Bitte warte eine Minute.' });
    }
  });
}

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function checkAndReportLoginAttempt(accountId, ip) {
  if (!accountId) return { allowed: true };
  
  const now = Date.now();
  const key = accountId;
  const attempts = loginAttempts.get(key) || [];
  const recentAttempts = attempts.filter(a => now - a.timestamp < LOGIN_LOCK_DURATION_MS);
  
  if (recentAttempts.length >= LOGIN_ATTEMPT_LIMIT) {
    const oldestAttempt = recentAttempts[0];
    const retryAfterMs = LOGIN_LOCK_DURATION_MS - (now - oldestAttempt.timestamp);
    return { allowed: false, retryAfterMs };
  }
  
  loginAttempts.set(key, [...recentAttempts, { ip, timestamp: now }]);
  return { allowed: true };
}

function resetLoginAttempt(accountId) {
  if (accountId) {
    loginAttempts.delete(accountId);
  }
}

function onFailedLogin(accountId, ip) {
  if (accountId) {
    checkAndReportLoginAttempt(accountId, ip);
  }
}

function applyAuthRateLimiters(app, authLimiter) {
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/resend-verification', authLimiter);
}

// Cleanup login attempts every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, attempts] of loginAttempts.entries()) {
    const recent = attempts.filter(a => now - a.timestamp < LOGIN_LOCK_DURATION_MS);
    if (recent.length === 0) {
      loginAttempts.delete(key);
    } else {
      loginAttempts.set(key, recent);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  applyAuthRateLimiters,
  checkAndReportLoginAttempt,
  createAuthLimiter,
  createExternalApiLimiter,
  onFailedLogin,
  resetLoginAttempt,
};
