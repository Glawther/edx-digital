/**
 * O que o servidor entrega para a internet: só os arquivos públicos do site e as rotas em uso.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-surface-'));
process.env.DATA_DIR = dataDir;

let server;
let base;
const TOKEN = 'edxwh_' + 'c'.repeat(40);

before(async () => {
  server = require('../../server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = (url) => fetch(base + url, { redirect: 'manual' });

test('os arquivos públicos do site são servidos', async () => {
  for (const url of ['/', '/index.html', '/landing', '/termos', '/privacidade', '/manifest.json', '/sw.js', '/js/app.js', '/css/identity.css', '/assets/icon.svg']) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
  }
  assert.match((await get('/js/app.js')).headers.get('content-type'), /javascript/);
});

test('código do servidor, dados, configuração e arquivos ocultos não são entregues', async () => {
  const hidden = [
    '/server.js', '/server/billing/google-auth.js', '/package.json', '/firestore.rules', '/firebase.json',
    '/render.yaml', '/Dockerfile', '/README.md', '/docs/COBRANCA_PIX.md', '/tests/rules/firestore-rules.test.mjs',
    '/data/webhook_leads.json', '/.env', '/.git/config', '/.firebaserc', '/js/../server.js', '/css/%2e%2e/package.json',
    '/assets/..%2f..%2fserver.js'
  ];
  for (const url of hidden) {
    const res = await get(url);
    const body = await res.text();
    // either "does not exist" or the app's own page; never the file
    assert.ok(res.status === 404 || body.includes('<!DOCTYPE html>'), `${url} respondeu ${res.status}`);
    assert.ok(!body.includes('require(') && !body.includes('"scripts"') && !body.includes('rules_version'), `${url} entregou conteúdo interno`);
  }
});

test('sem banco configurado, o servidor local recusa o lead em vez de guardá-lo em arquivo', async () => {
  const sent = await fetch(`${base}/api/webhook/leads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-token': TOKEN },
    body: JSON.stringify({ nome: 'Pessoa Reservada', email: 'reservada@teste.local' })
  });
  assert.equal(sent.status, 503);
  const leaked = await (await get('/data/webhook_leads.json')).text();
  assert.ok(!leaked.includes('Pessoa Reservada'));
});

test('ninguém lê nem apaga leads pelo endereço: a caixa de entrada antiga não existe mais', async () => {
  assert.equal((await fetch(`${base}/api/webhook/leads`, { headers: { 'x-webhook-token': TOKEN } })).status, 404);
  assert.equal((await fetch(`${base}/api/webhook/leads/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-token': TOKEN }, body: '{}' })).status, 404);
  assert.equal((await fetch(`${base}/api/webhook/token`)).status, 401, 'o token da empresa exige a conta do administrador');
});

test('a API antiga não responde: ninguém obtém token sem se identificar', async () => {
  for (const url of ['/api/v1/auth/token', '/api/v1/commercial/register-tenant', '/api/v1/commercial/checkout']) {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404, url);
    assert.ok(!(await res.text()).includes('token"'));
  }
  assert.equal((await get('/api/v1/leads')).status, 404);
  assert.equal((await get('/api/qualquer')).status, 404);
});

test('só GET e HEAD chegam aos arquivos', async () => {
  const res = await fetch(base + '/index.html', { method: 'DELETE' });
  assert.equal(res.status, 405);
});

test('lead vazio, corpo inválido e corpo grande demais são recusados', async () => {
  const post = (body) => fetch(`${base}/api/webhook/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-token': TOKEN }, body });
  assert.equal((await post('{}')).status, 400);
  assert.equal((await post('isto não é json')).status, 400);
  assert.equal((await post(JSON.stringify({ nome: 'x'.repeat(40000) }))).status, 400);
});

test('uma caixa de entrada não aceita enxurrada', async () => {
  const token = 'edxwh_' + 'f'.repeat(40);
  const statuses = [];
  for (let i = 0; i < 70; i++) {
    const res = await fetch(`${base}/api/webhook/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-token': token, 'x-forwarded-for': `10.0.0.${i}` }, body: JSON.stringify({ nome: `C${i}` })
    });
    statuses.push(res.status);
  }
  // os 60 primeiros passam pelo limite (e param no banco, que aqui não existe); o resto, não
  assert.equal(statuses.filter(s => s === 503).length, 60);
  assert.equal(statuses.filter(s => s === 429).length, 10);
});
