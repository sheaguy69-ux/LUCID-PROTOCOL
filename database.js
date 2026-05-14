const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return supabase;
}

// --- Scam Reports ---

async function insertScamReport({ telegramUserId, content, contentType, riskScore, confidence, flags, reasoning, verified = false }) {
  try {
    const { data, error } = await getSupabase()
      .from('scam_reports')
      .insert({
        telegram_user_id: telegramUserId,
        content,
        content_type: contentType,
        risk_score: riskScore,
        confidence,
        flags: flags || [],
        reasoning,
        verified,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to insert scam report:', err.message);
    return null;
  }
}

async function getScamReportsByUser(telegramUserId, limit = 10) {
  try {
    const { data, error } = await getSupabase()
      .from('scam_reports')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to get scam reports:', err.message);
    return [];
  }
}

async function getReportStats() {
  try {
    const db = getSupabase();

    const [scansResult, reportsResult, highRiskResult] = await Promise.all([
      db.from('scam_reports').select('id', { count: 'exact', head: true }),
      db.from('scam_reports').select('id', { count: 'exact', head: true }).eq('verified', false),
      db.from('scam_reports').select('id', { count: 'exact', head: true }).gte('risk_score', 7),
    ]);

    return {
      totalScans: scansResult.count || 0,
      communityReports: reportsResult.count || 0,
      highRiskDetected: highRiskResult.count || 0,
    };
  } catch (err) {
    console.error('Failed to get report stats:', err.message);
    return { totalScans: 0, communityReports: 0, highRiskDetected: 0 };
  }
}

// --- Scam Signatures ---

async function getSignaturesByPattern(patternType) {
  try {
    const { data, error } = await getSupabase()
      .from('scam_signatures')
      .select('*')
      .eq('pattern_type', patternType);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to get signatures:', err.message);
    return [];
  }
}

async function insertSignature({ patternType, pattern, severity, sources }) {
  try {
    const { data, error } = await getSupabase()
      .from('scam_signatures')
      .insert({
        pattern_type: patternType,
        pattern,
        severity,
        sources: sources || [],
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to insert signature:', err.message);
    return null;
  }
}

async function matchSignatures(content) {
  try {
    const signatures = await getSupabase()
      .from('scam_signatures')
      .select('*');

    if (signatures.error) throw signatures.error;

    const matches = (signatures.data || []).filter((sig) => {
      const lower = content.toLowerCase();
      return lower.includes(sig.pattern.toLowerCase());
    });

    return matches;
  } catch (err) {
    console.error('Failed to match signatures:', err.message);
    return [];
  }
}

// --- User Submissions ---

async function insertUserSubmission({ telegramUserId, query, result }) {
  try {
    const { data, error } = await getSupabase()
      .from('user_submissions')
      .insert({
        telegram_user_id: telegramUserId,
        query,
        result,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to insert user submission:', err.message);
    return null;
  }
}

async function markSubmissionHelpful(submissionId, helpful) {
  try {
    const { data, error } = await getSupabase()
      .from('user_submissions')
      .update({ helpful })
      .eq('id', submissionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to mark submission helpful:', err.message);
    return null;
  }
}

async function getSubmissionsByUser(telegramUserId, limit = 10) {
  try {
    const { data, error } = await getSupabase()
      .from('user_submissions')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to get submissions:', err.message);
    return [];
  }
}

// --- Portfolio Shield: tracked wallets ---
// Raw addresses NEVER hit the database. We HMAC them with WALLET_HASH_SECRET
// before INSERT and re-hash on lookup, so a DB dump leaks nothing usable.

const { hashWallet } = require('./utils/walletHash');

async function addTrackedWallet({ telegramUserId, address, chain, label = null }) {
  try {
    const { data, error } = await getSupabase()
      .from('tracked_wallets')
      .upsert(
        { telegram_user_id: telegramUserId, address_hash: hashWallet(address), chain, label },
        { onConflict: 'telegram_user_id,address_hash,chain' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to add tracked wallet:', err.message);
    return null;
  }
}

async function removeTrackedWallet({ telegramUserId, address, chain = null }) {
  try {
    let q = getSupabase()
      .from('tracked_wallets')
      .delete()
      .eq('telegram_user_id', telegramUserId)
      .eq('address_hash', hashWallet(address));
    if (chain) q = q.eq('chain', chain);
    const { error, count } = await q.select('*', { count: 'exact' });
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('Failed to remove tracked wallet:', err.message);
    return 0;
  }
}

async function listTrackedWallets(telegramUserId) {
  try {
    const { data, error } = await getSupabase()
      .from('tracked_wallets')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .order('added_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to list tracked wallets:', err.message);
    return [];
  }
}

async function countTrackedWallets(telegramUserId) {
  try {
    const { count, error } = await getSupabase()
      .from('tracked_wallets')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_user_id', telegramUserId);
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('Failed to count tracked wallets:', err.message);
    return 0;
  }
}

async function updateTrackedWalletScan({ id, riskSummary }) {
  try {
    const { error } = await getSupabase()
      .from('tracked_wallets')
      .update({
        last_scanned_at: new Date().toISOString(),
        last_risk_summary: riskSummary,
      })
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Failed to update tracked wallet scan:', err.message);
    return false;
  }
}

// --- Account deletion (GDPR / privacy-policy commitment) ---
// Walks every table that holds telegram_user_id and removes the user's rows.
// Returns a per-table count so the operator can verify what was deleted.

async function deleteUserData(telegramUserId) {
  const sb = getSupabase();
  const result = { telegramUserId, tables: {}, errors: [] };

  // api_scans + api_usage_monthly reference api_keys(id). Delete dependents first.
  try {
    const { data: keys } = await sb
      .from('api_keys')
      .select('id')
      .eq('telegram_user_id', telegramUserId);
    const keyIds = (keys || []).map((k) => k.id);
    if (keyIds.length > 0) {
      const { count: scanCount, error: scanErr } = await sb
        .from('api_scans')
        .delete({ count: 'exact' })
        .in('api_key_id', keyIds);
      if (scanErr) result.errors.push({ table: 'api_scans', message: scanErr.message });
      else result.tables.api_scans = scanCount || 0;

      const { count: usageCount, error: usageErr } = await sb
        .from('api_usage_monthly')
        .delete({ count: 'exact' })
        .in('api_key_id', keyIds);
      if (usageErr) result.errors.push({ table: 'api_usage_monthly', message: usageErr.message });
      else result.tables.api_usage_monthly = usageCount || 0;
    } else {
      result.tables.api_scans = 0;
      result.tables.api_usage_monthly = 0;
    }
  } catch (err) {
    result.errors.push({ table: 'api_keys (lookup)', message: err.message });
  }

  const userScopedTables = [
    'api_keys',
    'subscribers',
    'scam_reports',
    'user_submissions',
    'tracked_wallets',
    'free_scan_usage',
  ];

  for (const table of userScopedTables) {
    try {
      const { count, error } = await sb
        .from(table)
        .delete({ count: 'exact' })
        .eq('telegram_user_id', telegramUserId);
      if (error) result.errors.push({ table, message: error.message });
      else result.tables[table] = count || 0;
    } catch (err) {
      result.errors.push({ table, message: err.message });
    }
  }

  return result;
}

module.exports = {
  getSupabase,
  insertScamReport,
  getScamReportsByUser,
  getReportStats,
  getSignaturesByPattern,
  insertSignature,
  matchSignatures,
  insertUserSubmission,
  markSubmissionHelpful,
  getSubmissionsByUser,
  addTrackedWallet,
  removeTrackedWallet,
  listTrackedWallets,
  countTrackedWallets,
  updateTrackedWalletScan,
  deleteUserData,
};
