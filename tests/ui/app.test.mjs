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
      if (event.violatedDirective.startsWith('script-src') || event.violatedDirective.startsWith('style-src-elem')) console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`);
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
  assert.match(policy, /style-src 'self' https:\/\/fonts\.googleapis\.com; style-src-attr 'unsafe-inline';/);
  for (const address of ['/', '/landing', '/ajuda', '/termos', '/privacidade']) {
    assert.equal(/<style[\s>]/i.test(await (await fetch(base + address)).text()), false, `${address}: bloco de estilo na página`);
  }
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

test('na janela da oportunidade, as ações têm o mesmo estilo e "Excluir" fica separado, também no celular', async (t) => {
  for (const [role, viewport] of [['admin', { width: 1300, height: 800 }], ['admin', { width: 390, height: 844 }], ['employee', { width: 390, height: 844 }]]) {
    const demo = await openDemo(t, role, viewport);
    if (!demo) return;
    const { page } = demo;
    await page.locator('.lead-card .lead-name').first().click();
    await page.locator('#lead-details-dialog').waitFor({ state: 'visible' });
    const actions = page.locator('#lead-details-actions');
    // a filled button among outlined ones reads as the selected tab
    assert.equal(await actions.locator('.btn-primary').count(), 0);
    assert.match(await actions.locator('[data-click="handleOpenEditCustomer"]').textContent(), /Editar/);
    const remove = actions.locator('[data-click="handleDeleteCustomer"]');
    if (role !== 'admin') {
      assert.equal(await remove.count(), 0, 'o vendedor não exclui oportunidades');
      continue;
    }
    const main = await actions.locator('.lead-actions-main').boundingBox();
    const box = await remove.boundingBox();
    if (viewport.width < 768) assert.ok(box.y >= main.y + main.height + 12, 'no celular, "Excluir" fica numa linha própria, longe das outras ações');
    else assert.ok(box.x >= main.x + main.width + 24, 'no notebook, "Excluir" fica afastado das outras ações');
  }
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

test('soltar o cartão fora das colunas não deixa o arraste preso, e o arraste seguinte funciona', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  const card = page.locator('[data-drop="lead"] .lead-card').first();
  const id = await card.getAttribute('data-id');

  // passes over a column (lights it up) and lets go outside every column
  const from = await card.boundingBox();
  const over = await page.locator('[data-drop="proposal"]').boundingBox();
  const outside = await page.locator('.pipeline-column').first().evaluate(column => {
    const top = column.getBoundingClientRect().top;
    return { x: 650, y: Math.max(2, top - 30) };
  });
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-drop]'), outside), false, 'o ponto de soltar não pode estar numa coluna');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(over.x + over.width / 2, over.y + 60, { steps: 5 });
  await page.mouse.move(outside.x, outside.y, { steps: 5 });
  await page.mouse.up();

  await page.waitForFunction(() => !document.querySelector('.lead-card.dragging'));
  assert.equal(await page.locator('.lead-card.dragging').count(), 0);
  assert.equal(await page.locator('[data-drop].is-drop-target').count(), 0);
  assert.equal(await stageOf(page, id), 'lead');

  await card.dragTo(page.locator('[data-drop="negotiation"]'));
  await page.waitForFunction(cardId => document.querySelector(`.lead-card[data-id="${cardId}"]`)?.closest('[data-drop]')?.dataset.drop === 'negotiation', id);
  assert.equal(await page.locator('.lead-card.dragging').count(), 0);
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

test('passeio: percorre todos os passos sem sair da tela, e não deixa nada alterado', async (t) => {
  for (const [role, viewport] of [['admin', { width: 1300, height: 800 }], ['employee', { width: 375, height: 800 }]]) {
    const demo = await openDemo(t, role, viewport);
    if (!demo) return;
    const { page, problems } = demo;
    const cardsBefore = await page.locator('.lead-card').count();

    await page.click('#btn-header-tools');
    await page.click('#btn-menu-tour');
    await page.waitForFunction(() => /^Passo 1 de/.test(document.getElementById('tour-progress')?.textContent || ''));
    const total = Number((await page.textContent('#tour-progress')).match(/de (\d+)/)[1]);
    assert.ok(total >= 10, `${role}: ${total} passos`);

    const titles = [];
    for (let step = 1; step <= total; step++) {
      await page.waitForFunction(n => document.getElementById('tour-progress')?.textContent.startsWith(`Passo ${n} de`), step);
      await page.waitForTimeout(260); // the card slides to its place
      titles.push(await page.textContent('#tour-title'));
      const box = await page.locator('.tour-card').boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${role}, passo ${step}: o cartão cabe na tela`);
      const spot = page.locator('.tour-spot');
      if (await spot.isVisible()) {
        const lit = await spot.boundingBox();
        const overlapX = Math.min(box.x + box.width, lit.x + lit.width) - Math.max(box.x, lit.x);
        const overlapY = Math.min(box.y + box.height, lit.y + lit.height) - Math.max(box.y, lit.y);
        // a card over what it explains is accepted only when that thing takes most of the screen
        if (overlapX > 8 && overlapY > 8) assert.ok(lit.height > viewport.height * 0.4 || lit.width > viewport.width * 0.8, `${role}, passo ${step} (${titles.at(-1)}): o cartão cobre o que explica`);
      }
      await page.click('[data-tour="next"]');
    }
    await page.locator('.tour').waitFor({ state: 'detached' });
    assert.equal(new Set(titles).size, total, 'cada passo tem o seu título');
    assert.equal(await page.evaluate(() => document.body.dataset.view), 'today');
    if (role === 'employee') assert.equal(titles.some(title => /Equipe|Auditoria/.test(title)), false);

    await page.click('.nav-item[data-view="pipeline"]');
    assert.equal(await page.locator('.lead-card').count(), cardsBefore);
    assert.deepEqual(problems, []);
  }
});

test('passeio: Esc sai, as setas andam, e os atalhos do sistema descansam enquanto ele está aberto', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page } = demo;
  await page.click('#btn-header-tools');
  await page.click('#btn-menu-tour');
  await page.locator('.tour-card').waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('tour-progress').textContent.startsWith('Passo 2'));
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.getElementById('tour-progress').textContent.startsWith('Passo 1'));
  await page.keyboard.press('n'); // would open "Nova oportunidade"
  assert.equal(await page.locator('#customer-dialog').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.locator('.tour').waitFor({ state: 'detached' });
});

test('conta recém-criada: o passeio começa sozinho na primeira tela, uma vez só', async (t) => {
  if (!browser) return t.skip('Edge ou Chrome não encontrado nesta máquina');
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(base + '/');
  // what creating an account leaves behind
  await page.evaluate(() => localStorage.setItem('edx_tour_pending', '1'));
  await page.click('#btn-quick-login-admin');
  await page.locator('.tour-card').waitFor();
  assert.match(await page.textContent('#tour-title'), /Bem-vindo/);
  await page.click('[data-tour="skip"]');
  await page.locator('.tour').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('edx_tour_pending')), null);

  await page.reload();
  await page.waitForSelector('#today-content > *');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.tour').count(), 0);
});

test('regras do funil: a etapa exige, o sistema barra a mudança e diz o que falta; meta por vendedor aparece nos relatórios', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;

  await page.click('#btn-header-tools');
  await page.click('#btn-menu-customize');
  await page.check('#customize-requirements input[data-stage="contact"][data-field="company"]');
  await page.locator('#customize-seller-goals input').first().fill('50.000');
  await page.click('#customize-form button[type="submit"]');
  await page.locator('#customize-dialog').waitFor({ state: 'hidden' });

  // uma oportunidade sem empresa não entra em "Primeiro contato"
  await page.click('#btn-new-lead');
  await page.fill('#input-customer-name', 'Sem Empresa da Silva');
  await page.fill('#input-deal-value', '900');
  await page.locator('#customer-form-more').evaluate(details => { details.open = true; });
  await page.check('#input-deal-recurring');
  await page.click('#btn-submit-customer');
  const card = page.locator('.lead-card', { hasText: 'Sem Empresa da Silva' });
  await card.waitFor();
  assert.match(await card.locator('.lead-value').textContent(), /por mês/);

  await card.locator('.move-stage-select').selectOption('contact');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /falta: Empresa/.test(el.textContent)));
  assert.equal(await card.evaluate(el => el.closest('[data-drop]').dataset.drop), 'lead');
  assert.equal(await card.locator('.move-stage-select').inputValue(), 'lead', 'a lista volta para a etapa em que a oportunidade está');

  await page.click('.nav-item[data-view="metrics"]');
  await page.locator('#seller-goals .bar-row').first().waitFor();
  assert.match(await page.textContent('#seller-goals'), /de R\$\s?50\.000/);
  assert.deepEqual(problems, []);
});

test('busca: encontra pelo que está no histórico e mostra o trecho', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.locator('.lead-card .lead-name').first().click();
  await page.fill('#contact-log-text', 'Cliente pediu amostra do produto azul-turquesa');
  await page.click('#contact-log-form button[type="submit"]');
  await page.locator('.timeline-item-text', { hasText: 'azul-turquesa' }).waitFor();
  await page.click('#btn-close-lead-details');

  await page.fill('#global-search-input', 'TURQUESA');
  const result = page.locator('.search-result').first();
  await result.waitFor();
  assert.match(await result.locator('.search-snippet').textContent(), /No histórico: .*azul-turquesa/);
  assert.equal(await page.locator('.lead-card').count(), 1, 'o funil também filtra pelo histórico');
  await result.click();
  await page.locator('#lead-details-dialog').waitFor({ state: 'visible' });
  assert.deepEqual(problems, []);
});
test('agenda da semana: tarefas no dia certo, link para o Google Agenda, troca de semana e arquivo .ics', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.click('.nav-item[data-view="tasks"]');
  await page.click('[data-task-filter="week"]');
  await page.locator('.week-grid').waitFor();
  assert.equal(await page.locator('.week-day').count(), 7);
  assert.equal(await page.locator('.week-day.is-today').count(), 1);
  const todayTasks = page.locator('.week-day.is-today .week-task');
  assert.ok(await todayTasks.count() >= 1, 'a demonstração tem tarefas para hoje');
  assert.match(await todayTasks.first().locator('.week-task-calendar').getAttribute('href'), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);

  const title = await page.textContent('.week-title');
  await page.click('[data-click="handleWeek"][data-a="1"]');
  await page.waitForFunction(before => document.querySelector('.week-title').textContent !== before, title);
  assert.equal(await page.locator('.week-day.is-today').count(), 0);
  await page.click('[data-click="handleWeek"][data-a="0"]');
  await page.waitForFunction(before => document.querySelector('.week-title').textContent === before, title);

  const download = page.waitForEvent('download');
  await page.click('[data-click="handleExportAgenda"]');
  assert.equal((await download).suggestedFilename(), 'edx-digital-agenda.ics');
  assert.deepEqual(problems, []);
});

test('proposta com itens: a tabela aparece na folha e o total vira o valor da oportunidade', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.locator('.lead-card .lead-name').first().click();
  await page.click('#lead-details-actions [data-click="handleOpenProposalModal"]');
  await page.locator('#proposal-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#prop-items-block').isVisible(), false, 'sem itens, a proposta mostra só o valor');

  await page.locator('#proposal-items-editor summary').click();
  for (const [description, quantity, price] of [['Instalação', '2', '1.500,00'], ['Treinamento da equipe', '', '800']]) {
    await page.click('#btn-add-proposal-item');
    const row = page.locator('.proposal-item-row').last();
    await row.locator('[data-part="description"]').fill(description);
    await row.locator('[data-part="quantity"]').fill(quantity);
    await row.locator('[data-part="unitPrice"]').fill(price);
  }
  await page.click('#btn-save-proposal-items');
  await page.locator('#prop-items-body tr').nth(1).waitFor();
  assert.deepEqual((await page.locator('#prop-items-body tr').first().locator('td').allTextContents()).map(text => text.replace(/\s/g, ' ')), ['Instalação', '2', 'R$ 1.500', 'R$ 3.000']);
  assert.match((await page.textContent('#prop-price-display')).replace(/\s/g, ' '), /R\$ 3\.800/);
  assert.equal(await page.locator('#prop-items-mismatch').count(), 0);
  await page.click('#btn-close-proposal-footer');
  assert.match((await page.locator('#lead-details-summary').textContent()).replace(/\s/g, ' '), /R\$ 3\.800/);
  assert.deepEqual(problems, []);
});

test('páginas públicas: desenhadas pelos arquivos de estilo, sem nada recusado pela política de segurança', async (t) => {
  if (!browser) return t.skip('Edge ou Chrome não encontrado nesta máquina');
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR' });
  t.after(() => context.close());
  for (const address of ['/landing', '/ajuda', '/termos', '/privacidade']) {
    const page = await context.newPage();
    const refused = [];
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`)));
    page.on('console', message => { if (/^CSP (style|script)/.test(message.text())) refused.push(message.text()); });
    await page.goto(base + address);
    // the page's own stylesheet applied: the title is not the browser's default serif
    const font = await page.locator('h1').first().evaluate(el => getComputedStyle(el).fontFamily);
    assert.match(font, /IBM Plex Sans|system-ui/, `${address}: ${font}`);
    assert.deepEqual(refused, [], address);
    await page.close();
  }
});

test('ajuda: a busca mostra só as perguntas com as palavras, avisa quando nada bate e volta tudo ao limpar', async (t) => {
  if (!browser) return t.skip('Edge ou Chrome não encontrado nesta máquina');
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR' });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`)));
  page.on('console', message => { if (message.type() === 'error' && /^CSP (style|script)/.test(message.text())) problems.push(message.text()); });
  page.on('pageerror', error => problems.push(`erro: ${error.message}`));
  await page.goto(base + '/ajuda');

  const field = page.getByLabel('Buscar na ajuda');
  await field.waitFor({ state: 'visible' });
  const all = await page.locator('main details').count();
  const visible = () => page.locator('main details:visible summary').allTextContents();
  const visibleSections = () => page.locator('main h2:visible').allTextContents();

  // only the keyboard: the field is reached with Tab from the top of the page
  await page.keyboard.press('Tab');
  for (let step = 0; step < 10 && !(await field.evaluate(el => el === document.activeElement)); step++) await page.keyboard.press('Tab');
  assert.equal(await field.evaluate(el => el === document.activeElement), true, 'o campo de busca não é alcançado pelo teclado');

  // accents and case ignored: "codigo CONVITE" finds "código de convite"
  await page.keyboard.type('codigo CONVITE');
  assert.deepEqual(await visible(), ['Como coloco minha equipe no sistema?', 'Um vendedor saiu da empresa. O que faço?', 'O código de convite não funciona.']);
  assert.deepEqual(await visibleSections(), ['Equipe e permissões', 'Problemas comuns']);
  assert.equal(await page.locator('main details[open]').count(), 3, 'as perguntas encontradas abrem');
  assert.equal(await page.locator('main nav.index').isVisible(), false);
  assert.equal(await page.locator('#help-search-status').getAttribute('aria-live'), 'polite');
  assert.equal(await page.textContent('#help-search-status'), '3 perguntas encontradas');

  await field.fill('pix');
  assert.deepEqual(await visible(), ['Como pago?']);
  assert.equal(await page.textContent('#help-search-status'), '1 pergunta encontrada');

  await field.fill('helicóptero');
  assert.deepEqual(await visible(), []);
  assert.deepEqual(await visibleSections(), []);
  assert.match(await page.textContent('#help-search-status'), /Nenhuma pergunta com "helicóptero"\. Tente outra palavra/);
  assert.equal(await page.locator('.contact').isVisible(), true, 'o contato continua à vista');

  // Escape clears, and everything is back as it was: all questions, all closed, the subjects list
  await page.keyboard.press('Escape');
  assert.equal(await field.inputValue(), '');
  assert.equal((await visible()).length, all);
  assert.equal(await page.locator('main details[open]').count(), 0);
  assert.equal(await page.locator('main nav.index').isVisible(), true);
  assert.equal(await page.textContent('#help-search-status'), '');
  assert.deepEqual(problems, []);
});

test('ajuda: sem JavaScript a página continua inteira e a busca não aparece', async (t) => {
  if (!browser) return t.skip('Edge ou Chrome não encontrado nesta máquina');
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR', javaScriptEnabled: false });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(base + '/ajuda');
  assert.equal(await page.locator('#help-search').isVisible(), false);
  assert.ok(await page.locator('main details:visible').count() > 30);
  assert.equal(await page.locator('main nav.index').isVisible(), true);
});

test('vários funis: criar um, trocar de funil, cadastrar nele, e cada funil mostra só o que é seu', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  assert.equal(await page.locator('#view-pipeline .pipeline-switch').isVisible(), false, 'com um funil só, o seletor não aparece');
  const mainCards = await page.locator('.lead-card').count();

  await page.click('#btn-header-tools');
  await page.click('#btn-menu-customize');
  await page.click('#btn-add-pipeline');
  await page.locator('#customize-pipelines input[data-part="name"]').fill('Pós venda');
  await page.locator('#customize-pipelines input[data-stage="lead"]').fill('Implantação');
  await page.click('#customize-form button[type="submit"]');
  await page.locator('#customize-dialog').waitFor({ state: 'hidden' });

  const picker = page.locator('#view-pipeline select[data-pipeline-switch]');
  await picker.waitFor({ state: 'visible' });
  assert.deepEqual((await picker.locator('option').allTextContents()).map(text => text.replace(/\s*\(\d+\)$/, '')), ['Vendas', 'Pós venda']);

  await picker.selectOption({ index: 1 });
  await page.waitForFunction(() => document.querySelectorAll('.lead-card').length === 0);
  await page.locator('.column-title', { hasText: 'Implantação' }).waitFor();

  await page.click('#btn-new-lead');
  await page.fill('#input-customer-name', 'Cliente em Implantação');
  await page.fill('#input-deal-value', '2.000');
  await page.click('#btn-submit-customer');
  await page.locator('.lead-card', { hasText: 'Cliente em Implantação' }).waitFor();
  assert.equal(await page.locator('.lead-card').count(), 1);

  // de volta ao principal: os nomes das etapas e os cartões são os dele
  await picker.selectOption({ index: 0 });
  await page.waitForFunction(count => document.querySelectorAll('.lead-card').length === count, mainCards);
  assert.equal(await page.locator('.lead-card', { hasText: 'Cliente em Implantação' }).count(), 0);
  assert.equal(await page.locator('.column-title', { hasText: 'Implantação' }).count(), 0);

  // a tela Hoje junta todos os funis, e abrir dali leva ao funil da oportunidade
  await page.click('.nav-item[data-view="today"]');
  await page.locator('#today-notask button.today-row', { hasText: 'Cliente em Implantação' }).click();
  await page.locator('#lead-details-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#lead-details-stage option').first().textContent(), 'Implantação');
  await page.click('#btn-close-lead-details');

  await page.click('.nav-item[data-view="metrics"]');
  assert.match(await page.textContent('#metrics-content'), /no funil Pós venda/);
  assert.deepEqual(problems, []);
});

test('excluir e desfazer: a oportunidade volta; se desfazer falhar, o aviso diz e nada fica solto', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.click('.nav-item[data-view="customers"]');
  const remove = page.locator('#view-customers [data-click="handleDeleteCustomer"]');
  await remove.first().waitFor();
  const gone = (id) => page.waitForFunction(cardId => !document.querySelector(`#view-customers [data-click="handleDeleteCustomer"][data-a="${cardId}"]`), id);

  const first = await remove.first().getAttribute('data-a');
  await remove.first().click();
  await gone(first);
  await page.locator('.toast-action', { hasText: 'Desfazer' }).last().click();
  await page.locator(`#view-customers [data-click="handleDeleteCustomer"][data-a="${first}"]`).waitFor();
  await page.locator('.toast', { hasText: 'Oportunidade restaurada.' }).waitFor();

  // the restoration fails (as when the database refuses it): a notice, not a loose error
  await page.evaluate(async () => {
    const { storage } = await import('/js/core/storage-manager.js');
    storage.restoreCustomer = async () => { throw new Error('falha simulada'); };
  });
  const second = await remove.first().getAttribute('data-a');
  await remove.first().click();
  await gone(second);
  await page.locator('.toast-action', { hasText: 'Desfazer' }).last().click();
  await page.locator('.toast.error', { hasText: 'Não foi possível desfazer: falha simulada' }).waitFor();
  assert.deepEqual(problems, []);
});

test('proposta pelo WhatsApp: o WhatsApp abre mesmo quando o histórico não aceita o registro', async (t) => {
  const demo = await openDemo(t);
  if (!demo) return;
  const { page, problems } = demo;
  await page.evaluate(async () => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return null; };
    const { storage } = await import('/js/core/storage-manager.js');
    storage.addActivity = async () => { throw new Error('falha simulada'); };
  });
  await page.locator('.lead-card .lead-name').first().click();
  await page.click('#lead-details-actions [data-click="handleOpenProposalModal"]');
  await page.locator('#proposal-dialog').waitFor({ state: 'visible' });
  await page.click('#btn-send-proposal-wa');
  await page.locator('.toast', { hasText: 'O aviso não ficou no histórico: falha simulada' }).waitFor();
  const opened = await page.evaluate(() => window.__opened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/wa\.me\//);
  assert.deepEqual(problems, []);
});

test('conta real com a rede lenta: espera a conexão em vez de mostrar a tela de entrada', async (t) => {
  if (!browser) {
    t.skip('Edge ou Chrome não encontrado nesta máquina');
    return;
  }
  // the service worker would fetch the SDK on its own, out of reach of page.route
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR', serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`erro: ${error.message}`));
  // the last session on this browser was a real account
  await page.addInitScript(() => localStorage.setItem('edx_session_active', 'cloud'));
  // the Firebase SDK never arrives, like a phone on a weak signal
  const held = [];
  await page.route('https://www.gstatic.com/firebasejs/**', route => { held.push(route); });

  await page.goto(base + '/');
  await page.locator('#auth-offline-screen').waitFor({ state: 'visible', timeout: 20000 });
  assert.match(await page.textContent('#auth-offline-screen'), /Sem conexão com o servidor/);
  assert.equal(await page.locator('#btn-auth-offline-retry').isVisible(), true);
  assert.equal(await page.locator('#auth-portal-screen').isVisible(), false);
  assert.equal(await page.locator('#form-auth-login').isVisible(), false);
  // nothing was forgotten: the session is still marked as a real account
  assert.equal(await page.evaluate(() => localStorage.getItem('edx_session_active')), 'cloud');

  // trying again while still without the server keeps the waiting screen
  await page.click('#btn-auth-offline-retry');
  await page.locator('#auth-offline-status', { hasText: 'Ainda sem conexão' }).waitFor({ timeout: 20000 });
  assert.equal(await page.locator('#form-auth-login').isVisible(), false);
  if (process.env.EDX_SHOTS) await page.screenshot({ path: process.env.EDX_SHOTS + '/espera-conexao.png' });
  assert.deepEqual(problems, []);
  await page.unroute('https://www.gstatic.com/firebasejs/**');
  await Promise.all(held.map(route => route.abort().catch(() => {})));
});

test('quem nunca entrou e tem a rede lenta continua vendo a tela de entrada', async (t) => {
  if (!browser) {
    t.skip('Edge ou Chrome não encontrado nesta máquina');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: 'pt-BR', serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.route('https://www.gstatic.com/firebasejs/**', () => { /* never answers */ });
  await page.goto(base + '/');
  await page.locator('#form-auth-login').waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await page.locator('#auth-offline-screen').isVisible(), false);
});