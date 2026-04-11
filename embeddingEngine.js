const { getSupabase } = require('./database');

let googleApiKey = process.env.GOOGLE_API_KEY;

// Use YouTube API key if Google API key not set (they work with Gemini API)
if (!googleApiKey) {
  googleApiKey = process.env.YOUTUBE_API_KEY;
}

// --- Gemini Embedding 2 Configuration ---

const EMBEDDING_MODEL = 'gemini-embedding-001';
const SIMILARITY_THRESHOLD = 0.85; // Raised from 0.75 — Embedding 2 is more precise

// Matryoshka Representation Learning (MRL) dimensions
const EMBEDDING_DIMS = {
  free: 768,    // Free tier — faster, cheaper, compatible with existing DB
  premium: 3072, // Premium tier — full resolution for deep forensic analysis
};

const DEFAULT_DIM = EMBEDDING_DIMS.free; // Use 768 for backward compatibility

// Task type instructions for asymmetric retrieval
const TASK_TYPES = {
  RETRIEVAL_QUERY: 'RETRIEVAL_QUERY',       // User's incoming message (the query)
  RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT', // Known scam patterns in database
  CLASSIFICATION: 'CLASSIFICATION',          // For classifying scam vs not-scam
  SEMANTIC_SIMILARITY: 'SEMANTIC_SIMILARITY', // General similarity comparison
};

// --- Generate Text Embedding ---

async function generateEmbedding(text, options = {}) {
  if (!googleApiKey) {
    console.warn('No Google API key found for embeddings');
    return null;
  }

  const {
    taskType = TASK_TYPES.RETRIEVAL_QUERY,
    dimensions = DEFAULT_DIM,
  } = options;

  try {
    const body = {
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: dimensions,
    };

    // Add task type for optimized retrieval
    if (taskType) {
      body.taskType = taskType;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    console.error('Failed to generate text embedding:', err.message);
    return null;
  }
}

// --- Generate Multimodal Embedding (Image, Audio, PDF) ---

async function generateMultimodalEmbedding(mediaData, caption = '', options = {}) {
  if (!googleApiKey) {
    console.warn('No Google API key found for embeddings');
    return null;
  }

  const {
    taskType = TASK_TYPES.RETRIEVAL_QUERY,
    dimensions = DEFAULT_DIM,
  } = options;

  try {
    // Build multimodal content parts
    const parts = [];

    // Add the media file as inline_data (base64)
    if (mediaData && mediaData.buffer) {
      parts.push({
        inline_data: {
          mime_type: mediaData.mimeType,
          data: mediaData.buffer.toString('base64'),
        },
      });
    }

    // Add caption/text context if provided
    if (caption) {
      parts.push({ text: caption });
    }

    if (parts.length === 0) {
      console.warn('No content parts for multimodal embedding');
      return null;
    }

    const body = {
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts },
      outputDimensionality: dimensions,
    };

    if (taskType) {
      body.taskType = taskType;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Multimodal embedding API error:', error.error?.message);
      return null;
    }

    const data = await response.json();
    const embedding = data.embedding?.values;

    if (!embedding || embedding.length === 0) {
      return null;
    }

    return embedding;
  } catch (err) {
    console.error('Failed to generate multimodal embedding:', err.message);
    return null;
  }
}

// --- Cosine Similarity (local fallback) ---

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

// --- Vector Search via pgvector ---

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

// --- Store Embedding ---

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

// --- Seed Known Scams with CLASSIFICATION task type ---

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
      // Use RETRIEVAL_DOCUMENT for database storage (optimized for being searched)
      const embedding = await generateEmbedding(scam.pattern, {
        taskType: TASK_TYPES.RETRIEVAL_DOCUMENT,
        dimensions: DEFAULT_DIM,
      });

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
  generateMultimodalEmbedding,
  findSimilarScams,
  storeEmbedding,
  seedKnownScams,
  cosineSimilarity,
  SIMILARITY_THRESHOLD,
  EMBEDDING_DIMS,
  TASK_TYPES,
  DEFAULT_DIM,
};
