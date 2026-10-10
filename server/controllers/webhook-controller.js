/**
 * EDX Digital - Webhook Controller
 * Handles inbound lead ingestion, status acknowledgments and retrieval.
 */

const crypto = require('crypto');
const { getWebhookLeads, saveWebhookLeads, normalizeLeadPayload } = require('../services/lead-storage');

/**
 * Each CRM account has its own inbox, identified by its webhook token. A lead is only ever
 * handed back to whoever presents the same token it was sent with. Only a hash of the token
 * is stored. (Before, the inbox was one public list shared by every account.)
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

function inboxFromRequest(req) {
  let token = req.headers['x-webhook-token'];
  if (!token) {
    // Form and ads tools often cannot set headers, so the token may come in the address
    const query = (req.url || '').split('?')[1] || '';
    token = new URLSearchParams(query).get('token');
  }
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function rejectMissingToken(res) {
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, error: 'Token do webhook ausente ou inválido' }));
}

function withoutInbox(lead) {
  const { inbox, ...rest } = lead;
  return rest;
}

/**
 * Handles POST /api/webhook/leads
 */
async function handleIngestLead(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return rejectMissingToken(res);

  let body = '';
  req.on('data', chunk => { 
    body += chunk; 
    // Guard against oversized payload attacks (max 1MB)
    if (body.length > 1024 * 1024) {
      req.connection.destroy();
    }
  });

  req.on('end', async () => {
    try {
      const rawData = body ? JSON.parse(body) : {};
      const newLead = { ...normalizeLeadPayload(rawData), inbox };

      const leads = await getWebhookLeads();
      leads.unshift(newLead);
      if (leads.length > 2000) leads.length = 2000;
      await saveWebhookLeads(leads);

      console.log('[Webhook Controller] Lead recebido');

      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        message: 'Lead recebido com sucesso no EDX Digital',
        lead: withoutInbox(newLead)
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'JSON inválido no corpo da requisição' }));
    }
  });
}

/**
 * Handles GET /api/webhook/leads
 */
async function handleGetLeads(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return rejectMissingToken(res);

  const leads = (await getWebhookLeads()).filter(l => l.inbox === inbox).map(withoutInbox);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify({ success: true, count: leads.length, leads }));
}

/**
 * Handles POST /api/webhook/leads/ack
 */
async function handleAcknowledgeLeads(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return rejectMissingToken(res);

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { leadIds } = body ? JSON.parse(body) : { leadIds: [] };
      let leads = await getWebhookLeads();

      const all = !Array.isArray(leadIds) || leadIds.length === 0;
      leads = leads.map(l => (l.inbox === inbox && (all || leadIds.includes(l.id))) ? { ...l, status: 'processed' } : l);

      await saveWebhookLeads(leads);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'Leads marcados como processados' }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Erro ao processar ACK' }));
    }
  });
}

module.exports = {
  handleIngestLead,
  handleGetLeads,
  handleAcknowledgeLeads
};
