const crypto = require('crypto');
const { getSupabase } = require('./database');

const LIVE_PREFIX = 'sg_live_';
const TEST_PREFIX = 'sg_test_';
const KEY_LENGTH = 32;

function generateRawKey(isTest = false) {
  const prefix = isTest ? TEST_PREFIX : LIVE_PREFIX;
  const random = crypto.randomBytes(KEY_LENGTH).toString('hex');
  return prefix + random;
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function extractPrefix(rawKey) {
  // Store first 12 chars as prefix for identification (e.g. "sg_live_a1b2")
  return rawKey.slice(0, 12);
}

async function createApiKey(telegramUserId, { label = 'default', isTest = false } = {}) {
  const rawKey = generateRawKey(isTest);
  const hash = hashKey(rawKey);
  const prefix = extractPrefix(rawKey);

  try {
    const { data, error } = await getSupabase()
      .from('api_keys')
      .insert({
        telegram_user_id: telegramUserId,
        key_hash: hash,
        key_prefix: prefix,
        label,
        is_test: isTest,
        active: true,
      })
      .select()
      .single();

    if (error) throw error;

    // Return the raw key ONCE — it can never be retrieved again
    return { id: data.id, rawKey, prefix, isTest, label };
  } catch (err) {
    console.error('Failed to create API key:', err.message);
    return null;
  }
}

async function validateApiKey(rawKey) {
  if (!rawKey) return null;

  // Quick format check
  if (!rawKey.startsWith(LIVE_PREFIX) && !rawKey.startsWith(TEST_PREFIX)) {
    return null;
  }

  const hash = hashKey(rawKey);

  try {
    const { data, error } = await getSupabase()
      .from('api_keys')
      .select('*')
      .eq('key_hash', hash)
      .eq('active', true)
      .single();

    if (error || !data) return null;

    // Update last_used_at (fire and forget)
    getSupabase()
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {});

    return data;
  } catch (err) {
    console.error('Failed to validate API key:', err.message);
    return null;
  }
}

async function revokeApiKey(keyId, telegramUserId) {
  try {
    const { data, error } = await getSupabase()
      .from('api_keys')
      .update({ active: false })
      .eq('id', keyId)
      .eq('telegram_user_id', telegramUserId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to revoke API key:', err.message);
    return null;
  }
}

async function getKeysByUser(telegramUserId) {
  try {
    const { data, error } = await getSupabase()
      .from('api_keys')
      .select('id, key_prefix, label, is_test, active, created_at, last_used_at')
      .eq('telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to get user API keys:', err.message);
    return [];
  }
}

module.exports = {
  createApiKey,
  validateApiKey,
  revokeApiKey,
  getKeysByUser,
  hashKey,
};
