'use strict';

const { reviewCryptoThreats } = require('./policies/cryptoPolicy');
const { reviewDetectionQuality } = require('./policies/scamDetectionPolicy');
const { reviewPatternSubmission } = require('./policies/dataPolicy');
const { reviewRateLimit, reviewAbusePattern, cleanupCache } = require('./policies/apiPolicy');

// --- Status Constants ---

const AEGIS_STATUS = {
  APPROVED: 'APPROVED',
  FLAGGED: 'FLAGGED',
  BLOCKED: 'BLOCKED',
};

// --- Zero-Width Character Sanitization ---

// Invisible Unicode characters used in ASCII smuggling / prompt injection
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2028-\u202F\u2060-\u2064\u00AD\uFEFF\uDB40-\uDBFF]/g;

/**
 * Strips zero-width and invisible Unicode characters from input text.
 * Prevents ASCII smuggling attacks where hidden instructions are embedded
 * in Telegram messages before they reach the AI pipeline.
 */
function sanitizeInput(text) {
  if (!text) return text;
  return text.replace(ZERO_WIDTH_RE, '');
}

// --- Decision Resolution ---

function resolveStatus(violations) {
  if (violations.some((v) => v.severity === 'critical')) return AEGIS_STATUS.BLOCKED;
  if (violations.length > 0) return AEGIS_STATUS.FLAGGED;
  return AEGIS_STATUS.APPROVED;
}

// --- Audit Logging ---

function buildAuditEntry(action, status, violations, meta = {}) {
  return {
    timestamp: new Date().toISOString(),
    action,
    status,
    violations: violations.map((v) => ({
      rule: v.rule,
      severity: v.severity,
      message: v.message,
    })),
    meta,
  };
}

function logAegisDecision(audit) {
  if (audit.status === AEGIS_STATUS.APPROVED) return;
  const tag = audit.status === AEGIS_STATUS.BLOCKED ? 'BLOCK' : 'FLAG';
  const rules = audit.violations.map((v) => v.rule).join(', ');
  console.warn(`[Aegis:${tag}] ${audit.action} — ${rules}`);
}

// --- Review Functions ---

/**
 * Reviews a completed scan result before it is returned to the user.
 * Runs crypto-specific and detection-quality policies.
 */
async function reviewScanResult(result, context = {}) {
  const violations = [
    ...reviewCryptoThreats(result, context),
    ...reviewDetectionQuality(result, context),
  ];

  const status = resolveStatus(violations);
  const audit = buildAuditEntry('scan_result', status, violations, {
    userId: context.userId,
    riskScore: result.riskScore,
    confidence: result.confidence,
    source: result.source,
  });

  logAegisDecision(audit);
  return { status, violations, audit };
}

/**
 * Reviews a user-submitted pattern before it is stored in the knowledge base.
 * Prevents database poisoning, false-positive flooding, and prompt injection.
 */
async function reviewPattern(pattern, severity, context = {}) {
  const violations = reviewPatternSubmission(pattern, severity, context);
  const status = resolveStatus(violations);
  const audit = buildAuditEntry('pattern_submit', status, violations, {
    userId: context.userId,
    severity,
    patternLength: pattern.length,
  });

  logAegisDecision(audit);
  return { status, violations, audit };
}

/**
 * Reviews an API request for rate-limit and abuse-pattern violations.
 * Should be called before processing the scan in the REST API route.
 */
function checkRateLimit(keyData) {
  const violations = [
    ...reviewRateLimit(keyData),
    ...reviewAbusePattern(keyData),
  ];

  const status = resolveStatus(violations);

  if (status !== AEGIS_STATUS.APPROVED) {
    const rules = violations.map((v) => v.rule).join(', ');
    console.warn(`[Aegis:${status}] api_request — ${rules} (key: ${keyData.key_prefix || 'unknown'})`);
  }

  return { status, violations };
}

// --- Lifecycle ---

let cacheCleanupInterval = null;

/**
 * Starts Aegis background processes (cache cleanup).
 * Call once at bot startup.
 */
function init() {
  console.log('[Aegis] Multi-agent oversight system initialized');
  console.log('[Aegis] Policies loaded: cryptoPolicy, scamDetectionPolicy, dataPolicy, apiPolicy');

  // Clean up rate-limit cache every 5 minutes
  cacheCleanupInterval = setInterval(cleanupCache, 5 * 60 * 1000);
  // Allow process to exit even if interval is running
  if (cacheCleanupInterval.unref) cacheCleanupInterval.unref();
}

/**
 * Shuts down Aegis background processes.
 */
function shutdown() {
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
    cacheCleanupInterval = null;
  }
  console.log('[Aegis] Shutdown complete');
}

module.exports = {
  AEGIS_STATUS,
  sanitizeInput,
  reviewScanResult,
  reviewPattern,
  checkRateLimit,
  init,
  shutdown,
};
