// intelClient.js — Fire-and-forget producer for shared threat-intel DB.
// WS2 per plan: /Users/anthonyguy/.claude/plans/the-core-strategy-streamed-crown.md
//
// Reads envs:
//   THREAT_INTEL_URL            (required)
//   THREAT_INTEL_SERVICE_KEY    (required — service role, bypasses RLS)
//
// Public API:
//   fireIntercept({ rawText, urls, contracts, risk, sourceProduct, userId, mediaType })
//     -> Promise<{ ok: boolean, id?: string, reason?: string }>
//
// Never throws. Callers pattern: `intelClient.fireIntercept(...).catch(() => {})`.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// --- Config -----------------------------------------------------------

// Fire on risk >= this (scale is 1-10, matches scamDetector output).
const RISK_THRESHOLD = parseInt(process.env.THREAT_INTEL_RISK_THRESHOLD || '7', 10);

const ALLOWED_SOURCES = new Set([
  'scamshield_tg',
  'scamshield_discord',
  'scamshield_web',
  'scamshield_mobile',
  'shroud',
]);

const ALLOWED_MEDIA = new Set(['text', 'image', 'audio', 'doc', 'contract', 'url']);

// --- Lazy singleton ---------------------------------------------------

let client = null;
let disabled = false;

function getClient() {
  if (disabled) return null;
  if (client) return client;

  const url = process.env.THREAT_INTEL_URL;
  const key = process.env.THREAT_INTEL_SERVICE_KEY;

  if (!url || !key) {
    console.warn('[intelClient] THREAT_INTEL_URL or THREAT_INTEL_SERVICE_KEY missing — intercepts disabled');
    disabled = true;
    return null;
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'scamshield-bot-producer' } },
  });
  return client;
}

// --- Helpers ----------------------------------------------------------

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function hashUserId(userId) {
  if (userId === null || userId === undefined) return null;
  // Salt with a stable deployment secret if provided, else raw hash.
  // Keeps DB free of raw telegram/discord IDs.
  const salt = process.env.INTERCEPT_USER_HASH_SALT || '';
  return sha256(`${salt}:${String(userId)}`);
}

function clampRisk(r) {
  if (r === null || r === undefined || Number.isNaN(Number(r))) return 0;
  return Math.max(0, Math.min(10, Math.round(Number(r))));
}

function sanitizeArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v) => typeof v === 'string' && v.length > 0)
    .slice(0, 50) // cap array size
    .map((v) => v.slice(0, 1000));
}

// --- Public API -------------------------------------------------------

/**
 * Fire an intercept at the shared threat-intel DB.
 * Never throws. Swallows all errors into { ok: false, reason }.
 *
 * @param {Object} opts
 * @param {string} opts.rawText           — raw scam content (required)
 * @param {string[]} [opts.urls]          — extracted URLs
 * @param {string[]} [opts.contracts]     — extracted contract addresses
 * @param {number} opts.risk              — risk score 1-10
 * @param {string} opts.sourceProduct     — one of ALLOWED_SOURCES
 * @param {string|number} [opts.userId]   — raw user id (will be hashed)
 * @param {string} [opts.mediaType]       — one of ALLOWED_MEDIA
 * @returns {Promise<{ok: boolean, id?: string, reason?: string}>}
 */
async function fireIntercept({
  rawText,
  urls = [],
  contracts = [],
  risk = 0,
  sourceProduct,
  userId = null,
  mediaType = 'text',
}) {
  try {
    // Guard: threshold check
    const clampedRisk = clampRisk(risk);
    if (clampedRisk < RISK_THRESHOLD) {
      return { ok: false, reason: 'below_threshold' };
    }

    // Guard: required fields
    if (!rawText || typeof rawText !== 'string') {
      return { ok: false, reason: 'missing_raw_text' };
    }
    if (!ALLOWED_SOURCES.has(sourceProduct)) {
      return { ok: false, reason: 'invalid_source_product' };
    }

    const normMedia = ALLOWED_MEDIA.has(mediaType) ? mediaType : 'text';

    const c = getClient();
    if (!c) return { ok: false, reason: 'client_disabled' };

    // Truncate very long raw text (scam payloads rarely huge; cap at 16KB)
    const trimmed = rawText.slice(0, 16_000);
    const hash = sha256(trimmed);

    const { data, error } = await c
      .from('raw_intercepts')
      .insert({
        raw_text: trimmed,
        raw_text_hash: hash,
        urls: sanitizeArray(urls),
        contract_addresses: sanitizeArray(contracts),
        source_product: sourceProduct,
        source_user_hash: hashUserId(userId),
        detected_risk: clampedRisk,
        media_type: normMedia,
      })
      .select('id')
      .single();

    if (error) {
      // Unique-index violation on (raw_text_hash, created_day) = same scam same day.
      // That's expected behavior, not a real error.
      if (error.code === '23505') {
        return { ok: false, reason: 'duplicate' };
      }
      console.error('[intelClient] insert failed:', error.message);
      return { ok: false, reason: 'db_error' };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[intelClient] unexpected error:', err.message);
    return { ok: false, reason: 'exception' };
  }
}

module.exports = {
  fireIntercept,
  RISK_THRESHOLD,
  // exposed for tests
  _sha256: sha256,
  _hashUserId: hashUserId,
};
