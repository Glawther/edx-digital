/**
 * EDX Digital - Inbox for leads sent by forms and ad tools
 *
 * Each CRM account has its own inbox, identified by its webhook token. A lead is only ever
 * handed back to whoever presents the same token it was sent with, and only a hash of the
 * token is stored.
 */

const crypto = require('crypto');
const { parseJsonBody } = require('../middleware/body-parser');
const { leadInbox, normalizeLeadPayload } = require('../services/lead-storage');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const MAX_BODY_BYTES = 32 * 1024;

function inboxFromRequest(req) {
  let token = req.headers['x-webhook-token'];
  if (!token) {
    // Form and ad tools often cannot set headers, so the token may come in the address
    token = new URLSearchParams((req.url || '').split('?')[1] || '').get('token');
  }
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The sender is told to try again; the reason stays in the server's log
function unavailable(res, err) {
  console.error('[Webhook]', err.message);
  send(res, 503, { success: false, error: 'A caixa de entrada está indisponível. Tente de novo em instantes.' });
}

function withoutInbox(lead) {
  const { inbox, ...rest } = lead;
  return rest;
}

// A sender cannot flood the inbox: so many requests per minute for each address and each inbox
const WINDOW_MS = 60000;
const LIMITS = { ip: 120, inbox: 60 };
const hits = new Map();

function tooMany(kind, key) {
  const now = Date.now();
  const id = `${kind}:${key}`;
  const recent = (hits.get(id) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= LIMITS[kind]) {
    hits.set(id, recent);
    return true;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > 5000) {
    for (const [entry, times] of hits) {
      if (times.every(time => now - time >= WINDOW_MS)) hits.delete(entry);
    }
  }
  return false;
}

function clientAddress(req) {
  // Behind the host's proxy the caller's address is the first one in this header
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** POST /api/webhook/leads */
async function handleIngestLead(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return send(res, 401, { success: false, error: 'Token do webhook ausente ou inválido' });
  if (tooMany('ip', clientAddress(req)) || tooMany('inbox', inbox)) {
    return send(res, 429, { success: false, error: 'Muitos envios em pouco tempo. Tente de novo em um minuto.' });
  }

  let body;
  try {
    ({ body } = await parseJsonBody(req, MAX_BODY_BYTES));
  } catch {
    return send(res, 400, { success: false, error: 'O corpo precisa ser um JSON de até 32 KB' });
  }

  const lead = { ...normalizeLeadPayload(body), inbox };
  if (!lead.name && !lead.email && !lead.phone) {
    return send(res, 400, { success: false, error: 'Informe ao menos nome, e-mail ou telefone' });
  }

  try {
    const stored = await leadInbox().add(lead);
    if (!stored) return send(res, 429, { success: false, error: 'A caixa de entrada está cheia. Abra o CRM para recolher os contatos.' });
  } catch (err) {
    return unavailable(res, err);
  }

  send(res, 201, { success: true, lead: withoutInbox(lead) });
}

/** GET /api/webhook/leads */
async function handleGetLeads(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return send(res, 401, { success: false, error: 'Token do webhook ausente ou inválido' });

  try {
    const leads = (await leadInbox().list(inbox)).map(withoutInbox);
    send(res, 200, { success: true, count: leads.length, leads });
  } catch (err) {
    unavailable(res, err);
  }
}

/** POST /api/webhook/leads/ack */
async function handleAcknowledgeLeads(req, res) {
  const inbox = inboxFromRequest(req);
  if (!inbox) return send(res, 401, { success: false, error: 'Token do webhook ausente ou inválido' });

  let body;
  try {
    ({ body } = await parseJsonBody(req, MAX_BODY_BYTES));
  } catch {
    return send(res, 400, { success: false, error: 'O corpo precisa ser um JSON de até 32 KB' });
  }

  const ids = Array.isArray(body.leadIds) ? body.leadIds.filter(id => typeof id === 'string') : [];
  try {
    await leadInbox().acknowledge(inbox, ids.length === 0 ? null : ids.slice(0, 500));
    send(res, 200, { success: true });
  } catch (err) {
    unavailable(res, err);
  }
}

module.exports = {
  handleIngestLead,
  handleGetLeads,
  handleAcknowledgeLeads
};
