/**
 * Testes das regras de acesso do Firestore.
 *
 * Rodam contra o emulador local, nunca contra o banco de produção:
 *   npm run test:rules
 *
 * Usam só a API REST do emulador (sem dependências): cada "pessoa" é uma conta criada no
 * emulador de autenticação e cada requisição leva o token dela.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = 'demo-edx-digital';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const RUN = Date.now().toString(36);

// ---------------------------------------------------------------- utilidades

const PASSWORD = 'senha-de-teste-123';

async function authCall(method, payload, admin = false) {
  const url = admin
    ? `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:${method}`
    : `${AUTH}/accounts:${method}?key=demo-key`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// Uma conta nova; por padrão com o e-mail já confirmado, como quem clicou no link da mensagem
async function signUp(label, { verified = true } = {}) {
  const email = `${label}.${RUN}@teste.local`;
  let body = await authCall('signUp', { email, password: PASSWORD, returnSecureToken: true });
  assert.ok(body.idToken, `conta de teste não criada: ${JSON.stringify(body)}`);
  if (verified) {
    await authCall('update', { localId: body.localId, emailVerified: true }, true);
    // a confirmação só aparece num token emitido depois dela
    body = await authCall('signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
    assert.ok(body.idToken, `não entrou depois de confirmar: ${JSON.stringify(body)}`);
  }
  return { uid: body.localId, token: body.idToken, email };
}

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}

function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

function headers(who) {
  const h = { 'Content-Type': 'application/json' };
  if (who) h.Authorization = `Bearer ${who.token}`;
  return h;
}

// Cria ou substitui o documento inteiro
async function put(who, path, data) {
  const res = await fetch(`${DOCS}/${path}`, { method: 'PATCH', headers: headers(who), body: JSON.stringify({ fields: toFields(data) }) });
  return res.status;
}

// Altera só os campos informados
async function patch(who, path, data) {
  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${DOCS}/${path}?${mask}`, { method: 'PATCH', headers: headers(who), body: JSON.stringify({ fields: toFields(data) }) });
  return res.status;
}

async function get(who, path) {
  const res = await fetch(`${DOCS}/${path}`, { headers: headers(who) });
  return res.status;
}

async function del(who, path) {
  const res = await fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: headers(who) });
  return res.status;
}

async function list(who, collection, filters) {
  const where = filters.length === 1
    ? fieldFilter(filters[0])
    : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const res = await fetch(`${DOCS}:runQuery`, {
    method: 'POST',
    headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where } })
  });
  const body = await res.json();
  const denied = res.status !== 200 || (Array.isArray(body) && body.some(r => r.error));
  return { denied, count: denied ? 0 : body.filter(r => r.document).length };
}

function fieldFilter([field, value]) {
  return { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } };
}

const OK = 200;
const DAY = 24 * 60 * 60 * 1000;
// O emulador aceita este token como o servidor (conta de serviço), que passa por cima das regras
const SERVER = { token: 'owner' };
const DENIED = 403;

// ---------------------------------------------------------------- cenário

const world = {};

// O teste gratuito fica registrado por e-mail antes de a empresa existir
async function claimTrial(who, trialEndsAtMs = Date.now() + 14 * DAY) {
  assert.equal(await put(who, `trial_claims/${who.email}`, { trialEndsAtMs }), OK);
  return trialEndsAtMs;
}

async function registerCompany(label, { trialEndsAtMs } = {}) {
  const owner = await signUp(label);
  const orgId = `org_${label}_${RUN}`;
  const code = `NX-${label.toUpperCase()}${RUN.toUpperCase()}`;
  const endsAt = await claimTrial(owner, trialEndsAtMs);
  assert.equal(await put(owner, `organizations/${orgId}`, { name: `Empresa ${label}`, ownerUid: owner.uid, plan: 'pro', planStatus: 'trial', trialEndsAtMs: endsAt }), OK);
  assert.equal(await put(owner, `users/${owner.uid}`, { orgId, role: 'admin', name: `Dona ${label}`, email: owner.email, status: 'active' }), OK);
  assert.equal(await put(owner, `invites/${code}`, { orgId, role: 'employee', active: true, createdBy: owner.uid }), OK);
  return { owner, orgId, code };
}

async function join(label, company) {
  const person = await signUp(label);
  const status = await put(person, `users/${person.uid}`, {
    orgId: company.orgId, role: 'employee', name: `Vendedor ${label}`, email: person.email, status: 'active', inviteCode: company.code
  });
  assert.equal(status, OK);
  return person;
}

function lead(orgId, assignee, extra = {}) {
  return { name: 'Cliente Teste', stage: 'lead', dealValue: 1000, orgId, assignedTo: { id: assignee.uid, name: 'x', email: assignee.email }, ...extra };
}

before(async () => {
  world.a = await registerCompany('alfa');
  world.b = await registerCompany('beta');
  world.ana = await join('ana', world.a);     // vendedora da Alfa
  world.bruno = await join('bruno', world.a); // vendedor da Alfa
  world.solto = await signUp('solto');        // conta sem empresa

  assert.equal(await put(world.a.owner, `customers/a-ana-${RUN}`, lead(world.a.orgId, world.ana)), OK);
  assert.equal(await put(world.a.owner, `customers/a-bruno-${RUN}`, lead(world.a.orgId, world.bruno)), OK);
  assert.equal(await put(world.b.owner, `customers/b-dono-${RUN}`, lead(world.b.orgId, world.b.owner)), OK);
});

// ---------------------------------------------------------------- sem login

test('sem login: nada de clientes, perfis, empresas ou auditoria', async () => {
  assert.equal(await get(null, `customers/a-ana-${RUN}`), DENIED);
  assert.equal(await get(null, `users/${world.ana.uid}`), DENIED);
  assert.equal(await get(null, `organizations/${world.a.orgId}`), DENIED);
  assert.equal(await put(null, `customers/anonimo-${RUN}`, lead(world.a.orgId, world.ana)), DENIED);
  assert.equal(await del(null, `customers/a-ana-${RUN}`), DENIED);
  const q = await list(null, 'customers', [['orgId', world.a.orgId]]);
  assert.equal(q.denied, true);
});

test('a caixa de entrada de formulários (webhook_leads) é só do servidor', async () => {
  const contato = { inbox: 'x', name: 'Fulano', status: 'unread' };
  assert.equal(await put(SERVER, `webhook_leads/teste-${RUN}`, contato), OK);
  for (const who of [null, world.a.owner, world.ana]) {
    assert.equal(await get(who, `webhook_leads/teste-${RUN}`), DENIED);
    assert.equal(await put(who, `webhook_leads/outro-${RUN}`, contato), DENIED);
    assert.equal(await del(who, `webhook_leads/teste-${RUN}`), DENIED);
    assert.equal((await list(who, 'webhook_leads', [['inbox', 'x']])).denied, true);
  }
});

test('sem login: as coleções antigas (employees, system_config) estão fechadas', async () => {
  assert.equal(await get(null, 'employees/qualquer'), DENIED);
  assert.equal(await put(null, 'employees/qualquer', { cpf: '000' }), DENIED);
  assert.equal(await put(world.a.owner, 'system_config/x', { a: 1 }), DENIED);
});

// ---------------------------------------------------------------- isolamento entre empresas

test('uma empresa não lê nem altera os clientes de outra', async () => {
  assert.equal(await get(world.b.owner, `customers/a-ana-${RUN}`), DENIED);
  assert.equal(await patch(world.b.owner, `customers/a-ana-${RUN}`, { stage: 'won' }), DENIED);
  assert.equal(await del(world.b.owner, `customers/a-ana-${RUN}`), DENIED);
  const q = await list(world.b.owner, 'customers', [['orgId', world.a.orgId]]);
  assert.equal(q.denied, true);
});

test('não dá para criar um cliente dentro de outra empresa nem mudar um cliente de empresa', async () => {
  assert.equal(await put(world.b.owner, `customers/invasor-${RUN}`, lead(world.a.orgId, world.b.owner)), DENIED);
  assert.equal(await patch(world.a.owner, `customers/a-ana-${RUN}`, { orgId: world.b.orgId }), DENIED);
});

test('uma empresa não lê a outra, nem os perfis e o CPF dos colaboradores dela', async () => {
  assert.equal(await get(world.b.owner, `organizations/${world.a.orgId}`), DENIED);
  assert.equal(await get(world.b.owner, `users/${world.ana.uid}`), DENIED);
  assert.equal(await put(world.a.owner, `user_private/${world.ana.uid}`, { orgId: world.a.orgId, cpf: '123.456.789-09', phone: '' }), OK);
  assert.equal(await get(world.b.owner, `user_private/${world.ana.uid}`), DENIED);
  const q = await list(world.b.owner, 'users', [['orgId', world.a.orgId]]);
  assert.equal(q.denied, true);
});

// ---------------------------------------------------------------- papéis dentro da empresa

test('o administrador vê todos os clientes da empresa', async () => {
  const q = await list(world.a.owner, 'customers', [['orgId', world.a.orgId]]);
  assert.equal(q.denied, false);
  assert.equal(q.count, 2);
});

test('o vendedor só lê a própria carteira', async () => {
  assert.equal(await get(world.ana, `customers/a-ana-${RUN}`), OK);
  assert.equal(await get(world.ana, `customers/a-bruno-${RUN}`), DENIED);

  const propria = await list(world.ana, 'customers', [['orgId', world.a.orgId], ['assignedTo.id', world.ana.uid]]);
  assert.equal(propria.denied, false);
  assert.equal(propria.count, 1);

  const tudo = await list(world.ana, 'customers', [['orgId', world.a.orgId]]);
  assert.equal(tudo.denied, true);
});

test('o vendedor move o próprio lead de estágio, mas não o de um colega', async () => {
  assert.equal(await patch(world.ana, `customers/a-ana-${RUN}`, { stage: 'contact' }), OK);
  assert.equal(await patch(world.ana, `customers/a-bruno-${RUN}`, { stage: 'contact' }), DENIED);
});

test('o vendedor cadastra lead para si, não para outra pessoa, e não repassa o seu', async () => {
  assert.equal(await put(world.ana, `customers/novo-ana-${RUN}`, lead(world.a.orgId, world.ana)), OK);
  assert.equal(await put(world.ana, `customers/novo-para-bruno-${RUN}`, lead(world.a.orgId, world.bruno)), DENIED);
  assert.equal(await patch(world.ana, `customers/a-ana-${RUN}`, { assignedTo: { id: world.bruno.uid, name: 'x', email: 'x' } }), DENIED);
});

test('só o administrador exclui clientes', async () => {
  assert.equal(await del(world.ana, `customers/a-ana-${RUN}`), DENIED);
  assert.equal(await put(world.a.owner, `customers/descartavel-${RUN}`, lead(world.a.orgId, world.ana)), OK);
  assert.equal(await del(world.a.owner, `customers/descartavel-${RUN}`), OK);
});

test('estágio inválido e valor negativo são recusados', async () => {
  assert.equal(await patch(world.a.owner, `customers/a-ana-${RUN}`, { stage: 'inventado' }), DENIED);
  assert.equal(await patch(world.a.owner, `customers/a-ana-${RUN}`, { dealValue: -5 }), DENIED);
});

// ---------------------------------------------------------------- ninguém se promove

test('o vendedor não muda o próprio papel, empresa ou situação', async () => {
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { role: 'admin' }), DENIED);
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { orgId: world.b.orgId }), DENIED);
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { status: 'active', role: 'admin' }), DENIED);
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { name: 'Ana Maria' }), OK);
});

test('conta sem empresa não se declara administradora de uma empresa alheia', async () => {
  assert.equal(await put(world.solto, `users/${world.solto.uid}`, {
    orgId: world.a.orgId, role: 'admin', name: 'Intruso', email: world.solto.email, status: 'active'
  }), DENIED);
});

test('sem o código de convite certo ninguém entra na empresa', async () => {
  const base = { orgId: world.a.orgId, role: 'employee', name: 'Intruso', email: world.solto.email, status: 'active' };
  assert.equal(await put(world.solto, `users/${world.solto.uid}`, base), DENIED);
  assert.equal(await put(world.solto, `users/${world.solto.uid}`, { ...base, inviteCode: 'NX-ERRADO' }), DENIED);
  // o convite da Beta não abre a Alfa
  assert.equal(await put(world.solto, `users/${world.solto.uid}`, { ...base, inviteCode: world.b.code }), DENIED);
});

test('os códigos de convite não podem ser listados', async () => {
  const q = await list(world.ana, 'invites', [['orgId', world.a.orgId]]);
  assert.equal(q.denied, true);
  assert.equal(await get(null, `invites/${world.a.code}`), OK); // quem tem o código confere se vale
});

test('o vendedor não mexe em colegas nem em convites', async () => {
  assert.equal(await patch(world.ana, `users/${world.bruno.uid}`, { status: 'blocked' }), DENIED);
  assert.equal(await del(world.ana, `users/${world.bruno.uid}`), DENIED);
  assert.equal(await put(world.ana, `invites/NX-FALSO${RUN}`, { orgId: world.a.orgId, role: 'employee', active: true }), DENIED);
  assert.equal(await get(world.ana, `user_private/${world.bruno.uid}`), DENIED);
});

test('o administrador de uma empresa não altera pessoas de outra', async () => {
  assert.equal(await patch(world.b.owner, `users/${world.ana.uid}`, { status: 'blocked' }), DENIED);
  assert.equal(await del(world.b.owner, `users/${world.ana.uid}`), DENIED);
});

// ---------------------------------------------------------------- plano e dono

test('o plano não pode ser alterado pelo aplicativo, e não se cria empresa já paga', async () => {
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { planStatus: 'active' }), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { plan: 'enterprise' }), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { name: 'Alfa Ltda' }), OK);
  assert.equal(await put(world.solto, `organizations/org_paga_${RUN}`, { name: 'Paga', ownerUid: world.solto.uid, plan: 'enterprise', planStatus: 'active', trialEndsAtMs: Date.now() + DAY }), DENIED);
});

test('um administrador promovido não derruba o dono da empresa', async () => {
  assert.equal(await patch(world.a.owner, `users/${world.bruno.uid}`, { role: 'admin' }), OK);
  assert.equal(await patch(world.bruno, `users/${world.a.owner.uid}`, { role: 'employee' }), DENIED);
  assert.equal(await patch(world.bruno, `users/${world.a.owner.uid}`, { status: 'blocked' }), DENIED);
  assert.equal(await del(world.bruno, `users/${world.a.owner.uid}`), DENIED);
  assert.equal(await patch(world.a.owner, `users/${world.bruno.uid}`, { role: 'employee' }), OK);
});

// ---------------------------------------------------------------- bloqueio

test('colaborador bloqueado perde o acesso aos dados na hora', async () => {
  assert.equal(await get(world.bruno, `customers/a-bruno-${RUN}`), OK);
  assert.equal(await patch(world.a.owner, `users/${world.bruno.uid}`, { status: 'blocked' }), OK);
  assert.equal(await get(world.bruno, `customers/a-bruno-${RUN}`), DENIED);
  assert.equal(await patch(world.bruno, `customers/a-bruno-${RUN}`, { stage: 'won' }), DENIED);
  assert.equal(await patch(world.bruno, `users/${world.bruno.uid}`, { status: 'active' }), DENIED);
});

// ---------------------------------------------------------------- auditoria

test('a auditoria só recebe registros do próprio autor e nunca é alterada', async () => {
  const entry = { action: 'teste', timestamp: new Date().toISOString(), orgId: world.a.orgId, userId: world.ana.uid };
  assert.equal(await put(world.ana, `audit_logs/log-${RUN}`, entry), OK);
  assert.equal(await put(world.ana, `audit_logs/log-falso-${RUN}`, { ...entry, userId: world.a.owner.uid }), DENIED);
  assert.equal(await patch(world.a.owner, `audit_logs/log-${RUN}`, { action: 'adulterado' }), DENIED);
  assert.equal(await del(world.ana, `audit_logs/log-${RUN}`), DENIED);
  assert.equal(await del(world.b.owner, `audit_logs/log-${RUN}`), DENIED);
  assert.equal(await get(world.ana, `audit_logs/log-${RUN}`), DENIED);     // vendedor não lê a auditoria
  assert.equal(await get(world.a.owner, `audit_logs/log-${RUN}`), OK);
  assert.equal(await get(world.b.owner, `audit_logs/log-${RUN}`), DENIED); // outra empresa também não
});

// ---------------------------------------------------------------- cobrança

test('ninguém grava cobranças nem muda o plano pelo aplicativo; só o servidor', async () => {
  const cobranca = { orgId: world.a.orgId, plan: 'enterprise', amount: 497, status: 'approved' };
  assert.equal(await put(world.a.owner, `payments/falsa-${RUN}`, cobranca), DENIED);
  assert.equal(await put(world.ana, `payments/falsa2-${RUN}`, cobranca), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { paidUntil: '2099-01-01T00:00:00.000Z' }), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { planStatus: 'active', plan: 'enterprise' }), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { pendingPaymentId: 'x' }), DENIED);
});

// ---------------------------------------------------------------- plano vencido: modo de leitura

test('ninguém cria empresa com teste maior que 14 dias, sem data de fim ou já paga', async () => {
  const u = await signUp('esperto');
  const base = { name: 'Esperta', ownerUid: u.uid, plan: 'pro', planStatus: 'trial' };
  // sem o registro do teste, nenhuma data serve
  assert.equal(await put(u, `organizations/org_e0_${RUN}`, { ...base, trialEndsAtMs: Date.now() + 14 * DAY }), DENIED);
  // o registro não aceita mais que 14 dias, nem o e-mail de outra pessoa
  assert.equal(await put(u, `trial_claims/${u.email}`, { trialEndsAtMs: Date.now() + 365 * DAY }), DENIED);
  assert.equal(await put(u, `trial_claims/${world.solto.email}`, { trialEndsAtMs: Date.now() + DAY }), DENIED);
  const endsAt = await claimTrial(u);
  assert.equal(await put(u, `organizations/org_e1_${RUN}`, base), DENIED);
  assert.equal(await put(u, `organizations/org_e2_${RUN}`, { ...base, trialEndsAtMs: Date.now() + 365 * DAY }), DENIED);
  assert.equal(await put(u, `organizations/org_e3_${RUN}`, { ...base, trialEndsAtMs: endsAt, paidUntilMs: Date.now() + 365 * DAY }), DENIED);
  assert.equal(await put(u, `organizations/org_e4_${RUN}`, { ...base, trialEndsAtMs: endsAt }), OK);
});

test('o teste gratuito não recomeça: excluir a empresa e criar outra mantém a mesma data', async () => {
  const c = await registerCompany('repete', { trialEndsAtMs: Date.now() + 2 * DAY });
  const owner = c.owner;
  // o registro do teste não é alterado nem apagado por ninguém, e outra pessoa não o lê
  assert.equal(await put(owner, `trial_claims/${owner.email}`, { trialEndsAtMs: Date.now() + 14 * DAY }), DENIED);
  assert.equal(await del(owner, `trial_claims/${owner.email}`), DENIED);
  assert.equal(await get(owner, `trial_claims/${owner.email}`), OK);
  assert.equal(await get(world.a.owner, `trial_claims/${owner.email}`), DENIED);
  // exclui tudo, como o aplicativo faz
  assert.equal(await del(owner, `invites/${c.code}`), OK);
  assert.equal(await del(owner, `organizations/${c.orgId}`), OK);
  assert.equal(await del(owner, `users/${owner.uid}`), OK);
  // outra empresa com 14 dias novos é recusada; com a data antiga, aceita
  const again = { name: 'De novo', ownerUid: owner.uid, plan: 'pro', planStatus: 'trial' };
  assert.equal(await put(owner, `organizations/org_repete2_${RUN}`, { ...again, trialEndsAtMs: Date.now() + 14 * DAY }), DENIED);
  assert.equal(await put(owner, `organizations/org_repete2_${RUN}`, { ...again, trialEndsAtMs: Date.now() + 2 * DAY + 1 }), DENIED);
});

test('o fim do teste não pode ser empurrado pelo aplicativo', async () => {
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { trialEndsAtMs: Date.now() + 365 * DAY }), DENIED);
  assert.equal(await patch(world.a.owner, `organizations/${world.a.orgId}`, { paidUntilMs: Date.now() + 365 * DAY }), DENIED);
});

test('teste encerrado: a empresa lê, exporta e exclui, mas não cria nem altera', async () => {
  const c = await registerCompany('vencida', { trialEndsAtMs: Date.now() + 14 * DAY });
  const vend = await join('vera', c);
  assert.equal(await put(c.owner, `customers/v1-${RUN}`, lead(c.orgId, vend)), OK);
  assert.equal(await put(c.owner, `customers/v2-${RUN}`, lead(c.orgId, c.owner)), OK);

  // o servidor encerra o teste
  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { trialEndsAtMs: Date.now() - DAY }), OK);

  assert.equal(await put(c.owner, `customers/v3-${RUN}`, lead(c.orgId, c.owner)), DENIED);
  assert.equal(await patch(c.owner, `customers/v1-${RUN}`, { stage: 'won' }), DENIED);
  assert.equal(await patch(vend, `customers/v1-${RUN}`, { stage: 'contact' }), DENIED);
  assert.equal(await put(vend, `customers/v4-${RUN}`, lead(c.orgId, vend)), DENIED);

  assert.equal(await get(c.owner, `customers/v1-${RUN}`), OK);
  assert.equal(await get(vend, `customers/v1-${RUN}`), OK);
  const tudo = await list(c.owner, 'customers', [['orgId', c.orgId]]);
  assert.equal(tudo.count, 2);
  assert.equal(await del(c.owner, `customers/v2-${RUN}`), OK);
});

test('pagamento confirmado libera de novo; vencido além da tolerância volta a bloquear', async () => {
  const c = await registerCompany('paga');
  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { trialEndsAtMs: Date.now() - 30 * DAY }), OK);
  assert.equal(await put(c.owner, `customers/p1-${RUN}`, lead(c.orgId, c.owner)), DENIED);

  // pago e em dia
  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { planStatus: 'active', paidUntilMs: Date.now() + 30 * DAY }), OK);
  assert.equal(await put(c.owner, `customers/p1-${RUN}`, lead(c.orgId, c.owner)), OK);
  assert.equal(await patch(c.owner, `customers/p1-${RUN}`, { stage: 'contact' }), OK);

  // venceu ontem: ainda dentro dos 3 dias de tolerância
  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { paidUntilMs: Date.now() - DAY }), OK);
  assert.equal(await patch(c.owner, `customers/p1-${RUN}`, { stage: 'proposal' }), OK);

  // venceu há 4 dias: modo de leitura
  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { paidUntilMs: Date.now() - 4 * DAY }), OK);
  assert.equal(await patch(c.owner, `customers/p1-${RUN}`, { stage: 'won' }), DENIED);
  assert.equal(await get(c.owner, `customers/p1-${RUN}`), OK);
});

test('empresa criada antes desta regra (sem data de fim do teste) continua funcionando', async () => {
  const dono = await signUp('antiga');
  const orgId = `org_antiga_${RUN}`;
  assert.equal(await put(SERVER, `organizations/${orgId}`, { name: 'Antiga', ownerUid: dono.uid, plan: 'pro', planStatus: 'trial' }), OK);
  assert.equal(await put(dono, `users/${dono.uid}`, { orgId, role: 'admin', name: 'Dona Antiga', email: dono.email, status: 'active' }), OK);
  assert.equal(await put(dono, `customers/ant-${RUN}`, lead(orgId, dono)), OK);
});

// ---------------------------------------------------------------- exclusão de conta e de empresa

test('o vendedor exclui a própria conta, e só a própria', async () => {
  const carla = await join('carla', world.a);
  assert.equal(await put(world.a.owner, `user_private/${carla.uid}`, { orgId: world.a.orgId, cpf: '111.444.777-35', phone: '' }), OK);
  assert.equal(await del(carla, `users/${world.ana.uid}`), DENIED);
  assert.equal(await del(carla, `user_private/${carla.uid}`), OK);
  assert.equal(await del(carla, `users/${carla.uid}`), OK);
  // sem perfil, não alcança mais nada da empresa
  assert.equal(await get(carla, `organizations/${world.a.orgId}`), DENIED);
});

test('o dono não some deixando a empresa sem dono; administrador comum não exclui a empresa', async () => {
  assert.equal(await del(world.a.owner, `users/${world.a.owner.uid}`), DENIED);
  assert.equal(await patch(world.a.owner, `users/${world.ana.uid}`, { role: 'admin' }), OK);
  assert.equal(await del(world.ana, `organizations/${world.a.orgId}`), DENIED);
  assert.equal(await patch(world.a.owner, `users/${world.ana.uid}`, { role: 'employee' }), OK);
  assert.equal(await del(world.b.owner, `organizations/${world.a.orgId}`), DENIED);
});

test('o dono exclui a empresa inteira: clientes, auditoria, pessoas, empresa e a própria conta', async () => {
  const c = await registerCompany('gama');
  const vend = await join('gil', c);
  assert.equal(await put(c.owner, `customers/g-${RUN}`, lead(c.orgId, vend)), OK);
  assert.equal(await put(vend, `audit_logs/g-log-${RUN}`, { action: 'teste', timestamp: 'x', orgId: c.orgId, userId: vend.uid }), OK);

  assert.equal(await del(c.owner, `customers/g-${RUN}`), OK);
  assert.equal(await del(c.owner, `audit_logs/g-log-${RUN}`), OK);
  assert.equal(await del(c.owner, `invites/${c.code}`), OK);
  assert.equal(await del(c.owner, `users/${vend.uid}`), OK);
  assert.equal(await del(c.owner, `organizations/${c.orgId}`), OK);
  assert.equal(await del(c.owner, `users/${c.owner.uid}`), OK);

  // nada sobra acessível
  assert.equal(await get(c.owner, `organizations/${c.orgId}`), DENIED);
  assert.equal(await get(vend, `customers/g-${RUN}`), DENIED);
});

// ---------------------------------------------------------------- personalização da empresa

test('o administrador renomeia etapas e cria campos extras; listas grandes e vendedores são recusados', async () => {
  const org = `organizations/${world.a.orgId}`;
  const fields = (n) => Array.from({ length: n }, (_, i) => ({ id: `cf_campo${i}`, label: `Campo ${i}`, type: 'text' }));

  assert.equal(await patch(world.a.owner, org, { stageNames: { lead: 'Interessado' }, customFields: fields(8) }), OK);
  assert.equal(await patch(world.a.owner, org, { customFields: fields(9) }), DENIED, 'mais de 8 campos');
  assert.equal(await patch(world.a.owner, org, { stageNames: 'texto' }), DENIED, 'precisa ser um mapa');
  assert.equal(await patch(world.ana, org, { stageNames: { lead: 'Meu nome' } }), DENIED, 'vendedor não personaliza');
  assert.equal(await patch(world.b.owner, org, { customFields: [] }), DENIED, 'outra empresa não mexe');
});

test('o convite pode ser pausado pelo administrador e deixa de abrir a empresa', async () => {
  const company = await registerCompany('pausa');
  assert.equal(await patch(company.owner, `invites/${company.code}`, { active: false, pausedBy: 'team-full' }), OK);
  const person = await signUp('atrasado');
  const profile = { orgId: company.orgId, role: 'employee', name: 'Chegou tarde', email: person.email, status: 'active', inviteCode: company.code };
  assert.equal(await put(person, `users/${person.uid}`, profile), DENIED);
  assert.equal(await patch(company.owner, `invites/${company.code}`, { active: true, pausedBy: null }), OK);
  assert.equal(await put(person, `users/${person.uid}`, profile), OK);
});

// ---------------------------------------------------------------- identificadores

test('uma oportunidade só é criada com identificador de caracteres simples', async () => {
  // o identificador aparece na tela de quem administra; um com aspas ou parênteses tentaria virar código
  const tricky = encodeURIComponent(`x');alert(1);('`);
  assert.equal(await put(world.ana, `customers/${tricky}`, lead(world.a.orgId, world.ana)), DENIED);
  assert.equal(await put(world.ana, `customers/${'a'.repeat(121)}`, lead(world.a.orgId, world.ana)), DENIED);
  assert.equal(await put(world.ana, `customers/lead-ok-${RUN}`, lead(world.a.orgId, world.ana)), OK);
});

// ---------------------------------------------------------------- registros malformados e abuso

test('oportunidade com tipos trocados ou tamanho absurdo é recusada', async () => {
  // um registro assim travaria a tela de quem administra
  const base = lead(world.a.orgId, world.ana);
  const id = `customers/tipos-${RUN}`;
  assert.equal(await put(world.ana, id, { ...base, tags: 'não é lista' }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, tasks: 'não é lista' }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, activities: 7 }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, notes: 'x'.repeat(20001) }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, company: 12 }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, custom: 'texto' }), DENIED);
  assert.equal(await put(world.ana, id, { ...base, tags: ['ok'], tasks: [], activities: [], notes: 'ok', company: '', lossReason: null, custom: {} }), OK);
});

test('quem foi bloqueado não apaga o próprio perfil para voltar pelo convite', async () => {
  const company = await registerCompany('bloqueio');
  const person = await join('escapista', company);
  assert.equal(await patch(company.owner, `users/${person.uid}`, { status: 'blocked' }), OK);
  assert.equal(await del(person, `users/${person.uid}`), DENIED);
  assert.equal(await get(person, `organizations/${company.orgId}`), DENIED, 'bloqueado não lê a empresa, nem o convite novo');

  assert.equal(await patch(company.owner, `users/${person.uid}`, { status: 'active' }), OK);
  assert.equal(await del(person, `users/${person.uid}`), OK, 'quem está ativo pode excluir a própria conta');
});

test('o nome no perfil tem tamanho também ao alterar', async () => {
  assert.equal(await patch(world.bruno, `users/${world.bruno.uid}`, { name: 'x'.repeat(201) }), DENIED);
  assert.equal(await patch(world.bruno, `users/${world.bruno.uid}`, { name: '' }), DENIED);
  assert.equal(await patch(world.bruno, `users/${world.bruno.uid}`, { name: 'Bruno Renomeado' }), OK);
});

test('no histórico, ninguém se passa por administrador nem grava volume', async () => {
  const entry = { orgId: world.a.orgId, userId: world.ana.uid, action: 'lead_created', timestamp: new Date().toISOString(), userRole: 'employee', details: { nome: 'x' } };
  assert.equal(await put(world.ana, `audit_logs/h1-${RUN}`, entry), OK);
  assert.equal(await put(world.ana, `audit_logs/h2-${RUN}`, { ...entry, userRole: 'admin' }), DENIED, 'papel falso');
  assert.equal(await put(world.ana, `audit_logs/h3-${RUN}`, { ...entry, action: 'A'.repeat(81) }), DENIED, 'ação enorme');
  assert.equal(await put(world.ana, `audit_logs/h4-${RUN}`, { ...entry, anexo: 'x' }), DENIED, 'campo que não existe');
  assert.equal(await put(world.ana, `audit_logs/h5-${RUN}`, { ...entry, details: 'texto' }), DENIED);
  assert.equal(await put(world.ana, `audit_logs/h6-${RUN}`, { ...entry, userId: world.a.owner.uid }), DENIED, 'em nome de outra pessoa');
});

test('dados da empresa: meta numérica, nome obrigatório, logotipo com limite', async () => {
  const org = `organizations/${world.a.orgId}`;
  assert.equal(await patch(world.a.owner, org, { monthlyGoal: 5000 }), OK);
  assert.equal(await patch(world.a.owner, org, { monthlyGoal: -1 }), DENIED);
  assert.equal(await patch(world.a.owner, org, { monthlyGoal: 'muito' }), DENIED);
  assert.equal(await patch(world.a.owner, org, { name: '' }), DENIED);
  assert.equal(await patch(world.a.owner, org, { logoUrl: 'x'.repeat(400001) }), DENIED);
  assert.equal(await patch(world.ana, org, { monthlyGoal: 1 }), DENIED, 'vendedor não define a meta');
});

test('sem o e-mail confirmado ninguém cria empresa', async () => {
  const u = await signUp('semconfirmar', { verified: false });
  const endsAt = await claimTrial(u);
  const company = { name: 'Fantasma', ownerUid: u.uid, plan: 'pro', planStatus: 'trial', trialEndsAtMs: endsAt };
  assert.equal(await put(u, `organizations/org_fantasma_${RUN}`, company), DENIED);
  // depois de confirmar, com um token novo, a mesma criação passa
  await authCall('update', { localId: u.uid, emailVerified: true }, true);
  const again = await authCall('signInWithPassword', { email: u.email, password: PASSWORD, returnSecureToken: true });
  assert.equal(await put({ ...u, token: again.idToken }, `organizations/org_fantasma_${RUN}`, company), OK);
});

test('plano cheio (marcado pelo servidor): ninguém cria oportunidade nem entra na equipe; o resto continua', async () => {
  const c = await registerCompany('cheia');
  assert.equal(await put(c.owner, `customers/cheia-1-${RUN}`, lead(c.orgId, c.owner)), OK);
  // o aplicativo não marca nem desmarca
  assert.equal(await patch(c.owner, `organizations/${c.orgId}`, { usage: { leadsFull: false, seatsFull: false } }), DENIED);

  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { usage: { leadsFull: true, seatsFull: false } }), OK);
  assert.equal(await put(c.owner, `customers/cheia-2-${RUN}`, lead(c.orgId, c.owner)), DENIED);
  assert.equal(await patch(c.owner, `customers/cheia-1-${RUN}`, { stage: 'won' }), OK);   // alterar o que existe segue valendo
  assert.equal(await del(c.owner, `customers/cheia-1-${RUN}`), OK);

  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { usage: { leadsFull: false, seatsFull: true } }), OK);
  assert.equal(await put(c.owner, `customers/cheia-3-${RUN}`, lead(c.orgId, c.owner)), OK);
  const novato = await signUp('novato');
  const profile = { orgId: c.orgId, role: 'employee', name: 'Novato', email: novato.email, status: 'active', inviteCode: c.code };
  assert.equal(await put(novato, `users/${novato.uid}`, profile), DENIED);
  assert.equal(await put(c.owner, `users/colab-${RUN}`, { orgId: c.orgId, role: 'employee', name: 'Colab', email: 'colab@teste.local', status: 'active' }), DENIED);

  assert.equal(await patch(SERVER, `organizations/${c.orgId}`, { usage: { leadsFull: false, seatsFull: false } }), OK);
  assert.equal(await put(novato, `users/${novato.uid}`, profile), OK);
});

test('cada pessoa liga ou desliga o próprio resumo por e-mail, e só o dela', async () => {
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { emailDigest: false }), OK);
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { emailDigest: 'talvez' }), DENIED);
  assert.equal(await patch(world.ana, `users/${world.a.owner.uid}`, { emailDigest: false }), DENIED);
  assert.equal(await patch(world.ana, `users/${world.ana.uid}`, { emailDigest: true }), OK);
});
