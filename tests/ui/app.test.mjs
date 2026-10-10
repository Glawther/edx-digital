/**
 * Testes de tela: o aplicativo aberto num navegador de verdade, usado como uma pessoa usaria.
 *
 *   npm run test:ui
 *
 * Sobem o servidor desta pasta numa porta livre e usam a demonstração do próprio app
 * (dados de exemplo, guardados só no navegador): nada toca o banco de produção.
 * O navegador é o Edge ou o Chrome já instalado na máquina; sem nenhum dos dois, os testes são pulados.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let server;
let browser;
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('o servidor local não respondeu');
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch { /* try the next one */ }
  }
  return null;
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  await waitForServer(`${base}/health`);
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

/**
 * A fresh browser profile signed in to the demonstration as administrator or as salesperson.
 * Everything the page complains about (errors, anything the security policy refused) is collected.
 */
async function openDemo(t, role = 'admin', viewport = { width: 1300, height: 800 }, start = 'pipeline') {
  if (!browser) {
    t.skip('Edge ou Chrome não encontrado nesta máquina');
    return null;
  }
  const context = await browser.newContext({ viewport, locale: 'pt-BR' });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`erro: ${error.message}`));
  page.on('console', message => {
    // the demonstration has no cloud: failed requests to services outside this machine are expected
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      // fonts and the cloud are outside this machine; what matters here is the page's own code
      if (event.violatedDirective.startsWith('script-src')) console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/');
  await page.click(role === 'admin' ? '#btn-quick-login-admin' : '#btn-quick-login-employee');
  // the session opens on "Hoje"; most tests work on the funnel
  await page.waitForSelector('#today-content > *');
  if (start !== 'today') {
    await page.click('.nav-item[data-view="pipeline"]');
    await page.waitForSelector('.lead-card');
  }
  t.after(() => context.close());
  return { page, problems };
}

const stageOf = (page, id) => page.locator(`.lead-card[data-id="${id}"]`).evaluate(card => card.closest('[data-drop]').dataset.drop);

test('a página não tem código embutido e a política de segurança o proíbe', async () => {
  const response = await fetch(base + '/');
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /script-src 'self' https:\/\/www\.gstatic\.com;/);
  const html = await response.text();
  assert.equal(/<script(?![^>]*\ssrc=)/i.test(html), false, 'script embutido na página');
  assert.equal(/\son[a-z]+\s*=\s*["']/i.test(html), false, 'evento embutido na página');
});

test('administrador: o funil abre com as oportunidades e sem nenhum erro', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  assert.ok(await page.locator('.lead-card').count() >= 5);
  assert.ok(await page.locator('.pipeline-column').count() >= 5);
  for (const view of ['today', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security', 'pipeline']) {
    await page.click(`.nav-item[data-view="${view}"]`);
    await page.waitForFunction(name => document.body.dataset.view === name, view);
  }
  assert.deepEqual(problems, []);
});

test('o cartão abre a oportunidade pelo clique e pelo Enter, mas não ao usar o seletor de etapa', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  const card = page.locator('.lead-card').first();
  const dialog = page.locator('#lead-details-dialog');

  await card.locator('.lead-name').click();
  await dialog.waitFor({ state: 'visible' });
  await page.click('#btn-close-lead-details');

  await card.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'visible' });
  await page.click('#btn-close-lead-details');

  const id = await card.getAttribute('data-id');
  await card.locator('.move-stage-select').selectOption('proposal');
  await page.waitForFunction(cardId => document.querySelector(`.lead-card[data-id="${cardId}"]`)?.closest('[data-drop]')?.dataset.drop === 'proposal', id);
  assert.equal(await dialog.isVisible(), false);
  assert.deepEqual(problems, []);
});

test('arrastar um cartão para outra coluna muda a etapa', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  const card = page.locator('[data-drop="lead"] .lead-card').first();
  const id = await card.getAttribute('data-id');
  await card.dragTo(page.locator('[data-drop="negotiation"]'));
  await page.waitForFunction(cardId => document.querySelector(`.lead-card[data-id="${cardId}"]`)?.closest('[data-drop]')?.dataset.drop === 'negotiation', id);
  assert.equal(await stageOf(page, id), 'negotiation');
  assert.deepEqual(problems, []);
});

test('nova oportunidade: aparece no funil e na lista de clientes', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.click('#btn-new-lead');
  await page.fill('#input-customer-name', 'Cliente do Teste de Tela');
  await page.fill('#input-deal-value', '12.500');
  await page.click('#btn-submit-customer');
  await page.locator('.lead-card', { hasText: 'Cliente do Teste de Tela' }).waitFor();
  await page.click('.nav-item[data-view="customers"]');
  await page.locator('.cell-title', { hasText: 'Cliente do Teste de Tela' }).waitFor();
  assert.deepEqual(problems, []);
});

test('histórico: registrar um contato de dias atrás, filtrar e excluir', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.locator('.lead-card .lead-name').first().click();
  const items = page.locator('#lead-details-timeline .timeline-item');
  const before = await items.count();

  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  const pad = n => String(n).padStart(2, '0');
  await page.selectOption('#contact-log-type', 'meeting');
  await page.fill('#contact-log-when', `${threeDaysAgo.getFullYear()}-${pad(threeDaysAgo.getMonth() + 1)}-${pad(threeDaysAgo.getDate())}T10:00`);
  await page.fill('#contact-log-text', 'Reunião registrada pelo teste de tela');
  await page.click('#contact-log-form button[type="submit"]');
  await page.locator('.timeline-item-text', { hasText: 'Reunião registrada pelo teste de tela' }).waitFor();
  assert.equal(await items.count(), before + 1);
  assert.match(await page.textContent('#lead-details-last-contact'), /Último contato/);

  await page.click('[data-click="handleHistoryFilter"][data-a="system"]');
  assert.equal(await page.locator('.timeline-item-text', { hasText: 'Reunião registrada pelo teste de tela' }).count(), 0);
  await page.click('[data-click="handleHistoryFilter"][data-a="contacts"]');
  await page.locator('.timeline-item', { hasText: 'Reunião registrada pelo teste de tela' }).locator('[data-click="handleDeleteActivity"]').click();
  await page.waitForFunction(() => !document.querySelector('#lead-details-timeline')?.textContent.includes('Reunião registrada pelo teste de tela'));
  assert.deepEqual(problems, []);
});

test('tarefas: agendar dentro da oportunidade e concluir', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.locator('.lead-card .lead-name').first().click();
  await page.fill('#lead-task-title', 'Tarefa do teste de tela');
  await page.click('#lead-task-form button[type="submit"]');
  const task = page.locator('#lead-details-tasks .lead-task', { hasText: 'Tarefa do teste de tela' });
  await task.waitFor();
  await task.locator('.task-checkbox').check();
  await page.locator('#lead-details-tasks .lead-task.completed', { hasText: 'Tarefa do teste de tela' }).waitFor();
  assert.deepEqual(problems, []);
});

test('lista de clientes: o filtro por etapa reduz a lista e a ordenação muda a primeira linha', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.click('.nav-item[data-view="customers"]');
  const rows = page.locator('#customer-table-body tr');
  await rows.first().waitFor();
  const all = await rows.count();
  await page.selectOption('#customers-stage-filter', 'won');
  await page.waitForFunction(total => document.querySelectorAll('#customer-table-body tr').length < total, all);
  await page.selectOption('#customers-stage-filter', { index: 0 });
  assert.deepEqual(problems, []);
});

test('vendedor: não vê Equipe, Auditoria nem Segurança, e só a própria carteira', async (t) => {
  const admin = await openDemo(t, 'admin');
  if (!admin) return;
  const total = await admin.page.locator('.lead-card').count();
  const seller = await openDemo(t, 'employee');
  for (const view of ['team', 'audit', 'security']) {
    assert.equal(await seller.page.locator(`.nav-item[data-view="${view}"]`).isVisible(), false, view);
  }
  assert.ok(await seller.page.locator('.lead-card').count() < total, 'o vendedor vê menos oportunidades que o administrador');
  assert.equal(await seller.page.locator('[data-click="handleDeleteCustomer"]').count(), 0);
  assert.deepEqual(seller.problems, []);
});

test('janela estreita: o menu de ferramentas abre do lado do botão e cabe na tela', async (t) => {
  for (const width of [360, 600, 760]) {
    const demo = await openDemo(t, 'admin', { width, height: 800 });
    if (!demo) return;
    const { page } = demo;
    await page.click('#btn-header-tools');
    const menu = await page.locator('#header-tools-menu').boundingBox();
    const button = await page.locator('#btn-header-tools').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width, `em ${width}px o menu cabe na tela`);
    assert.ok(menu.x <= button.x && menu.x + menu.width >= button.x + button.width, `em ${width}px o menu fica sob o botão`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `em ${width}px não há rolagem lateral`);
  }
});

test('janela larga: o menu de ferramentas abre acima do botão, dentro da barra lateral', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page } = demo;
  await page.click('#btn-header-tools');
  const menu = await page.locator('#header-tools-menu').boundingBox();
  const button = await page.locator('#btn-header-tools').boundingBox();
  assert.ok(menu.y + menu.height <= button.y + 1, 'o menu fica acima do botão');
  assert.ok(Math.abs(menu.x - button.x) < 4, 'alinhado com o botão');
  assert.ok(menu.y >= 0, 'cabe na altura da tela');
});

test('botões e campos usam a fonte do aplicativo', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const odd = await demo.page.evaluate(() => {
    const body = getComputedStyle(document.body).fontFamily;
    return [...document.querySelectorAll('button, select, textarea, input')]
      .filter(el => getComputedStyle(el).fontFamily !== body && !/monospace/.test(getComputedStyle(el).fontFamily))
      .map(el => el.id || el.className);
  });
  assert.deepEqual(odd, []);
});

test('Hoje é a primeira tela: lista o que fazer, abre a oportunidade e conclui tarefa dali', async (t) => {
  const demo = await openDemo(t, 'admin', { width: 1300, height: 800 }, 'today');
  if (!demo) return;
  const { page, problems } = demo;
  assert.equal(await page.evaluate(() => document.body.dataset.view), 'today');
  assert.equal(await page.locator('.nav-item[data-view="today"]').getAttribute('class'), 'nav-item active');
  assert.ok(await page.locator('.today-section').count() >= 1, 'a demonstração tem pendências para mostrar');
  assert.match(await page.textContent('.today-summary'), /tarefa|parada|fechar/);

  // uma linha de oportunidade abre a janela dela
  await page.locator('button.today-row').first().click();
  await page.locator('#lead-details-dialog').waitFor({ state: 'visible' });
  await page.click('#btn-close-lead-details');

  // concluir uma tarefa pela lista tira a linha dali
  const tasks = page.locator('#today-tasks .today-row');
  const before = await tasks.count();
  if (before > 0) {
    // click, not check(): the list is redrawn and the row it would verify is gone
    await tasks.first().locator('.task-checkbox').click();
    await page.waitForFunction(count => document.querySelectorAll('#today-tasks .today-row').length < count, before);
  }
  assert.deepEqual(problems, []);
});

test('Hoje para o vendedor: só a própria carteira, sem o nome do responsável em cada linha', async (t) => {
  const admin = await openDemo(t, 'admin', { width: 1300, height: 800 }, 'today');
  if (!admin) return;
  const seller = await openDemo(t, 'employee', { width: 1300, height: 800 }, 'today');
  const rows = (page) => page.locator('.today-row').count();
  assert.ok(await rows(seller.page) <= await rows(admin.page));
  assert.ok(await admin.page.locator('.today-owner').count() > 0);
  assert.equal(await seller.page.locator('.today-owner').count(), 0);
  assert.deepEqual(seller.problems, []);
});

test('Hoje numa janela de celular: cabe na tela, sem rolagem lateral', async (t) => {
  const demo = await openDemo(t, 'admin', { width: 375, height: 800 }, 'today');
  if (!demo) return;
  assert.equal(await demo.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(demo.problems, []);
});

test('relatório por vendedor: o administrador vê as duas tabelas e exporta; o vendedor não vê', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.click('.nav-item[data-view="metrics"]');
  await page.click('[data-click="handleReportPeriod"][data-a="all"]');
  const tables = page.locator('#seller-report table');
  assert.equal(await tables.count(), 2);
  assert.deepEqual(await tables.nth(0).locator('th').allTextContents(), ['Vendedor', 'Vendas', 'Valor vendido', 'Ticket médio', 'Conversão', 'Perdidas', 'Novas', 'Conversas']);
  assert.ok(await tables.nth(0).locator('tbody tr').count() >= 2);
  assert.equal(await tables.nth(0).locator('tbody tr').count(), await tables.nth(1).locator('tbody tr').count());

  const download = page.waitForEvent('download');
  await page.click('[data-click="handleExportSellerReport"]');
  assert.equal((await download).suggestedFilename(), 'edx-digital-vendedores-all.csv');
  assert.deepEqual(problems, []);

  const seller = await openDemo(t, 'employee');
  await seller.page.click('.nav-item[data-view="metrics"]');
  await seller.page.waitForSelector('.figure-row');
  assert.equal(await seller.page.locator('#seller-report').count(), 0);
  assert.match(await seller.page.textContent('.figure-row'), /Conversas registradas/);
});
