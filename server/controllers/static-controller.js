/**
 * EDX Digital - Static files
 * Serves the site's public files and nothing else: the server's own code, its data
 * folder, configuration and dot-files are never handed out.
 */

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, MIME_TYPES } = require('../config/constants');
const { sanitizePath } = require('../middleware/security');

// What a browser is allowed to fetch. Anything not listed here answers 404.
const PUBLIC_FILES = new Set(['/index.html', '/landing.html', '/termos.html', '/privacidade.html', '/ajuda.html', '/manifest.json', '/sw.js']);
const PUBLIC_FOLDERS = ['/assets/', '/css/', '/js/'];
const PUBLIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.ico', '.woff2']);

function isPublic(urlPath) {
  if (urlPath.split('/').some(part => part.startsWith('.'))) return false;
  if (!PUBLIC_EXTENSIONS.has(path.extname(urlPath).toLowerCase())) return false;
  return PUBLIC_FILES.has(urlPath) || PUBLIC_FOLDERS.some(folder => urlPath.startsWith(folder));
}

function send(res, status, contentType, content, method) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, must-revalidate' });
  res.end(method === 'HEAD' ? undefined : content);
}

function sendApp(req, res) {
  fs.readFile(path.join(ROOT_DIR, 'index.html'), (err, content) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', 'Página não encontrada', req.method);
    send(res, 200, 'text/html; charset=utf-8', content, req.method);
  });
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} parsedUrl - the path, without the query string
 */
function handleStaticFile(req, res, parsedUrl) {
  let urlPath;
  try {
    urlPath = path.posix.normalize(decodeURIComponent(parsedUrl || '/'));
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', 'Endereço inválido', req.method);
  }
  if (urlPath === '/') urlPath = '/index.html';
  // Clean addresses: /landing, /termos, /privacidade
  if (!path.extname(urlPath) && PUBLIC_FILES.has(urlPath + '.html')) urlPath += '.html';

  if (!isPublic(urlPath)) {
    // A screen of the app (no extension) opens the app; a file that is not public does not exist
    return path.extname(urlPath) ? send(res, 404, 'text/plain; charset=utf-8', 'Página não encontrada', req.method) : sendApp(req, res);
  }

  const filePath = sanitizePath(urlPath);
  if (!filePath) return send(res, 404, 'text/plain; charset=utf-8', 'Página não encontrada', req.method);

  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', 'Página não encontrada', req.method);
    send(res, 200, MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', content, req.method);
  });
}

module.exports = { handleStaticFile, isPublic };
