/**
 * EDX Digital - Google identity for the billing server, without dependencies.
 *
 * Two jobs:
 *  - prove who is calling: verify the Firebase ID token the browser sends;
 *  - act as the project: turn the service account into an access token for Firestore.
 *
 * In production (Firebase Functions) the project's identity comes from the machine itself, so no
 * key file exists anywhere. Outside Google a service account key in FIREBASE_SERVICE_ACCOUNT does
 * the same job. In development the Firebase emulators can stand in for both (never in production).
 */

const crypto = require('crypto');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Running as a Firebase Function (Cloud Run sets this), not under the local emulator */
function onGoogleCloud() {
  return Boolean(process.env.K_SERVICE) && process.env.FUNCTIONS_EMULATOR !== 'true';
}

function projectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'nexuscrm-d8e13';
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || onGoogleCloud();
}

function authEmulatorHost() {
  return isProduction() ? null : (process.env.FIREBASE_AUTH_EMULATOR_HOST || null);
}

function firestoreEmulatorHost() {
  return isProduction() ? null : (process.env.FIRESTORE_EMULATOR_HOST || null);
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

// ---------------------------------------------------------------- ID token

let certCache = { certs: null, expiresAt: 0 };

async function loadGoogleCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Não foi possível obter as chaves públicas do Google.');
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = {
    certs: await res.json(),
    expiresAt: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000
  };
  return certCache.certs;
}

/**
 * Checks a Firebase ID token and returns its claims ({ uid, email, name }).
 * Throws when the token is missing, forged, expired or issued for another project.
 */
async function verifyIdToken(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new Error('Token ausente ou malformado.');
  }
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId()) throw new Error('Token emitido para outro projeto.');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Token sem usuário.');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Token expirado.');

  if (authEmulatorHost()) {
    // Emulator tokens are unsigned; accepted only outside production
    return { uid: payload.sub, email: payload.email || '', name: payload.name || '', emailVerified: payload.email_verified === true };
  }

  if (header.alg !== 'RS256' || !header.kid) throw new Error('Assinatura do token não suportada.');
  if (payload.iss !== `https://securetoken.google.com/${projectId()}`) throw new Error('Emissor do token inválido.');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Token com data inválida.');

  const certs = await loadGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('Chave do token desconhecida.');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(cert, Buffer.from(signatureB64, 'base64url'))) {
    throw new Error('Assinatura do token inválida.');
  }

  return { uid: payload.sub, email: payload.email || '', name: payload.name || '', emailVerified: payload.email_verified === true };
}

// ---------------------------------------------------------------- service account

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const account = JSON.parse(text);
    return account.client_email && account.private_key ? account : null;
  } catch {
    return null;
  }
}

let tokenCache = { token: null, expiresAt: 0 };

/**
 * Access token to call Firestore as the project (bypasses the security rules, like the Admin SDK)
 */
async function getAccessToken() {
  if (firestoreEmulatorHost()) return 'owner';
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;

  const account = loadServiceAccount();
  if (!account && onGoogleCloud()) return machineAccessToken();
  if (!account) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurada.');

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('O Google recusou a conta de serviço.');

  tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

// On Google's machines the function's own identity is handed out by the metadata server
async function machineAccessToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('Não foi possível obter a identidade do projeto.');
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 600) * 1000 };
  return tokenCache.token;
}

function isServiceAccountConfigured() {
  return Boolean(firestoreEmulatorHost() || loadServiceAccount() || onGoogleCloud());
}

module.exports = {
  onGoogleCloud,
  projectId,
  firestoreEmulatorHost,
  verifyIdToken,
  getAccessToken,
  isServiceAccountConfigured
};
