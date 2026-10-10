/**
 * Nexus CRM - Enterprise Server Entrypoint
 * Architecture: Clean Modular Server with CID Triad Security & OWASP Guards
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
const { handleApiV1 } = require('./server/routes/api-v1');
const { handleBilling } = require('./server/billing/billing-controller');

// Initialize local storage files & directories
initStorage();

const server = http.createServer((req, res) => {
  // Apply Security Headers & CORS
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = (req.url || '/').split('?')[0];

  // Zero Trust API v1 (Multitenant, RBAC, DLP, Audit, Crypto)
  if (parsedUrl.startsWith('/api/v1/')) {
    return handleApiV1(req, res, parsedUrl);
  }

  // Subscription billing by PIX
  if (parsedUrl.startsWith('/api/billing/')) {
    return handleBilling(req, res, parsedUrl);
  }

  // Legacy Webhook Routes
  if (parsedUrl === '/api/webhook/leads' && req.method === 'POST') {
    return handleIngestLead(req, res);
  }
  if (parsedUrl === '/api/webhook/leads' && req.method === 'GET') {
    return handleGetLeads(req, res);
  }
  if (parsedUrl === '/api/webhook/leads/ack' && req.method === 'POST') {
    return handleAcknowledgeLeads(req, res);
  }

  // Healthcheck endpoint
  if (parsedUrl === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', version: '2.0.0', timestamp: new Date().toISOString() }));
    return;
  }

  // Static File Serving
  handleStaticFile(req, res, parsedUrl);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Nexus CRM Enterprise Server Online!`);
  console.log(`📡 URL Local: http://localhost:${PORT}`);
  console.log(`⚡ Endpoint Webhook: http://localhost:${PORT}/api/webhook/leads`);
  console.log(`🌐 Landing Page: http://localhost:${PORT}/landing`);
  console.log(`🛡️ Segurança: Tríade CID, OWASP & Path Traversal Guards`);
  console.log(`======================================================\n`);
});

module.exports = server;
