/**
 * Nexus CRM - Static File Controller
 * Serves static assets with MIME detection, caching policies and fallback routing.
 */

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, MIME_TYPES } = require('../config/constants');
const { sanitizePath } = require('../middleware/security');

// Only the front-end is public. Everything else in the project folder (server source, data/,
// .env files, package.json, deploy scripts) must never be downloadable.
const PUBLIC_ROOT_FILES = new Set([
  'index.html',
  'landing.html',
  'termos.html',
  'privacidade.html',
  'manifest.json',
  'sw.js'
]);
const PUBLIC_DIRS = ['js/', 'css/', 'assets/'];

/**
 * Tells whether an absolute path inside ROOT_DIR belongs to the public front-end
 * @param {string} absolutePath
 * @returns {boolean}
 */
function isPublicFile(absolutePath) {
  const relative = path.relative(ROOT_DIR, absolutePath).split(path.sep).join('/');
  if (!relative || relative.split('/').some(segment => segment.startsWith('.'))) {
    return false;
  }
  return PUBLIC_ROOT_FILES.has(relative) || PUBLIC_DIRS.some(dir => relative.startsWith(dir));
}

function sendIndex(res) {
  fs.readFile(path.join(ROOT_DIR, 'index.html'), (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - Arquivo não encontrado no Nexus CRM');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(content);
  });
}

/**
 * Serves static files safely
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} parsedUrl
 */
function handleStaticFile(req, res, parsedUrl) {
  let relativePath = parsedUrl;
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  }

  // Clean URLs support: /landing -> /landing.html
  if (!path.extname(relativePath)) {
    const candidateHtml = relativePath + '.html';
    const safeCandidate = sanitizePath(candidateHtml);
    if (safeCandidate && fs.existsSync(safeCandidate)) {
      relativePath = candidateHtml;
    }
  }

  const safeFilePath = sanitizePath(relativePath);

  if (!safeFilePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 - Acesso Negado (Proteção Tríade CID)');
    return;
  }

  if (!isPublicFile(safeFilePath)) {
    // A path without extension that matches nothing on disk is a client-side route: the SPA handles it.
    // Dotfiles and real private files or folders (Dockerfile, server/, data/) are never routes.
    const isHidden = path.relative(ROOT_DIR, safeFilePath).split(path.sep).some(segment => segment.startsWith('.'));
    if (!isHidden && !path.extname(safeFilePath) && !fs.existsSync(safeFilePath)) {
      return sendIndex(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Arquivo não encontrado no Nexus CRM');
    return;
  }

  const ext = path.extname(safeFilePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(safeFilePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA Fallback to index.html for unknown client routes
        sendIndex(res);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 - Erro no servidor: ${err.code}`);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    }
  });
}

module.exports = {
  handleStaticFile
};
