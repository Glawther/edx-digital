/**
 * Registros lidos do banco: qualquer que seja o conteúdo, as telas recebem os tipos que esperam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomer } from '../../js/core/normalize.js';

test('um registro correto passa sem alteração no que importa', () => {
  const input = {
    name: 'Ana', company: 'Loja', dealValue: 1500.5, stage: 'proposal', priority: 'high', tags: ['Indicação'],
    tasks: [{ id: 'task-1', title: 'Ligar', type: 'call', dueDate: '2026-10-10', dueTime: '09:30', completed: false }],
    activities: [{ id: 'act-1', type: 'note', title: 'Criada', text: '', author: 'Ana', timestamp: '2026-10-01T10:00:00.000Z' }],
    assignedTo: { id: 'u1', name: 'Ana Dona', email: 'ana@a.com' }, custom: { cf_origem01: 'Site' },
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', orgId: 'org_a', id: 'lead-1'
  };
  const out = normalizeCustomer(input);
  assert.equal(out.name, 'Ana');
  assert.equal(out.dealValue, 1500.5);
  assert.equal(out.stage, 'proposal');
  assert.deepEqual(out.tasks, input.tasks);
  assert.deepEqual(out.assignedTo, input.assignedTo);
  assert.deepEqual(out.custom, { cf_origem01: 'Site' });
  assert.equal(out.orgId, 'org_a', 'campos que o app não conhece são mantidos');
  assert.equal(out.id, 'lead-1');
});

test('tipos trocados de propósito não derrubam nada', () => {
  const hostile = {
    name: 'Tipos errados', stage: 'lead', assignedTo: { id: 'u2', name: 12345 }, tags: 'nao-e-lista', tasks: 'nao-e-lista',
    activities: 7, dealValue: 'muito', priority: { a: 1 }, phone: 99, email: ['x'], company: { x: 1 }, expectedCloseDate: 20261010,
    notes: 123, custom: 'texto', createdAt: 5, updatedAt: null, lossReason: {}, wonAt: 'ontem'
  };
  const out = normalizeCustomer(hostile);
  assert.deepEqual(out.tags, []);
  assert.deepEqual(out.tasks, []);
  assert.deepEqual(out.activities, []);
  assert.equal(out.dealValue, 0);
  assert.equal(out.priority, 'medium');
  assert.equal(out.phone, '99');
  assert.equal(out.email, '');
  assert.equal(out.company, '');
  assert.equal(out.expectedCloseDate, '');
  assert.equal(out.notes, '123');
  assert.deepEqual(out.custom, {});
  assert.equal(out.assignedTo.name, '12345');
  assert.equal(out.lossReason, null);
  assert.equal(out.wonAt, null);
  assert.ok(!isNaN(Date.parse(out.createdAt)) && !isNaN(Date.parse(out.updatedAt)));

  // everything the screens call on these fields works
  assert.doesNotThrow(() => {
    out.tasks.filter(t => !t.completed);
    out.tags.join(', ');
    out.assignedTo.name.split(' ');
    out.name.toLowerCase();
    out.phone.replace(/\D/g, '');
    new Date(out.updatedAt).getTime();
  });
});

test('registro vazio, nulo ou que nem é objeto vira uma oportunidade em branco', () => {
  for (const raw of [undefined, null, 'texto', 42, []]) {
    const out = normalizeCustomer(raw);
    assert.equal(out.name, 'Sem nome');
    assert.equal(out.stage, 'lead');
    assert.equal(out.assignedTo, null);
    assert.deepEqual(out.tasks, []);
  }
});

test('tarefas e atividades malformadas ou com identificador estranho são descartadas, as boas ficam', () => {
  const out = normalizeCustomer({
    tasks: [null, 'x', { id: `t');alert(1);('`, title: 'hostil' }, { id: 'task-ok', title: 5, dueDate: '10/10/2026', dueTime: 'tarde', completed: 'sim' }],
    activities: [{ id: 'act-ok', timestamp: 'nunca', type: {} }, { title: 'sem id' }]
  });
  assert.deepEqual(out.tasks, [{ id: 'task-ok', title: '5', type: 'followup', dueDate: '', dueTime: '', completed: false }]);
  assert.equal(out.activities.length, 1);
  assert.equal(out.activities[0].type, 'note');
});

test('nome de etapa antigo é convertido; etapa desconhecida vira novo lead; negativos e textos enormes são contidos', () => {
  assert.equal(normalizeCustomer({ stage: 'contacted' }).stage, 'contact');
  assert.equal(normalizeCustomer({ stage: 'inventada' }).stage, 'lead');
  assert.equal(normalizeCustomer({ dealValue: -50 }).dealValue, 0);
  assert.equal(normalizeCustomer({ name: 'x'.repeat(5000) }).name.length, 300);
  assert.equal(normalizeCustomer({ tags: Array.from({ length: 100 }, (_, i) => `t${i}`) }).tags.length, 30);
});
