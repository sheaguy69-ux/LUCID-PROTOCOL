'use strict';

// Per-key rate limits (sliding window)
const RATE_LIMITS = {
  free: { maxRequests: 10, windowMs: 60_000 },   // 10 req/min
  paid: { maxRequests: 60, windowMs: 60_000 },    // 60 req/min
};

// In-memory sliding-window tracker: keyId → [timestamp, ...]
const keyWindows = new Map();

/**
 * Checks whether an API key has exceeded its per-minute rate limit.
 * Returns a violation array (empty = allowed, non-empty = blocked).
 */
function reviewRateLimit(keyData) {
  const tier = keyData.is_test ? 'free' : 'free'; // both use free limits for now
  const limit = RATE_LIMITS[tier];
  const now = Date.now();

  if (!keyWindows.has(keyData.id)) {
    keyWindows.set(keyData.id, []);
  }

  const timestamps = keyWindows.get(keyData.id);

  // Evict expired timestamps
  while (timestamps.length > 0 && timestamps[0] < now - limit.windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= limit.maxRequests) {
    return [
      {
        rule: 'RATE_LIMIT_EXCEEDED',
        severity: 'critical',
        message: `Rate limit exceeded: ${limit.maxRequests} requests per minute. Try again shortly.`,
      },
    ];
  }

  // Record this request
  timestamps.push(now);
  return [];
}

/**
 * Detect rapid-fire abuse patterns: many requests in a very short window.
 * Called alongside reviewRateLimit for extra protection.
 */
function reviewAbusePattern(keyData) {
  const violations = [];
  const timestamps = keyWindows.get(keyData.id) || [];

  if (timestamps.length < 5) return violations;

  // Check if 5+ requests came within 3 seconds (bot-like behavior)
  const last5 = timestamps.slice(-5);
  const span = last5[last5.length - 1] - last5[0];

  if (span < 3000) {
    violations.push({
      rule: 'ABUSE_RAPID_FIRE',
      severity: 'warning',
      message: 'Unusually rapid request pattern detected. Throttling may apply.',
    });
  }

  return violations;
}

/**
 * Periodically clean up stale entries from the rate-limit cache.
 * Call this on an interval (e.g., every 5 minutes) to prevent memory leaks.
 */
function cleanupCache() {
  const now = Date.now();
  for (const [keyId, timestamps] of keyWindows) {
    // Remove entries where all timestamps are older than 2 minutes
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < now - 120_000) {
      keyWindows.delete(keyId);
    }
  }
}

module.exports = { reviewRateLimit, reviewAbusePattern, cleanupCache };
