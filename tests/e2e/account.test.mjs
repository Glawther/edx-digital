/**
 * Conta de verdade, do cadastro ao bloqueio, num navegador de verdade, contra os emuladores
 * do Firebase nesta máquina (nunca contra a produção):
 *
 *   npm run test:e2e
 *
 * Cobre o que a demonstração não alcança: confirmar o e-mail para criar a empresa, o passeio
 * que começa sozinho, entrar por convite, cada um ver só o que é seu, e o bloqueio.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = 'demo-edx-digital';
const AUTH_ADMIN = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const RUN = Date.now().toString(36);
const password = () => `T-${crypto.randomBytes(9).toString('base64url')}`;

let server;
let browser;
let base;
const world = {};

async function adminCall(method, payload) {
  const res = await fetch(`${AUTH_ADMIN}/accounts:${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// What clicking the link in the confirmation e-mail does
async function confirmEmail(email) {
  const found = await adminCall('lookup', { email: [email] });
  const account = found.users && found.users[0];
  assert.ok(account, `conta ${email} não existe no emulador`);
  await adminCall('update', { localId: account.localId, emailVerified: true });
}

before(async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const channel of ['msedge', 'chrome']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ }
  }
});

after(async () => {
  for (const context of Object.values(world.contexts || {})) await context.close().catch(() => {});
  if (browser) await browser.close();
  if (server) server.kill();
});

/** A browser of its own for one person, pointed at the emulators */
async function person(name) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR' });
  (world.contexts ||= {})[name] = context;
  await context.addInitScript(() => localStorage.setItem('edx_use_emulator', '1'));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return { page, problems };
}

const toasts = (page) => page.locator('.toast').allTextContents();

test('criar empresa: pede a confirmação do e-mail, e só depois dela a empresa existe', async (t) => {
  if (!browser) return t.skip('Edge ou Chrome não encontrado nesta máquina');
  const dona = { ...(await person('dona')), email: `dona.${RUN}@teste.local`, password: password() };
  world.dona = dona;
  const { page } = dona;

  await page.goto(`${base}/#register`);
  await page.fill('#reg-input-name', 'Dona Teste');
  await page.fill('#reg-input-email', dona.email);
  await page.fill('#reg-input-company', `Empresa ${RUN}`);
  await page.fill('#reg-input-password', dona.password);
  await page.check('#reg-consent');
  await page.click('#btn-submit-register');

  await page.locator('#reg-verify-note').waitFor({ state: 'visible' });
  assert.equal(await page.textContent('#reg-verify-email'), dona.email);
  assert.equal((await page.textContent('#btn-submit-register')).trim(), 'Já confirmei, criar empresa');
  assert.equal(await page.locator('#auth-portal-screen').isVisible(), true, 'continua na tela de cadastro');

  // insistir sem confirmar não cria nada
  await page.click('#btn-submit-register');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /ainda não foi confirmado/.test(el.textContent)));
  assert.equal(await page.locator('#auth-portal-screen').isVisible(), true);

  await confirmEmail(dona.email);
  await page.click('#btn-submit-register');
  await page.locator('#today-content > *').first().waitFor({ timeout: 20000 });
  assert.match(await page.title(), new RegExp(`Empresa ${RUN}`));
});

test('conta nova: o passeio começa sozinho, e a tela Hoje convida a cadastrar a primeira oportunidade', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const { page, problems } = world.dona;
  await page.locator('.tour-card').waitFor({ timeout: 10000 });
  assert.match(await page.textContent('#tour-title'), /Bem-vindo/);
  await page.click('[data-tour="skip"]');
  await page.locator('.tour').waitFor({ state: 'detached' });

  assert.match(await page.textContent('#today-content'), /Nada por aqui ainda/);
  await page.click('#today-content [data-click="openNewOpportunity"]');
  await page.fill('#input-customer-name', 'Cliente da Dona');
  await page.fill('#input-deal-value', '8.000');
  await page.click('#btn-submit-customer');
  await page.click('.nav-item[data-view="pipeline"]');
  await page.locator('.lead-card', { hasText: 'Cliente da Dona' }).waitFor();
  assert.deepEqual(problems, []);
});

test('convite: o vendedor entra com o código, vê só a própria carteira, e a administradora vê tudo', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const dona = world.dona.page;
  await dona.click('.nav-item[data-view="team"]');
  const code = (await dona.textContent('#display-team-invite-code')).trim();
  assert.match(code, /^EDX-[A-Z0-9]{8}$/);

  const vendedor = { ...(await person('vendedor')), email: `vend.${RUN}@teste.local`, password: password() };
  world.vendedor = vendedor;
  const { page } = vendedor;
  await page.goto(`${base}/#register`);
  await page.click('#tab-reg-type-employee');
  await page.fill('#join-input-code', code);
  await page.fill('#join-input-name', 'Vendedor Teste');
  await page.fill('#join-input-email', vendedor.email);
  await page.fill('#join-input-password', vendedor.password);
  await page.check('#join-consent');
  await page.click('#btn-submit-join-team');

  // entra direto (o código já veio de quem administra) e também recebe o passeio
  await page.locator('.tour-card').waitFor({ timeout: 20000 });
  assert.match(await page.textContent('#tour-progress'), /de 12/, 'o passeio do vendedor não tem as telas de administrador');
  await page.click('[data-tour="skip"]');

  for (const view of ['team', 'audit', 'security']) {
    assert.equal(await page.locator(`.nav-item[data-view="${view}"]`).isVisible(), false, view);
  }
  await page.click('.nav-item[data-view="pipeline"]');
  assert.equal(await page.locator('.lead-card').count(), 0, 'não vê a oportunidade da administradora');

  await page.click('#btn-new-lead');
  await page.fill('#input-customer-name', 'Cliente do Vendedor');
  await page.fill('#input-deal-value', '1.500');
  await page.click('#btn-submit-customer');
  await page.locator('.lead-card', { hasText: 'Cliente do Vendedor' }).waitFor();

  await dona.click('.nav-item[data-view="pipeline"]');
  await dona.locator('.lead-card', { hasText: 'Cliente do Vendedor' }).waitFor({ timeout: 15000 });
  assert.equal(await dona.locator('.lead-card').count(), 2);
  assert.deepEqual(vendedor.problems, []);
});

test('bloqueio: a administradora bloqueia e o vendedor perde o acesso', async (t) => {
  if (!world.vendedor) return t.skip('depende do convite');
  const dona = world.dona.page;
  await dona.click('.nav-item[data-view="team"]');
  const row = dona.locator('#team-list-container tr', { hasText: 'Vendedor Teste' });
  await row.waitFor({ timeout: 15000 });
  const codeBefore = (await dona.textContent('#display-team-invite-code')).trim();
  await row.locator('[data-click="handleToggleEmployeeStatus"]').click();
  await dona.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /bloqueado/i.test(el.textContent)));
  // quem saiu conhecia o código: ele é trocado
  await dona.waitForFunction(old => document.getElementById('display-team-invite-code').textContent.trim() !== old, codeBefore);

  const { page } = world.vendedor;
  await page.reload();
  await page.locator('#auth-portal-screen').waitFor({ state: 'visible', timeout: 20000 });
  await page.fill('#login-input-email, #auth-input-email, #form-auth-login input[type="email"]', world.vendedor.email);
  await page.fill('#form-auth-login input[type="password"]', world.vendedor.password);
  await page.click('#form-auth-login button[type="submit"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /bloqueado/i.test(el.textContent)));
  assert.equal(await page.locator('#auth-portal-screen').isVisible(), true);
  assert.ok((await toasts(page)).some(text => /bloqueado/i.test(text)));
});
