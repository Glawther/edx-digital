/**
 * EDX Digital - Mercado Pago client (PIX charges), without dependencies.
 *
 * Uses the Orders API: a charge is an order with one PIX payment inside it.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
 *
 * Charges made before the move to Orders have numeric ids and are still read through the
 * older Payments API, so nothing created back then is left without an answer.
 */

const crypto = require('crypto');

function apiBase() {
  // Overridable so tests can point at a local stand-in
  return process.env.MERCADO_PAGO_API_BASE || 'https://api.mercadopago.com';
}

// "pendente" is what the secret holds until the real credential is set (docs/COBRANCA_PIX.md)
function real(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'pendente' ? text : '';
}

function accessToken() {
  return real(process.env.MERCADO_PAGO_ACCESS_TOKEN);
}

function webhookSecret() {
  return real(process.env.MERCADO_PAGO_WEBHOOK_SECRET);
}

function isConfigured() {
  return Boolean(accessToken());
}

async function call(method, path, { body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${apiBase()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Orders answers with a list of errors; Payments, with a message or a list of causes
    const first = (Array.isArray(data.errors) && data.errors[0]) || (Array.isArray(data.cause) && data.cause[0]) || {};
    const reason = first.message || first.description || data.message || `HTTP ${res.status}`;
    const err = new Error(`Mercado Pago: ${reason}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const money = (amount) => Number(amount).toFixed(2);

/**
 * How long the charge can be paid, as Orders wants it (an ISO 8601 duration).
 * Mercado Pago accepts from 30 minutes on; a minute is added so a charge of exactly 30 is not refused.
 */
function expirationFrom(expiresAt, now = Date.now()) {
  const minutes = Math.ceil((Date.parse(expiresAt) - now) / 60000);
  return `PT${Math.max(30, Number.isFinite(minutes) ? minutes : 30) + 1}M`;
}

function firstPayment(order) {
  const payments = order && order.transactions && order.transactions.payments;
  return (Array.isArray(payments) && payments[0]) || {};
}

/**
 * Creates a PIX charge and returns what the customer needs to pay it.
 * Where Mercado Pago tells us about the payment is set in its panel (Webhooks, event "Order"),
 * not in the request.
 */
async function createPixPayment({ amount, payerEmail, externalReference, idempotencyKey, expiresAt }) {
  const data = await call('POST', '/v1/orders', {
    idempotencyKey,
    body: {
      type: 'online',
      processing_mode: 'automatic',
      total_amount: money(amount),
      external_reference: externalReference,
      payer: { email: payerEmail },
      transactions: {
        payments: [{
          amount: money(amount),
          payment_method: { id: 'pix', type: 'bank_transfer' },
          expiration_time: expirationFrom(expiresAt)
        }]
      }
    }
  });

  const pix = firstPayment(data).payment_method || {};
  if (!data.id || !pix.qr_code) throw new Error('Mercado Pago: a cobrança foi criada sem código PIX.');
  return {
    id: String(data.id),
    status: orderStatus(data),
    copyPaste: pix.qr_code,
    qrCodeBase64: pix.qr_code_base64 || ''
  };
}

/**
 * One word for where an order stands, in the vocabulary the billing service uses.
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
 */
function orderStatus(order) {
  const status = String(order.status || '');
  const detail = String(order.status_detail || '');
  // part of the amount given back does not undo the period (docs/COBRANCA_PIX.md)
  if (status === 'processed') return 'approved';
  if (status === 'refunded') return 'refunded';
  // a dispute only counts as money returned once Mercado Pago has reimbursed the payer
  if (status === 'charged_back') return detail === 'reimbursed' ? 'charged_back' : 'approved';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'expired') return 'expired';
  if (status === 'failed') return 'rejected';
  return 'pending';
}

function orderCurrency(order) {
  const explicit = order.currency || order.currency_id;
  if (explicit) return String(explicit);
  const country = String(order.country_code || '').toUpperCase();
  // Orders does not always say the currency: an order of this account, created by this server, is in reais
  return !country || country === 'BR' || country === 'BRA' ? 'BRL' : '';
}

async function getOrder(orderId) {
  const data = await call('GET', `/v1/orders/${encodeURIComponent(orderId)}`);
  const payment = firstPayment(data);
  const paid = data.total_paid_amount ?? payment.paid_amount ?? data.total_amount;
  return {
    id: String(data.id),
    status: orderStatus(data),
    amount: Number(paid),
    currency: orderCurrency(data),
    externalReference: data.external_reference || '',
    approvedAt: payment.date_approved || data.last_updated_date || null
  };
}

async function getLegacyPayment(paymentId) {
  const data = await call('GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
  return {
    id: String(data.id),
    status: data.status,
    amount: Number(data.transaction_amount),
    currency: data.currency_id,
    externalReference: data.external_reference || '',
    approvedAt: data.date_approved || null
  };
}

/**
 * Reads a charge straight from Mercado Pago. This, not the webhook body, is the source of truth.
 */
function getPayment(chargeId) {
  // ids of the Payments API are numbers; orders are letters and numbers
  return /^\d+$/.test(String(chargeId)) ? getLegacyPayment(chargeId) : getOrder(chargeId);
}

/**
 * Checks the x-signature header Mercado Pago sends with a notification.
 * manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;", HMAC-SHA256 with the webhook secret.
 * An id with letters goes into the manifest in lower case, whatever case it arrived in.
 */
function verifyWebhookSignature({ signatureHeader, requestId, dataId, secret }) {
  if (!secret || !signatureHeader || !dataId) return false;
  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map(piece => piece.split('=').map(s => s.trim())).filter(pair => pair.length === 2)
  );
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId || ''};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const given = Buffer.from(parts.v1, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

module.exports = { isConfigured, webhookSecret, createPixPayment, getPayment, verifyWebhookSignature, orderStatus, expirationFrom };
