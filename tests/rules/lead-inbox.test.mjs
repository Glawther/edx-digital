/**
 * Caixa de entrada de formulários guardada no Firestore (como roda em produção),
 * contra o emulador local: npm run test:rules
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.FIREBASE_PROJECT_ID = 'demo-edx-digital';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const require = createRequire(import.meta.url);
const { firestoreInbox, normalizeLeadPayload } = require('../../server/services/lead-storage.js');

const RUN = Date.now().toString(36);
const inboxA = `caixa-a-${RUN}`;
const inboxB = `caixa-b-${RUN}`;
const lead = (inbox, name) => ({ ...normalizeLeadPayload({ name, email: `${name}@teste.local` }), inbox });

test('cada caixa só devolve os próprios contatos', async () => {
  assert.equal(await firestoreInbox.add(lead(inboxA, 'ana')), true);
  assert.equal(await firestoreInbox.add(lead(inboxA, 'bia')), true);
  assert.equal(await firestoreInbox.add(lead(inboxB, 'caio')), true);

  const a = await firestoreInbox.list(inboxA);
  assert.deepEqual(a.map(item => item.name).sort(), ['ana', 'bia']);
  assert.ok(a.every(item => item.status === 'unread'));
  assert.deepEqual((await firestoreInbox.list(inboxB)).map(item => item.name), ['caio']);
  assert.deepEqual(await firestoreInbox.list(`caixa-vazia-${RUN}`), []);
});

test('confirmar o recebimento tira da caixa só os contatos indicados, e só os dela', async () => {
  const [first] = await firestoreInbox.list(inboxA);
  await firestoreInbox.acknowledge(inboxB, [first.id]); // de outra caixa: não acontece nada
  assert.equal((await firestoreInbox.list(inboxA)).length, 2);

  await firestoreInbox.acknowledge(inboxA, [first.id]);
  const left = await firestoreInbox.list(inboxA);
  assert.equal(left.length, 1);
  assert.notEqual(left[0].id, first.id);

  await firestoreInbox.acknowledge(inboxA, null); // tudo o que resta
  assert.deepEqual(await firestoreInbox.list(inboxA), []);
  assert.equal((await firestoreInbox.list(inboxB)).length, 1);
  await firestoreInbox.acknowledge(inboxB, null);
});

// ---------------------------------------------------------------- contagem para os limites do plano

const { firestoreStore, setDoc } = require('../../server/billing/firestore-store.js');
const { createUsageService } = require('../../server/usage/usage-service.js');

test('o servidor conta as oportunidades em aberto e as pessoas ativas, e marca a empresa cheia', async () => {
  const orgId = `org_conta_${RUN}`;
  await setDoc(`organizations/${orgId}`, { name: 'Conta', plan: 'starter', ownerUid: 'dona' });
  await setDoc(`users/dona-${RUN}`, { orgId, role: 'admin', status: 'active', name: 'Dona', email: 'dona@teste.local' });
  await setDoc(`users/vend-${RUN}`, { orgId, role: 'employee', status: 'active', name: 'Vend', email: 'vend@teste.local' });
  await setDoc(`users/bloq-${RUN}`, { orgId, role: 'employee', status: 'blocked', name: 'Bloq', email: 'bloq@teste.local' });
  for (const [id, stage] of [['a', 'lead'], ['b', 'negotiation'], ['c', 'won'], ['d', 'lost'], ['e', 'contacted']]) {
    await setDoc(`customers/conta-${id}-${RUN}`, { orgId, name: id, stage });
  }
  await setDoc(`customers/outra-${RUN}`, { orgId: 'org_de_outro', name: 'x', stage: 'lead' });

  assert.equal(await firestoreStore.countDocs('customers', [['orgId', orgId], ['stage', 'IN', ['lead', 'contact', 'contacted', 'proposal', 'negotiation']]]), 3);
  assert.equal(await firestoreStore.countDocs('users', [['orgId', orgId], ['status', 'active']]), 2);

  // Starter comporta 2 pessoas: está cheio de gente, não de oportunidades
  const usage = createUsageService({ store: firestoreStore });
  assert.deepEqual(await usage.refreshUsage(orgId), { leadsFull: false, seatsFull: true, changed: true });
  assert.deepEqual((await firestoreStore.getOrganization(orgId)).usage, { leadsFull: false, seatsFull: true });
  assert.equal((await usage.refreshUsage(orgId)).changed, false);

  assert.ok((await firestoreStore.listOrganizations()).some(doc => doc.id === orgId));
  assert.equal((await firestoreStore.listUsers(orgId)).length, 3);
  assert.equal((await firestoreStore.listCustomers(orgId)).length, 5);
});