const express = require('express');
const { validateApiKey } = require('../apiKeySystem');
const { analyzeContent } = require('../scamDetector');
const { logScan } = require('../usageTracking');
const { incrementUsage, getUsageSummary, checkScanAllowance, TIER_LIMITS } = require('../metering');
const { checkRateLimit, reviewScanResult, AEGIS_STATUS } = require('../aegisAgent');
const { getReportStats } = require('../database');

const router = express.Router();

router.use(express.json());

// --- API Key Authentication Middleware ---

async function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  let rawKey = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7);
  } else if (apiKey) {
    rawKey = apiKey;
  }

  if (!rawKey) {
    return res.status(401).json({
      error: 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.',
    });
  }

  const keyData = await validateApiKey(rawKey);
  if (!keyData) {
    return res.status(401).json({ error: 'Invalid or revoked API key.' });
  }

  req.apiKey = keyData;
  next();
}

// --- POST /api/scan ---

router.post('/scan', authenticateApiKey, async (req, res) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing required field: content (string)' });
  }

  if (content.length > 4000) {
    return res.status(400).json({ error: 'Content exceeds 4000 character limit.' });
  }

  const startTime = Date.now();

  // Aegis: per-key rate limiting
  const rateCheck = checkRateLimit(req.apiKey);
  if (rateCheck.status === AEGIS_STATUS.BLOCKED) {
    return res.status(429).json({
      error: rateCheck.violations[0]?.message || 'Rate limit exceeded.',
      aegis: { status: rateCheck.status, rule: rateCheck.violations[0]?.rule },
    });
  }

  try {
    // Check subscription tier before allowing scan
    const tierCheck = await checkScanAllowance(req.apiKey.telegram_user_id);
    if (!tierCheck.allowed) {
      const status = tierCheck.reason === 'no_subscription' ? 402 : 429;
      return res.status(status).json({
        error: tierCheck.reason === 'no_subscription' ? 'subscription_required' : 'scan_limit_exceeded',
        ...(tierCheck.limit && { used: tierCheck.used, limit: tierCheck.limit }),
      });
    }

    // Increment usage and get current counts
    const usage = await incrementUsage(req.apiKey.id);
    const summary = await getUsageSummary(req.apiKey.id);

    // Run the scan
    const result = await analyzeContent(content);
    const responseTimeMs = Date.now() - startTime;

    // Aegis: review the scan result
    const aegis = await reviewScanResult(result, { input: content });

    // Log scan to batch buffer
    logScan({
      apiKeyId: req.apiKey.id,
      query: content,
      riskScore: result.riskScore,
      responseTimeMs,
    });

    // Set usage headers
    const limit = TIER_LIMITS[tierCheck.tier] || 0;
    const remaining = limit === Infinity ? 'unlimited' : String(Math.max(0, limit - (tierCheck.used || 0)));
    res.set('X-Scans-Used', String(summary.scanCount));
    res.set('X-Scans-Remaining', remaining);
    res.set('X-Subscription-Tier', tierCheck.tier);

    // Test keys get flagged
    if (req.apiKey.is_test) {
      res.set('X-Test-Mode', 'true');
    }

    // Build Aegis section for API response
    const aegisSection = {
      status: aegis.status,
      violations: aegis.violations.map((v) => ({
        rule: v.rule,
        severity: v.severity,
        message: v.message,
      })),
    };

    res.json({
      success: true,
      data: {
        risk_score: result.riskScore,
        confidence: result.confidence,
        indicators: result.indicators,
        reasoning: result.reasoning,
        advice: result.advice,
        content_type: result.contentType,
        virus_total: result.virusTotalResult
          ? {
              malicious: result.virusTotalResult.malicious,
              suspicious: result.virusTotalResult.suspicious,
              total: result.virusTotalResult.total,
            }
          : null,
        blockchain: result.blockchainResult
          ? {
              addresses_found: result.blockchainResult.addresses.length,
              honeypot_detected: result.blockchainResult.honeypotDetected,
              malicious_wallet_detected: result.blockchainResult.maliciousWalletDetected,
              highest_risk: result.blockchainResult.highestRisk,
              results: result.blockchainResult.results.map((r) => ({
                address: r.address,
                chain: r.chainName,
                risk_level: r.riskLevel,
                flags: r.flags,
              })),
            }
          : null,
        analysis_source: result.source,
        response_time_ms: responseTimeMs,
        aegis: aegisSection,
      },
      usage: {
        scans_used: summary.scanCount,
        tier: tierCheck.tier,
        tier_limit: limit === Infinity ? 'unlimited' : limit,
        scans_remaining: remaining,
      },
    });
  } catch (err) {
    console.error('API scan error:', err.message);
    res.status(500).json({ error: 'Internal server error during analysis.' });
  }
});

// --- GET /api/usage ---

router.get('/usage', authenticateApiKey, async (req, res) => {
  try {
    const summary = await getUsageSummary(req.apiKey.id);
    const tierCheck = await checkScanAllowance(req.apiKey.telegram_user_id);
    const limit = TIER_LIMITS[tierCheck.tier] || 0;
    const remaining = limit === Infinity ? 'unlimited' : String(Math.max(0, limit - (tierCheck.used || 0)));

    res.set('X-Scans-Used', String(summary.scanCount));
    res.set('X-Scans-Remaining', remaining);
    res.set('X-Subscription-Tier', tierCheck.tier);

    res.json({
      success: true,
      data: {
        month: summary.month,
        scans_used: summary.scanCount,
        tier: tierCheck.tier,
        tier_status: tierCheck.status,
        tier_limit: limit === Infinity ? 'unlimited' : limit,
        scans_remaining: remaining,
      },
    });
  } catch (err) {
    console.error('API usage error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve usage data.' });
  }
});

// --- Public Stats (no auth required) ---

router.get('/stats', async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://scamshield.dev');
  res.set('Access-Control-Allow-Methods', 'GET');
  try {
    const stats = await getReportStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;
