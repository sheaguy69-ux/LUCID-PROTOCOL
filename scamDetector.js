const Anthropic = require('@anthropic-ai/sdk');
const { parseInput, encodeUrlForVT, getDomain } = require('./utils/urlExtractor');
const {
  generateEmbedding,
  generateMultimodalEmbedding,
  findSimilarScams,
  TASK_TYPES,
} = require('./embeddingEngine');
const { sanitizeInput } = require('./aegisAgent');
const { scanWeb3Addresses } = require('./web3Scanner');
const { fireIntercept } = require('./intelClient');

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

// --- Claude Analysis (supports multimodal via vision) ---

async function analyzeWithClaude(input, vtResult, keywordResult, mediaInfo = null, blockchainResult = null) {
  try {
    const client = getAnthropic();

    const contextParts = [];
    if (vtResult) {
      contextParts.push(`VirusTotal: ${vtResult.malicious}/${vtResult.total} engines flagged as malicious`);
    }
    if (keywordResult && keywordResult.matches.length > 0) {
      contextParts.push(`Keyword matches: ${keywordResult.matches.join(', ')}`);
    }
    if (mediaInfo) {
      contextParts.push(`Media type: ${mediaInfo.type} (${mediaInfo.mimeType || 'unknown mime'})`);
    }
    if (blockchainResult?.honeypotDetected) {
      contextParts.push('Blockchain: HONEYPOT contract detected by GoPlus Security');
    }
    if (blockchainResult?.maliciousWalletDetected) {
      contextParts.push('Blockchain: Malicious wallet flagged by GoPlus Security');
    }

    const contextStr = contextParts.length > 0
      ? `\n\nPre-analysis context:\n${contextParts.join('\n')}`
      : '';

    // Build message content — multimodal if image attached
    const contentParts = [];

    if (mediaInfo && mediaInfo.type === 'image' && mediaInfo.data) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaInfo.data.mimeType,
          data: mediaInfo.data.buffer.toString('base64'),
        },
      });
    }

    const textPrompt = `Analyze the following content for crypto, investment, or financial scam indicators. Consider phishing, Ponzi schemes, pump-and-dump, fake giveaways, impersonation, and social engineering tactics.${contextStr}

${mediaInfo && mediaInfo.type === 'image' ? 'The image above was sent by a user for scam analysis. Look for fake screenshots, phishing pages, fake exchange interfaces, manipulated charts, fake celebrity endorsements, or scam promotional material.\n\n' : ''}Content to analyze:
${input || '(no text — analyze the attached media)'}

Return ONLY valid JSON with this exact structure:
{"risk_score": <1-10>, "confidence": <0-100>, "indicators": ["<indicator1>", "<indicator2>"], "reasoning": "<brief explanation>", "advice": "<what the user should do>"}`;

    contentParts.push({ type: 'text', text: textPrompt });

    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: contentParts }],
      },
      { timeout: 30_000 },
    );

    const text = message.content[0]?.text || '';
    // Strip markdown fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Claude analysis failed:', err.message);
    return null;
  }
}

// --- Semantic Similarity Search (text) ---

async function findSemanticMatches(input) {
  try {
    // Use RETRIEVAL_QUERY task type — optimized for finding matches in the database
    const embedding = await generateEmbedding(input, {
      taskType: TASK_TYPES.RETRIEVAL_QUERY,
    });
    if (!embedding) return { matches: [], bestMatch: null, embedding: null };

    const matches = await findSimilarScams(embedding, 3);
    return {
      matches: matches.map((m) => ({
        pattern: m.pattern,
        similarity: Math.round(m.similarity * 100),
        severity: m.severity,
      })),
      bestMatch: matches[0] || null,
      embedding,
    };
  } catch (err) {
    console.error('Semantic search failed:', err.message);
    return { matches: [], bestMatch: null, embedding: null };
  }
}

// --- Multimodal Semantic Search (images, audio, PDFs) ---

async function findMultimodalMatches(mediaData, caption = '') {
  try {
    const embedding = await generateMultimodalEmbedding(mediaData, caption, {
      taskType: TASK_TYPES.RETRIEVAL_QUERY,
    });
    if (!embedding) return { matches: [], bestMatch: null, embedding: null };

    const matches = await findSimilarScams(embedding, 3);
    return {
      matches: matches.map((m) => ({
        pattern: m.pattern,
        similarity: Math.round(m.similarity * 100),
        severity: m.severity,
      })),
      bestMatch: matches[0] || null,
      embedding,
    };
  } catch (err) {
    console.error('Multimodal semantic search failed:', err.message);
    return { matches: [], bestMatch: null, embedding: null };
  }
}

// --- Score Aggregation ---

function aggregateScores(claudeResult, vtResult, keywordResult, semanticResult, blockchainResult = null) {
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

  // Blockchain floors
  if (blockchainResult?.honeypotDetected && riskScore < 9) riskScore = 9;
  if (blockchainResult?.maliciousWalletDetected && riskScore < 8) riskScore = 8;

  // Clamp
  riskScore = Math.max(1, Math.min(10, riskScore));
  confidence = Math.max(0, Math.min(100, confidence));

  return { riskScore, confidence, source };
}

// --- Main Analysis Function (text-only, backward compatible) ---

// opts: { userId?, sourceProduct? } — used for threat-intel harvest.
// Defaults keep existing Telegram callers working unchanged.
async function analyzeContent(input, opts = {}) {
  const startTime = Date.now();

  // Aegis: Strip zero-width / invisible Unicode before any analysis
  input = sanitizeInput(input);

  // Stage 1: Parse input
  const parsed = parseInput(input);

  // Stage 2, 3, 4 & 5: Run VT, keywords, semantic search, and blockchain scan in parallel
  const [vtResult, keywordResult, semanticResult, blockchainResult] = await Promise.all([
    parsed.urls.length > 0 ? checkVirusTotal(parsed.urls[0]) : Promise.resolve(null),
    Promise.resolve(analyzeKeywords(parsed.text)),
    findSemanticMatches(parsed.text),
    scanWeb3Addresses(parsed.text),
  ]);

  // Stage 6: Claude analysis
  const claudeResult = await analyzeWithClaude(input, vtResult, keywordResult, null, blockchainResult);

  // Stage 7: Aggregate scores
  const { riskScore, confidence, source } = aggregateScores(claudeResult, vtResult, keywordResult, semanticResult, blockchainResult);

  // Stage 8: Harvest intercept (fire-and-forget, gated by intelClient threshold)
  // Only contracts from blockchainResult are relevant if present.
  const contracts = blockchainResult?.addresses || [];
  fireIntercept({
    rawText: input,
    urls: parsed.urls || [],
    contracts,
    risk: riskScore,
    sourceProduct: opts.sourceProduct || 'scamshield_tg',
    userId: opts.userId,
    mediaType: parsed.urls.length > 0 ? 'url' : 'text',
  }).catch(() => { /* swallow — never block user */ });

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
    blockchainResult,
    contentType: parsed.contentType,
    source,
    elapsed,
  };
}

// --- Multimodal Analysis Function (photos, voice, documents) ---

// opts: { userId?, sourceProduct? } — used for threat-intel harvest.
async function analyzeMultimodalContent(mediaData, caption = '', opts = {}) {
  const startTime = Date.now();

  // Aegis: Strip zero-width / invisible Unicode from caption
  caption = sanitizeInput(caption) || '';

  // Build media info for Claude
  const mediaInfo = {
    type: mediaData.mimeType.startsWith('image/') ? 'image'
      : mediaData.mimeType.startsWith('audio/') ? 'audio'
        : 'document',
    mimeType: mediaData.mimeType,
    data: mediaData,
  };

  // Parse caption for URLs and keywords
  const parsed = caption ? parseInput(caption) : { text: '', urls: [], contentType: 'media' };

  // Run all stages in parallel
  const [vtResult, keywordResult, semanticResult, blockchainResult] = await Promise.all([
    // Check URLs from caption
    parsed.urls.length > 0 ? checkVirusTotal(parsed.urls[0]) : Promise.resolve(null),
    // Keywords from caption text
    caption ? Promise.resolve(analyzeKeywords(caption)) : Promise.resolve({ score: 0, matches: [] }),
    // Multimodal semantic search — embed the image/audio/doc itself
    findMultimodalMatches(mediaData, caption),
    // Blockchain scan from caption addresses
    caption ? scanWeb3Addresses(caption) : Promise.resolve(null),
  ]);

  // Claude vision analysis (send image + caption context)
  const claudeResult = await analyzeWithClaude(
    caption || '(user sent media for scam analysis)',
    vtResult,
    keywordResult,
    mediaInfo,
    blockchainResult
  );

  // Aggregate scores
  const { riskScore, confidence, source } = aggregateScores(claudeResult, vtResult, keywordResult, semanticResult, blockchainResult);

  // Harvest intercept (fire-and-forget)
  const mmContracts = blockchainResult?.addresses || [];
  fireIntercept({
    rawText: caption || `[media:${mediaInfo.type}]`,
    urls: parsed.urls || [],
    contracts: mmContracts,
    risk: riskScore,
    sourceProduct: opts.sourceProduct || 'scamshield_tg',
    userId: opts.userId,
    mediaType: mediaInfo.type === 'image' ? 'image'
      : mediaInfo.type === 'audio' ? 'audio'
      : 'doc',
  }).catch(() => { /* swallow */ });

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
    reasoning: claudeResult?.reasoning || 'Media analyzed for visual scam indicators.',
    advice: claudeResult?.advice || 'Exercise caution with unsolicited media containing financial claims.',
    virusTotalResult: vtResult,
    keywordMatches: keywordResult.matches,
    semanticMatches: semanticResult.matches,
    blockchainResult,
    contentType: `media_${mediaInfo.type}`,
    mediaType: mediaInfo.type,
    source,
    elapsed,
  };
}

module.exports = {
  analyzeContent,
  analyzeMultimodalContent,
  analyzeKeywords,
  findSemanticMatches,
  findMultimodalMatches,
};
