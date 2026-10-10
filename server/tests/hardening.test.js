/**
 * Nexus CRM Enterprise - Automated Hardening Tests
 * Tests: Password login, no unauthenticated token issuing, platform-only payment settings,
 *        webhook secret without public default, static file allowlist, production secrets
 * Framework: Node.js Native Test Runner (node:test & node:assert)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('node:child_process');

// The server listens as soon as it is required: ask the OS for a free port first
process.env.PORT = '0';
const server = require('../../server');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('🛡️ [HARDENING] Autenticação, segredos e arquivos públicos', async (t) => {
  let base;

  const request = async (method, urlPath, body, token) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };

  const registerTenant = (suffix) => request('POST', '/api/v1/commercial/register-tenant', {
    companyName: `Empresa Teste ${suffix}`,
    adminName: 'Admin Teste',
    email: `admin@${suffix}.test`,
    password: 'senha-de-teste-123'
  });

  t.before(async () => {
    if (!server.listening) {
      await new Promise(resolve => server.once('listening', resolve));
    }
    base = `http://127.0.0.1:${server.address().port}`;
  });

  t.after(() => new Promise(resolve => server.close(resolve)));

  await t.test('1. Não deve emitir token de sessão sem credenciais', async () => {
    const victim = await registerTenant('vitima');
    assert.equal(victim.status, 201);

    const res = await request('POST', '/api/v1/auth/token', { tenant_id: victim.json.tenant.id, role: 'admin' });
    assert.notEqual(res.status, 200);
    assert.equal(res.json?.token, undefined);
  });

  await t.test('2. Deve fazer login com e-mail e senha e recusar credenciais erradas', async () => {
    const created = await registerTenant('login');
    assert.equal(created.status, 201);

    const ok = await request('POST', '/api/v1/auth/login', { email: 'ADMIN@login.test', password: 'senha-de-teste-123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.role, 'admin');
    assert.equal(ok.json.tenant.id, created.json.tenant.id);

    const leads = await request('GET', '/api/v1/leads', null, ok.json.token);
    assert.equal(leads.status, 200);

    const wrongPassword = await request('POST', '/api/v1/auth/login', { email: 'admin@login.test', password: 'senha-errada-999' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.json.token, undefined);

    const unknownEmail = await request('POST', '/api/v1/auth/login', { email: 'ninguem@login.test', password: 'senha-de-teste-123' });
    assert.equal(unknownEmail.status, 401);
    assert.equal(unknownEmail.json.error, wrongPassword.json.error, 'A mensagem não deve revelar se o e-mail existe');
  });

  await t.test('3. Admin de uma empresa cliente não deve alterar o recebimento da plataforma', async () => {
    const tenant = await registerTenant('cliente');
    const before = await request('GET', '/api/v1/commercial/payment-settings');

    const res = await request('POST', '/api/v1/commercial/payment-settings', { pixKey: 'pix-de-terceiro@teste.test' }, tenant.json.token);
    assert.equal(res.status, 403);

    const after = await request('GET', '/api/v1/commercial/payment-settings');
    assert.equal(after.json.settings.pixKey, before.json.settings.pixKey);
  });

  await t.test('4. Webhook de cobrança assinado com os antigos segredos padrão deve ser recusado', async () => {
    const tenant = await registerTenant('webhook');
    const body = JSON.stringify({ id: 'evt-forjado', type: 'subscription.upgraded', data: { tenant_id: tenant.json.tenant.id, plan: 'enterprise' } });

    for (const oldDefault of ['billing_secret_nexus_2026', 'nexus_whsec_default_2026']) {
      const signature = crypto.createHmac('sha256', oldDefault).update(body).digest('hex');
      const res = await fetch(base + '/api/v1/commercial/billing-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-signature-256': `sha256=${signature}` },
        body
      });
      assert.equal(res.status, 401);
    }

    const subscription = await request('GET', '/api/v1/commercial/subscription', null, tenant.json.token);
    assert.equal(subscription.json.data.plan, 'pro', 'O plano não deve mudar com um webhook forjado');
  });

  await t.test('5. Só o front-end deve ser servido como arquivo estático', async () => {
    await request('POST', '/api/webhook/leads', { name: 'Lead Sigiloso', phone: '11900000000' });

    for (const blocked of [
      '/server/middleware/auth-context.js',
      '/server/config/secrets.js',
      '/data/webhook_leads.json',
      '/.env.production.example',
      '/.gitignore',
      '/package.json',
      '/Dockerfile',
      '/render.yaml',
      '/js/../server.js',
      '/js/%2e%2e/package.json'
    ]) {
      const res = await fetch(base + blocked);
      const text = await res.text();
      assert.ok(res.status === 404 || res.status === 403, `${blocked} respondeu ${res.status}`);
      assert.ok(!text.includes('JWT_SECRET') && !text.includes('Lead Sigiloso'), `${blocked} vazou conteúdo`);
    }

    for (const allowed of ['/', '/index.html', '/landing', '/termos', '/privacidade', '/manifest.json', '/sw.js', '/js/app.js', '/css/layout.css', '/assets/icon.svg']) {
      const res = await fetch(base + allowed);
      assert.equal(res.status, 200, `${allowed} deveria ser público`);
    }

    const clientRoute = await fetch(base + '/pipeline/kanban');
    assert.equal(clientRoute.status, 200);
    assert.match(await clientRoute.text(), /<html/i, 'Rotas do SPA devolvem a página inicial');
  });

  await t.test('6. Em produção, o servidor não deve subir sem os segredos', () => {
    const load = (env) => spawnSync(process.execPath, ['-e', "require('./server/config/secrets')"], {
      cwd: ROOT_DIR,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', ...env },
      encoding: 'utf8'
    });

    const strong = crypto.randomBytes(32).toString('hex');

    const missing = load({});
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /JWT_SECRET/);

    const weak = load({ JWT_SECRET: 'curto', MASTER_ENCRYPTION_KEY: strong, WEBHOOK_HMAC_SECRET: strong });
    assert.notEqual(weak.status, 0);

    const complete = load({ JWT_SECRET: strong, MASTER_ENCRYPTION_KEY: strong, WEBHOOK_HMAC_SECRET: strong });
    assert.equal(complete.status, 0, complete.stderr);
  });
});
