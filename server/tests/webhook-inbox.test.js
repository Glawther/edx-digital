/**
 * Leads de formulário: o servidor grava o contato direto na empresa dona do token.
 * Ninguém lê nem apaga leads pelo navegador, e um token só alcança a própria empresa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLeadIntake, IntakeError, hashOf } = require('../services/lead-intake');
const { normalizeLeadPayload } = require('../services/lead-storage');

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function world({ org = {} } = {}) {
  const db = {
    users: {
      dona: { orgId: 'org_a', role: 'admin', status: 'active', name: 'Dona', email: 'dona@a.test' },
      vend: { orgId: 'org_a', role: 'employee', status: 'active', name: 'Vendedor', email: 'v@a.test' },
      outra: { orgId: 'org_b', role: 'admin', status: 'active', name: 'Outra', email: 'o@b.test' }
    },
    organizations: {
      org_a: { name: 'Alfa', ownerUid: 'dona', planStatus: 'trial', trialEndsAtMs: NOW + 5 * DAY, ...org },
      org_b: { name: 'Beta', ownerUid: 'outra', planStatus: 'trial', trialEndsAtMs: NOW + 5 * DAY }
    },
    config: {}, tokens: {}, customers: {}
  };
  const store = {
    getUserProfile: async (uid) => db.users[uid] || null,
    getOrganization: async (id) => db.organizations[id] || null,
    getConfig: async (orgId) => db.config[orgId] || null,
    saveConfig: async (orgId, data) => { db.config[orgId] = data; },
    getToken: async (hash) => db.tokens[hash] || null,
    saveToken: async (hash, data) => { db.tokens[hash] = data; },
    deleteToken: async (hash) => { delete db.tokens[hash]; },
    findCustomer: async (orgId, field, value) => {
      const hit = Object.entries(db.customers).find(([, c]) => c.orgId === orgId && c[field] === value);
      return hit ? { id: hit[0], data: hit[1] } : null;
    },
    createCustomer: async (id, data) => { db.customers[id] = data; },
    appendActivity: async (id, activity) => { db.customers[id].activities.push(activity); }
  };
  let n = 0;
  const intake = createLeadIntake({ store, now: () => NOW, randomToken: () => `edxwh_token_de_teste_${++n}_${'x'.repeat(20)}` });
  return { db, intake };
}

const lead = (extra) => normalizeLeadPayload({ nome: 'Maria', email: 'Maria@Cliente.com', telefone: '(11) 98888-7777', origem: 'Site', mensagem: 'Quero orçamento', ...extra });

test('só quem administra a empresa vê e gera o token; gerar outro desliga o anterior', async () => {
  const { intake, db } = world();
  assert.equal(await intake.currentToken({ uid: 'dona' }), null);
  await assert.rejects(intake.issueToken({ uid: 'vend' }), err => err instanceof IntakeError && err.status === 403);
  await assert.rejects(intake.currentToken({ uid: 'ninguem' }), err => err.status === 403);

  const first = await intake.issueToken({ uid: 'dona' });
  assert.equal(await intake.currentToken({ uid: 'dona' }), first);
  assert.deepEqual(db.tokens[hashOf(first)], { orgId: 'org_a' });
  assert.equal(Object.values(db.config.org_a).includes(first), true);

  const second = await intake.issueToken({ uid: 'dona' });
  assert.notEqual(second, first);
  assert.equal(db.tokens[hashOf(first)], undefined, 'o token antigo deixa de valer');
  await assert.rejects(intake.ingest(first, lead()), err => err.status === 401);
  assert.equal((await intake.ingest(second, lead())).status, 'created');
});

test('o contato vira oportunidade da empresa dona do token, com o dono como responsável', async () => {
  const { intake, db } = world();
  const token = await intake.issueToken({ uid: 'dona' });
  const other = await intake.issueToken({ uid: 'outra' });
  const result = await intake.ingest(token, lead({ valor: 2500, empresa: 'Cliente SA' }));
  assert.equal(result.status, 'created');
  const created = db.customers[result.id];
  assert.equal(created.orgId, 'org_a');
  assert.equal(created.stage, 'lead');
  assert.equal(created.email, 'maria@cliente.com');
  assert.equal(created.dealValue, 2500);
  assert.deepEqual(created.assignedTo, { id: 'dona', name: 'Dona', email: 'dona@a.test' });
  assert.equal(created.fromForm, true);
  assert.match(created.activities[0].text, /Origem: Site\. Quero orçamento/);

  await intake.ingest(other, lead({ nome: 'Da B', email: 'b@b.com', telefone: '' }));
  assert.equal(Object.values(db.customers).filter(c => c.orgId === 'org_b').length, 1);
  assert.equal(Object.values(db.customers).filter(c => c.orgId === 'org_a').length, 1);
});

test('o mesmo formulário enviado duas vezes não cria duas oportunidades: vira uma anotação', async () => {
  const { intake, db } = world();
  const token = await intake.issueToken({ uid: 'dona' });
  await intake.ingest(token, lead());
  const again = await intake.ingest(token, lead({ email: 'MARIA@cliente.com', mensagem: 'De novo' }));
  assert.equal(again.status, 'duplicate');
  assert.equal(Object.keys(db.customers).length, 1);
  const [only] = Object.values(db.customers);
  assert.equal(only.activities.length, 2);
  assert.match(only.activities[1].title, /Novo contato pelo formulário/);
  // só o telefone igual também conta como o mesmo contato
  assert.equal((await intake.ingest(token, lead({ email: '' }))).status, 'duplicate');
});

test('token desconhecido, plano vencido ou plano cheio: nada é criado, e a resposta diz por quê', async () => {
  const { intake } = world();
  await assert.rejects(intake.ingest('edxwh_nao_existe_xxxxxxxxxxxxxxxxxx', lead()), err => err.status === 401);

  const expired = world({ org: { planStatus: 'trial', trialEndsAtMs: NOW - DAY } });
  const t1 = await expired.intake.issueToken({ uid: 'dona' });
  await assert.rejects(expired.intake.ingest(t1, lead()), err => err.status === 403 && /vencido/.test(err.message));
  assert.equal(Object.keys(expired.db.customers).length, 0);

  const full = world({ org: { usage: { leadsFull: true } } });
  const t2 = await full.intake.issueToken({ uid: 'dona' });
  await assert.rejects(full.intake.ingest(t2, lead()), err => err.status === 403 && /limite/.test(err.message));

  const paid = world({ org: { planStatus: 'active', paidUntilMs: NOW - DAY } }); // dentro dos 3 dias de tolerância
  const t3 = await paid.intake.issueToken({ uid: 'dona' });
  assert.equal((await paid.intake.ingest(t3, lead())).status, 'created');
});

test('o que chega é guardado como texto simples, com tamanho limitado', () => {
  const clean = normalizeLeadPayload({ nome: '<script>alert(1)</script>Ana & Cia', telefone: 11988887777, valor: 'abc', mensagem: 'm'.repeat(5000), campo_estranho: { a: 1 } });
  assert.equal(clean.name, 'scriptalert(1)/scriptAna & Cia');
  assert.equal(clean.phone, '11988887777');
  assert.equal(clean.value, 0);
  assert.equal(clean.notes.length, 2000);
  assert.ok(!('campo_estranho' in clean));
});