// HMAC-SHA-256 fingerprint for wallet addresses we've been asked to watch.
// We never store the raw address — only this hash. Lookups work by re-hashing
// whatever the user types, so the same input always maps to the same row.
//
// WALLET_HASH_SECRET must be set in env before Portfolio Shield will work.
// Rotating the secret invalidates every existing watch entry — treat as a key.

const crypto = require('crypto');

function getSecret() {
  return process.env.WALLET_HASH_SECRET || '';
}

function isConfigured() {
  return getSecret().length >= 32;
}

function normalize(address) {
  // EVM addresses are case-insensitive; Solana base58 is case-sensitive.
  // Lowercase only when it's a hex 0x... address.
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return address.toLowerCase();
  return address;
}

function hashWallet(address) {
  const secret = getSecret();
  if (!secret) throw new Error('WALLET_HASH_SECRET not set');
  return crypto.createHmac('sha256', secret).update(normalize(address)).digest('hex');
}

module.exports = { hashWallet, isConfigured };
