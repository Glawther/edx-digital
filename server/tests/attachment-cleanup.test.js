/**
 * Limpeza diária dos arquivos de oportunidades que não existem mais.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanOrphanAttachments } = require('../storage/attachment-cleanup');

function fakeStorage(pages) {
  const calls = [];
  let page = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', auth: options.headers.Authorization });
    if (options.method === 'DELETE') return { ok: true, status: 204 };
    const body = pages[page++];
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404 };
  };
  return { fetchImpl, calls };
}

test('apaga só os arquivos cuja oportunidade sumiu ou é de outra empresa', async () => {
  const { fetchImpl, calls } = fakeStorage([
    { items: [{ name: 'orgs/o1/customers/vivo/a_aaaaaaaa.pdf' }, { name: 'orgs/o1/customers/apagado/a_bbbbbbbb.pdf' }], nextPageToken: 'p2' },
    { items: [{ name: 'orgs/o1/customers/apagado/a_cccccccc.png' }, { name: 'orgs/o2/customers/vivo/a_dddddddd.pdf' }, { name: 'orgs/solto.txt' }] }
  ]);
  const asked = [];
  const result = await cleanOrphanAttachments({
    bucket: 'balde-de-teste',
    fetchImpl,
    token: async () => 't',
    getCustomer: async (id) => { asked.push(id); return id === 'vivo' ? { orgId: 'o1' } : null; }
  });

  assert.deepEqual(result, { files: 5, removed: 3 });
  const deleted = calls.filter(call => call.method === 'DELETE').map(call => decodeURIComponent(call.url.split('/o/')[1]));
  assert.deepEqual(deleted, ['orgs/o1/customers/apagado/a_bbbbbbbb.pdf', 'orgs/o1/customers/apagado/a_cccccccc.png', 'orgs/o2/customers/vivo/a_dddddddd.pdf']);
  // cada oportunidade é consultada uma vez por empresa, não uma vez por arquivo
  assert.deepEqual(asked, ['vivo', 'apagado', 'vivo']);
  assert.ok(calls.every(call => call.auth === 'Bearer t'));
  assert.match(calls[1].url, /pageToken=p2/);
});

test('sem o serviço de arquivos ativado, não faz nada e não falha', async () => {
  const { fetchImpl } = fakeStorage([]);
  assert.deepEqual(await cleanOrphanAttachments({ bucket: 'b', fetchImpl, token: async () => 't', getCustomer: async () => null }), { skipped: 'no_bucket', files: 0, removed: 0 });
});
