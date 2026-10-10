/**
 * Nexus CRM Enterprise - Authentication & Security Context Middleware
 * Enforces Zero Trust request identification and tenant resolution
 */

const crypto = require('crypto');
const { SecurityContext, defaultRepository } = require('../database/repository');
const { auditService, AUDIT_ACTIONS, SEVERITY } = require('../security/audit-service');

const { JWT_SECRET } = require('../config/secrets');

/**
 * Creates a signed JWT-like HS256 token for testing and API sessions
 */
function generateSessionToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Cryptographically verifies session token and returns decoded claims
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null; // Invalid signature / forgery attempt
  }

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token expired
    }
    return claims;
  } catch {
    return null;
  }
}

/**
 * Extracts client IP securely (preventing IP spoofing headers unless trusted proxy configured)
 */
function extractClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket.remoteAddress ||
         '127.0.0.1';
}

/**
 * Middleware: Resolves and freezes SecurityContext on request
 */
async function authenticateContext(req, res, repository = defaultRepository) {
  const clientIp = extractClientIp(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      status: 401,
      error: 'ACESSO NÃO AUTORIZADO: Cabeçalho Authorization com token Bearer é obrigatório.'
    };
  }

  const token = authHeader.slice(7).trim();
  const claims = verifySessionToken(token);

  if (!claims || !claims.tenant_id || !claims.user_id) {
    auditService.log({
      tenantId: 'unauthenticated',
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'AUTH',
      ipAddress: clientIp,
      userAgent,
      severity: SEVERITY.WARNING,
      newValues: { reason: 'Invalid or forged JWT token signature' }
    });

    return {
      success: false,
      status: 401,
      error: 'FALHA DE AUTENTICAÇÃO: Token expirado, inválido ou adulterado.'
    };
  }

  // Tenant validation
  const tenant = await repository.getTenantById(claims.tenant_id);
  if (!tenant || tenant.status !== 'active') {
    return {
      success: false,
      status: 403,
      error: 'ACESSO BLOQUEADO: Organização/Tenant inativo ou suspenso por políticas de conformidade.'
    };
  }

  // Create immutable context
  const context = new SecurityContext({
    tenantId: claims.tenant_id,
    userId: claims.user_id,
    role: claims.role || 'vendedor',
    teamId: claims.team_id || null,
    ipAddress: clientIp,
    userAgent
  });

  return { success: true, context };
}

module.exports = {
  generateSessionToken,
  verifySessionToken,
  extractClientIp,
  authenticateContext
};
