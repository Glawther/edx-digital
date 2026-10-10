/**
 * Limites do plano contados pelo servidor, e-mails da manhã, envio pelo Brevo e relatos de erro.
 * Tudo sem rede: o banco e os serviços de fora são substituídos por versões de mentira.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createUsageService, customerChangeMatters, userChangeMatters } = require('../usage/usage-service');
const { runDailyEmails, buildPlanNotice, daysUntil } = require('../mail/daily-emails');
const { scrub } = require('../controllers/error-controller');

// ---------------------------------------------------------------- limites do plano

function usageWorld({ plan = 'starter', openLeads = 0, seats = 1, usage } = {}) {
  const org = { name: 'A', plan, ...(usage ? { usage } : {}) };
  const writes = [];
  const counted = [];
  const store = {
    getOrganization: async (id) => (id === 'org_a' ? { ...org } : null),
    updateOrganization: async (id, data) => { writes.push(data); Object.assign(org, data); },
    countDocs: async (collection, filters) => { counted.push({ collection, filters }); return collection === 'customers' ? openLeads : seats; }
  };
  return { org, writes, counted, service: createUsageService({ store }) };
}

test('limites: abaixo do limite nada é gravado; ao encher, a empresa é marcada', async () => {
  const quiet = usageWorld({ openLeads: 499, seats: 1 });
  assert.deepEqual(await quiet.service.refreshUsage('org_a'), { leadsFull: false, seatsFull: false, changed: false });
  assert.equal(quiet.writes.length, 0);
  assert.deepEqual(quiet.counted[0], { collection: 'customers', filters: [['orgId', 'org_a'], ['stage', 'IN', ['lead', 'contact', 'contacted', 'proposal', 'negotiation']]] });
  assert.deepEqual(quiet.counted[1], { collection: 'users', filters: [['orgId', 'org_a'], ['status', 'active']] });

  const full = usageWorld({ openLeads: 500, seats: 2 });
  assert.deepEqual(await full.service.refreshUsage('org_a'), { leadsFull: true, seatsFull: true, changed: true });
  assert.deepEqual(full.writes, [{ usage: { leadsFull: true, seatsFull: true } }]);
});

test('limites: quando abre vaga a marca sai, e uma segunda contagem igual não grava de novo', async () => {
  const world = usageWorld({ openLeads: 120, seats: 2, usage: { leadsFull: true, seatsFull: true } });
  assert.deepEqual(await world.service.refreshUsage('org_a'), { leadsFull: false, seatsFull: true, changed: true });
  await world.service.refreshUsage('org_a');
  assert.equal(world.writes.length, 1);
});

test('limites: o plano sem limite nem conta; empresa que não existe é ignorada', async () => {
  const world = usageWorld({ plan: 'enterprise', openLeads: 999999, seats: 999 });
  assert.deepEqual(await world.service.refreshUsage('org_a'), { leadsFull: false, seatsFull: false, changed: false });
  assert.equal(world.counted.length, 0);
  assert.equal(await world.service.refreshUsage('org_sumiu'), null);
  assert.equal(await world.service.refreshUsage(''), null);
});

test('limites: só recontam as mudanças que mexem na contagem', () => {
  const open = { orgId: 'a', stage: 'lead' };
  assert.equal(customerChangeMatters(null, open), true);                                  // criada
  assert.equal(customerChangeMatters(open, null), true);                                  // excluída
  assert.equal(customerChangeMatters(open, { ...open, stage: 'won' }), true);             // fechou
  assert.equal(customerChangeMatters({ ...open, stage: 'lost' }, open), true);            // reabriu
  assert.equal(customerChangeMatters(open, { ...open, stage: 'proposal', notes: 'x' }), false);
  assert.equal(customerChangeMatters(null, { orgId: 'a', stage: 'won' }), false);         // importada já fechada

  const active = { orgId: 'a', status: 'active' };
  assert.equal(userChangeMatters(null, active), true);
  assert.equal(userChangeMatters(active, { ...active, status: 'blocked' }), true);
  assert.equal(userChangeMatters(active, { ...active, name: 'Outro' }), false);
  assert.equal(userChangeMatters({ ...active, status: 'blocked' }, null), false);
});

// ---------------------------------------------------------------- e-mails da manhã

const NOW = new Date(2026, 9, 12, 8, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const day = (offset) => { const d = new Date(2026, 9, 12 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function mailWorld({ configured = true, failFor = null } = {}) {
  const ana = { id: 'ana', name: 'Ana Lima', email: 'ana@a.com' };
  const fresh = new Date(NOW.getTime() - DAY).toISOString();
  const stale = new Date(NOW.getTime() - 9 * DAY).toISOString();
  const data = {
    organizations: [
      { id: 'org_a', data: { name: 'Alfa', planStatus: 'trial', trialEndsAtMs: NOW.getTime() + 3 * DAY } },
      { id: 'org_b', data: { name: 'Beta', planStatus: 'active', paidUntilMs: NOW.getTime() + 20 * DAY } }
    ],
    users: {
      org_a: [
        { id: 'dona', data: { name: 'Dona Maria', email: 'dona@a.com', role: 'admin', status: 'active' } },
        { id: 'ana', data: { name: 'Ana Lima', email: 'ana@a.com', role: 'employee', status: 'active' } },
        { id: 'beto', data: { name: 'Beto', email: 'beto@a.com', role: 'employee', status: 'active', emailDigest: false } },
        { id: 'caio', data: { name: 'Caio', email: 'caio@a.com', role: 'employee', status: 'blocked' } },
        { id: 'dani', data: { name: 'Dani', email: 'dani@a.com', role: 'employee', status: 'active' } }
      ],
      org_b: [{ id: 'chefe', data: { name: 'Chefe', email: 'chefe@b.com', role: 'admin', status: 'active' } }]
    },
    customers: {
      org_a: [
        { id: 'c1', data: { name: 'Cliente <Um>', company: 'Loja', stage: 'proposal', dealValue: 3000, assignedTo: ana, updatedAt: fresh, tasks: [{ id: 't1', title: 'Ligar', dueDate: day(-2) }] } },
        { id: 'c2', data: { name: 'Cliente Dois', stage: 'lead', dealValue: 500, assignedTo: { id: 'beto' }, updatedAt: stale, tasks: [{ id: 't2', title: 'Visita', dueDate: day(0), dueTime: '10:00' }] } },
        { id: 'c3', data: { name: 'Cliente Três', stage: 'lead', dealValue: 100, assignedTo: { id: 'dani' }, updatedAt: fresh, tasks: [{ id: 't3', title: 'Mês que vem', dueDate: day(20) }] } }
      ],
      org_b: [{ id: 'd1', data: { name: 'Em dia', stage: 'lead', dealValue: 100, assignedTo: { id: 'chefe' }, updatedAt: fresh, tasks: [{ id: 't', title: 'x', dueDate: day(9) }] } }]
    }
  };
  const sent = [];
  const store = {
    listOrganizations: async () => data.organizations,
    listUsers: async (orgId) => data.users[orgId] || [],
    listCustomers: async (orgId) => data.customers[orgId] || []
  };
  const mailer = {
    isConfigured: () => configured,
    sendEmail: async (message) => {
      if (failFor && message.to.email === failFor) throw new Error('recusado');
      sent.push(message);
    }
  };
  const run = () => runDailyEmails({ store, mailer, loadToday: () => import('../../js/core/today.js'), now: NOW, log: { error() {} } });
  return { run, sent, data };
}

test('e-mails: sem o serviço configurado nada é enviado', async () => {
  const world = mailWorld({ configured: false });
  assert.deepEqual(await world.run(), { companies: 0, digests: 0, notices: 0, failed: 0, skipped: 'mail_not_configured' });
  assert.equal(world.sent.length, 0);
});

test('e-mails: cada pessoa recebe o que é dela; quem desligou, quem está bloqueado e quem não tem nada não recebem', async () => {
  const world = mailWorld();
  const result = await world.run();
  assert.deepEqual(result, { companies: 2, digests: 2, notices: 1, failed: 0 });

  const to = (email) => world.sent.filter(message => message.to.email === email);
  // a administradora: o aviso do teste e o resumo da empresa inteira
  assert.equal(to('dona@a.com').length, 2);
  const digestDona = to('dona@a.com').find(message => message.subject.startsWith('Hoje'));
  assert.match(digestDona.text, /Ligar/);
  assert.match(digestDona.text, /10:00 Visita/);
  assert.match(digestDona.text, /Cliente Dois, R\$ 500: sem atualização há 9 dias/);
  // a vendedora: só a própria carteira
  const [digestAna] = to('ana@a.com');
  assert.match(digestAna.subject, /1 tarefa atrasada/);
  assert.match(digestAna.text, /Olá, Ana\./);
  assert.match(digestAna.text, /atrasada há 2 dias/);
  assert.equal(/Visita/.test(digestAna.text), false);
  // nada de marcação vinda dos dados dentro do HTML
  assert.equal(digestAna.html.includes('<Um>'), false);
  assert.match(digestAna.html, /Cliente &lt;Um&gt;/);

  assert.equal(to('beto@a.com').length, 0);  // desligou o resumo
  assert.equal(to('caio@a.com').length, 0);  // bloqueado
  assert.equal(to('dani@a.com').length, 0);  // nada pendente
  assert.equal(to('chefe@b.com').length, 0); // tudo em dia e o plano longe de vencer
});

test('e-mails: uma falha de envio não interrompe os demais', async () => {
  const world = mailWorld({ failFor: 'ana@a.com' });
  const result = await world.run();
  assert.equal(result.failed, 1);
  assert.equal(result.digests, 1);
  assert.equal(result.notices, 1);
});

test('aviso de vencimento: só nos dias marcados, com o texto certo para teste e para plano pago', () => {
  const at = (days) => NOW.getTime() + days * DAY;
  assert.equal(daysUntil(at(3), NOW), 3);
  assert.equal(buildPlanNotice({ org: { planStatus: 'trial', trialEndsAtMs: at(2) }, now: NOW }), null);
  assert.equal(buildPlanNotice({ org: { planStatus: 'trial', trialEndsAtMs: at(-1) }, now: NOW }), null);
  assert.equal(buildPlanNotice({ org: { planStatus: 'trial' }, now: NOW }), null); // empresa antiga, sem data
  assert.match(buildPlanNotice({ org: { name: 'Alfa', planStatus: 'trial', trialEndsAtMs: at(1) }, now: NOW }).subject, /teste gratuito termina amanhã/);
  const paid = buildPlanNotice({ org: { name: 'Beta', planStatus: 'active', paidUntilMs: at(5), trialEndsAtMs: at(-40) }, now: NOW });
  assert.match(paid.subject, /plano vence em 5 dias/);
  assert.match(paid.text, /PIX/);
  assert.equal(buildPlanNotice({ org: { planStatus: 'active', paidUntilMs: at(4) }, now: NOW }), null);
});

// ---------------------------------------------------------------- Brevo

let brevo;
const brevoCalls = [];

before(async () => {
  brevo = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      brevoCalls.push({ url: req.url, key: req.headers['api-key'], body: JSON.parse(raw || '{}') });
      const refused = req.headers['api-key'] !== 'chave-de-teste';
      res.writeHead(refused ? 401 : 201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(refused ? { message: 'Key not found' } : { messageId: '<1@teste>' }));
    });
  });
  await new Promise(resolve => brevo.listen(0, '127.0.0.1', resolve));
  process.env.BREVO_API_BASE = `http://127.0.0.1:${brevo.address().port}`;
});

after(() => {
  for (const name of ['BREVO_API_BASE', 'BREVO_API_KEY', 'MAIL_SENDER']) delete process.env[name];
  brevo.close();
});

test('Brevo: só conta como configurado com a chave e um remetente de verdade', () => {
  const mailer = require('../mail/brevo');
  const set = (key, sender) => { process.env.BREVO_API_KEY = key; process.env.MAIL_SENDER = sender; };
  set('pendente', 'pendente');
  assert.equal(mailer.isConfigured(), false);
  set('chave-de-teste', 'pendente');
  assert.equal(mailer.isConfigured(), false);
  set('chave-de-teste', 'isto não é endereço');
  assert.equal(mailer.isConfigured(), false);
  set('chave-de-teste', 'EDX Digital <avisos@empresa.com>');
  assert.equal(mailer.isConfigured(), true);
  assert.deepEqual(mailer.parseSender('EDX Digital <avisos@empresa.com>'), { name: 'EDX Digital', email: 'avisos@empresa.com' });
  assert.deepEqual(mailer.parseSender('avisos@empresa.com'), { name: 'EDX Digital', email: 'avisos@empresa.com' });
});

test('Brevo: envia remetente, destinatário, assunto e as duas versões do texto; o erro chega com o motivo', async () => {
  const mailer = require('../mail/brevo');
  process.env.BREVO_API_KEY = 'chave-de-teste';
  process.env.MAIL_SENDER = 'EDX Digital <avisos@empresa.com>';
  await mailer.sendEmail({ to: { email: 'ana@a.com', name: 'Ana' }, subject: 'Assunto', text: 'texto', html: '<p>texto</p>' });
  const call = brevoCalls.at(-1);
  assert.equal(call.url, '/v3/smtp/email');
  assert.deepEqual(call.body, {
    sender: { name: 'EDX Digital', email: 'avisos@empresa.com' },
    to: [{ email: 'ana@a.com', name: 'Ana' }],
    subject: 'Assunto',
    textContent: 'texto',
    htmlContent: '<p>texto</p>'
  });

  process.env.BREVO_API_KEY = 'chave-errada';
  await assert.rejects(() => mailer.sendEmail({ to: { email: 'ana@a.com' }, subject: 's', text: 't', html: 'h' }), /Key not found/);
});

// ---------------------------------------------------------------- relatos de erro

test('relato de erro: e-mails e números longos não vão para o registro', () => {
  assert.equal(scrub('Falha ao salvar ana.lima@empresa.com.br (tel 11999990000) na linha 42'), 'Falha ao salvar [e-mail] (tel [número]) na linha 42');
});

test('relato de erro: o servidor aceita o relato, recusa o vazio e limita a quantidade por endereço', async () => {
  const server = require('../../server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/errors`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify(body) });
  const original = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    assert.equal((await post({ message: 'x is not a function', stack: 'at render (app.js:1:2)', view: 'today', version: '3.18.0', kind: 'error', orgId: 'org_secreta' })).status, 204);
    const line = JSON.parse(logged[0]);
    assert.equal(line.severity, 'ERROR');
    assert.deepEqual(Object.keys(line.report).sort(), ['browser', 'kind', 'message', 'stack', 'version', 'view']);
    assert.equal((await post({ message: '' })).status, 400);
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await post({ message: `erro ${i}` })).status);
    assert.ok(statuses.includes(429), 'depois de dez relatos no mesmo minuto o endereço é contido');
  } finally {
    console.error = original;
    await new Promise(resolve => server.close(resolve));
  }
});
