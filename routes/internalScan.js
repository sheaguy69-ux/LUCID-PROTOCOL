// internalScan.js — Shared-secret scan endpoint for internal consumers
// (Discord bot, Flutter app backend, etc.). Bypasses API-key auth — secret-gated.
//
// WS5 per plan: /Users/anthonyguy/.claude/plans/the-core-strategy-streamed-crown.md
//
// Required env:
//   INTERNAL_SCAN_SECRET — shared bearer between this bot and consumers
//
// POST /internal/scan
//   Headers: x-internal-secret: <INTERNAL_SCAN_SECRET>
//   Body:    { content, guildId?, userId?, sourceProduct?='lucidprotocol_discord' }
//   Returns: { success, data: { risk_score, attack_type, indicators, reasoning,
//                               advice, analysis_source, urls, contracts,
//                               blockchain, semantic_matches, elapsed_ms } }

const express = require('express');
const { analyzeContent } = require('../scamDetector');
const { parseInput } = require('../utils/urlExtractor');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

// --- Auth middleware --------------------------------------------------

function authenticateInternal(req, res, next) {
  const expected = process.env.INTERNAL_SCAN_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'internal_scan_disabled' });
  }
  const got = req.headers['x-internal-secret'];
  if (!got || typeof got !== 'string') {
    return res.status(401).json({ error: 'missing_secret' });
  }
  // Constant-time compare — avoid timing attacks.
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return res.status(401).json({ error: 'invalid_secret' });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return res.status(401).json({ error: 'invalid_secret' });
  next();
}

// --- Route ------------------------------------------------------------

router.post('/scan', authenticateInternal, async (req, res) => {
  const { content, guildId, userId, sourceProduct } = req.body || {};

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'missing_content' });
  }
  if (content.length > 4000) {
    return res.status(400).json({ error: 'content_too_long' });
  }

  const t0 = Date.now();

  try {
    const result = await analyzeContent(content, {
      sourceProduct: sourceProduct || 'lucidprotocol_discord',
      // Tag the intercept with guild_id (hashed) so we can dedupe per-guild.
      userId: guildId || userId || null,
    });

    const elapsedMs = Date.now() - t0;

    return res.json({
      success: true,
      data: {
        risk_score: result.riskScore,
        confidence: result.confidence,
        attack_type: result.attackType || null,
        indicators: result.indicators || [],
        reasoning: result.reasoning,
        advice: result.advice,
        analysis_source: result.source,
        urls: extractUrls(content),
        contracts: extractContracts(result),
        blockchain: result.blockchainResult
          ? {
              honeypot: result.blockchainResult.honeypotDetected,
              malicious_wallet: result.blockchainResult.maliciousWalletDetected,
              highest_risk: result.blockchainResult.highestRisk,
            }
          : null,
        semantic_matches: (result.semanticMatches || []).map((m) => ({
          pattern: m.pattern,
          similarity: m.similarity,
        })),
        content_type: result.contentType,
        elapsed_ms: elapsedMs,
      },
    });
  } catch (err) {
    console.error('[internalScan] error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// --- Helpers ----------------------------------------------------------

function extractUrls(content) {
  try {
    const p = parseInput(content);
    return p.urls || [];
  } catch {
    return [];
  }
}

function extractContracts(result) {
  const out = [];
  for (const r of result.blockchainResult?.results || []) {
    if (r?.address) out.push({ address: r.address, chain: r.chainName, risk: r.riskLevel });
  }
  return out;
}

module.exports = router;
