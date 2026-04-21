const { getSupabase } = require('./database');
const { getSubscriberTier } = require('./billing');

const TIER_LIMITS = {
  pro: 1000,
  unlimited: Infinity,
};

// Free tier — harvest intel, upsell hard.
const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '3', 10);

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
 * Read today's free scan count for a user. No increment.
 * Returns 0 on error (fail-open for the read path).
 */
async function getFreeScanCountToday(telegramUserId) {
  try {
    const { data, error } = await getSupabase().rpc('get_free_scan_count', {
      p_user_id: telegramUserId,
    });
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  } catch (err) {
    console.error('[metering] get_free_scan_count failed:', err.message);
    return 0;
  }
}

/**
 * Read referral stats for a user: current bonus balance + total referrals made.
 */
async function getReferralStats(telegramUserId) {
  try {
    const { data, error } = await getSupabase().rpc('get_referral_stats', {
      p_user: telegramUserId,
    });
    if (error) throw error;
    return {
      balance: (data && data.balance) || 0,
      referrals: (data && data.referrals) || 0,
    };
  } catch (err) {
    console.error('[metering] get_referral_stats failed:', err.message);
    return { balance: 0, referrals: 0 };
  }
}

/**
 * Grant a referrer +bonus scans for referring a new user. Idempotent on referred_id.
 * Returns { credited, already_referred, new_balance }.
 */
async function grantReferralBonus(referrerId, referredId, bonus = 5) {
  try {
    const { data, error } = await getSupabase().rpc('grant_referral_bonus', {
      p_referrer: referrerId,
      p_referred: referredId,
      p_bonus: bonus,
    });
    if (error) throw error;
    return data || { credited: false };
  } catch (err) {
    console.error('[metering] grant_referral_bonus failed:', err.message);
    return { credited: false, error: err.message };
  }
}

/**
 * Atomically consume 1 bonus scan. Returns new balance, or null if user had none.
 */
async function consumeBonusScan(telegramUserId) {
  try {
    const { data, error } = await getSupabase().rpc('consume_bonus_scan', {
      p_user: telegramUserId,
    });
    if (error) throw error;
    return typeof data === 'number' ? data : null;
  } catch (err) {
    console.error('[metering] consume_bonus_scan failed:', err.message);
    return null;
  }
}

/**
 * Atomically increment today's free scan count. Returns new count.
 * Called AFTER a successful scan for free-tier users.
 */
async function bumpFreeScanUsage(telegramUserId) {
  try {
    const { data, error } = await getSupabase().rpc('bump_free_scan_usage', {
      p_user_id: telegramUserId,
    });
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  } catch (err) {
    console.error('[metering] bump_free_scan_usage failed:', err.message);
    return 0;
  }
}

/**
 * Check whether a user is allowed to scan.
 *
 * Tier precedence:
 *   1. Subscribed (active/trialing) → existing pro/unlimited limits
 *   2. Non-subscriber → free tier: FREE_DAILY_LIMIT (default 3) Claude scans/UTC-day
 *
 * Returns { allowed, reason?, tier, status, used?, limit?, isFree? }
 * When isFree=true, caller MUST call bumpFreeScanUsage() after a successful scan.
 */
async function checkScanAllowance(telegramUserId) {
  const sub = await getSubscriberTier(telegramUserId);
  const subscribed = sub.status === 'active' || sub.status === 'trialing';

  // Path 1: paid subscriber
  if (subscribed) {
    const limit = TIER_LIMITS[sub.tier];
    if (limit === undefined) {
      // Subscribed but unknown tier — fall through to free tier below.
    } else if (limit === Infinity) {
      return { allowed: true, tier: sub.tier, status: sub.status, isFree: false };
    } else {
      const used = await countUserScansThisMonth(telegramUserId);
      if (used >= limit) {
        return { allowed: false, reason: 'limit_exceeded', tier: sub.tier, status: sub.status, used, limit, isFree: false };
      }
      return { allowed: true, tier: sub.tier, status: sub.status, used, limit, isFree: false };
    }
  }

  // Path 2: free tier — harvest + upsell
  const freeUsed = await getFreeScanCountToday(telegramUserId);
  if (freeUsed < FREE_DAILY_LIMIT) {
    return {
      allowed: true,
      tier: 'free',
      status: sub.status,
      used: freeUsed,
      limit: FREE_DAILY_LIMIT,
      isFree: true,
      isBonus: false,
    };
  }

  // Path 3: free exhausted — try bonus balance from referrals
  const stats = await getReferralStats(telegramUserId);
  if (stats.balance > 0) {
    return {
      allowed: true,
      tier: 'free',
      status: sub.status,
      used: freeUsed,
      limit: FREE_DAILY_LIMIT,
      bonusBalance: stats.balance,
      isFree: true,
      isBonus: true,
    };
  }

  return {
    allowed: false,
    reason: 'free_limit_exceeded',
    tier: 'free',
    status: sub.status,
    used: freeUsed,
    limit: FREE_DAILY_LIMIT,
    bonusBalance: 0,
    isFree: true,
    isBonus: false,
  };
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
  FREE_DAILY_LIMIT,
  getCurrentMonth,
  checkScanAllowance,
  countUserScansThisMonth,
  getOrCreateMonthlyUsage,
  incrementUsage,
  getUsageSummary,
  getUsageSummaryForUser,
  getFreeScanCountToday,
  bumpFreeScanUsage,
  getReferralStats,
  grantReferralBonus,
  consumeBonusScan,
};
