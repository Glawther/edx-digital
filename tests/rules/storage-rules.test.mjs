/**
 * Testes das regras de acesso aos arquivos (Firebase Storage).
 *
 * Rodam contra os emuladores locais, nunca contra a produção:
 *   npm run test:rules
 *
 * Os perfis e as oportunidades são gravados direto no emulador do banco (como o servidor
 * faria); cada pedido de arquivo leva o token de uma conta criada no emulador de autenticação.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = 'demo-edx-digital';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FILES = `http://127.0.0.1:9199/v0/b/${PROJECT}.firebasestorage.app/o`;
const RUN = Date.now().toString(36);
const PDF = 'application/pdf';

async function signUp(label) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${label}.${RUN}@arquivos.local`, password: 'senha-de-teste-123', returnSecureToken: true })
  });
  const body = await res.json();
  assert.ok(body.idToken, `conta de teste não criada: ${JSON.stringify(body)}`);
  return { uid: body.localId, token: body.idToken };
}

function toValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

// Gravado como o projeto, sem passar pelas regras do banco
async function seed(path, data) {
  const res = await fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(toValue(data).mapValue)
  });
  assert.equal(res.status, 200, `semente ${path}: ${await res.text()}`);
}

const auth = (who) => (who ? { Authorization: `Firebase ${who.token}` } : {});

async function upload(who, path, { contentType = PDF, disposition = 'attachment; filename="a.pdf"', bytes = 20 } = {}) {
  const boundary = 'limite' + RUN;
  const meta = { name: path, contentType, ...(disposition ? { contentDisposition: disposition } : {}) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.alloc(bytes, 'a'),
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const res = await fetch(`${FILES}?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { ...auth(who), 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  return res.status;
}

const download = async (who, path) => (await fetch(`${FILES}/${encodeURIComponent(path)}?alt=media`, { headers: auth(who) })).status;
const remove = async (who, path) => (await fetch(`${FILES}/${encodeURIComponent(path)}`, { method: 'DELETE', headers: auth(who) })).status;
const list = async (who, prefix) => (await fetch(`${FILES}?prefix=${encodeURIComponent(prefix)}`, { headers: auth(who) })).status;

const orgA = `orgA_${RUN}`;
const orgB = `orgB_${RUN}`;
const leadAna = `lead-ana-${RUN}`;   // da empresa A, do vendedor Ana
const leadRui = `lead-rui-${RUN}`;   // da empresa A, do vendedor Rui
const leadB = `lead-b-${RUN}`;       // da empresa B
const file = (org, lead, name = 'a_arquivo001.pdf') => `orgs/${org}/customers/${lead}/${name}`;
const people = {};

before(async () => {
  for (const [name, orgId, role, status] of [
    ['admin', orgA, 'admin', 'active'], ['ana', orgA, 'employee', 'active'], ['rui', orgA, 'employee', 'active'],
    ['bloqueado', orgA, 'employee', 'blocked'], ['adminB', orgB, 'admin', 'active']
  ]) {
    people[name] = await signUp(name);
    await seed(`users/${people[name].uid}`, { orgId, role, status, name });
  }
  people.semPerfil = await signUp('semperfil');
  await seed(`customers/${leadAna}`, { orgId: orgA, name: 'Cliente da Ana', stage: 'lead', assignedTo: { id: people.ana.uid } });
  await seed(`customers/${leadRui}`, { orgId: orgA, name: 'Cliente do Rui', stage: 'lead', assignedTo: { id: people.rui.uid } });
  await seed(`customers/${leadB}`, { orgId: orgB, name: 'Cliente da B', stage: 'lead', assignedTo: { id: people.adminB.uid } });
});

test('o vendedor responsável anexa, baixa e exclui; o administrador também', async () => {
  assert.equal(await upload(people.ana, file(orgA, leadAna)), 200);
  assert.equal(await download(people.ana, file(orgA, leadAna)), 200);
  assert.equal(await download(people.admin, file(orgA, leadAna)), 200);
  assert.equal(await upload(people.admin, file(orgA, leadAna, 'a_arquivo002.png'), { contentType: 'image/png' }), 200);
  assert.equal(await remove(people.admin, file(orgA, leadAna, 'a_arquivo002.png')), 204);
  assert.equal(await remove(people.ana, file(orgA, leadAna)), 204);
  assert.equal(await upload(people.ana, file(orgA, leadAna)), 200, 'fica um arquivo para os testes seguintes');
});

test('outro vendedor da mesma empresa não alcança o arquivo de uma oportunidade que não é dele', async () => {
  assert.equal(await download(people.rui, file(orgA, leadAna)), 403);
  assert.equal(await remove(people.rui, file(orgA, leadAna)), 403);
  assert.equal(await upload(people.rui, file(orgA, leadAna, 'a_arquivo003.pdf')), 403);
});

test('outra empresa, quem foi bloqueado, quem não tem perfil e quem não entrou: nada', async () => {
  for (const who of [people.adminB, people.bloqueado, people.semPerfil, null]) {
    const expected = who ? 403 : 403;
    assert.equal(await download(who, file(orgA, leadAna)), expected);
    assert.equal(await remove(who, file(orgA, leadAna)), expected);
    assert.equal(await upload(who, file(orgA, leadAna, 'a_arquivo004.pdf')), expected);
  }
  // a empresa B não consegue guardar um arquivo seu na pasta de uma oportunidade da A,
  // nem pôr uma oportunidade da A debaixo da própria pasta
  assert.equal(await upload(people.adminB, file(orgB, leadAna)), 403);
  assert.equal(await upload(people.adminB, file(orgB, leadB)), 200);
  assert.equal(await download(people.admin, file(orgB, leadB)), 403);
});

test('só documentos e imagens, até 10 MB, sempre como download, e sem trocar um arquivo por outro', async () => {
  const at = (name) => file(orgA, leadAna, name);
  assert.equal(await upload(people.ana, at('a_pagina0001.html'), { contentType: 'text/html' }), 403, 'página');
  assert.equal(await upload(people.ana, at('a_pagina0002.pdf'), { contentType: 'text/html' }), 403, 'página com nome de PDF');
  assert.equal(await upload(people.ana, at('a_desenho001.svg'), { contentType: 'image/svg+xml' }), 403, 'SVG');
  assert.equal(await upload(people.ana, at('contrato.pdf')), 403, 'nome fora do padrão');
  assert.equal(await upload(people.ana, at('a_semdownload.pdf'), { disposition: '' }), 403, 'sem marca de download');
  assert.equal(await upload(people.ana, at('a_inline00001.pdf'), { disposition: 'inline' }), 403, 'para abrir na tela');
  assert.equal(await upload(people.ana, at('a_grande00001.pdf'), { bytes: 10 * 1024 * 1024 + 1 }), 403, 'acima de 10 MB');
  assert.equal(await upload(people.ana, at('a_vazio000001.pdf'), { bytes: 0 }), 403, 'vazio');
  assert.equal(await upload(people.ana, at('a_arquivo001.pdf')), 403, 'já existe: não é trocado');
  assert.equal(await upload(people.ana, at('a_planilha001.xlsx'), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 200);
});

test('ninguém lista pastas, e fora da pasta de anexos nada é aceito', async () => {
  assert.equal(await list(people.admin, `orgs/${orgA}/`), 403);
  assert.equal(await list(people.ana, `orgs/${orgA}/customers/${leadAna}/`), 403);
  assert.equal(await upload(people.admin, `orgs/${orgA}/logo.png`, { contentType: 'image/png' }), 403);
  assert.equal(await upload(people.admin, `solto/a_arquivo001.pdf`), 403);
  assert.equal(await upload(people.admin, file(orgA, `nao-existe-${RUN}`)), 403, 'oportunidade que não existe');
});

// O servidor copia em cada perfil até quando a empresa pode gravar (planWritableUntilMs)
test('plano vencido: a empresa não anexa arquivo novo, mas abre e exclui os que tem; em dia, anexa', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const orgC = `orgC_${RUN}`;
  const leadC = `lead-c-${RUN}`;
  const dona = await signUp('donaC');
  await seed(`users/${dona.uid}`, { orgId: orgC, role: 'admin', status: 'active', name: 'Dona C', planWritableUntilMs: Date.now() + 10 * DAY });
  await seed(`customers/${leadC}`, { orgId: orgC, name: 'Cliente da C', stage: 'lead', assignedTo: { id: dona.uid } });

  assert.equal(await upload(dona, file(orgC, leadC, 'a_emdia00001.pdf')), 200, 'em dia');
  assert.equal(await upload(dona, file(orgC, leadC, 'a_emdia00002.pdf')), 200, 'em dia');

  await seed(`users/${dona.uid}`, { orgId: orgC, role: 'admin', status: 'active', name: 'Dona C', planWritableUntilMs: Date.now() - DAY });
  assert.equal(await upload(dona, file(orgC, leadC, 'a_vencido001.pdf')), 403, 'vencido: não anexa');
  assert.equal(await download(dona, file(orgC, leadC, 'a_emdia00001.pdf')), 200, 'vencido: abre');
  assert.equal(await remove(dona, file(orgC, leadC, 'a_emdia00001.pdf')), 204, 'vencido: exclui');

  // sem prazo nenhum (empresa antiga) continua anexando
  await seed(`users/${dona.uid}`, { orgId: orgC, role: 'admin', status: 'active', name: 'Dona C' });
  assert.equal(await upload(dona, file(orgC, leadC, 'a_semprazo01.pdf')), 200, 'sem prazo');
});
