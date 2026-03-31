const { getSupabase } = require('./database');

// In-memory batch buffer — flushed to DB every 60 seconds
const scanBuffer = [];
let flushInterval = null;

function logScan({ apiKeyId, query, riskScore, responseTimeMs }) {
  scanBuffer.push({
    api_key_id: apiKeyId,
    query: query.slice(0, 2000),
    risk_score: riskScore,
    response_time_ms: responseTimeMs,
    created_at: new Date().toISOString(),
  });
}

async function flushBuffer() {
  if (scanBuffer.length === 0) return;

  // Drain the buffer
  const batch = scanBuffer.splice(0, scanBuffer.length);

  try {
    const { error } = await getSupabase()
      .from('api_scans')
      .insert(batch);

    if (error) {
      console.error('Failed to flush scan buffer:', error.message);
      // Put failed records back at the front
      scanBuffer.unshift(...batch);
    }
  } catch (err) {
    console.error('Scan buffer flush error:', err.message);
    scanBuffer.unshift(...batch);
  }
}

function startBatchFlush(intervalMs = 60_000) {
  if (flushInterval) return;
  flushInterval = setInterval(flushBuffer, intervalMs);
  // Flush on shutdown
  process.on('SIGTERM', flushBuffer);
  process.on('SIGINT', flushBuffer);
}

function stopBatchFlush() {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

async function getScansByKey(apiKeyId, limit = 50) {
  try {
    const { data, error } = await getSupabase()
      .from('api_scans')
      .select('*')
      .eq('api_key_id', apiKeyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to get scans by key:', err.message);
    return [];
  }
}

module.exports = {
  logScan,
  flushBuffer,
  startBatchFlush,
  stopBatchFlush,
  getScansByKey,
};
