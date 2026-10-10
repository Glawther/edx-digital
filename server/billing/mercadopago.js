/**
 * EDX Digital - Mercado Pago client (PIX charges), without dependencies.
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
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
    const reason = data.message || (data.cause && data.cause[0] && data.cause[0].description) || `HTTP ${res.status}`;
    const err = new Error(`Mercado Pago: ${reason}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Creates a PIX charge and returns what the customer needs to pay it
 */
async function createPixPayment({ amount, description, payerEmail, payerName, externalReference, idempotencyKey, notificationUrl, expiresAt }) {
  const [firstName, ...rest] = (payerName || 'Cliente').trim().split(/\s+/);
  const data = await call('POST', '/v1/payments', {
    idempotencyKey,
    body: {
      transaction_amount: Number(amount),
      description,
      payment_method_id: 'pix',
      external_reference: externalReference,
      date_of_expiration: expiresAt,
      notification_url: notificationUrl || undefined,
      payer: { email: payerEmail, first_name: firstName, last_name: rest.join(' ') || firstName }
    }
  });

  const pix = (data.point_of_interaction && data.point_of_interaction.transaction_data) || {};
  if (!data.id || !pix.qr_code) throw new Error('Mercado Pago: a cobrança foi criada sem código PIX.');
  return {
    id: String(data.id),
    status: data.status,
    copyPaste: pix.qr_code,
    qrCodeBase64: pix.qr_code_base64 || ''
  };
}

/**
 * Reads a payment straight from Mercado Pago. This, not the webhook body, is the source of truth.
 */
async function getPayment(paymentId) {
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
 * Checks the x-signature header Mercado Pago sends with a notification.
 * manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;", HMAC-SHA256 with the webhook secret.
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

module.exports = { isConfigured, webhookSecret, createPixPayment, getPayment, verifyWebhookSignature };
