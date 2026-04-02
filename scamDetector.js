const Anthropic = require('@anthropic-ai/sdk');
const { parseInput, encodeUrlForVT, getDomain } = require('./utils/urlExtractor');
const { generateEmbedding, findSimilarScams } = require('./embeddingEngine');

let anthropic = null;

function getAnthropic() {
  if (!anthropic) {
    anthropic = new Anthropic();
  }
  return anthropic;
}

// --- VirusTotal Rate Limiting (4 req/min free tier) ---

const vtTimestamps = [];
const VT_RATE_LIMIT = 4;
const VT_WINDOW_MS = 60_000;

function canCallVirusTotal() {
  const now = Date.now();
  // Remove timestamps older than the window
  while (vtTimestamps.length > 0 && vtTimestamps[0] < now - VT_WINDOW_MS) {
    vtTimestamps.shift();
  }
  return vtTimestamps.length < VT_RATE_LIMIT;
}

function recordVTCall() {
  vtTimestamps.push(Date.now());
}

// --- VirusTotal Check ---

async function checkVirusTotal(url) {
  if (!process.env.VIRUSTOTAL_API_KEY) return null;
  if (!canCallVirusTotal()) {
    console.log('VirusTotal rate limit reached, skipping');
    return null;
  }

  try {
    recordVTCall();
    const encoded = encodeUrlForVT(url);
    const response = await fetch(`https://www.virustotal.com/api/v3/urls/${encoded}`, {
      headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // URL not in VT database — submit it first
      if (response.status === 404) {
        const submitRes = await fetch('https://www.virustotal.com/api/v3/urls', {
          method: 'POST',
          headers: {
            'x-apikey': process.env.VIRUSTOTAL_API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `url=${encodeURIComponent(url)}`,
          signal: AbortSignal.timeout(10_000),
        });
        if (!submitRes.ok) return null;
        // After submission, re-fetch
        recordVTCall();
        const retryRes = await fetch(`https://www.virustotal.com/api/v3/urls/${encoded}`, {
          headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY },
          signal: AbortSignal.timeout(10_000),
        });
        if (!retryRes.ok) return null;
        const retryData = await retryRes.json();
        const stats = retryData.data?.attributes?.last_analysis_stats;
        if (!stats) return null;
        return {
          malicious: stats.malicious || 0,
          suspicious: stats.suspicious || 0,
          total: (stats.malicious || 0) + (stats.suspicious || 0) + (stats.harmless || 0) + (stats.undetected || 0),
          permalink: retryData.data?.links?.self || '',
        };
      }
      return null;
    }

    const data = await response.json();
    const stats = data.data?.attributes?.last_analysis_stats;
    if (!stats) return null;

    return {
      malicious: stats.malicious || 0,
      suspicious: stats.suspicious || 0,
      total: (stats.malicious || 0) + (stats.suspicious || 0) + (stats.harmless || 0) + (stats.undetected || 0),
      permalink: data.data?.links?.self || '',
    };
  } catch (err) {
    console.error('VirusTotal check failed:', err.message);
    return null;
  }
}

// --- Keyword Analysis ---

const KEYWORDS = {
  high: [
    'guaranteed returns', '100% profit', 'send crypto to', 'double your money',
    'limited slots', 'act now', 'once in a lifetime', 'risk free', 'zero risk',
    'send btc', 'send eth', 'send usdt', 'guaranteed profit', 'no risk',
    'wire transfer', 'money back guarantee', 'secret method', 'get rich quick',
  ],
  medium: [
    'pump', 'moon', 'lambo', 'passive income', 'financial freedom',
    'exclusive opportunity', 'whitelisted', 'early access', 'private sale',
    'insider', 'next 100x', 'dont miss', "don't miss", 'last chance',
    'limited time', 'join now', 'dm me',
  ],
  low: [
    'invest', 'token', 'airdrop', 'nft', 'defi', 'yield', 'staking',
    'mining', 'wallet', 'exchange', 'trading', 'signal', 'profit',
  ],
};

function analyzeKeywords(text) {
  const lower = text.toLowerCase();
  const matches = [];
  let score = 0;

  for (const keyword of KEYWORDS.high) {
    if (lower.includes(keyword)) {
      matches.push(keyword);
      score += 3;
    }
  }
  for (const keyword of KEYWORDS.medium) {
    if (lower.includes(keyword)) {
      matches.push(keyword);
      score += 2;
    }
  }
  for (const keyword of KEYWORDS.low) {
    if (lower.includes(keyword)) {
      matches.push(keyword);
      score += 1;
    }
  }

  return { score: Math.min(score, 10), matches };
}

// --- Claude Analysis ---

async function analyzeWithClaude(input, vtResult, keywordResult) {
  try {
    const client = getAnthropic();

    const contextParts = [];
    if (vtResult) {
      contextParts.push(`VirusTotal: ${vtResult.malicious}/${vtResult.total} engines flagged as malicious`);
    }
    if (keywordResult && keywordResult.matches.length > 0) {
      contextParts.push(`Keyword matches: ${keywordResult.matches.join(', ')}`);
    }

    const contextStr = contextParts.length > 0
      ? `\n\nPre-analysis context:\n${contextParts.join('\n')}`
      : '';

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze the following content for crypto, investment, or financial scam indicators. Consider phishing, Ponzi schemes, pump-and-dump, fake giveaways, impersonation, and social engineering tactics.${contextStr}

Content to analyze:
${input}

Return ONLY valid JSON with this exact structure:
{"risk_score": <1-10>, "confidence": <0-100>, "indicators": ["<indicator1>", "<indicator2>"], "reasoning": "<brief explanation>", "advice": "<what the user should do>"}`,
        },
      ],
    });

    const text = message.content[0]?.text || '';
    // Strip markdown fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Claude analysis failed:', err.message);
    return null;
  }
}

// --- Semantic Similarity Search ---

async function findSemanticMatches(input) {
  try {
    const embedding = await generateEmbedding(input);
    if (!embedding) return { matches: [], bestMatch: null };

    const matches = await findSimilarScams(embedding, 3);
    return {
      matches: matches.map((m) => ({
        pattern: m.pattern,
        similarity: Math.round(m.similarity * 100),
        severity: m.severity,
      })),
      bestMatch: matches[0] || null,
    };
  } catch (err) {
    console.error('Semantic search failed:', err.message);
    return { matches: [], bestMatch: null };
  }
}

// --- Score Aggregation ---

function aggregateScores(claudeResult, vtResult, keywordResult, semanticResult) {
  let riskScore;
  let confidence;
  let source;

  if (claudeResult) {
    // Weighted average: Claude 60%, VT 25%, Keywords 10%, Semantic 5%
    const claudeScore = claudeResult.risk_score || 5;
    const vtScore = vtResult ? Math.min(10, (vtResult.malicious / Math.max(vtResult.total, 1)) * 20) : 0;
    const kwScore = keywordResult ? keywordResult.score : 0;
    const semanticScore = semanticResult?.bestMatch ? semanticResult.bestMatch.severity : 0;

    if (vtResult) {
      riskScore = Math.round(claudeScore * 0.6 + vtScore * 0.25 + kwScore * 0.1 + semanticScore * 0.05);
    } else {
      riskScore = Math.round(claudeScore * 0.7 + kwScore * 0.2 + semanticScore * 0.1);
    }

    confidence = claudeResult.confidence || 70;
    source = 'full_analysis';
  } else if (vtResult || keywordResult) {
    // Fallback without Claude
    const vtScore = vtResult ? Math.min(10, (vtResult.malicious / Math.max(vtResult.total, 1)) * 20) : 0;
    const kwScore = keywordResult ? keywordResult.score : 0;

    if (vtResult) {
      riskScore = Math.round(vtScore * 0.6 + kwScore * 0.4);
    } else {
      riskScore = kwScore;
    }
    confidence = 40;
    source = vtResult ? 'vt_only' : 'keyword_only';
  } else {
    riskScore = 5;
    confidence = 10;
    source = 'none';
  }

  // Floor at 7 if VT reports >3 malicious detections
  if (vtResult && vtResult.malicious > 3 && riskScore < 7) {
    riskScore = 7;
  }

  // Clamp
  riskScore = Math.max(1, Math.min(10, riskScore));
  confidence = Math.max(0, Math.min(100, confidence));

  return { riskScore, confidence, source };
}

// --- Main Analysis Function ---

async function analyzeContent(input) {
  const startTime = Date.now();

  // Stage 1: Parse input
  const parsed = parseInput(input);

  // Stage 2, 3, & 4: Run VT, keywords, and semantic search in parallel
  const [vtResult, keywordResult, semanticResult] = await Promise.all([
    parsed.urls.length > 0 ? checkVirusTotal(parsed.urls[0]) : Promise.resolve(null),
    Promise.resolve(analyzeKeywords(parsed.text)),
    findSemanticMatches(parsed.text),
  ]);

  // Stage 5: Claude analysis
  const claudeResult = await analyzeWithClaude(input, vtResult, keywordResult);

  // Stage 6: Aggregate scores (now includes semantic similarity)
  const { riskScore, confidence, source } = aggregateScores(claudeResult, vtResult, keywordResult, semanticResult);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Combine all indicators
  const allIndicators = [
    ...(claudeResult?.indicators || []),
    ...keywordResult.matches,
    ...(semanticResult.matches.map((m) => `Similar to: "${m.pattern}" (${m.similarity}% match)`) || []),
  ];

  return {
    riskScore,
    confidence,
    indicators: [...new Set(allIndicators)],
    reasoning: claudeResult?.reasoning || (semanticResult?.bestMatch
      ? `Semantic match found: "${semanticResult.bestMatch.pattern}"`
      : keywordResult.matches.length > 0
        ? `Keyword analysis detected: ${keywordResult.matches.join(', ')}`
        : 'No clear scam indicators detected.'),
    advice: claudeResult?.advice || 'Exercise caution with any unsolicited financial offers.',
    virusTotalResult: vtResult,
    keywordMatches: keywordResult.matches,
    semanticMatches: semanticResult.matches,
    contentType: parsed.contentType,
    source,
    elapsed,
  };
}

module.exports = { analyzeContent, analyzeKeywords, findSemanticMatches };
