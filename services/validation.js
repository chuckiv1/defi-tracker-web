const MESSAGE_SEGMENTS = new Set(['all_users', 'active_7d', 'active_30d', 'new_14d', 'verified_users', 'admins']);
const ROLE_ORDER = ['user', 'support', 'admin', 'owner'];
const VALID_ROLES = ['user', 'support', 'admin', 'owner'];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidEntryArray(list, requiredFields) {
  if (!Array.isArray(list)) return false;
  return list.every((entry) => isPlainObject(entry) && requiredFields.every((field) => Object.prototype.hasOwnProperty.call(entry, field)));
}

function isValidStrategy(strategy) {
  return isPlainObject(strategy)
    && typeof strategy.id === 'string'
    && typeof strategy.name === 'string'
    && typeof strategy.startDate === 'string'
    && isPlainObject(strategy.token)
    && typeof strategy.token.name === 'string'
    && Number.isFinite(parseFloat(strategy.token.amount))
    && Number.isFinite(parseFloat(strategy.token.entryPrice))
    && isValidEntryArray(strategy.investmentHistory || [], ['id', 'amount', 'date'])
    && isValidEntryArray(strategy.rewards || [], ['id', 'amount', 'date'])
    && isValidEntryArray(strategy.pnl || [], ['id', 'amount', 'date']);
}

function isValidFrfPayload(frf) {
  if (!isPlainObject(frf) || !Array.isArray(frf.exchanges) || !Array.isArray(frf.positions)) return false;

  const exchangesValid = frf.exchanges.every((exchange) => isPlainObject(exchange)
    && typeof exchange.id === 'string'
    && typeof exchange.name === 'string'
    && isValidEntryArray(exchange.marginHistory || [], ['id', 'amount', 'date']));

  const positionsValid = frf.positions.every((position) => isPlainObject(position)
    && typeof position.id === 'string'
    && typeof position.type === 'string'
    && typeof position.token === 'string'
    && Number.isFinite(parseFloat(position.tokenAmount))
    && isValidEntryArray(position.fundingShort || [], ['id', 'amount', 'date'])
    && isValidEntryArray(position.fundingLong || [], ['id', 'amount', 'date']));

  return exchangesValid && positionsValid;
}

function sanitizeMessageLinkUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { value: null, invalid: false };
  if (value.startsWith('/') && !value.startsWith('//')) return { value, invalid: false };

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { value: parsed.toString(), invalid: false };
    }
  } catch (error) {
    return { value: null, invalid: true };
  }

  return { value: null, invalid: true };
}

function normalizeLoopTokenInput(value) {
  return String(value || '').trim().toUpperCase().slice(0, 50);
}

function normalizeRole(role) {
  return ROLE_ORDER.includes(role) ? role : 'user';
}

function validateRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return VALID_ROLES.includes(normalized) ? normalized : null;
}

function hasRole(account, minRole) {
  if (!account) return false;
  return ROLE_ORDER.indexOf(normalizeRole(account.role)) >= ROLE_ORDER.indexOf(minRole);
}

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeMessagePayload(body) {
  const targetType = ['all', 'direct', 'segment'].includes(body.targetType) ? body.targetType : 'direct';
  const audiencePreset = MESSAGE_SEGMENTS.has(body.audiencePreset) ? body.audiencePreset : 'all_users';
  const priority = ['info', 'important', 'urgent'].includes(body.priority) ? body.priority : 'info';
  const category = ['system', 'update', 'maintenance', 'security', 'support'].includes(body.category) ? body.category : 'system';
  const status = ['draft', 'scheduled', 'sent'].includes(body.status) ? body.status : 'draft';
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const linkData = sanitizeMessageLinkUrl(body.linkUrl);
  const targetAccountId = body.targetAccountId ? String(body.targetAccountId) : null;
  const conversationId = body.conversationId ? String(body.conversationId) : null;
  const parentMessageId = body.parentMessageId ? String(body.parentMessageId) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

  return {
    targetType,
    targetAccountId,
    audiencePreset,
    title,
    body: text,
    priority,
    category,
    linkUrl: linkData.value,
    invalidLinkUrl: linkData.invalid,
    isPinned: !!body.isPinned,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
    status,
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null,
    readTracking: body.readTracking !== false,
    emailMirror: !!body.emailMirror,
    conversationId,
    parentMessageId,
  };
}

module.exports = {
  MESSAGE_SEGMENTS,
  ROLE_ORDER,
  VALID_ROLES,
  escHtml,
  hasRole,
  isPlainObject,
  isValidEntryArray,
  isValidFrfPayload,
  isValidStrategy,
  normalizeLoopTokenInput,
  normalizeMessagePayload,
  normalizeRole,
  sanitizeMessageLinkUrl,
  validateRole,
};
