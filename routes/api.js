const express = require('express');
const { validateApiKey } = require('../apiKeySystem');
const { analyzeContent } = require('../scamDetector');
const { logScan } = require('../usageTracking');
const { incrementUsage, getUsageSummary, FREE_TIER_SCANS } = require('../metering');

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

  try {
    // Increment usage and get current counts
    const usage = await incrementUsage(req.apiKey.id);
    const summary = await getUsageSummary(req.apiKey.id);

    // Run the scan
    const result = await analyzeContent(content);
    const responseTimeMs = Date.now() - startTime;

    // Log scan to batch buffer
    logScan({
      apiKeyId: req.apiKey.id,
      query: content,
      riskScore: result.riskScore,
      responseTimeMs,
    });

    // Set usage headers
    res.set('X-Scans-Used', String(summary.scanCount));
    res.set('X-Scans-Remaining', String(summary.freeRemaining));
    res.set('X-Billing-Status', summary.billingStatus);

    // Test keys get flagged
    if (req.apiKey.is_test) {
      res.set('X-Test-Mode', 'true');
    }

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
        analysis_source: result.source,
        response_time_ms: responseTimeMs,
      },
      usage: {
        scans_used: summary.scanCount,
        scans_remaining: summary.freeRemaining,
        overage_cost: summary.overageCost,
        billing_status: summary.billingStatus,
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

    res.set('X-Scans-Used', String(summary.scanCount));
    res.set('X-Scans-Remaining', String(summary.freeRemaining));
    res.set('X-Billing-Status', summary.billingStatus);

    res.json({
      success: true,
      data: {
        month: summary.month,
        scans_used: summary.scanCount,
        free_tier_limit: FREE_TIER_SCANS,
        scans_remaining: summary.freeRemaining,
        overage_scans: summary.overageCount,
        overage_cost: summary.overageCost,
        billing_status: summary.billingStatus,
      },
    });
  } catch (err) {
    console.error('API usage error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve usage data.' });
  }
});

module.exports = router;
