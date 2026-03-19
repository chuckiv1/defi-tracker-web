function registerMessageRoutes(app, deps) {
  const {
    MESSAGE_SEGMENTS,
    db,
    flushScheduledMessages,
    getEditableMessageForSender,
    getMessageRecipients,
    getMessageStats,
    gid,
    hasRole,
    isPrivilegedRecipient,
    mapMessageRow,
    mirrorMessageToRecipients,
    normalizeMessagePayload,
    requireAuth,
    requireSupport,
  } = deps;

  app.get('/api/messages/summary', requireAuth, async (req, res) => {
    try {
      await flushScheduledMessages();
      const { rows } = await db.query(`
        SELECT COUNT(*) FILTER (WHERE mr.readAt IS NULL)::int AS "unreadCount",
               COUNT(*) FILTER (WHERE mr.readAt IS NULL AND (m.priority = 'urgent' OR m.isPinned = true))::int AS "importantUnreadCount",
               COUNT(*) FILTER (WHERE mr.readAt IS NULL AND m.category = 'support')::int AS "supportUnreadCount"
        FROM message_recipients mr
        JOIN messages m ON m.id = mr.messageId
        WHERE mr.accountId = $1
          AND mr.archived = false
          AND m.status = 'sent'
          AND m.withdrawnAt IS NULL
          AND (m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP)
      `, [req.account.id]);
      res.json(rows[0] || { unreadCount: 0, importantUnreadCount: 0, supportUnreadCount: 0 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
    }
  });

  app.get('/api/messages/inbox', requireAuth, async (req, res) => {
    try {
      await flushScheduledMessages();
      const { rows } = await db.query(`
        SELECT m.*, sender.email AS senderEmail, target.email AS targetEmail,
               self.readAt AS selfReadAt,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount,
               (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount
        FROM messages m
        JOIN accounts sender ON sender.id = m.senderAccountId
        LEFT JOIN accounts target ON target.id = m.targetAccountId
        LEFT JOIN message_recipients self ON self.messageId = m.id AND self.accountId = $1
        WHERE m.status = 'sent'
          AND m.withdrawnAt IS NULL
          AND (m.senderAccountId = $1 OR self.accountId = $1)
          AND ((m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP) OR m.senderAccountId = $1)
        ORDER BY COALESCE(m.sentAt, m.createdAt) DESC, m.createdAt DESC
        LIMIT 250
      `, [req.account.id]);
      res.json(rows.map((row) => mapMessageRow(row, req.account.id)));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Inbox konnte nicht geladen werden' });
    }
  });

  app.post('/api/messages/read-all', requireAuth, async (req, res) => {
    try {
      await flushScheduledMessages();
      await db.query(`
        UPDATE message_recipients mr
        SET readAt = CURRENT_TIMESTAMP
        FROM messages m
        WHERE mr.messageId = m.id
          AND mr.accountId = $1
          AND mr.readAt IS NULL
          AND m.status = 'sent'
          AND m.withdrawnAt IS NULL
          AND (m.expiresAt IS NULL OR m.expiresAt > CURRENT_TIMESTAMP)
      `, [req.account.id]);
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachrichten konnten nicht aktualisiert werden' });
    }
  });

  app.put('/api/messages/:id/read', requireAuth, async (req, res) => {
    try {
      const { rowCount } = await db.query('UPDATE message_recipients SET readAt = COALESCE(readAt, CURRENT_TIMESTAMP) WHERE messageId = $1 AND accountId = $2', [req.params.id, req.account.id]);
      if (!rowCount) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachricht konnte nicht als gelesen markiert werden' });
    }
  });

  app.post('/api/messages', requireAuth, async (req, res) => {
    try {
      const payload = normalizeMessagePayload(req.body || {});
      if (!payload.title || !payload.body) return res.status(400).json({ error: 'Betreff und Nachricht sind erforderlich' });
      if (payload.invalidLinkUrl) return res.status(400).json({ error: 'Ungültiger Link' });

      if (!hasRole(req.account, 'support')) {
        payload.targetType = 'direct';
        payload.status = 'sent';
        payload.category = 'support';
        payload.isPinned = false;
        payload.emailMirror = false;
        if (!(await isPrivilegedRecipient(payload.targetAccountId))) return res.status(403).json({ error: 'Antworten sind nur an Support/Admin erlaubt' });
      }

      if (hasRole(req.account, 'support')) {
        if (payload.targetType === 'direct' && !payload.targetAccountId) return res.status(400).json({ error: 'Empfänger fehlt' });
        if (payload.targetType === 'segment' && !MESSAGE_SEGMENTS.has(payload.audiencePreset)) return res.status(400).json({ error: 'Ungültiges Segment' });
        if (payload.status === 'scheduled' && !payload.scheduledAt) return res.status(400).json({ error: 'Zeitpunkt für geplante Nachricht fehlt' });
      }

      const previewRecipients = await getMessageRecipients(req.account.id, payload.targetType, payload.targetAccountId, payload.audiencePreset);
      if (!previewRecipients.length) return res.status(400).json({ error: 'Keine gültigen Empfänger gefunden' });

      const id = gid();
      const initialConversationId = payload.conversationId || id;
      const initialStatus = hasRole(req.account, 'support') ? payload.status : 'sent';
      const sentAt = initialStatus === 'sent' ? new Date().toISOString() : null;
      await db.query(
        `INSERT INTO messages (id, senderAccountId, conversationId, parentMessageId, targetType, targetAccountId, audiencePreset, title, body, priority, category, linkUrl, isPinned, expiresAt, status, scheduledAt, sentAt, readTracking, emailMirror)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [id, req.account.id, initialConversationId, payload.parentMessageId, payload.targetType, payload.targetAccountId, payload.audiencePreset, payload.title, payload.body, payload.priority, payload.category, payload.linkUrl, payload.isPinned, payload.expiresAt, initialStatus, payload.scheduledAt, sentAt, payload.readTracking, payload.emailMirror],
      );

      if (initialStatus === 'sent') {
        const messageRow = { id, senderaccountid: req.account.id, targettype: payload.targetType, targetaccountid: payload.targetAccountId, audiencepreset: payload.audiencePreset, emailmirror: payload.emailMirror, title: payload.title, body: payload.body, linkurl: payload.linkUrl };
        await Promise.all(previewRecipients.map((recipient) => db.query('INSERT INTO message_recipients (messageId, accountId) VALUES ($1, $2) ON CONFLICT (messageId, accountId) DO NOTHING', [id, recipient.id])));
        await mirrorMessageToRecipients(messageRow, previewRecipients);
      }

      res.json({ ok: 1, id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachricht konnte nicht erstellt werden' });
    }
  });

  app.put('/api/messages/:id', requireAuth, async (req, res) => {
    try {
      const message = await getEditableMessageForSender(req.params.id, req.account.id);
      if (!message) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      const stats = await getMessageStats(message.id);
      if (message.status === 'sent' && stats.read > 0) return res.status(409).json({ error: 'Bereits gelesene Nachrichten können nicht mehr bearbeitet werden' });

      const payload = normalizeMessagePayload(req.body || {});
      if (!payload.title || !payload.body) return res.status(400).json({ error: 'Betreff und Nachricht sind erforderlich' });
      if (payload.invalidLinkUrl) return res.status(400).json({ error: 'Ungültiger Link' });

      if (!hasRole(req.account, 'support')) {
        payload.targetType = 'direct';
        payload.status = 'sent';
        payload.category = 'support';
        payload.isPinned = false;
        payload.emailMirror = false;
        if (!(await isPrivilegedRecipient(payload.targetAccountId))) return res.status(403).json({ error: 'Antworten sind nur an Support/Admin erlaubt' });
      }

      if (payload.targetType === 'direct' && !payload.targetAccountId) return res.status(400).json({ error: 'Empfänger fehlt' });
      if (payload.targetType === 'segment' && !MESSAGE_SEGMENTS.has(payload.audiencePreset)) return res.status(400).json({ error: 'Ungültiges Segment' });
      if (payload.status === 'scheduled' && !payload.scheduledAt) return res.status(400).json({ error: 'Zeitpunkt für geplante Nachricht fehlt' });

      const previewRecipients = await getMessageRecipients(req.account.id, payload.targetType, payload.targetAccountId, payload.audiencePreset);
      if (!previewRecipients.length) return res.status(400).json({ error: 'Keine gültigen Empfänger gefunden' });

      const nextStatus = payload.status;
      const shouldSendNow = nextStatus === 'sent' && message.status !== 'sent';
      await db.query(
        `UPDATE messages SET targetType = $1, targetAccountId = $2, audiencePreset = $3, title = $4, body = $5, priority = $6, category = $7, linkUrl = $8,
         isPinned = $9, expiresAt = $10, status = $11, scheduledAt = $12, readTracking = $13, emailMirror = $14,
         conversationId = COALESCE($15, conversationId), parentMessageId = $16, sentAt = CASE WHEN $17 THEN CURRENT_TIMESTAMP ELSE sentAt END,
         updatedAt = CURRENT_TIMESTAMP WHERE id = $18 AND senderAccountId = $19`,
        [payload.targetType, payload.targetAccountId, payload.audiencePreset, payload.title, payload.body, payload.priority, payload.category, payload.linkUrl, payload.isPinned, payload.expiresAt, nextStatus, payload.scheduledAt, payload.readTracking, payload.emailMirror, payload.conversationId || message.conversationid || message.id, payload.parentMessageId || null, shouldSendNow, message.id, req.account.id],
      );

      await db.query('DELETE FROM message_recipients WHERE messageId = $1', [message.id]);
      if (nextStatus === 'sent') {
        await Promise.all(previewRecipients.map((recipient) => db.query('INSERT INTO message_recipients (messageId, accountId) VALUES ($1, $2) ON CONFLICT (messageId, accountId) DO NOTHING', [message.id, recipient.id])));
        const messageRow = { id: message.id, senderaccountid: req.account.id, targettype: payload.targetType, targetaccountid: payload.targetAccountId, audiencepreset: payload.audiencePreset, emailmirror: payload.emailMirror, title: payload.title, body: payload.body, linkurl: payload.linkUrl };
        if (shouldSendNow) await mirrorMessageToRecipients(messageRow, previewRecipients);
      }
      res.json({ ok: 1 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachricht konnte nicht gespeichert werden' });
    }
  });

  app.delete('/api/messages/:id', requireAuth, async (req, res) => {
    try {
      const message = await getEditableMessageForSender(req.params.id, req.account.id);
      if (!message) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      if (message.status === 'draft' || message.status === 'scheduled') {
        await db.query('DELETE FROM messages WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
        return res.json({ ok: 1, deleted: true });
      }
      const stats = await getMessageStats(message.id);
      if (stats.total > 0 && stats.unread === 0) return res.status(409).json({ error: 'Nachricht wurde bereits von allen Empfängern gelesen' });
      await db.query('UPDATE messages SET withdrawnAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
      res.json({ ok: 1, withdrawn: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Nachricht konnte nicht entfernt werden' });
    }
  });

  app.get('/api/admin/messages/overview', requireSupport, async (req, res) => {
    try {
      await flushScheduledMessages();
      const [draftRes, historyRes, userRes, statRes] = await Promise.all([
        db.query(`SELECT m.*, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount FROM messages m WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL AND m.status IN ('draft', 'scheduled') ORDER BY m.updatedAt DESC`, [req.account.id]),
        db.query(`SELECT m.*, target.email AS targetEmail, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id)::int AS recipientCount, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NOT NULL)::int AS readCount, (SELECT COUNT(*) FROM message_recipients r WHERE r.messageId = m.id AND r.readAt IS NULL)::int AS unreadCount FROM messages m LEFT JOIN accounts target ON target.id = m.targetAccountId WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL AND m.status = 'sent' ORDER BY COALESCE(m.sentAt, m.createdAt) DESC LIMIT 100`, [req.account.id]),
        db.query(`SELECT a.id, a.email, a.role, a.isverified, a.isblocked, a.createdat, COUNT(DISTINCT p.id)::int as "profileCount", COUNT(DISTINCT l.id)::int as "loginCount30d", MAX(ap.lastseen) as "lastSeenAt", COUNT(DISTINCT mr.messageId) FILTER (WHERE mr.readAt IS NULL AND m.senderAccountId = $1 AND m.targetType = 'direct' AND m.withdrawnAt IS NULL)::int as "directUnreadCount" FROM accounts a LEFT JOIN profiles p ON a.id = p.accountid LEFT JOIN account_logins l ON a.id = l.accountid AND l.logindate >= CURRENT_DATE - INTERVAL '30 days' LEFT JOIN account_presence ap ON a.id = ap.accountid LEFT JOIN message_recipients mr ON mr.accountId = a.id LEFT JOIN messages m ON m.id = mr.messageId GROUP BY a.id ORDER BY a.createdat DESC`, [req.account.id]),
        db.query(`SELECT COUNT(*) FILTER (WHERE status = 'sent' AND sentAt >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS "sent30d", COUNT(*) FILTER (WHERE status = 'sent' AND targetType = 'direct' AND sentAt >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS "direct30d", COUNT(*) FILTER (WHERE status IN ('draft', 'scheduled') AND withdrawnAt IS NULL)::int AS drafts, COALESCE(ROUND(AVG(CASE WHEN recipientStats.total > 0 THEN (recipientStats.read::numeric / recipientStats.total::numeric) * 100 ELSE NULL END)), 0)::int AS "avgReadRate" FROM messages m LEFT JOIN LATERAL (SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE readAt IS NOT NULL)::int AS read FROM message_recipients mr WHERE mr.messageId = m.id) recipientStats ON true WHERE m.senderAccountId = $1 AND m.withdrawnAt IS NULL`, [req.account.id]),
      ]);

      res.json({
        drafts: draftRes.rows.map((row) => mapMessageRow(row, req.account.id)),
        history: historyRes.rows.map((row) => mapMessageRow(row, req.account.id)),
        users: userRes.rows,
        stats: statRes.rows[0] || { sent30d: 0, direct30d: 0, drafts: 0, avgReadRate: 0 },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Admin-Nachrichten konnten nicht geladen werden' });
    }
  });

  app.get('/api/admin/messages/:id/recipients', requireSupport, async (req, res) => {
    try {
      const { rows: own } = await db.query('SELECT id FROM messages WHERE id = $1 AND senderAccountId = $2', [req.params.id, req.account.id]);
      if (!own.length) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      const { rows } = await db.query(`
        SELECT a.id, a.email, mr.readAt, ap.lastSeen as "lastSeenAt"
        FROM message_recipients mr
        JOIN accounts a ON a.id = mr.accountId
        LEFT JOIN account_presence ap ON ap.accountId = a.id
        WHERE mr.messageId = $1
        ORDER BY mr.readAt NULLS FIRST, a.email ASC
      `, [req.params.id]);
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Empfänger konnten nicht geladen werden' });
    }
  });
}

module.exports = { registerMessageRoutes };
