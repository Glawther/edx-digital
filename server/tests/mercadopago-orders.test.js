/**
 * Cliente do Mercado Pago (API de Orders) falando com um Mercado Pago de mentira nesta máquina.
 * Confere o que é enviado e como as respostas viram o vocabulário do serviço de cobrança.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
const calls = [];
const orders = {};

function pixOrder(id, body) {
  return {
    id,
    type: 'online',
    processing_mode: 'automatic',
    total_amount: body.total_amount,
    external_reference: body.external_reference,
    country_code: 'BRA',
    status: 'action_required',
    status_detail: 'waiting_transfer',
    transactions: {
      payments: [{
        id: 'PAY' + id.slice(3),
        amount: body.transactions.payments[0].amount,
        status: 'action_required',
        status_detail: 'waiting_transfer',
        payment_method: { id: 'pix', type: 'bank_transfer', qr_code: `00020126-${id}`, qr_code_base64: 'QUJD', ticket_url: 'https://mp.test/ticket' }
      }]
    }
  };
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

      if (req.headers.authorization !== 'Bearer APP_USR-teste') return send(401, { message: 'invalid access token' });
      if (req.method === 'POST' && req.url === '/v1/orders') {
        if (body.total_amount === '0.00') return send(400, { errors: [{ code: 'invalid_total_amount', message: 'total_amount must be greater than zero' }] });
        const id = 'ORD01TESTE' + String(Object.keys(orders).length + 1).padStart(4, '0');
        orders[id] = pixOrder(id, body);
        return send(201, orders[id]);
      }
      const order = /^\/v1\/orders\/([A-Z0-9]+)$/.exec(req.url);
      if (req.method === 'GET' && order) return orders[order[1]] ? send(200, orders[order[1]]) : send(404, { errors: [{ message: 'order not found' }] });
      if (req.method === 'GET' && req.url === '/v1/payments/123456') {
        return send(200, { id: 123456, status: 'approved', transaction_amount: 97, currency_id: 'BRL', external_reference: 'org_a|starter|abc', date_approved: '2026-10-01T10:00:00.000Z' });
      }
      send(404, { message: 'not found' });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.MERCADO_PAGO_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'APP_USR-teste';
});

after(() => {
  delete process.env.MERCADO_PAGO_API_BASE;
  delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  server.close();
});

const mercadopago = require('../billing/mercadopago');
const { createBillingService } = require('../billing/billing-service');

const charge = (extra = {}) => mercadopago.createPixPayment({
  amount: 97,
  payerEmail: 'dona@empresa.com',
  externalReference: 'org_a-starter-0123456789abcdef',
  idempotencyKey: 'org_a-starter-0123456789abcdef',
  expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
  ...extra
});

test('a cobrança é uma ordem com um pagamento PIX, e devolve o código para pagar', async () => {
  const result = await charge();
  assert.match(result.id, /^ORD01TESTE/);
  assert.equal(result.status, 'pending');
  assert.equal(result.copyPaste, `00020126-${result.id}`);
  assert.equal(result.qrCodeBase64, 'QUJD');

  const sent = calls.find(call => call.method === 'POST' && call.url === '/v1/orders');
  assert.equal(sent.headers['x-idempotency-key'], 'org_a-starter-0123456789abcdef');
  assert.deepEqual(sent.body, {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: '97.00',
    external_reference: 'org_a-starter-0123456789abcdef',
    payer: { email: 'dona@empresa.com' },
    transactions: { payments: [{ amount: '97.00', payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT31M' }] }
  });
});

test('o prazo vai como duração e nunca abaixo do mínimo que o Mercado Pago aceita', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  assert.equal(mercadopago.expirationFrom('2026-10-10T12:30:00.000Z', now), 'PT31M');
  assert.equal(mercadopago.expirationFrom('2026-10-10T12:05:00.000Z', now), 'PT31M');
  assert.equal(mercadopago.expirationFrom('2026-10-10T14:00:00.000Z', now), 'PT121M');
  assert.equal(mercadopago.expirationFrom('data ruim', now), 'PT31M');
});

test('a situação da ordem vira a palavra que o serviço de cobrança entende', () => {
  const as = (status, status_detail) => mercadopago.orderStatus({ status, status_detail });
  assert.equal(as('action_required', 'waiting_transfer'), 'pending');
  assert.equal(as('created', 'created'), 'pending');
  assert.equal(as('processing', 'in_process'), 'pending');
  assert.equal(as('processed', 'accredited'), 'approved');
  assert.equal(as('processed', 'partially_refunded'), 'approved'); // devolução parcial não tira o período
  assert.equal(as('refunded', 'refunded'), 'refunded');
  assert.equal(as('charged_back', 'in_process'), 'approved');      // contestação em análise: nada muda ainda
  assert.equal(as('charged_back', 'reimbursed'), 'charged_back');
  assert.equal(as('canceled', 'canceled'), 'cancelled');
  assert.equal(as('expired', 'expired'), 'expired');
  assert.equal(as('failed', 'failed'), 'rejected');
  assert.equal(as('algo_novo', ''), 'pending');                    // o que não se conhece nunca libera
});

test('a consulta lê a ordem: valor pago, moeda e referência', async () => {
  const { id } = await charge();
  let read = await mercadopago.getPayment(id);
  assert.deepEqual({ status: read.status, currency: read.currency, reference: read.externalReference }, { status: 'pending', currency: 'BRL', reference: 'org_a-starter-0123456789abcdef' });

  Object.assign(orders[id], { status: 'processed', status_detail: 'accredited', total_paid_amount: '97.00' });
  read = await mercadopago.getPayment(id);
  assert.equal(read.status, 'approved');
  assert.equal(read.amount, 97);

  // moeda informada e diferente de real aparece como é, para o serviço recusar
  Object.assign(orders[id], { currency: 'ARS' });
  assert.equal((await mercadopago.getPayment(id)).currency, 'ARS');
});

test('cobrança antiga, de número, ainda é lida pela API de Payments', async () => {
  const read = await mercadopago.getPayment('123456');
  assert.deepEqual(read, { id: '123456', status: 'approved', amount: 97, currency: 'BRL', externalReference: 'org_a|starter|abc', approvedAt: '2026-10-01T10:00:00.000Z' });
});

test('o erro do Mercado Pago chega com o motivo, no formato de Orders', async () => {
  await assert.rejects(() => charge({ amount: 0 }), /total_amount must be greater than zero/);
  await assert.rejects(() => mercadopago.getPayment('ORD01NAOEXISTE'), /order not found/);
});

test('de ponta a ponta: cobrar, pagar e liberar o plano; estornar e tirar o período', async () => {
  const db = {
    users: { dona: { orgId: 'org_a', role: 'admin', status: 'active', name: 'Dona', email: 'dona@empresa.com' } },
    organizations: { org_a: { name: 'A', plan: 'pro', planStatus: 'trial', trialEndsAtMs: Date.now() - 1000 } },
    payments: {}
  };
  const store = {
    getUserProfile: async (uid) => db.users[uid] || null,
    getOrganization: async (id) => db.organizations[id] ? { ...db.organizations[id] } : null,
    updateOrganization: async (id, data) => { Object.assign(db.organizations[id], data); },
    getPayment: async (id) => db.payments[id] ? { ...db.payments[id] } : null,
    savePayment: async (id, data) => { db.payments[id] = { ...data }; },
    updatePayment: async (id, data) => { Object.assign(db.payments[id], data); }
  };
  const service = createBillingService({ store, gateway: mercadopago });
  const user = { uid: 'dona', email: 'dona@empresa.com' };

  const created = await service.createCharge(user, 'starter');
  assert.match(created.paymentId, /^ORD01TESTE/);
  assert.match(db.payments[created.paymentId].reference, /^org_a-starter-[0-9a-f]{16}$/);
  assert.equal((await service.syncPayment(created.paymentId)).status, 'pending');
  assert.equal(db.organizations.org_a.planStatus, 'trial');

  // o cliente paga
  Object.assign(orders[created.paymentId], { status: 'processed', status_detail: 'accredited', total_paid_amount: '97.00' });
  assert.equal((await service.syncPayment(created.paymentId)).status, 'approved');
  assert.equal(db.organizations.org_a.planStatus, 'active');
  assert.equal(db.organizations.org_a.plan, 'starter');
  const paidUntil = db.organizations.org_a.paidUntilMs;
  assert.ok(paidUntil > Date.now() + 29 * 24 * 60 * 60 * 1000);

  // o aviso chega de novo: nada soma
  await service.syncPayment(created.paymentId);
  assert.equal(db.organizations.org_a.paidUntilMs, paidUntil);

  // uma ordem com referência de outra cobrança não libera
  const other = await service.createCharge(user, 'pro');
  Object.assign(orders[other.paymentId], { status: 'processed', status_detail: 'accredited', external_reference: 'org_b-pro-0000000000000000' });
  await assert.rejects(() => service.syncPayment(other.paymentId), /não corresponde/);
  // nem pagando menos que o plano
  Object.assign(orders[other.paymentId], { external_reference: db.payments[other.paymentId].reference, total_paid_amount: '1.00' });
  await assert.rejects(() => service.syncPayment(other.paymentId), /valor pago/);
  assert.equal(db.organizations.org_a.plan, 'starter');

  // estorno total da primeira
  Object.assign(orders[created.paymentId], { status: 'refunded', status_detail: 'refunded' });
  assert.equal((await service.syncPayment(created.paymentId)).status, 'refunded');
  assert.equal(db.organizations.org_a.planStatus, 'trial');
});
