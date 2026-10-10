/**
 * EDX Digital - Static File Controller
 * Serves static assets with MIME detection, caching policies and fallback routing.
 */

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, MIME_TYPES } = require('../config/constants');
const { sanitizePath } = require('../middleware/security');

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

  const ext = path.extname(safeFilePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(safeFilePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA Fallback to index.html for unknown client routes
        const indexPath = path.join(ROOT_DIR, 'index.html');
        fs.readFile(indexPath, (fallbackErr, fallbackContent) => {
          if (fallbackErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 - Arquivo não encontrado no EDX Digital');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(fallbackContent);
          }
        });
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
