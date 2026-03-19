function createAuthLimiter(rateLimit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' },
  });
}

function applyAuthRateLimiters(app, authLimiter) {
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/resend-verification', authLimiter);
}

module.exports = {
  applyAuthRateLimiters,
  createAuthLimiter,
};
