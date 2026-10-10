/**
 * EDX Digital - Server for the developer's own machine
 * Serves the site's public files and answers the same routes that run in Firebase Functions
 * in production (server/api.js): PIX billing and the inbox for leads sent by forms.
 */

const http = require('http');
const { PORT } = require('./server/config/constants');
const { applySecurityHeaders } = require('./server/middleware/security');
const { handleStaticFile } = require('./server/controllers/static-controller');
const { handleApi, sendJson } = require('./server/api');

const server = http.createServer((req, res) => {
  if (handleApi(req, res)) return;

  applySecurityHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }
  handleStaticFile(req, res, (req.url || '/').split('?')[0]);
});

// A connection that sends its request too slowly is dropped instead of being held open
server.headersTimeout = 20000;
server.requestTimeout = 30000;

// Loaded by the tests without opening a port
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`EDX Digital no ar em http://localhost:${PORT}`);
  });
}

module.exports = server;
