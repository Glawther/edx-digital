/**
 * EDX Digital - The server's routes
 * PIX billing and the inbox for leads sent by forms. The same routes answer in two places:
 * in Firebase Functions (cloud.js), which is what runs in production, and in server.js,
 * which serves the site on the developer's own machine.
 */

const { applySecurityHeaders } = require('./middleware/security');
const {
  handleIngestLead,
  handleGetLeads,
  handleAcknowledgeLeads
} = require('./controllers/webhook-controller');
const { handleBilling } = require('./billing/billing-controller');
const { handleErrorReport } = require('./controllers/error-controller');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Answers the request when it is for one of the server's routes.
 * @returns {boolean} false when the address is not under /api (nor /health): the caller decides what to do
 */
function handleApi(req, res) {
  const pathname = (req.url || '/').split('?')[0];
  if (!pathname.startsWith('/api/') && pathname !== '/health') return false;

  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname.startsWith('/api/billing/')) {
    handleBilling(req, res, pathname);
  } else if (pathname === '/api/webhook/leads' && req.method === 'POST') {
    handleIngestLead(req, res);
  } else if (pathname === '/api/webhook/leads' && req.method === 'GET') {
    handleGetLeads(req, res);
  } else if (pathname === '/api/webhook/leads/ack' && req.method === 'POST') {
    handleAcknowledgeLeads(req, res);
  } else if (pathname === '/api/errors' && req.method === 'POST') {
    handleErrorReport(req, res);
  } else if (pathname === '/health' || pathname === '/api/health') {
    sendJson(res, 200, { status: 'healthy' });
  } else {
    // Nothing else answers under /api (the older /api/v1 was removed: the app never used it)
    sendJson(res, 404, { error: 'not_found' });
  }
  return true;
}

module.exports = { handleApi, sendJson };
