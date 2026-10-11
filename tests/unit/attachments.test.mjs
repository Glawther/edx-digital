/**
 * Arquivos anexados a uma oportunidade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile, cleanAttachments, safeFileName, extensionOf, attachmentPath, formatBytes, newAttachmentId, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, ACCEPT_ATTRIBUTE } from '../../js/core/attachments.js';

test('só documentos e imagens entram; nada que o navegador executaria', () => {
  assert.deepEqual(checkFile({ name: 'Proposta Final.PDF', size: 2048 }), { ok: true, ext: 'pdf', contentType: 'application/pdf' });
  assert.equal(checkFile({ name: 'foto.jpeg', size: 10 }).contentType, 'image/jpeg');
  for (const name of ['pagina.html', 'desenho.svg', 'programa.exe', 'script.js', 'semextensao', 'contrato.pdf.exe']) {
    assert.equal(checkFile({ name, size: 10 }).ok, false, name);
  }
  assert.match(checkFile({ name: 'pagina.html', size: 10 }).message, /não é aceito/);
  assert.equal(ACCEPT_ATTRIBUTE.includes('.svg'), false);
});

test('tamanho e quantidade têm limite, e a mensagem diz qual', () => {
  assert.match(checkFile({ name: 'a.pdf', size: 0 }).message, /vazio/);
  assert.match(checkFile({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES + 1 }).message, /limite é 10 MB/);
  assert.equal(checkFile({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES }).ok, true);
  const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({ id: `a_arquivo${i}` }));
  assert.match(checkFile({ name: 'a.pdf', size: 10 }, full).message, /até 10 arquivos/);
  assert.equal(checkFile(null).ok, false);
});

test('o nome mostrado não leva pasta, marcação nem caractere de controle', () => {
  assert.equal(safeFileName('C:\\Users\\eu\\contrato.pdf'), 'contrato.pdf');
  assert.equal(safeFileName('../../etc/senha.txt'), 'senha.txt');
  assert.equal(safeFileName('<b>"nome".txt'), 'bnome.txt');
  assert.equal(safeFileName('a\u0000b\n.pdf'), 'a b .pdf');
  const long = safeFileName('x'.repeat(300) + '.pdf');
  assert.equal(long.length, 120);
  assert.equal(extensionOf(long), 'pdf');
  assert.equal(extensionOf('sem ponto'), '');
});

test('o endereço do arquivo usa o identificador, não o nome', () => {
  const id = newAttachmentId();
  assert.match(id, /^a_[a-z0-9]{10}$/);
  assert.equal(attachmentPath('org1', 'lead-9', { id: 'a_abc1234567', ext: 'pdf', name: '../outro.pdf' }), 'orgs/org1/customers/lead-9/a_abc1234567.pdf');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1572864), '1,5 MB');
});

test('a lista guardada é limpa: identificador e tipo válidos, sem repetição, até o limite', () => {
  const clean = cleanAttachments([
    { id: 'a_abc1234567', ext: 'PDF', name: ' Proposta <1>.pdf ', size: 100, by: 'Ana', at: '2026-10-11T12:00:00.000Z' },
    { id: 'a_abc1234567', ext: 'pdf', name: 'repetido.pdf', size: 1 },
    { id: 'a_html123456', ext: 'html', name: 'pagina.html', size: 1 },
    { id: '../fora', ext: 'pdf', name: 'x.pdf', size: 1 },
    { id: 'a_semnome123', ext: 'pdf', name: '  ', size: 1 },
    { id: 'a_tamanho123', ext: 'pdf', name: 'x.pdf', size: 'grande' },
    null, 'texto'
  ]);
  assert.deepEqual(clean, [{ id: 'a_abc1234567', ext: 'pdf', name: 'Proposta 1.pdf', size: 100, by: 'Ana', at: '2026-10-11T12:00:00.000Z' }]);
  assert.equal(cleanAttachments(Array.from({ length: 15 }, (_, i) => ({ id: `a_arquivo${String(i).padStart(2, '0')}`, ext: 'png', name: `${i}.png`, size: 1 }))).length, MAX_ATTACHMENTS);
  assert.deepEqual(cleanAttachments('nada'), []);
});
