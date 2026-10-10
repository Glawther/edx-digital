/**
 * EDX Digital - Server Constants & Configurations
 * Standard MIME Types and Security Headers
 */

const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const WEBHOOK_FILE = path.join(DATA_DIR, 'webhook_leads.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

// Keep the policy in step with firebase.json, which serves the published site.
// Outside production the Firebase emulators (on this machine) are reachable too.
const DEV_CONNECT = process.env.NODE_ENV === 'production' ? '' : ' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*';
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.googleapis.com https://www.gstatic.com https://nexus-crm-yfof.onrender.com" + DEV_CONNECT + "; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY
};

module.exports = {
  PORT,
  ROOT_DIR,
  DATA_DIR,
  WEBHOOK_FILE,
  MIME_TYPES,
  SECURITY_HEADERS
};
