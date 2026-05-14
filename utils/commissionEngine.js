/**
 * commissionEngine.js — Core revenue pipeline for Abyssal Active Defense.
 *
 * Records 17% commission on verified value saved, tracks balances,
 * and manages invoicing lifecycle.
 *
 * Public API:
 *   recordSaveEvent({ telegramUserId, poolAddress, valueSavedWei, transactionHash, attackType })
 *   getCommissionBalance(telegramUserId)
 *   getCommissionHistory(telegramUserId, limit)
 *   createInvoiceForUser(telegramUserId)
 *   markInvoicePaid(batchId)
 */

const { getSupabase } = require('../database');
const { getSubscriberTier } = require('../billing');

const COMMISSION_RATE = 0.17;
const COMMISSION_NUMERATOR = 17n;
const COMMISSION_DENOMINATOR = 100n;

/**
 * Record a save event — calculate 17% commission and insert into commission_transactions.
 * Only records if user is on Abyssal Active Defense tier.
 *
 * @param {Object} opts
 * @param {number} opts.telegramUserId
 * @param {string} opts.poolAddress          — EVM pool address
 * @param {string} opts.valueSavedWei        — raw wei value saved (decimal string)
 * @param {string} [opts.transactionHash]    — on-chain TX hash, if available
 * @param {string} [opts.attackType]         — 'sandwich'|'jit_liquidity'|'frontrun'|'backrun'|'unknown'
 * @returns {Promise<Object|null>} { id, commissionWei, valueSavedWei, rate } or null if skipped
 */
async function recordSaveEvent({ telegramUserId, poolAddress, valueSavedWei, transactionHash, attackType }) {
  try {
    // Only record for active Abyssal subscribers
    const sub = await getSubscriberTier(telegramUserId);
    if (sub.tier !== 'abyssal_active') {
      return null;
    }

    // Calculate 17% commission using BigInt math
    const valueWei = BigInt(valueSavedWei);
    const commissionWei = (valueWei * COMMISSION_NUMERATOR) / COMMISSION_DENOMINATOR;

    const { data, error } = await getSupabase()
      .from('commission_transactions')
      .insert({
        telegram_user_id: telegramUserId,
        pool_address: poolAddress.toLowerCase(),
        value_saved_wei: String(valueWei),
        commission_wei: String(commissionWei),
        commission_rate: COMMISSION_RATE,
        transaction_hash: transactionHash || null,
        attack_type: attackType || 'unknown',
        status: 'pending',
      })
      .select('id, commission_wei, value_saved_wei, commission_rate')
      .single();

    if (error) throw error;

    return {
      id: data.id,
      commissionWei: data.commission_wei,
      valueSavedWei: data.value_saved_wei,
      rate: data.commission_rate,
    };
  } catch (err) {
    console.error('[commissionEngine] recordSaveEvent failed:', err.message);
    return null;
  }
}

/**
 * Get aggregated commission balance for a user, grouped by status.
 *
 * @param {number} telegramUserId
 * @returns {Promise<Object>} {
 *   pending: { count, totalWei },
 *   invoiced: { count, totalWei },
 *   paid: { count, totalWei },
 *   totalAllTime: { count, totalWei }
 * }
 */
async function getCommissionBalance(telegramUserId) {
  const result = {
    pending: { count: 0, totalWei: '0' },
    invoiced: { count: 0, totalWei: '0' },
    paid: { count: 0, totalWei: '0' },
    totalAllTime: { count: 0, totalWei: '0' },
  };

  try {
    const { data, error } = await getSupabase()
      .from('commission_transactions')
      .select('status, commission_wei')
      .eq('telegram_user_id', telegramUserId);

    if (error) throw error;

    if (!data || data.length === 0) return result;

    const totals = { pending: [], invoiced: [], paid: [] };

    for (const row of data) {
      if (totals[row.status]) {
        totals[row.status].push(BigInt(row.commission_wei));
      }
    }

    let allWei = 0n;

    for (const [status, weis] of Object.entries(totals)) {
      if (weis.length === 0) continue;
      const sum = weis.reduce((a, b) => a + b, 0n);
      allWei += sum;
      result[status] = {
        count: weis.length,
        totalWei: String(sum),
      };
    }

    result.totalAllTime = {
      count: data.length,
      totalWei: String(allWei),
    };

    return result;
  } catch (err) {
    console.error('[commissionEngine] getCommissionBalance failed:', err.message);
    return result;
  }
}

/**
 * Format wei value to ETH with 6 decimal places.
 * @param {string} wei
 * @returns {string}
 */
function weiToEth(wei) {
  return (Number(wei) / 1e18).toFixed(6);
}

/**
 * Get recent commission transaction history for a user.
 *
 * @param {number} telegramUserId
 * @param {number} [limit=20]
 * @returns {Promise<Array<Object>>} Array of formatted transaction objects
 */
async function getCommissionHistory(telegramUserId, limit = 20) {
  try {
    const { data, error } = await getSupabase()
      .from('commission_transactions')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => {
      const shortPool = row.pool_address
        ? row.pool_address.slice(0, 6) + '...' + row.pool_address.slice(-4)
        : 'unknown';

      return {
        id: row.id,
        shortPool,
        poolAddress: row.pool_address,
        valueSavedEth: weiToEth(row.value_saved_wei),
        commissionEth: weiToEth(row.commission_wei),
        commissionWei: row.commission_wei,
        valueSavedWei: row.value_saved_wei,
        status: row.status,
        attackType: row.attack_type || 'unknown',
        date: row.created_at ? new Date(row.created_at).toLocaleDateString() : 'unknown',
        invoiceId: row.invoice_id,
        paidAt: row.paid_at,
      };
    });
  } catch (err) {
    console.error('[commissionEngine] getCommissionHistory failed:', err.message);
    return [];
  }
}

/**
 * Create a soft invoice — mark all pending commission transactions
 * for a user as 'invoiced' with a timestamp-based batch ID.
 *
 * Real Stripe billing requires an ETH/USD price feed (coming in Phase 3).
 * For now we create batch invoices for tracking purposes.
 *
 * @param {number} telegramUserId
 * @returns {Promise<Object|null>} { batchId, count, totalCommissionWei } or null if nothing pending
 */
async function createInvoiceForUser(telegramUserId) {
  try {
    // Get all pending transactions for this user
    const { data: pending, error: fetchError } = await getSupabase()
      .from('commission_transactions')
      .select('id, commission_wei')
      .eq('telegram_user_id', telegramUserId)
      .eq('status', 'pending');

    if (fetchError) throw fetchError;

    if (!pending || pending.length === 0) return null;

    // Create a batch ID (timestamp-based)
    const batchId = `inv_batch_${Date.now()}_${telegramUserId}`;

    // Sum total commission
    const totalCommissionWei = pending
      .reduce((sum, row) => sum + BigInt(row.commission_wei), 0n);

    // Mark all as invoiced
    const { error: updateError } = await getSupabase()
      .from('commission_transactions')
      .update({
        status: 'invoiced',
        invoice_id: batchId,
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', telegramUserId)
      .eq('status', 'pending');

    if (updateError) throw updateError;

    return {
      batchId,
      count: pending.length,
      totalCommissionWei: String(totalCommissionWei),
    };
  } catch (err) {
    console.error('[commissionEngine] createInvoiceForUser failed:', err.message);
    return null;
  }
}

/**
 * Mark all transactions with a given batch ID as paid.
 *
 * @param {string} batchId
 * @returns {Promise<boolean>}
 */
async function markInvoicePaid(batchId) {
  try {
    const now = new Date().toISOString();

    const { error } = await getSupabase()
      .from('commission_transactions')
      .update({
        status: 'paid',
        paid_at: now,
        updated_at: now,
      })
      .eq('invoice_id', batchId)
      .eq('status', 'invoiced');

    if (error) throw error;

    return true;
  } catch (err) {
    console.error('[commissionEngine] markInvoicePaid failed:', err.message);
    return false;
  }
}

module.exports = {
  recordSaveEvent,
  getCommissionBalance,
  getCommissionHistory,
  createInvoiceForUser,
  markInvoicePaid,
  COMMISSION_RATE,
};
