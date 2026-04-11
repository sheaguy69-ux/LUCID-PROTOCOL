'use strict';

// Overly broad single-word terms that would poison the detection database
const OVERLY_BROAD_TERMS = [
  'invest', 'wallet', 'token', 'crypto', 'bitcoin', 'ethereum', 'buy',
  'sell', 'trade', 'nft', 'defi', 'yield', 'staking', 'mining', 'profit',
];

// Prompt injection attempts targeting the AI pipeline
const PROMPT_INJECTION_KEYWORDS = [
  'ignore previous', 'ignore above', 'ignore all', 'system:', 'system prompt',
  'you are now', 'new instructions', 'disregard', 'forget all', 'override',
  'act as', 'pretend you', 'jailbreak', 'developer mode', 'do anything now',
];

/**
 * Reviews a user-submitted pattern before it is stored in the knowledge base.
 * Prevents database poisoning, false-positive flooding, and prompt injection.
 */
function reviewPatternSubmission(pattern, severity, context = {}) {
  const violations = [];
  const lower = pattern.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // 1. Prompt injection hidden in pattern text
  if (PROMPT_INJECTION_KEYWORDS.some((kw) => lower.includes(kw))) {
    violations.push({
      rule: 'PROMPT_INJECTION_IN_PATTERN',
      severity: 'critical',
      message: 'Pattern contains prompt injection keywords and cannot be stored.',
    });
  }

  // 2. Single overly-broad term with high severity = false-positive flood
  if (words.length <= 2 && severity >= 7 && OVERLY_BROAD_TERMS.some((t) => lower.includes(t))) {
    violations.push({
      rule: 'OVERLY_BROAD_PATTERN',
      severity: 'critical',
      message: 'Pattern is too generic and would cause false positives on legitimate crypto content.',
    });
  }

  // 3. High severity on short patterns — suspicious
  if (severity >= 9 && pattern.length < 30) {
    violations.push({
      rule: 'HIGH_SEVERITY_SHORT_PATTERN',
      severity: 'warning',
      message: 'Severity 9+ assigned to a short pattern. This may flag too many legitimate messages.',
    });
  }

  // 4. Duplicate-style spam: identical repeated words
  const uniqueWords = new Set(words);
  if (words.length > 3 && uniqueWords.size <= 2) {
    violations.push({
      rule: 'SPAM_PATTERN',
      severity: 'critical',
      message: 'Pattern appears to be spam (repeated words). Not stored.',
    });
  }

  return violations;
}

module.exports = { reviewPatternSubmission };
