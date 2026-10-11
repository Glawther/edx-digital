/**
 * EDX Digital - HTTP side of PIX billing
 *
 *   POST /api/billing/pix                     create (or reuse) the charge for a plan   [signed-in admin]
 *                                             with { test: true }, a charge of R$ 1     [owner of the system]
 *   GET  /api/billing/pix/:paymentId          has it been paid?                         [signed-in admin]
 *   POST /api/billing/webhook/mercadopago     Mercado Pago tells us a payment changed   [public, verified]
 *   GET  /api/billing/status                  is billing set up on this server?         [public]
 */

const { parseJsonBody } = require('../middleware/body-parser');
const { verifyIdToken, isServiceAccountConfigured } = require('./google-auth');
const { firestoreStore } = require('./firestore-store');
const mercadopago = require('./mercadopago');
const { createBillingService, BillingError } = require('./billing-service');
const { isOwnerUser } = require('../controllers/owner-controller');
const { createUsageService } = require('../usage/usage-service');

function isBillingConfigured() {
  return mercadopago.isConfigured() && isServiceAccountConfigured();
}

let service = null;
function billingService() {
  if (!service) {
    const usage = createUsageService({ store: firestoreStore });
    service = createBillingService({ store: firestoreStore, gateway: mercadopago, onPlanChanged: (orgId) => usage.refreshUsage(orgId) });
  }
  return service;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    return await verifyIdToken(token);
  } catch {
    throw new BillingError('unauthenticated', 'Entre na sua conta para continuar.', 401);
  }
}

// A person cannot ask for charges faster than this (per account, in memory)
const recentCharges = new Map();
function throttle(uid) {
  const now = Date.now();
  const stamps = (recentCharges.get(uid) || []).filter(t => now - t < 10 * 60 * 1000);
  if (stamps.length >= 10) throw new BillingError('too_many', 'Muitas tentativas. Aguarde alguns minutos.', 429);
  stamps.push(now);
  recentCharges.set(uid, stamps);
}

async function handleBilling(req, res, pathname) {
  try {
    if (pathname === '/api/billing/status' && req.method === 'GET') {
      return send(res, 200, { configured: isBillingConfigured() });
    }

    if (pathname === '/api/billing/webhook/mercadopago' && req.method === 'POST') {
      return await handleWebhook(req, res);
    }

    if (!isBillingConfigured()) {
      throw new BillingError('billing_not_configured', 'A cobrança automática ainda não foi configurada.', 503);
    }

    if (pathname === '/api/billing/pix' && req.method === 'POST') {
      const user = await authenticate(req);
      throttle(user.uid);
      const { body } = await parseJsonBody(req, 4096).catch(() => { throw new BillingError('invalid_body', 'Pedido inválido.', 400); });
      const test = body.test === true;
      if (test && !isOwnerUser(user)) {
        throw new BillingError('not_owner', 'A cobrança de teste é só para quem é dono do sistema.', 403);
      }
      const charge = await billingService().createCharge(user, String(body.plan || ''), { test });
      return send(res, 200, charge);
    }

    const match = /^\/api\/billing\/pix\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
    if (match && req.method === 'GET') {
      const user = await authenticate(req);
      const result = await billingService().checkCharge(user, match[1]);
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    if (err instanceof BillingError) {
      return send(res, err.status, { error: err.code, message: err.message });
    }
    console.error('[Billing]', err.message);
    return send(res, 502, { error: 'billing_unavailable', message: 'Não foi possível falar com o provedor de pagamento. Tente de novo em instantes.' });
  }
}

/**
 * Mercado Pago calls this when a charge changes (event "Order" in its panel). The body is only
 * a pointer: the charge is always read back from Mercado Pago before anything is released.
 */
// One line in the function's log for each notice that arrives, so it can be seen that Mercado
// Pago is reaching this server and what came of it. Only the kind of notice, the charge's
// number and the outcome: nothing about who paid.
function logNotice(topic, dataId, outcome) {
  console.log(JSON.stringify({ message: `[Cobrança] aviso do Mercado Pago: ${outcome}`, topic: String(topic || '').slice(0, 30), charge: String(dataId || '').slice(0, 64), outcome }));
}

async function handleWebhook(req, res) {
  if (!isBillingConfigured()) return send(res, 503, { error: 'billing_not_configured' });

  const query = new URLSearchParams((req.url || '').split('?')[1] || '');
  let body = {};
  try {
    ({ body } = await parseJsonBody(req, 65536));
  } catch {
    return send(res, 400, { error: 'invalid_body' });
  }

  const topic = body.type || query.get('type') || query.get('topic') || '';
  const dataId = query.get('data.id') || (body.data && body.data.id) || query.get('id') || '';
  // "payment" is what charges made through the older Payments API are announced as
  if (topic && topic !== 'order' && topic !== 'payment') {
    logNotice(topic, '', 'ignorado, outro tipo de aviso');
    return send(res, 200, { ignored: true });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(dataId))) {
    logNotice(topic, '', 'ignorado, sem número de cobrança');
    return send(res, 200, { ignored: true });
  }

  const secret = mercadopago.webhookSecret();
  if (secret) {
    const valid = mercadopago.verifyWebhookSignature({
      signatureHeader: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      dataId,
      secret
    });
    if (!valid) {
      logNotice(topic, dataId, 'recusado, assinatura inválida');
      return send(res, 401, { error: 'invalid_signature' });
    }
  }

  try {
    const result = await billingService().syncPayment(String(dataId));
    logNotice(topic, dataId, `recebido, cobrança ${result.status}${result.alreadyApplied ? ' (já aplicada)' : ''}`);
    return send(res, 200, { received: true, status: result.status });
  } catch (err) {
    if (err instanceof BillingError && err.code === 'unknown_payment') {
      // A payment of the same Mercado Pago account that is not a CRM charge: acknowledged, nothing to do
      logNotice(topic, dataId, 'ignorado, cobrança que não é do CRM');
      return send(res, 200, { ignored: true });
    }
    if (err instanceof BillingError) {
      logNotice(topic, dataId, `recebido, com problema: ${err.code}`);
      return send(res, 200, { received: true, problem: err.code });
    }
    console.error('[Billing webhook]', err.message);
    // A 5xx makes Mercado Pago try again later
    return send(res, 500, { error: 'retry' });
  }
}

module.exports = { handleBilling, isBillingConfigured };
