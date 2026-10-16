/**
 * Limite de pedidos por minuto: quem chama não escolhe o próprio endereço, e o mapa cheio não
 * devolve a ninguém o limite no meio da janela.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clientAddress, createRateLimiter } = require('../middleware/rate-limit');

const request = (forwarded, socket = '169.254.1.1') => ({
  headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  socket: { remoteAddress: socket }
});
const CLOUD = { K_SERVICE: 'api' };

test('endereço do cliente: em produção vale o item que o Hosting escreveu, não o começo do cabeçalho', () => {
  // o Hosting acrescenta o navegador; o Google acrescenta o endereço do próprio Hosting
  const honest = clientAddress(request('198.51.100.7, 35.191.0.1'), { env: CLOUD });
  assert.equal(honest, '198.51.100.7');
  for (const forged of ['1.2.3.4', '1.2.3.4, 5.6.7.8', 'qualquer coisa', '198.51.100.8']) {
    const key = clientAddress(request(`${forged}, 198.51.100.7, 35.191.0.1`), { env: CLOUD });
    assert.equal(key, honest, `forjar "${forged}" mudou a chave`);
  }
});

test('endereço do cliente: o número de proxies pode ser ajustado e um cabeçalho curto não quebra', () => {
  assert.equal(clientAddress(request('9.9.9.9, 198.51.100.7, 35.191.0.1, 35.191.0.2'), { env: { ...CLOUD, TRUSTED_PROXY_HOPS: '2' } }), '198.51.100.7');
  assert.equal(clientAddress(request('198.51.100.7'), { env: CLOUD }), '198.51.100.7');
  assert.equal(clientAddress(request(undefined), { env: CLOUD }), '169.254.1.1');
});

test('endereço do cliente: no servidor local o cabeçalho é ignorado e vale o socket', () => {
  assert.equal(clientAddress(request('1.2.3.4', '127.0.0.1'), { env: {} }), '127.0.0.1');
  assert.equal(clientAddress(request(undefined, '127.0.0.1'), { env: {} }), '127.0.0.1');
});

test('limite: o mapa cheio só perde as chaves vencidas, e quem está no meio da janela continua contido', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ windowMs: 60000, maxKeys: 50, clock: () => now });
  // chaves que vão estar vencidas quando o mapa encher
  for (let i = 0; i < 40; i++) limiter.tooMany(`antiga-${i}`, 10);

  now += 40000;
  for (let i = 0; i < 10; i++) assert.equal(limiter.tooMany('atacante', 10), false);
  assert.equal(limiter.tooMany('atacante', 10), true);

  // o mapa passa do tamanho com o atacante no meio da janela
  now += 25000;
  for (let i = 0; i < 20; i++) limiter.tooMany(`nova-${i}`, 10);

  assert.equal(limiter.tooMany('atacante', 10), true, 'o mapa cheio devolveu o limite no meio da janela');
  assert.ok(limiter.size() <= 50, 'as chaves vencidas saíram do mapa');
  assert.ok(limiter.size() > 20, 'só as vencidas saíram');

  // passada a janela de quem foi contido, ele volta a poder
  now += 35001;
  assert.equal(limiter.tooMany('atacante', 10), false);
});

test('relato de erro: no servidor local, trocar o X-Forwarded-For a cada envio não escapa do limite', async () => {
  const server = require('../../server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const original = console.error;
  console.error = () => {};
  try {
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${base}/api/errors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.0.${i}` },
        body: JSON.stringify({ message: `erro ${i}` })
      });
      statuses.push(res.status);
    }
    assert.equal(statuses.filter(s => s === 204).length, 10);
    assert.equal(statuses.filter(s => s === 429).length, 2);
  } finally {
    console.error = original;
    await new Promise(resolve => server.close(resolve));
  }
});
