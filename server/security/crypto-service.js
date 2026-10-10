/**
 * Nexus CRM Enterprise - Cryptographic Suite
 * Standards: NIST SP 800-38D, RFC 7914, OWASP Cryptographic Storage Cheat Sheet
 * Algorithms: AES-256-GCM (Authenticated Encryption), Scrypt/Argon2id (Password Hash), HMAC-SHA256
 */

const crypto = require('crypto');

// Master Encryption Key (32 bytes / 256 bits), loaded from the environment. See config/secrets.js.
const { MASTER_KEY } = require('../config/secrets');

/**
 * 1. PASSWORD HASHING (Scrypt with Cryptographically Secure Dynamic Salt)
 * Parameters: N=32768 (Cost), r=8 (Block size), p=1 (Parallelism), keylen=64
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string' || plainPassword.length < 6) {
    throw new Error('A senha deve possuir no mínimo 6 caracteres.');
  }

  const salt = crypto.randomBytes(32);
  return new Promise((resolve, reject) => {
    crypto.scrypt(plainPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return reject(err);
      const hashString = `$scrypt$N=32768,r=8,p=1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
      resolve(hashString);
    });
  });
}

/**
 * Verifies a password against the stored Scrypt hash in constant time
 */
async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[1] !== 'scrypt') {
    return false;
  }

  const salt = Buffer.from(parts[3], 'hex');
  const expectedKey = Buffer.from(parts[4], 'hex');

  return new Promise((resolve) => {
    crypto.scrypt(plainPassword, salt, expectedKey.length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return resolve(false);
      // Constant-time comparison to prevent timing attacks
      if (derivedKey.length !== expectedKey.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, expectedKey));
    });
  });
}

/**
 * 2. FIELD-LEVEL DATA ENCRYPTION AT REST (AES-256-GCM)
 * Cryptographic binding with Additional Authenticated Data (AAD): tenantId
 * This prevents ciphertext transplantation attacks across tenants.
 */
function encryptField(plainText, tenantId = '') {
  if (plainText === null || plainText === undefined) return null;
  const text = typeof plainText === 'object' ? JSON.stringify(plainText) : String(plainText);

  // 96-bit (12 bytes) Initialization Vector as recommended by NIST SP 800-38D
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);

  // Bind tenantId as AAD if provided
  if (tenantId) {
    cipher.setAAD(Buffer.from(String(tenantId), 'utf8'));
  }

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypts AES-256-GCM ciphertext, verifying authenticity tag and tenant AAD
 */
function decryptField(encryptedPayload, tenantId = '') {
  if (!encryptedPayload || !encryptedPayload.ciphertext || !encryptedPayload.iv || !encryptedPayload.authTag) {
    return null;
  }

  try {
    const iv = Buffer.from(encryptedPayload.iv, 'hex');
    const authTag = Buffer.from(encryptedPayload.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);

    if (tenantId) {
      decipher.setAAD(Buffer.from(String(tenantId), 'utf8'));
    }

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedPayload.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Attempt JSON parse if it was structured
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  } catch (err) {
    // Authentication tag mismatch, wrong key, or cross-tenant transplantation attempt
    throw new Error('DECRYPTION_FAILED: Falha na validação de integridade ou autenticidade dos dados (Tríade CID).');
  }
}

/**
 * 3. WEBHOOK SIGNATURE VERIFICATION (HMAC-SHA256)
 * Validates that requests come exclusively from the official partner gateway
 */
function generateWebhookSignature(payloadBuffer, secretKey) {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(payloadBuffer);
  return hmac.digest('hex');
}

function verifyWebhookSignature(payloadBuffer, incomingSignature, secretKey) {
  if (!payloadBuffer || !incomingSignature || !secretKey) {
    return false;
  }

  const expectedSignature = generateWebhookSignature(payloadBuffer, secretKey);
  const sigBuffer = Buffer.from(incomingSignature, 'hex');
  const expBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expBuffer.length) {
    return false;
  }

  // Timing-safe comparison to prevent side-channel timing leaks
  return crypto.timingSafeEqual(sigBuffer, expBuffer);
}

/**
 * 4. LGPD / GDPR DATA MASKING UTILITIES
 */
function maskCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') return '';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return '***.***.***-**';
  return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***.***';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 8) return '****-****';
  return `(${clean.slice(0, 2)}) 9****-${clean.slice(-4)}`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  encryptField,
  decryptField,
  generateWebhookSignature,
  verifyWebhookSignature,
  maskCPF,
  maskEmail,
  maskPhone
};
