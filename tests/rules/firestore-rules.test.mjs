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

const PROJECT = 'demo-nexus-crm';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const RUN = Date.now().toString(36);

// ---------------------------------------------------------------- utilidades

async function signUp(label) {
  const email = `${label}.${RUN}@teste.local`;
  const res = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senha-de-teste-123', returnSecureToken: true })
  });
  const body = await res.json();
  assert.ok(body.idToken, `conta de teste não criada: ${JSON.stringify(body)}`);
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
const DENIED = 403;

// ---------------------------------------------------------------- cenário

const world = {};

async function registerCompany(label) {
  const owner = await signUp(label);
  const orgId = `org_${label}_${RUN}`;
  const code = `NX-${label.toUpperCase()}${RUN.toUpperCase()}`;
  assert.equal(await put(owner, `organizations/${orgId}`, { name: `Empresa ${label}`, ownerUid: owner.uid, plan: 'pro', planStatus: 'trial' }), OK);
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
  assert.equal(await put(world.solto, `organizations/org_paga_${RUN}`, { name: 'Paga', ownerUid: world.solto.uid, plan: 'enterprise', planStatus: 'active' }), DENIED);
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
  assert.equal(await del(world.a.owner, `audit_logs/log-${RUN}`), DENIED);
  assert.equal(await get(world.ana, `audit_logs/log-${RUN}`), DENIED);     // vendedor não lê a auditoria
  assert.equal(await get(world.a.owner, `audit_logs/log-${RUN}`), OK);
  assert.equal(await get(world.b.owner, `audit_logs/log-${RUN}`), DENIED); // outra empresa também não
});
