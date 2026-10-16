/**
 * O que o servidor faz direto no banco e na autenticação, contra os emuladores:
 * transação otimista da cobrança e consulta de e-mails confirmados (npm run test:rules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-edx-digital';
const require = createRequire(new URL('../../server/x.js', import.meta.url));
const { runTransaction, setDoc, getDoc } = require('./billing/firestore-store');
const { verifiedEmailsOf } = require('./billing/google-auth');

test('transação REST no emulador: duas ao mesmo tempo somam as duas', async () => {
  await setDoc('organizations/tx_teste', { n: 0 });
  const bump = () => runTransaction(async (tx) => { const d = await tx.get('organizations/tx_teste'); await new Promise(r => setTimeout(r, 30)); tx.update('organizations/tx_teste', { n: d.n + 1 }); return d.n; });
  await Promise.all([bump(), bump(), bump()]);
  assert.equal((await getDoc('organizations/tx_teste')).n, 3);
});

test('consulta de contas no emulador: só e-mail confirmado volta', async () => {
  const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
  const mk = async (email) => (await (await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-123456', returnSecureToken: true }) })).json()).localId;
  const a = await mk(`conf${Date.now()}@t.local`); const b = await mk(`naoconf${Date.now()}@t.local`);
  await fetch(`${AUTH}/projects/demo-edx-digital/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: a, emailVerified: true }) });
  const found = await verifiedEmailsOf([a, b, 'nao-existe']);
  assert.equal(found.has(a), true); assert.equal(found.has(b), false); assert.equal(found.size, 1);
});