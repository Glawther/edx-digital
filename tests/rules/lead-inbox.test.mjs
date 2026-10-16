/**
 * Leads de formulário gravados pelo servidor, contra os emuladores (como roda em produção):
 * npm run test:rules
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.FIREBASE_PROJECT_ID = 'demo-edx-digital';
process.env.GCLOUD_PROJECT = 'demo-edx-digital';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const require = createRequire(import.meta.url);
const { createLeadIntake, firestoreLeadStore } = require('../../server/services/lead-intake.js');
const { normalizeLeadPayload } = require('../../server/services/lead-storage.js');
const { setDoc, getDoc, queryDocs } = require('../../server/billing/firestore-store.js');

const PROJECT = 'demo-edx-digital';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const RUN = Date.now().toString(36);
const intake = createLeadIntake({ store: firestoreLeadStore });

async function account(label) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${label}.${RUN}@leads.local`, password: 'senha-de-teste-123', returnSecureToken: true }) });
  const body = await res.json();
  return { uid: body.localId, token: body.idToken };
}

const orgA = `leads_a_${RUN}`;
const orgB = `leads_b_${RUN}`;
let dona, vend, outra;

test('preparo: duas empresas, uma dona com vendedor', async () => {
  [dona, vend, outra] = await Promise.all([account('dona'), account('vend'), account('outra')]);
  const trial = { planStatus: 'trial', trialEndsAtMs: Date.now() + 5 * 86400000, plan: 'pro' };
  await setDoc(`organizations/${orgA}`, { name: 'Alfa', ownerUid: dona.uid, ...trial });
  await setDoc(`organizations/${orgB}`, { name: 'Beta', ownerUid: outra.uid, ...trial });
  await setDoc(`users/${dona.uid}`, { orgId: orgA, role: 'admin', status: 'active', name: 'Dona', email: 'dona@a.local' });
  await setDoc(`users/${vend.uid}`, { orgId: orgA, role: 'employee', status: 'active', name: 'Vend', email: 'vend@a.local' });
  await setDoc(`users/${outra.uid}`, { orgId: orgB, role: 'admin', status: 'active', name: 'Outra', email: 'outra@b.local' });
});

test('o contato do formulário entra na empresa dona do token, e a administradora o lê pelo aplicativo', async () => {
  const token = await intake.issueToken({ uid: dona.uid });
  await intake.issueToken({ uid: outra.uid });
  const result = await intake.ingest(token, normalizeLeadPayload({ nome: 'Lead Real', email: `lead.${RUN}@site.com`, telefone: '11 90000-0000' }));
  assert.equal(result.status, 'created');
  const created = await getDoc(`customers/${result.id}`);
  assert.equal(created.orgId, orgA);
  assert.equal(created.assignedTo.id, dona.uid);

  // pelas regras do banco, como o aplicativo lê
  const asDona = await fetch(`${DOCS}/customers/${result.id}`, { headers: { Authorization: `Bearer ${dona.token}` } });
  assert.equal(asDona.status, 200);
  const asOther = await fetch(`${DOCS}/customers/${result.id}`, { headers: { Authorization: `Bearer ${outra.token}` } });
  assert.equal(asOther.status, 403);

  // repetido vira anotação, sem nova oportunidade
  assert.equal((await intake.ingest(token, normalizeLeadPayload({ nome: 'Lead Real', email: `LEAD.${RUN}@site.com` }))).status, 'duplicate');
  assert.equal((await queryDocs('customers', [['orgId', orgA]], 50)).length, 1);
  assert.equal((await getDoc(`customers/${result.id}`)).activities.length, 2);
});

test('o token e a ligação token → empresa ficam fora do alcance do aplicativo, até da administradora', async () => {
  const token = await intake.currentToken({ uid: dona.uid });
  const { hashOf } = require('../../server/services/lead-intake.js');
  for (const who of [dona, vend]) {
    assert.equal((await fetch(`${DOCS}/webhook_config/${orgA}`, { headers: { Authorization: `Bearer ${who.token}` } })).status, 403);
    assert.equal((await fetch(`${DOCS}/webhook_tokens/${hashOf(token)}`, { headers: { Authorization: `Bearer ${who.token}` } })).status, 403);
  }
  await assert.rejects(intake.currentToken({ uid: vend.uid }), err => err.status === 403);
});