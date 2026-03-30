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

module.exports = {
  insertScamReport,
  getScamReportsByUser,
  getReportStats,
  getSignaturesByPattern,
  insertSignature,
  matchSignatures,
  insertUserSubmission,
  markSubmissionHelpful,
  getSubmissionsByUser,
};
