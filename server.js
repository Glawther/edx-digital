/**
 * EDX Digital - Server
 * Three jobs: PIX billing, the inbox for leads sent by forms, and serving the site's public files.
 */

const http = require('http');
const { PORT } = require('./server/config/constants');
const { initStorage } = require('./server/services/lead-storage');
const { applySecurityHeaders } = require('./server/middleware/security');
const {
  handleIngestLead,
  handleGetLeads,
  handleAcknowledgeLeads
} = require('./server/controllers/webhook-controller');
const { handleStaticFile } = require('./server/controllers/static-controller');
const { handleBilling } = require('./server/billing/billing-controller');

initStorage();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = (req.url || '/').split('?')[0];

  if (parsedUrl.startsWith('/api/billing/')) {
    return handleBilling(req, res, parsedUrl);
  }

  if (parsedUrl === '/api/webhook/leads' && req.method === 'POST') {
    return handleIngestLead(req, res);
  }
  if (parsedUrl === '/api/webhook/leads' && req.method === 'GET') {
    return handleGetLeads(req, res);
  }
  if (parsedUrl === '/api/webhook/leads/ack' && req.method === 'POST') {
    return handleAcknowledgeLeads(req, res);
  }

  if (parsedUrl === '/health') {
    return sendJson(res, 200, { status: 'healthy' });
  }

  // Nothing else answers under /api (the older /api/v1 was removed: the app never used it)
  if (parsedUrl.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'not_found' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }
  handleStaticFile(req, res, parsedUrl);
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
