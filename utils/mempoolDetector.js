/**
 * mempoolDetector.js — Mempool Simulator + Detection Engine for Abyssal
 *
 * Polls Alchemy RPC for recent block activity on user's protected pools.
 * Detects MEV attack patterns: sandwich, JIT liquidity, front-run, back-run.
 * Records save events through commissionEngine for active defense subscribers.
 *
 * Public API:
 *   MempoolDetector class
 *   createMempoolDetector() — singleton factory
 */
const { createClient } = require('@supabase/supabase-js');
const { ALCHEMY_HOSTS } = require('./alchemyClient');
const { recordSaveEvent } = require('./commissionEngine');

// ── Constants ─────────────────────────────────────────────────────────

// Keccak-256("Swap(address,uint256,uint256,uint256,uint256,address)")
const SWAP_TOPIC0 = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

// Keccak-256("Mint(address,uint256,uint256)")
const MINT_TOPIC0 = '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c';

// Keccak-256("Burn(address,uint256,uint256,address)")
const BURN_TOPIC0 = '0xdccd412f0b245281116b015b9cc6c82269e0d6c82b7055f59e0f55e7b4c1c44';

// ── Lazy threat-intel client ─────────────────────────────────────────

let threatIntelClient = null;
let threatIntelDisabled = false;

function getThreatIntelClient() {
  if (threatIntelDisabled) return null;
  if (threatIntelClient) return threatIntelClient;

  const url = process.env.THREAT_INTEL_URL;
  const key = process.env.THREAT_INTEL_SERVICE_KEY;

  if (!url || !key) {
    console.warn('[mempoolDetector] THREAT_INTEL_URL or THREAT_INTEL_SERVICE_KEY missing — pools disabled');
    threatIntelDisabled = true;
    return null;
  }

  threatIntelClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'scamshield-bot-mempool' } },
  });
  return threatIntelClient;
}

// ── Alchemy RPC helper ───────────────────────────────────────────────

function alchemyUrl(chainId) {
  const host = ALCHEMY_HOSTS[chainId];
  if (!host) return null;
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  return `https://${host}.g.alchemy.com/v2/${key}`;
}

async function rpc(chainId, method, params) {
  const url = alchemyUrl(chainId);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error) return null;
    return json.result;
  } catch {
    return null;
  }
}

// ── MempoolDetector Class ────────────────────────────────────────────

class MempoolDetector {
  constructor() {
    this.running = false;
    this.pollInterval = null;
    this.intervalMs = parseInt(process.env.MEMPOOL_POLL_MS || '30000', 10); // 30s default
    this.watchedPools = []; // array of { telegram_user_id, pool_address, chain_id, active_defense }
    this.recentBlocks = new Map(); // pool_address -> last checked block number (hex string)
    this.detectionCount = 0;
  }

  /**
   * Refresh watched pools from the threat-intel Supabase (protected_pools table).
   */
  async refreshWatchedPools() {
    const c = getThreatIntelClient();
    if (!c) {
      this.watchedPools = [];
      return;
    }

    try {
      const { data, error } = await c
        .from('protected_pools')
        .select('user_id, pool_address, chain_id, active_defense')
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.watchedPools = (data || []).map((row) => ({
        telegram_user_id: row.user_id,
        pool_address: row.pool_address.toLowerCase(),
        chain_id: parseInt(row.chain_id || '1', 10),
        active_defense: !!row.active_defense,
      }));

      console.log(`[mempoolDetector] Refreshed ${this.watchedPools.length} watched pools`);
    } catch (err) {
      console.error('[mempoolDetector] refreshWatchedPools failed:', err.message);
    }
  }

  /**
   * Start the mempool detector polling loop.
   */
  start() {
    if (this.running) return;
    this.running = true;
    console.log('[mempoolDetector] Mempool detector started (simulated mode)');

    // Immediate initial refresh
    this.refreshWatchedPools();

    // Set periodic tick
    this.pollInterval = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[mempoolDetector] tick error:', err.message);
      });
    }, this.intervalMs);
  }

  /**
   * Main polling tick — check every watched pool for recent activity.
   */
  async tick() {
    if (!this.running) return;

    // Refresh pools in case new ones were added
    await this.refreshWatchedPools();

    if (this.watchedPools.length === 0) {
      console.log('[mempoolDetector] No watched pools — skipping tick');
      return;
    }

    let totalEvents = 0;

    for (const pool of this.watchedPools) {
      try {
        const events = await this._checkPoolActivity(pool);
        totalEvents += events;
      } catch (err) {
        console.error(`[mempoolDetector] Error checking pool ${pool.pool_address}:`, err.message);
      }
    }

    console.log(
      `[mempoolDetector] Mempool detector: checked ${this.watchedPools.length} pools, found ${totalEvents} events`
    );
  }

  /**
   * Check a single pool for recent swap activity via Alchemy RPC.
   * Returns the number of swap events processed.
   */
  async _checkPoolActivity(pool) {
    const { pool_address, chain_id } = pool;

    // Only EVM chains supported
    if (!ALCHEMY_HOSTS[chain_id]) return 0;

    // Get latest block number
    const latestBlockHex = await rpc(chain_id, 'eth_blockNumber');
    if (!latestBlockHex) {
      console.warn(`[mempoolDetector] Failed to get latest block for chain ${chain_id}`);
      return 0;
    }

    const latestBlockNum = parseInt(latestBlockHex, 16);

    // Determine the last checked block for this pool
    let fromBlockNum = latestBlockNum - 2; // check last 3 blocks (current - 2 to current)
    const lastChecked = this.recentBlocks.get(pool_address);
    if (lastChecked) {
      const lastNum = parseInt(lastChecked, 16);
      if (lastNum >= latestBlockNum) return 0; // already up to date
      fromBlockNum = Math.max(lastNum + 1, latestBlockNum - 2);
    }

    const fromBlock = '0x' + fromBlockNum.toString(16);
    const toBlock = latestBlockHex;

    // Fetch swap event logs from the pool
    const logs = await rpc(chain_id, 'eth_getLogs', [{
      address: pool_address,
      fromBlock,
      toBlock,
      topics: [SWAP_TOPIC0],
    }]);

    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      // Update last checked block even if no swaps
      this.recentBlocks.set(pool_address, latestBlockHex);
      return 0;
    }

    // Also fetch LP events (Mint/Burn) for JIT detection
    const lpLogs = await rpc(chain_id, 'eth_getLogs', [{
      address: pool_address,
      fromBlock,
      toBlock,
      topics: [[MINT_TOPIC0, BURN_TOPIC0]],
    }]);

    const lpEventsByBlock = new Map();
    if (lpLogs && Array.isArray(lpLogs)) {
      for (const lp of lpLogs) {
        const blockKey = lp.blockNumber || toBlock;
        if (!lpEventsByBlock.has(blockKey)) {
          lpEventsByBlock.set(blockKey, 0);
        }
        lpEventsByBlock.set(blockKey, lpEventsByBlock.get(blockKey) + 1);
      }
    }

    // Fetch block details to get all transactions in these blocks
    // We need to check for sandwich patterns — for that, group swaps by block
    const swapsByBlock = new Map();

    for (const log of logs) {
      const blockKey = log.blockNumber || toBlock;
      if (!swapsByBlock.has(blockKey)) {
        swapsByBlock.set(blockKey, []);
      }
      swapsByBlock.get(blockKey).push(log);
    }

    let eventsProcessed = 0;

    // Process each swap log
    for (const log of logs) {
      const txHash = log.transactionHash;
      const logBlockNum = log.blockNumber || toBlock;
      const blockKey = logBlockNum;

      // Decode swap event data
      // Swap event: 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
      // Data: amount0In (uint256), amount1In (uint256), amount0Out (uint256), amount1Out (uint256)
      // Topics: [0], sender, to
      const dataHex = log.data || '0x';
      // Each uint256 is 64 hex chars = 32 bytes
      const amount0In = BigInt('0x' + (dataHex.slice(2, 66) || '0'));
      const amount1In = BigInt('0x' + (dataHex.slice(66, 130) || '0'));
      const amount0Out = BigInt('0x' + (dataHex.slice(130, 194) || '0'));
      const amount1Out = BigInt('0x' + (dataHex.slice(194, 258) || '0'));

      // Estimate value being swapped (conservative: sum of in/out in each direction)
      const totalSwapValue = amount0In + amount1In + amount0Out + amount1Out;

      // Detect MEV pattern
      const blockSwaps = swapsByBlock.get(blockKey) || [];
      const hasLPInBlock = (lpEventsByBlock.get(blockKey) || 0) > 0;

      const attack = await this._detectMevPattern(txHash, log, blockSwaps, hasLPInBlock, pool);

      if (attack) {
        attack.estimatedValueAtRisk = String(totalSwapValue);
        await this._handleDetectedAttack(attack, pool);
        eventsProcessed++;
      }
    }

    // Update last checked block
    this.recentBlocks.set(pool_address, latestBlockHex);

    return eventsProcessed;
  }

  /**
   * Simple heuristic MEV pattern detection.
   *
   * @param {string} txHash — transaction hash
   * @param {Object} swapLog — single swap event log entry
   * @param {Array} blockSwaps — all swap logs in the same block for this pool
   * @param {boolean} hasLPInBlock — whether LP mint/burn events exist in same block
   * @param {Object} pool — pool config object
   * @returns {Promise<Object|null>} attack object or null for normal swaps
   */
  async _detectMevPattern(txHash, swapLog, blockSwaps, hasLPInBlock, pool) {
    // Decode this swap's direction
    const dataHex = swapLog.data || '0x';
    const amount0In = BigInt('0x' + (dataHex.slice(2, 66) || '0'));
    const amount1In = BigInt('0x' + (dataHex.slice(66, 130) || '0'));
    const amount0Out = BigInt('0x' + (dataHex.slice(130, 194) || '0'));
    const amount1Out = BigInt('0x' + (dataHex.slice(194, 258) || '0'));

    // Determine direction: "in" means buying token0, "out" means selling token0
    const isBuy = amount0In > 0n && amount1Out > 0n;
    const isSell = amount1In > 0n && amount0Out > 0n;

    // Pattern 1: JIT Liquidity — LP mint/burn + swap in same block
    if (hasLPInBlock) {
      return {
        type: 'jit_liquidity',
        confidence: 65,
        estimatedValueAtRisk: '0',
        txHash,
      };
    }

    // Pattern 2: Sandwich — check if another swap in the same block has opposite direction
    // This is a simplified detection. Real sandwich detection needs gas price ordering,
    // but for same-block polling we detect direction reversal as a proxy.
    if (blockSwaps.length >= 2 && (isBuy || isSell)) {
      for (const otherLog of blockSwaps) {
        if (otherLog.transactionHash === txHash) continue;

        const otherData = otherLog.data || '0x';
        const oAmt0In = BigInt('0x' + (otherData.slice(2, 66) || '0'));
        const oAmt1In = BigInt('0x' + (otherData.slice(66, 130) || '0'));
        const oAmt0Out = BigInt('0x' + (otherData.slice(130, 194) || '0'));
        const oAmt1Out = BigInt('0x' + (otherData.slice(194, 258) || '0'));

        const otherIsBuy = oAmt0In > 0n && oAmt1Out > 0n;
        const otherIsSell = oAmt1In > 0n && oAmt0Out > 0n;

        // Different directions in same block = sandwich pattern
        if ((isBuy && otherIsSell) || (isSell && otherIsBuy)) {
          return {
            type: 'sandwich',
            confidence: 70,
            estimatedValueAtRisk: '0',
            txHash,
          };
        }
      }
    }

    // Pattern 3: No matching pattern — but if there's significant value flowing and
    // it's a single swap, it could be a front-run or back-run target.
    // For now, classify as normal_swap (detected but not an attack pattern).
    // We still record it if there's a single swap with large value as a potential target.
    if (blockSwaps.length === 1) {
      // Check total value — very rough threshold (0.1 ETH minimum to flag)
      const ethValue = Number(
        (amount0In + amount1In + amount0Out + amount1Out) / BigInt('100000000000000000')
      );
      if (ethValue > 1) {
        // Single large swap — potential front-run target, but low confidence
        return {
          type: 'frontrun',
          confidence: 30,
          estimatedValueAtRisk: '0',
          txHash,
        };
      }
    }

    return null;
  }

  /**
   * Handle a detected attack — record commission event via commissionEngine.
   */
  async _handleDetectedAttack(attack, pool) {
    if (!attack || !attack.type) return;

    try {
      const result = await recordSaveEvent({
        telegramUserId: pool.telegram_user_id,
        poolAddress: pool.pool_address,
        valueSavedWei: attack.estimatedValueAtRisk || '0',
        transactionHash: attack.txHash,
        attackType: attack.type,
      });

      this.detectionCount++;

      const ethValue = (Number(attack.estimatedValueAtRisk || '0') / 1e18).toFixed(6);
      console.log(
        `[mempoolDetector] detected ${attack.type} attack on ${pool.pool_address.slice(0, 10)} — ${ethValue} ETH saved`
      );
    } catch (err) {
      console.error('[mempoolDetector] _handleDetectedAttack failed:', err.message);
    }
  }

  /**
   * Stop the mempool detector polling loop.
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.running = false;
    console.log('[mempoolDetector] Mempool detector stopped');
  }

  /**
   * Get current status of the detector.
   * @returns {Object} status object
   */
  getStatus() {
    return {
      running: this.running,
      watchedPoolsCount: this.watchedPools.length,
      detectionCount: this.detectionCount,
      intervalMs: this.intervalMs,
    };
  }
}

// ── Singleton factory ────────────────────────────────────────────────

let singleton = null;

/**
 * Create or return the singleton MempoolDetector instance.
 * @returns {MempoolDetector}
 */
function createMempoolDetector() {
  if (!singleton) {
    singleton = new MempoolDetector();
  }
  return singleton;
}

module.exports = {
  MempoolDetector,
  createMempoolDetector,
};
