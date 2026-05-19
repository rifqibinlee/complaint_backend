/**
 * encryption.js — AES-256-CBC field-level encryption for PDPA compliance.
 *
 * ENCRYPTION_KEY in .env must be a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * HMAC_SECRET in .env must be a 64-char hex string.
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

function getKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string in .env');
  return Buffer.from(k, 'hex');
}

function getHmacSecret() {
  const s = process.env.HMAC_SECRET;
  if (!s || s.length !== 64) throw new Error('HMAC_SECRET must be a 64-char hex string in .env');
  return s;
}

/**
 * Encrypt a plaintext string.
 * Returns "ivHex:ciphertextHex".
 */
function encrypt(plaintext) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
  const enc    = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a value produced by encrypt().
 * Returns null if the value is already plain (legacy) or malformed.
 */
function decrypt(ciphertext) {
  try {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext; // legacy plain value
    const [ivHex, encHex] = ciphertext.split(':');
    const iv       = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
    const dec      = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return ciphertext; // return as-is if decryption fails (migration safety)
  }
}

/**
 * Deterministic HMAC-SHA256 of a value.
 * Used to look up IC numbers without storing them plaintext.
 */
function hmac(value) {
  return crypto.createHmac('sha256', getHmacSecret()).update(String(value)).digest('hex');
}

module.exports = { encrypt, decrypt, hmac };
