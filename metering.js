const { getSupabase } = require('./database');
const { getSubscriberTier } = require('./billing');

const TIER_LIMITS = {
  pro: 1000,
  unlimited: Infinity,
};

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Count total scans for a user this month across both bot (scam_reports) and API (api_usage_monthly).
 */
async function countUserScansThisMonth(telegramUserId) {
  const month = getCurrentMonth();
  const db = getSupabase();

  try {
    // Count bot scans from scam_reports this month
    const monthStart = `${month}-01T00:00:00.000Z`;
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const { count: botScans, error: botErr } = await db
      .from('scam_reports')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_user_id', telegramUserId)
      .gte('created_at', monthStart)
      .lt('created_at', nextMonth.toISOString());

    if (botErr) throw botErr;

    // Count API scans from api_usage_monthly for all user's keys
    const { data: keys, error: keysErr } = await db
      .from('api_keys')
      .select('id')
      .eq('telegram_user_id', telegramUserId)
      .eq('active', true);

    if (keysErr) throw keysErr;

    let apiScans = 0;
    if (keys && keys.length > 0) {
      const keyIds = keys.map((k) => k.id);
      const { data: usageRows, error: usageErr } = await db
        .from('api_usage_monthly')
        .select('scan_count')
        .in('api_key_id', keyIds)
        .eq('month', month);

      if (usageErr) throw usageErr;
      apiScans = (usageRows || []).reduce((sum, row) => sum + (row.scan_count || 0), 0);
    }

    return (botScans || 0) + apiScans;
  } catch (err) {
    console.error('Failed to count user scans:', err.message);
    return 0;
  }
}

/**
 * Check whether a user is allowed to scan.
 * Returns { allowed, reason?, tier, status, used?, limit? }
 */
async function checkScanAllowance(telegramUserId) {
  const sub = await getSubscriberTier(telegramUserId);

  if (sub.status !== 'active' && sub.status !== 'trialing') {
    return { allowed: false, reason: 'no_subscription', tier: sub.tier, status: sub.status };
  }

  const limit = TIER_LIMITS[sub.tier];
  if (limit === undefined) {
    return { allowed: false, reason: 'no_subscription', tier: sub.tier, status: sub.status };
  }

  if (limit === Infinity) {
    return { allowed: true, tier: sub.tier, status: sub.status };
  }

  const used = await countUserScansThisMonth(telegramUserId);
  if (used >= limit) {
    return { allowed: false, reason: 'limit_exceeded', tier: sub.tier, status: sub.status, used, limit };
  }

  return { allowed: true, tier: sub.tier, status: sub.status, used, limit };
}

// --- Legacy API key usage tracking (still used by routes/api.js for per-key counting) ---

async function getOrCreateMonthlyUsage(apiKeyId) {
  const month = getCurrentMonth();
  const db = getSupabase();

  try {
    const { data, error } = await db
      .from('api_usage_monthly')
      .select('*')
      .eq('api_key_id', apiKeyId)
      .eq('month', month)
      .single();

    if (data) return data;

    if (error && error.code === 'PGRST116') {
      const { data: created, error: createErr } = await db
        .from('api_usage_monthly')
        .insert({ api_key_id: apiKeyId, month, scan_count: 0, overage_count: 0, overage_cost: 0 })
        .select()
        .single();

      if (createErr) throw createErr;
      return created;
    }

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to get/create monthly usage:', err.message);
    return null;
  }
}

async function incrementUsage(apiKeyId) {
  const month = getCurrentMonth();
  const usage = await getOrCreateMonthlyUsage(apiKeyId);
  if (!usage) return null;

  try {
    const { data, error } = await getSupabase()
      .from('api_usage_monthly')
      .update({
        scan_count: usage.scan_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('api_key_id', apiKeyId)
      .eq('month', month)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to increment usage:', err.message);
    return null;
  }
}

async function getUsageSummary(apiKeyId) {
  const usage = await getOrCreateMonthlyUsage(apiKeyId);
  if (!usage) {
    return { month: getCurrentMonth(), scanCount: 0 };
  }

  return {
    month: usage.month,
    scanCount: usage.scan_count,
  };
}

async function getUsageSummaryForUser(telegramUserId) {
  try {
    const { data: keys, error } = await getSupabase()
      .from('api_keys')
      .select('id, key_prefix, label, is_test, active')
      .eq('telegram_user_id', telegramUserId)
      .eq('active', true);

    if (error) throw error;
    if (!keys || keys.length === 0) return null;

    const summaries = await Promise.all(
      keys.map(async (key) => {
        const usage = await getUsageSummary(key.id);
        return { ...key, usage };
      })
    );

    return summaries;
  } catch (err) {
    console.error('Failed to get user usage summary:', err.message);
    return null;
  }
}

module.exports = {
  TIER_LIMITS,
  getCurrentMonth,
  checkScanAllowance,
  countUserScansThisMonth,
  getOrCreateMonthlyUsage,
  incrementUsage,
  getUsageSummary,
  getUsageSummaryForUser,
};
