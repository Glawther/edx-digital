/**
 * EDX Digital - Leads sent by forms and ad tools
 *
 *   POST /api/webhook/leads    a form sends one lead, with the company's token          [public]
 *   GET  /api/webhook/token    the company's token (null when none was issued yet)      [company admin]
 *   POST /api/webhook/token    a new token; the previous one stops working at once      [company admin]
 *
 * The lead is written straight into the company that owns the token (lead-intake.js).
 */

const crypto = require('crypto');
const { parseJsonBody } = require('../middleware/body-parser');
const { normalizeLeadPayload } = require('../services/lead-storage');
const { createLeadIntake, firestoreLeadStore, IntakeError } = require('../services/lead-intake');
const { verifyIdToken, isServiceAccountConfigured } = require('../billing/google-auth');
const { clientAddress, createRateLimiter } = require('../middleware/rate-limit');

let intake = null;
function leadIntake() {
  if (!intake) intake = createLeadIntake({ store: firestoreLeadStore });
  return intake;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const MAX_BODY_BYTES = 32 * 1024;

function tokenFromRequest(req) {
  let token = req.headers['x-webhook-token'];
  if (!token) {
    // Form and ad tools often cannot set headers, so the token may come in the address
    token = new URLSearchParams((req.url || '').split('?')[1] || '').get('token');
  }
  return typeof token === 'string' && TOKEN_PATTERN.test(token) ? token : null;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The sender is told to try again; the reason stays in the server's log
function unavailable(res, err) {
  console.error('[Webhook]', err.message);
  send(res, 503, { success: false, error: 'O recebimento de contatos está indisponível. Tente de novo em instantes.' });
}

// A sender cannot flood the inbox: so many requests per minute for each address and each inbox
const LIMITS = { ip: 120, inbox: 60 };
const limiter = createRateLimiter({ windowMs: 60000 });
const tooMany = (kind, key) => limiter.tooMany(`${kind}:${key}`, LIMITS[kind]);

/** POST /api/webhook/leads */
async function handleIngestLead(req, res) {
  const token = tokenFromRequest(req);
  if (!token) return send(res, 401, { success: false, error: 'Token do webhook ausente ou inválido' });
  const tokenKey = crypto.createHash('sha256').update(token).digest('hex');
  if (tooMany('ip', clientAddress(req)) || tooMany('inbox', tokenKey)) {
    return send(res, 429, { success: false, error: 'Muitos envios em pouco tempo. Tente de novo em um minuto.' });
  }

  let body;
  try {
    ({ body } = await parseJsonBody(req, MAX_BODY_BYTES));
  } catch {
    return send(res, 400, { success: false, error: 'O corpo precisa ser um JSON de até 32 KB' });
  }

  const lead = normalizeLeadPayload(body);
  if (!lead.name && !lead.email && !lead.phone) {
    return send(res, 400, { success: false, error: 'Informe ao menos nome, e-mail ou telefone' });
  }
  if (!isServiceAccountConfigured()) {
    return send(res, 503, { success: false, error: 'O recebimento de contatos não está configurado neste servidor.' });
  }

  try {
    const result = await leadIntake().ingest(token, lead);
    send(res, result.status === 'created' ? 201 : 200, { success: true, status: result.status });
  } catch (err) {
    if (err instanceof IntakeError) return send(res, err.status, { success: false, error: err.message });
    unavailable(res, err);
  }
}

/** GET and POST /api/webhook/token */
async function handleWebhookToken(req, res) {
  const header = req.headers.authorization || '';
  let user;
  try {
    user = await verifyIdToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  } catch {
    return send(res, 401, { error: 'unauthenticated', message: 'Entre na sua conta para continuar.' });
  }
  if (!isServiceAccountConfigured()) {
    return send(res, 503, { error: 'not_configured', message: 'O recebimento de contatos não está configurado neste servidor.' });
  }
  try {
    const token = req.method === 'POST' ? await leadIntake().issueToken(user) : await leadIntake().currentToken(user);
    send(res, 200, { token });
  } catch (err) {
    if (err instanceof IntakeError) return send(res, err.status, { error: 'forbidden', message: err.message });
    unavailable(res, err);
  }
}

module.exports = {
  handleIngestLead,
  handleWebhookToken
};
