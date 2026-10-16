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
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: PROJECT, OWNER_EMAILS: `dona.${RUN}@teste.local` }, stdio: 'ignore' });
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
  // o cartão aparece um instante antes de receber o texto do primeiro passo
  await page.waitForFunction(() => /Bem-vindo/.test(document.getElementById('tour-title')?.textContent || ''), null, { timeout: 10000 });
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
  await page.waitForFunction(() => /de 12/.test(document.getElementById('tour-progress')?.textContent || ''), null, { timeout: 10000 }); // sem as telas de administrador
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

test('anexos: o arquivo é guardado na oportunidade, continua lá depois de recarregar e pode ser excluído', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const { page, problems } = world.dona;
  const open = async () => {
    await page.click('.nav-item[data-view="pipeline"]');
    await page.locator('.lead-card', { hasText: 'Cliente da Dona' }).click();
    await page.locator('#lead-attachments-block').waitFor({ state: 'visible' });
  };
  await open();
  assert.match(await page.textContent('#lead-details-attachments'), /Nenhum arquivo/);

  await page.setInputFiles('#lead-attachment-input', { name: 'Proposta assinada.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 arquivo de teste') });
  const row = page.locator('.attachment-row', { hasText: 'Proposta assinada.pdf' });
  await row.waitFor({ timeout: 20000 });
  assert.match(await row.textContent(), /pdf/);
  assert.match(await row.textContent(), /Dona Teste/);

  // um tipo que o navegador executaria é recusado antes de sair da máquina
  await page.setInputFiles('#lead-attachment-input', { name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<p>oi</p>') });
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /não é aceito/.test(el.textContent)));
  assert.equal(await page.locator('.attachment-row').count(), 1);

  await page.reload();
  await page.locator('#today-content > *').first().waitFor({ timeout: 20000 });
  await open();
  await row.waitFor({ timeout: 15000 });

  // o nome abre o endereço de download do arquivo guardado
  const [download] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 15000 }),
    row.locator('.attachment-name').click()
  ]);
  await download.close().catch(() => {});

  await row.locator('[data-click="handleDeleteAttachment"]').click();
  await row.waitFor({ state: 'detached', timeout: 15000 });
  assert.match(await page.textContent('#lead-details-attachments'), /Nenhum arquivo/);
  assert.match(await page.textContent('#lead-details-timeline'), /Arquivo excluído/);
  await page.click('#btn-close-lead-details');
  assert.deepEqual(problems, []);
});
test('dona do sistema: o painel aparece no menu, também depois de recarregar a página', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const { page } = world.dona;
  const entryShows = () => page.waitForFunction(() => document.getElementById('btn-menu-owner')?.hidden === false, null, { timeout: 15000 });
  await page.reload();
  await page.locator('#today-content > *').first().waitFor({ timeout: 20000 });
  await entryShows();

  // a cobrança de teste de R$ 1 é oferecida só a ela
  await page.evaluate(() => window.openCheckoutModal('starter'));
  await page.locator('#chk-test-row').waitFor({ state: 'visible' });
  await page.click('#btn-close-checkout-modal');

  // o vendedor bloqueado saiu; outra pessoa qualquer não vê nem o painel nem a opção
  assert.equal(await world.vendedor.page.evaluate(() => document.getElementById('btn-menu-owner').hidden), true);
});
// ---------------------------------------------------------------- texto hostil gravado por fora do aplicativo

test('texto hostil no banco (gravado por fora do aplicativo) aparece como texto em todas as telas, nunca como marcação', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const { page, problems } = world.dona;
  const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  const asServer = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
  const toValue = (v) => {
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  };
  const write = async (path, data, merge = false) => {
    const mask = merge ? '?' + Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&') : '';
    const res = await fetch(`${DOCS}/${path}${mask}`, { method: 'PATCH', headers: asServer, body: JSON.stringify(toValue(data).mapValue) });
    assert.equal(res.status, 200, `${path}: ${await res.text()}`);
  };
  const found = await (await fetch(`${DOCS}:runQuery`, {
    method: 'POST', headers: asServer,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: world.dona.email } } } } })
  })).json();
  const profile = found.find(row => row.document).document;
  const uid = profile.name.split('/').pop();
  const orgId = profile.fields.orgId.stringValue;

  // cada campo leva uma marca própria, para o teste dizer qual escapou
  const P = (n) => `x"'><img src=x onerror="window.__xss='${n}'" data-xss="${n}"><svg onload="window.__xss='${n}'"></svg><b data-xss="${n}">B</b>`;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const hostile = (id, extra) => ({
    orgId, name: P('name'), company: P('company'), role: P('role'), email: P('email'), phone: '(11) 98888-7777', notes: P('notes'),
    stage: 'lead', priority: P('priority'), dealValue: 1000, expectedCloseDate: today, pipelineId: 'default',
    tags: [P('tag')], createdAt: now, updatedAt: now, createdBy: P('createdBy'), updatedBy: P('updatedBy'),
    assignedTo: { id: uid, name: P('assignedName'), email: P('assignedEmail') },
    tasks: [{ id: 't1', title: P('taskTitle'), type: P('taskType'), dueDate: today, dueTime: '10:00', completed: false }],
    activities: [{ id: 'act1', type: P('actType'), title: P('actTitle'), text: P('actText'), author: P('actAuthor'), timestamp: now },
      { id: 'act2', type: 'call', title: P('callTitle'), text: P('callText'), author: P('callAuthor'), timestamp: now }],
    items: [{ description: P('item'), quantity: 2, unitPrice: 10 }],
    attachments: [{ id: 'a_xssxssxss1', ext: 'pdf', name: P('fileName'), size: 10, by: P('fileBy'), at: now }],
    custom: { cf_hostil: P('customValue') },
    id, ...extra
  });
  await write(`customers/xss-aberta-${RUN}`, hostile(`xss-aberta-${RUN}`, {}));
  await write(`customers/xss-perdida-${RUN}`, hostile(`xss-perdida-${RUN}`, { stage: 'lost', lossReason: P('lossReason'), lossDetails: P('lossDetails'), lostAt: now }));
  await write(`customers/xss-ganha-${RUN}`, hostile(`xss-ganha-${RUN}`, { stage: 'won', wonAt: now, recurring: true }));
  await write(`organizations/${orgId}`, {
    name: P('orgName'), legalName: P('legalName'), cnpj: P('cnpj'), brandColor: P('brandColor'), logoUrl: 'javascript:window.__xss="logo"',
    stageNames: { lead: P('stageLead'), contact: P('stageContact'), proposal: P('stageProposal'), negotiation: P('stageNeg'), won: P('stageWon'), lost: P('stageLost') },
    customFields: [{ id: 'cf_hostil', label: P('customLabel'), type: 'text' }],
    messageTemplates: [{ id: 'm1', name: P('templateName'), text: P('templateText') }],
    pipelines: [{ id: 'p_hostil123', name: P('pipelineName'), stageNames: { lead: P('pipelineStage') } }],
    stageRequirements: { proposal: [P('requirement')] }, sellerGoals: { [uid]: 1000 }, mainPipelineName: P('mainPipeline'), monthlyGoal: 5000
  }, true);
  await write(`users/${uid}`, { name: P('myName'), jobTitle: P('myJob'), department: P('myDept') }, true);
  await write(`users/colega-hostil-${RUN}`, { orgId, role: 'employee', status: 'active', name: P('mateName'), email: P('mateEmail'), jobTitle: P('mateJob'), department: P('mateDept') });
  await write(`audit_logs/xss-${RUN}`, { orgId, userId: uid, action: P('auditAction'), userName: P('auditName'), userEmail: P('auditEmail'), userRole: 'admin', severity: P('auditSeverity'), orgName: P('auditOrg'), timestamp: now, details: { campo: P('auditDetail') } });

  const escaped = async (where) => {
    const found = await page.evaluate(() => ({
      marks: [...new Set([...document.querySelectorAll('[data-xss]')].map(el => el.getAttribute('data-xss')))],
      ran: window.__xss || null,
      // um endereço perigoso num link ou numa imagem também é marcação que não devia existir
      links: [...document.querySelectorAll('a[href^="javascript:"], img[src^="javascript:"], [style*="data-xss"]')].length
    }));
    assert.deepEqual(found, { marks: [], ran: null, links: 0 }, where);
  };
  const closeDialogs = () => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));

  await page.reload();
  await page.locator('#today-content > *').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.body.textContent.includes('data-xss'), null, { timeout: 15000 });
  await escaped('tela Hoje');

  for (const view of ['pipeline', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security', 'today']) {
    await page.click(`.nav-item[data-view="${view}"]`);
    await page.waitForTimeout(700);
    await escaped(`tela ${view}`);
  }

  for (const id of [`xss-aberta-${RUN}`, `xss-perdida-${RUN}`, `xss-ganha-${RUN}`]) {
    for (const opener of ['handleOpenLeadDetails', 'handleOpenEditCustomer', 'handleOpenProposalModal', 'handleOpenWhatsAppModal']) {
      await page.evaluate(([fn, customerId]) => window[fn] && window[fn](customerId), [opener, id]);
      await page.waitForTimeout(500);
      await escaped(`${opener} em ${id}`);
      await closeDialogs();
    }
  }

  for (const entry of ['btn-menu-customize', 'btn-menu-billing', 'btn-menu-account', 'btn-menu-whitelabel', 'btn-menu-webhook', 'btn-menu-import', 'btn-menu-owner']) {
    await page.evaluate((id) => document.getElementById(id)?.click(), entry);
    await page.waitForTimeout(700);
    await escaped(`menu ${entry}`);
    await closeDialogs();
  }

  // a busca e o funil secundário também desenham os mesmos textos
  await page.click('.nav-item[data-view="pipeline"]');
  await page.fill('#global-search-input', 'x');
  await page.waitForTimeout(600);
  await escaped('busca');
  await page.fill('#global-search-input', '');
  await page.evaluate(() => document.querySelectorAll('[data-click="setActivePipeline"], .pipeline-switch button').forEach(button => button.click()));
  await page.waitForTimeout(500);
  await escaped('troca de funil');

  // relatórios exportados e títulos também não podem ter virado marcação em lugar nenhum
  assert.equal(await page.evaluate(() => document.querySelectorAll('script:not([src])').length), 0, 'nenhum script embutido na página');
  // e nenhuma tela quebrou por causa do texto estranho
  assert.deepEqual(problems, []);
});
test('duas sessões ao mesmo tempo: editar não desfaz a etapa mudada pela outra, e os dois registros no histórico ficam', async (t) => {
  if (!world.dona) return t.skip('depende do cadastro');
  const a = world.dona.page;
  const second = await person('dona-2');
  const b = second.page;
  await b.goto(base);
  await b.locator('#auth-portal-screen').waitFor({ state: 'visible', timeout: 20000 });
  await b.fill('#form-auth-login input[type="email"]', world.dona.email);
  await b.fill('#form-auth-login input[type="password"]', world.dona.password);
  await b.click('#form-auth-login button[type="submit"]');
  await b.locator('#today-content > *').first().waitFor({ timeout: 20000 });
  if (await b.locator('.tour-card').count()) await b.click('[data-tour="skip"]');

  const open = async (page) => {
    await page.click('.nav-item[data-view="pipeline"]');
    await page.locator('.lead-card', { hasText: 'Cliente da Dona' }).click();
    await page.locator('#lead-details-dialog[open]').waitFor();
  };

  // A abre o formulário de edição; enquanto isso, B muda a etapa
  await open(a);
  await a.click('#lead-details-actions [data-click="handleOpenEditCustomer"]');
  await a.locator('#customer-dialog[open]').waitFor();
  await open(b);
  await b.selectOption('#lead-details-stage', 'proposal');
  await a.waitForFunction(() => document.querySelector('.lead-card') && true);
  await new Promise(resolve => setTimeout(resolve, 1500));
  // A só muda o valor e salva
  await a.fill('#input-deal-value', '9.500');
  await a.click('#btn-submit-customer');
  await a.locator('#customer-dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
  await b.waitForFunction(() => /9\.500/.test(document.querySelector('#lead-details-summary')?.textContent || ''), null, { timeout: 15000 });
  assert.equal(await b.inputValue('#lead-details-stage'), 'proposal', 'a etapa mudada por B continua');

  // os dois registram um contato quase ao mesmo tempo
  if (!(await a.locator('#lead-details-dialog[open]').count())) await open(a);
  await a.fill('#contact-log-text', 'Ligação registrada por A');
  await b.fill('#contact-log-text', 'Mensagem registrada por B');
  await Promise.all([
    a.click('#contact-log-form button[type="submit"]'),
    b.click('#contact-log-form button[type="submit"]')
  ]);
  for (const page of [a, b]) {
    await page.waitForFunction(() => {
      const text = document.querySelector('#lead-details-timeline')?.textContent || '';
      return text.includes('Ligação registrada por A') && text.includes('Mensagem registrada por B');
    }, null, { timeout: 15000 });
  }
  await a.click('#btn-close-lead-details');
  await b.close();
  assert.deepEqual(world.dona.problems, []);
});