const { getSupabase } = require('./database');

const FREE_TIER_SCANS = 100;
const OVERAGE_COST_PER_SCAN = 0.05;

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getOrCreateMonthlyUsage(apiKeyId) {
  const month = getCurrentMonth();
  const db = getSupabase();

  try {
    // Try to get existing record
    const { data, error } = await db
      .from('api_usage_monthly')
      .select('*')
      .eq('api_key_id', apiKeyId)
      .eq('month', month)
      .single();

    if (data) return data;

    // Create new record for this month
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

  const newCount = usage.scan_count + 1;
  const isOverage = newCount > FREE_TIER_SCANS;
  const newOverageCount = isOverage ? usage.overage_count + 1 : usage.overage_count;
  const newOverageCost = parseFloat((newOverageCount * OVERAGE_COST_PER_SCAN).toFixed(2));

  try {
    const { data, error } = await getSupabase()
      .from('api_usage_monthly')
      .update({
        scan_count: newCount,
        overage_count: newOverageCount,
        overage_cost: newOverageCost,
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
    return {
      month: getCurrentMonth(),
      scanCount: 0,
      freeRemaining: FREE_TIER_SCANS,
      overageCount: 0,
      overageCost: 0,
      billingStatus: 'free',
    };
  }

  const freeRemaining = Math.max(0, FREE_TIER_SCANS - usage.scan_count);
  const billingStatus = usage.scan_count <= FREE_TIER_SCANS ? 'free' : 'overage';

  return {
    month: usage.month,
    scanCount: usage.scan_count,
    freeRemaining,
    overageCount: usage.overage_count,
    overageCost: parseFloat(usage.overage_cost) || 0,
    billingStatus,
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
  FREE_TIER_SCANS,
  OVERAGE_COST_PER_SCAN,
  getCurrentMonth,
  getOrCreateMonthlyUsage,
  incrementUsage,
  getUsageSummary,
  getUsageSummaryForUser,
};
