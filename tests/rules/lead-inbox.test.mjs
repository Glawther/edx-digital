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
