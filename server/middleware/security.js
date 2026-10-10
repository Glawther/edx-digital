/**
 * EDX Digital - Security & CORS Middleware
 * Enforces OWASP standards and prevents Path Traversal attacks.
 */

const path = require('path');
const { ROOT_DIR, SECURITY_HEADERS } = require('../config/constants');

/**
 * Applies security and CORS headers to the response
 * @param {import('http').ServerResponse} res 
 */
function applySecurityHeaders(res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-webhook-token, x-signature-256, x-tenant-id, x-hub-signature-256');

  // OWASP Security Headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * Validates whether a requested path is safe from Directory Traversal attacks
 * @param {string} relativePath 
 * @returns {string|null} Safe absolute path or null if unsafe
 */
function sanitizePath(relativePath) {
  try {
    const safeRelative = path.normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.resolve(ROOT_DIR, safeRelative.startsWith(path.sep) ? safeRelative.slice(1) : safeRelative);

    // Guard: Prevent accessing files outside ROOT_DIR
    if (!absolutePath.startsWith(ROOT_DIR)) {
      console.warn(`[Security Alert] Blocked Path Traversal attempt: ${relativePath}`);
      return null;
    }

    return absolutePath;
  } catch (err) {
    console.warn(`[Security Alert] Error sanitizing path ${relativePath}:`, err);
    return null;
  }
}

module.exports = {
  applySecurityHeaders,
  sanitizePath
};
