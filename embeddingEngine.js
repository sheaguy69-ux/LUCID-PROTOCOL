const { getSupabase } = require('./database');

let googleApiKey = process.env.GOOGLE_API_KEY;

// Use YouTube API key if Google API key not set (they work with Gemini API)
if (!googleApiKey) {
  googleApiKey = process.env.YOUTUBE_API_KEY;
}

const EMBEDDING_MODEL = 'models/text-embedding-004';
const SIMILARITY_THRESHOLD = 0.75; // 75% semantic match = similar scam

async function generateEmbedding(text) {
  if (!googleApiKey) {
    console.warn('No Google API key found for embeddings');
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          content: { parts: [{ text }] },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Embedding API error:', error.error?.message);
      return null;
    }

    const data = await response.json();
    const embedding = data.embedding?.values;

    if (!embedding || embedding.length === 0) {
      return null;
    }

    return embedding;
  } catch (err) {
    console.error('Failed to generate embedding:', err.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function findSimilarScams(embedding, limit = 5) {
  if (!embedding) return [];

  try {
    // Use pgvector's cosine similarity search
    const { data, error } = await getSupabase().rpc('search_scam_signatures', {
      query_embedding: embedding,
      similarity_threshold: SIMILARITY_THRESHOLD,
      match_count: limit,
    });

    if (error) {
      console.error('Similarity search error:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Failed to find similar scams:', err.message);
    return [];
  }
}

async function storeEmbedding(table, id, text, embedding) {
  if (!embedding) return null;

  try {
    const { data, error } = await getSupabase()
      .from(table)
      .update({ embedding })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error(`Failed to store embedding for ${table}:`, err.message);
    return null;
  }
}

async function seedKnownScams() {
  const knownScams = [
    { pattern: 'Double your BTC. Send 0.1 and receive 1', severity: 9 },
    { pattern: 'Limited whitelist spots available. Airdrop coming soon', severity: 8 },
    { pattern: 'Click here to claim your free crypto rewards', severity: 9 },
    { pattern: 'Verify your wallet by sending 0.01 ETH', severity: 10 },
    { pattern: 'Exclusive pre-sale: guaranteed 100x returns', severity: 10 },
    { pattern: 'Flash loan opportunity - risk free profit', severity: 9 },
    { pattern: 'Confirm your seed phrase to unlock premium features', severity: 10 },
    { pattern: 'Send funds to this wallet and get 2x back', severity: 9 },
    { pattern: 'Join our private telegram group for insider tips', severity: 7 },
    { pattern: 'Lambo guaranteed in 30 days or your money back', severity: 9 },
  ];

  for (const scam of knownScams) {
    try {
      const embedding = await generateEmbedding(scam.pattern);

      await getSupabase()
        .from('scam_signatures')
        .upsert({
          pattern: scam.pattern,
          pattern_type: 'phrase',
          severity: scam.severity,
          embedding,
          sources: ['seed_data'],
        })
        .eq('pattern', scam.pattern);
    } catch (err) {
      console.error(`Failed to seed scam: ${scam.pattern}`, err.message);
    }
  }
}

module.exports = {
  generateEmbedding,
  findSimilarScams,
  storeEmbedding,
  seedKnownScams,
  SIMILARITY_THRESHOLD,
};
