'use strict';

/**
 * Reviews the quality and reliability of a scan result.
 * Flags results that may be unreliable before they reach the user.
 */
function reviewDetectionQuality(result, context = {}) {
  const violations = [];

  // 1. High risk score with low confidence — unreliable result
  if (result.confidence < 40 && result.riskScore >= 7) {
    violations.push({
      rule: 'LOW_CONFIDENCE_HIGH_RISK',
      severity: 'warning',
      message: `Risk score ${result.riskScore}/10 with only ${result.confidence}% confidence. Treat this result with caution.`,
    });
  }

  // 2. No analysis signals at all — default score, not real analysis
  if (result.source === 'none') {
    violations.push({
      rule: 'NO_ANALYSIS_SIGNALS',
      severity: 'warning',
      message: 'No reliable signals were available for this scan. The score is a default estimate.',
    });
  }

  // 3. Keyword-only high risk — Claude was unavailable, less reliable
  if (result.source === 'keyword_only' && result.riskScore >= 7) {
    violations.push({
      rule: 'KEYWORD_ONLY_HIGH_RISK',
      severity: 'warning',
      message: 'High risk score based on keyword matching only — AI analysis was unavailable. Result may be less accurate.',
    });
  }

  // 4. VT and Claude significantly disagree — warrants caution
  const vt = result.virusTotalResult;
  if (vt && vt.malicious > 3 && result.riskScore < 5) {
    violations.push({
      rule: 'VT_CLAUDE_CONTRADICTION',
      severity: 'warning',
      message: `VirusTotal flagged ${vt.malicious} engines malicious, but risk score is low. Exercise caution — manual review recommended.`,
    });
  }

  return violations;
}

module.exports = { reviewDetectionQuality };
