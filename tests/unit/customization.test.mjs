/**
 * Personalização da empresa: nomes das etapas e campos extras.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStageNames, cleanCustomFields, readCustomValues, formatCustomValue, MAX_CUSTOM_FIELDS } from '../../js/core/customization.js';

const DEFAULTS = { lead: 'Novo Lead', contact: 'Primeiro Contato', won: 'Fechado Ganho' };

test('só os nomes de etapa realmente alterados são guardados', () => {
  assert.deepEqual(cleanStageNames({ lead: '  Interessado  ', contact: 'Primeiro Contato', won: '', outra: 'x' }, DEFAULTS), { lead: 'Interessado' });
  assert.deepEqual(cleanStageNames(null, DEFAULTS), {});
  assert.equal(cleanStageNames({ lead: 'x'.repeat(100) }, DEFAULTS).lead.length, 40);
  assert.equal(cleanStageNames({ lead: '<b>Novo</b>' }, DEFAULTS).lead, 'bNovo/b');
});

test('campos extras: sem vazios, sem repetidos, tipo conhecido, no máximo 8', () => {
  const cleaned = cleanCustomFields([
    { id: 'cf_abcd1234', label: 'Origem', type: 'text' },
    { label: '  origem ', type: 'text' },
    { label: '', type: 'text' },
    { label: 'Quantidade', type: 'moeda' },
    { label: 'Visita', type: 'date' }
  ]);
  assert.deepEqual(cleaned.map(f => f.label), ['Origem', 'Quantidade', 'Visita']);
  assert.equal(cleaned[0].id, 'cf_abcd1234', 'o campo mantém o id ao ser salvo de novo');
  assert.match(cleaned[1].id, /^cf_[a-z0-9]{4,12}$/);
  assert.equal(cleaned[1].type, 'text');

  const many = Array.from({ length: 20 }, (_, i) => ({ label: `Campo ${i}`, type: 'text' }));
  assert.equal(cleanCustomFields(many).length, MAX_CUSTOM_FIELDS);
  assert.deepEqual(cleanCustomFields(undefined), []);
});

test('valores digitados: número brasileiro, data e texto; vazios e campos desconhecidos ficam de fora', () => {
  const fields = [{ id: 'cf_n', type: 'number' }, { id: 'cf_d', type: 'date' }, { id: 'cf_t', type: 'text' }, { id: 'cf_v', type: 'text' }];
  const values = readCustomValues(fields, { cf_n: '1.250,5', cf_d: '2026-10-10', cf_t: ' Indicação <b> ', cf_v: '  ', cf_intruso: 'x' });
  assert.deepEqual(values, { cf_n: 1250.5, cf_d: '2026-10-10', cf_t: 'Indicação b' });
  assert.deepEqual(readCustomValues(fields, { cf_n: 'abc', cf_d: '10/10/2026' }), {});
});

test('valores mostrados no formato brasileiro', () => {
  assert.equal(formatCustomValue({ type: 'number' }, 1250.5), '1.250,5');
  assert.equal(formatCustomValue({ type: 'date' }, '2026-10-10'), '10/10/2026');
  assert.equal(formatCustomValue({ type: 'text' }, 'Indicação'), 'Indicação');
  assert.equal(formatCustomValue({ type: 'text' }, undefined), '');
});
