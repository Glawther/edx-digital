/**
 * A caixa de entrada do webhook é separada por token: quem não apresenta o token não lê nada,
 * e um token nunca enxerga os leads enviados com outro.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-webhook-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';

let server;
let base;
const TOKEN_A = 'nxwh_' + 'a'.repeat(40);
const TOKEN_B = 'nxwh_' + 'b'.repeat(40);

before(async () => {
  server = require('../../server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function send(token, lead) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-webhook-token'] = token;
  return fetch(`${base}/api/webhook/leads`, { method: 'POST', headers, body: JSON.stringify(lead) });
}

function read(token) {
  return fetch(`${base}/api/webhook/leads`, { headers: token ? { 'x-webhook-token': token } : {} });
}

test('sem token não se envia nem se lê lead', async () => {
  assert.equal((await send(null, { name: 'Sem token' })).status, 401);
  assert.equal((await read(null)).status, 401);
  assert.equal((await read('curto')).status, 401);
  const ack = await fetch(`${base}/api/webhook/leads/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(ack.status, 401);
});

test('cada token só enxerga os próprios leads', async () => {
  assert.equal((await send(TOKEN_A, { name: 'Lead da empresa A' })).status, 201);
  assert.equal((await send(TOKEN_B, { name: 'Lead da empresa B' })).status, 201);

  const a = await (await read(TOKEN_A)).json();
  const b = await (await read(TOKEN_B)).json();
  assert.deepEqual(a.leads.map(l => l.name), ['Lead da empresa A']);
  assert.deepEqual(b.leads.map(l => l.name), ['Lead da empresa B']);
  assert.ok(a.leads.every(l => !('inbox' in l)), 'a resposta não devolve a identificação da caixa');
});

test('o token também pode vir no endereço', async () => {
  const res = await fetch(`${base}/api/webhook/leads?token=${TOKEN_A}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pelo endereço' })
  });
  assert.equal(res.status, 201);
  const a = await (await read(TOKEN_A)).json();
  assert.ok(a.leads.some(l => l.name === 'Pelo endereço'));
});

test('confirmar o recebimento não afeta os leads de outro token', async () => {
  const ack = await fetch(`${base}/api/webhook/leads/ack`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-token': TOKEN_A }, body: JSON.stringify({ leadIds: [] })
  });
  assert.equal(ack.status, 200);
  const a = await (await read(TOKEN_A)).json();
  const b = await (await read(TOKEN_B)).json();
  assert.ok(a.leads.every(l => l.status === 'processed'));
  assert.ok(b.leads.every(l => l.status === 'unread'));
});
