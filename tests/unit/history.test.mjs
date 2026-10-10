/**
 * Histórico da oportunidade: o que foi conversado, em ordem, e o que a ficha de contato aceita.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortedHistory, countHistory, lastContact, daysAgoLabel, buildContact, isManual, toLocalInput } from '../../js/core/history.js';

const NOW = new Date(2026, 9, 10, 15, 0, 0);
const at = (daysAgo, hour = 10) => new Date(2026, 9, 10 - daysAgo, hour).toISOString();

const customer = {
  activities: [
    { id: 'a1', type: 'note', title: 'Oportunidade criada', timestamp: at(9) },
    { id: 'a2', type: 'stage_change', title: 'Mudou de etapa', timestamp: at(6) },
    { id: 'a3', type: 'call', title: 'Ligação', text: 'Pediu proposta', timestamp: at(2), manual: true },
    // registrada depois, mas aconteceu antes da ligação
    { id: 'a4', type: 'meeting', title: 'Reunião', text: 'Apresentação', timestamp: at(5), manual: true },
    { id: 'a5', type: 'whatsapp', title: 'WhatsApp', text: 'Enviada pelo sistema', timestamp: at(4) }
  ]
};

test('o histórico sai do mais recente para o mais antigo, pela data em que aconteceu', () => {
  assert.deepEqual(sortedHistory(customer).map(a => a.id), ['a3', 'a5', 'a4', 'a2', 'a1']);
});

test('os filtros separam conversas, notas e mudanças do sistema', () => {
  assert.deepEqual(sortedHistory(customer, 'contacts').map(a => a.id), ['a3', 'a5', 'a4']);
  assert.deepEqual(sortedHistory(customer, 'notes').map(a => a.id), ['a1']);
  assert.deepEqual(sortedHistory(customer, 'system').map(a => a.id), ['a2']);
  assert.deepEqual(countHistory(customer), { all: 5, contacts: 3, notes: 1, system: 1 });
});

test('último contato é a conversa mais recente; nota e mudança de etapa não contam', () => {
  assert.equal(lastContact(customer).id, 'a3');
  assert.equal(lastContact({ activities: [customer.activities[0], customer.activities[1]] }), null);
  assert.equal(lastContact({}), null);
});

test('há quantos dias, pelo calendário e não por blocos de 24 horas', () => {
  assert.equal(daysAgoLabel(new Date(2026, 9, 10, 0, 5).toISOString(), NOW), 'hoje');
  assert.equal(daysAgoLabel(new Date(2026, 9, 9, 23, 50).toISOString(), NOW), 'ontem');
  assert.equal(daysAgoLabel(at(5), NOW), 'há 5 dias');
  assert.equal(daysAgoLabel('não é data', NOW), '');
});

test('a ficha de contato exige tipo conhecido e texto, e recusa data no futuro', () => {
  assert.equal(buildContact({ type: 'fax', text: 'x' }, NOW).ok, false);
  assert.equal(buildContact({ type: 'call', text: '   ' }, NOW).ok, false);
  assert.equal(buildContact({ type: 'call', text: 'x'.repeat(5001) }, NOW).ok, false);
  assert.equal(buildContact({ type: 'call', text: 'ok', when: 'amanhã' }, NOW).ok, false);
  assert.equal(buildContact({ type: 'call', text: 'ok', when: toLocalInput(new Date(2026, 9, 11, 9, 0)) }, NOW).ok, false);
});

test('um contato pode ser registrado dias depois, com a data em que aconteceu', () => {
  const when = toLocalInput(new Date(2026, 9, 7, 14, 30));
  assert.equal(when, '2026-10-07T14:30');
  const result = buildContact({ type: 'meeting', when, text: '  Reunião com a diretoria  ' }, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.activity, { type: 'meeting', title: 'Reunião', text: 'Reunião com a diretoria', timestamp: new Date(2026, 9, 7, 14, 30).toISOString(), manual: true });
  // sem data, vale o momento do registro
  assert.equal(buildContact({ type: 'note', text: 'ok' }, NOW).activity.timestamp, NOW.toISOString());
});

test('só o que alguém escreveu à mão pode ser excluído', () => {
  assert.equal(isManual(customer.activities[2]), true);
  assert.equal(isManual(customer.activities[4]), false); // WhatsApp enviado pelo sistema
  assert.equal(isManual(customer.activities[1]), false); // mudança de etapa
  assert.equal(isManual(null), false);
});
