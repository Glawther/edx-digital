/**
 * Cobrança por PIX: o plano só é liberado pelo que o provedor de pagamento informa
 * sobre uma cobrança criada por este servidor.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createBillingService, BillingError, PERIOD_DAYS } = require('../billing/billing-service');
const { verifyWebhookSignature } = require('../billing/mercadopago');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-10T12:00:00.000Z');

function setup({ orgExtra = {} } = {}) {
  const db = {
    users: {
      admin1: { orgId: 'org_a', role: 'admin', status: 'active', name: 'Ana Dona', email: 'ana@a.test' },
      seller1: { orgId: 'org_a', role: 'employee', status: 'active', name: 'Beto', email: 'beto@a.test' },
      admin2: { orgId: 'org_b', role: 'admin', status: 'active', name: 'Carla', email: 'carla@b.test' },
      blocked: { orgId: 'org_a', role: 'admin', status: 'blocked', name: 'Dora', email: 'dora@a.test' }
    },
    organizations: {
      org_a: { name: 'Alfa', plan: 'pro', planStatus: 'trial', ...orgExtra },
      org_b: { name: 'Beta', plan: 'pro', planStatus: 'trial' }
    },
    payments: {}
  };
  const remote = {}; // what "Mercado Pago" knows
  let nextId = 1000;
  const clock = { now: NOW };

  const store = {
    getUserProfile: async (uid) => db.users[uid] || null,
    getOrganization: async (id) => db.organizations[id] ? { ...db.organizations[id] } : null,
    updateOrganization: async (id, data) => { Object.assign(db.organizations[id], data); },
    getPayment: async (id) => db.payments[id] ? { ...db.payments[id] } : null,
    savePayment: async (id, data) => { db.payments[id] = { ...data }; },
    updatePayment: async (id, data) => { Object.assign(db.payments[id], data); }
  };
  const gateway = {
    created: [],
    createPixPayment: async (input) => {
      const id = String(nextId++);
      remote[id] = { id, status: 'pending', amount: input.amount, currency: 'BRL', externalReference: input.externalReference, approvedAt: null };
      gateway.created.push(input);
      return { id, status: 'pending', copyPaste: `00020126-${id}`, qrCodeBase64: 'QUJD' };
    },
    getPayment: async (id) => {
      if (!remote[id]) { const e = new Error('not found'); e.status = 404; throw e; }
      return { ...remote[id] };
    }
  };
  const service = createBillingService({ store, gateway, now: () => clock.now, notificationUrl: 'https://api.test/hook' });
  const pay = (id, extra = {}) => Object.assign(remote[id], { status: 'approved', approvedAt: new Date(clock.now).toISOString() }, extra);
  return { db, remote, gateway, service, clock, pay };
}

const admin = { uid: 'admin1', email: 'ana@a.test', name: 'Ana Dona' };

// ---------------------------------------------------------------- criar a cobrança

test('o administrador gera a cobrança do plano, com o preço da tabela', async () => {
  const { service, gateway, db } = setup();
  const charge = await service.createCharge(admin, 'starter');
  assert.equal(charge.amount, 97);
  assert.equal(charge.status, 'pending');
  assert.ok(charge.copyPaste);
  assert.equal(gateway.created[0].amount, 97);
  assert.match(gateway.created[0].externalReference, /^org_a\|starter\|[0-9a-f]{16}$/);
  assert.equal(gateway.created[0].notificationUrl, 'https://api.test/hook');
  assert.equal(db.organizations.org_a.pendingPaymentId, charge.paymentId);
  assert.equal(db.organizations.org_a.planStatus, 'trial', 'gerar a cobrança não libera nada');
});

test('vendedor, conta bloqueada e conta sem perfil não geram cobrança', async () => {
  const { service } = setup();
  await assert.rejects(service.createCharge({ uid: 'seller1' }, 'pro'), (e) => e instanceof BillingError && e.code === 'not_admin');
  await assert.rejects(service.createCharge({ uid: 'blocked' }, 'pro'), (e) => e.code === 'no_profile');
  await assert.rejects(service.createCharge({ uid: 'ninguem' }, 'pro'), (e) => e.code === 'no_profile');
});

test('plano inexistente é recusado, inclusive nomes herdados de Object', async () => {
  const { service } = setup();
  await assert.rejects(service.createCharge(admin, 'gratis'), (e) => e.code === 'invalid_plan');
  await assert.rejects(service.createCharge(admin, 'constructor'), (e) => e.code === 'invalid_plan');
  await assert.rejects(service.createCharge(admin, ''), (e) => e.code === 'invalid_plan');
});

test('pedir de novo o mesmo plano devolve a mesma cobrança enquanto ela vale', async () => {
  const { service, gateway, clock } = setup();
  const first = await service.createCharge(admin, 'pro');
  const again = await service.createCharge(admin, 'pro');
  assert.equal(again.paymentId, first.paymentId);
  assert.equal(gateway.created.length, 1);

  const other = await service.createCharge(admin, 'starter');
  assert.notEqual(other.paymentId, first.paymentId, 'outro plano é outra cobrança');

  clock.now += 31 * 60 * 1000;
  const later = await service.createCharge(admin, 'starter');
  assert.notEqual(later.paymentId, other.paymentId, 'cobrança vencida não é reaproveitada');
});

// ---------------------------------------------------------------- liberar o plano

test('pagamento aprovado libera o plano por 30 dias', async () => {
  const { service, db, pay } = setup();
  const charge = await service.createCharge(admin, 'enterprise');

  assert.equal((await service.syncPayment(charge.paymentId)).status, 'pending');
  assert.equal(db.organizations.org_a.planStatus, 'trial');

  pay(charge.paymentId);
  const result = await service.syncPayment(charge.paymentId);
  assert.equal(result.status, 'approved');
  assert.equal(db.organizations.org_a.plan, 'enterprise');
  assert.equal(db.organizations.org_a.planStatus, 'active');
  assert.equal(Date.parse(db.organizations.org_a.paidUntil), NOW + PERIOD_DAYS * DAY);
  assert.equal(db.organizations.org_a.paidUntilMs, NOW + PERIOD_DAYS * DAY, 'as regras do banco comparam este número');
  assert.equal(db.organizations.org_a.pendingPaymentId, null);
  assert.equal(db.payments[charge.paymentId].status, 'approved');
});

test('o mesmo pagamento nunca soma dois períodos, nem em chamadas simultâneas', async () => {
  const { service, db, pay } = setup();
  const charge = await service.createCharge(admin, 'pro');
  pay(charge.paymentId);

  await Promise.all([service.syncPayment(charge.paymentId), service.syncPayment(charge.paymentId), service.syncPayment(charge.paymentId)]);
  const afterFirst = db.organizations.org_a.paidUntil;
  const again = await service.syncPayment(charge.paymentId);
  assert.equal(again.alreadyApplied, true);
  assert.equal(db.organizations.org_a.paidUntil, afterFirst);
  assert.equal(Date.parse(afterFirst), NOW + PERIOD_DAYS * DAY);
});

test('pagar antes do vencimento estende a partir do fim do período já pago', async () => {
  const paidUntil = new Date(NOW + 10 * DAY).toISOString();
  const { service, db, pay } = setup({ orgExtra: { planStatus: 'active', paidUntil } });
  const charge = await service.createCharge(admin, 'pro');
  pay(charge.paymentId);
  await service.syncPayment(charge.paymentId);
  assert.equal(Date.parse(db.organizations.org_a.paidUntil), NOW + 40 * DAY);
});

test('plano vencido recomeça de hoje, não da data antiga', async () => {
  const paidUntil = new Date(NOW - 20 * DAY).toISOString();
  const { service, db, pay } = setup({ orgExtra: { planStatus: 'active', paidUntil } });
  const charge = await service.createCharge(admin, 'pro');
  pay(charge.paymentId);
  await service.syncPayment(charge.paymentId);
  assert.equal(Date.parse(db.organizations.org_a.paidUntil), NOW + 30 * DAY);
});

// ---------------------------------------------------------------- tentativas de fraude

test('pagamento que este servidor não criou não libera nada', async () => {
  const { service, remote, db } = setup();
  remote['9999'] = { id: '9999', status: 'approved', amount: 497, currency: 'BRL', externalReference: 'org_a|enterprise|deadbeefdeadbeef' };
  await assert.rejects(service.syncPayment('9999'), (e) => e.code === 'unknown_payment');
  assert.equal(db.organizations.org_a.planStatus, 'trial');
});

test('valor menor que o do plano, ou em outra moeda, não libera', async () => {
  const { service, db, pay } = setup();
  const charge = await service.createCharge(admin, 'enterprise');
  pay(charge.paymentId, { amount: 1 });
  await assert.rejects(service.syncPayment(charge.paymentId), (e) => e.code === 'amount_mismatch');
  pay(charge.paymentId, { amount: 497, currency: 'USD' });
  await assert.rejects(service.syncPayment(charge.paymentId), (e) => e.code === 'amount_mismatch');
  assert.equal(db.organizations.org_a.planStatus, 'trial');
});

test('referência trocada (outra empresa ou outro plano) não libera', async () => {
  const { service, db, pay } = setup();
  const charge = await service.createCharge(admin, 'starter');
  pay(charge.paymentId, { externalReference: 'org_b|starter|0000000000000000' });
  await assert.rejects(service.syncPayment(charge.paymentId), (e) => e.code === 'reference_mismatch');
  pay(charge.paymentId, { externalReference: 'org_a|enterprise|0000000000000000' });
  await assert.rejects(service.syncPayment(charge.paymentId), (e) => e.code === 'reference_mismatch');
  assert.equal(db.organizations.org_a.planStatus, 'trial');
  assert.equal(db.organizations.org_b.planStatus, 'trial');
});

test('uma empresa não consulta a cobrança de outra', async () => {
  const { service } = setup();
  const charge = await service.createCharge(admin, 'pro');
  await assert.rejects(service.checkCharge({ uid: 'admin2' }, charge.paymentId), (e) => e.code === 'unknown_payment');
  await assert.rejects(service.checkCharge({ uid: 'seller1' }, charge.paymentId), (e) => e.code === 'not_admin');
  assert.equal((await service.checkCharge(admin, charge.paymentId)).status, 'pending');
});

test('cobrança cancelada ou expirada fica registrada e não libera', async () => {
  const { service, db, remote } = setup();
  const charge = await service.createCharge(admin, 'pro');
  remote[charge.paymentId].status = 'cancelled';
  assert.equal((await service.syncPayment(charge.paymentId)).status, 'cancelled');
  assert.equal(db.payments[charge.paymentId].status, 'cancelled');
  assert.equal(db.organizations.org_a.planStatus, 'trial');
});

// ---------------------------------------------------------------- assinatura do aviso

test('a assinatura do aviso do Mercado Pago é conferida', () => {
  const secret = 'segredo-de-teste';
  const ts = '1760000000';
  const requestId = 'req-123';
  const dataId = '123456';
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  const header = `ts=${ts},v1=${v1}`;

  assert.equal(verifyWebhookSignature({ signatureHeader: header, requestId, dataId, secret }), true);
  assert.equal(verifyWebhookSignature({ signatureHeader: header, requestId, dataId: '999', secret }), false);
  assert.equal(verifyWebhookSignature({ signatureHeader: header, requestId: 'outro', dataId, secret }), false);
  assert.equal(verifyWebhookSignature({ signatureHeader: header, requestId, dataId, secret: 'errado' }), false);
  assert.equal(verifyWebhookSignature({ signatureHeader: 'ts=1,v1=abc', requestId, dataId, secret }), false);
  assert.equal(verifyWebhookSignature({ signatureHeader: '', requestId, dataId, secret }), false);
});
