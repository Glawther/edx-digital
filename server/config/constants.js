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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

module.exports = {
  PORT,
  ROOT_DIR,
  DATA_DIR,
  WEBHOOK_FILE,
  MIME_TYPES,
  SECURITY_HEADERS
};
