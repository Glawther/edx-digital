/**
 * Lembretes de tarefa: de quem é cada tarefa e o que está para hoje, atrasado ou na hora.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tasksOf, dueTasks, digestText, localDateString } from '../../js/services/reminder-service.js';

const ana = { uid: 'u-ana', email: 'ana@a.com' };
const customers = [
  { id: 'c1', name: 'Cliente 1', assignedTo: { id: 'u-ana' }, tasks: [{ id: 't1', title: 'Ligar', dueDate: '2026-10-10', dueTime: '09:30' }, { id: 't2', title: 'Feita', dueDate: '2026-10-09', completed: true }] },
  { id: 'c2', name: 'Cliente 2', assignedTo: { id: 'u-beto', email: 'beto@a.com' }, tasks: [{ id: 't3', title: 'Do Beto', dueDate: '2026-10-10' }] },
  { id: 'c3', name: 'Cliente 3', assignedTo: { email: 'ANA@a.com' }, tasks: [{ id: 't4', title: 'Atrasada', dueDate: '2026-10-08' }] },
  { id: 'c4', name: 'Cliente 4', tasks: [{ id: 't5', title: 'Sem dono', dueDate: '2026-10-11' }] }
];

test('cada pessoa é lembrada só das tarefas pendentes da própria carteira', () => {
  assert.deepEqual(tasksOf(customers, ana, false).map(t => t.id), ['t1', 't4']);
  assert.deepEqual(tasksOf(customers, { uid: 'u-beto' }, false).map(t => t.id), ['t3']);
});

test('quem administra também é lembrado das tarefas de oportunidades sem responsável', () => {
  assert.deepEqual(tasksOf(customers, ana, true).map(t => t.id), ['t1', 't4', 't5']);
});

test('hoje, atrasadas e na hora, pelo relógio local', () => {
  const tasks = tasksOf(customers, ana, true);
  const before = dueTasks(tasks, new Date(2026, 9, 10, 9, 0));
  assert.deepEqual(before.today.map(t => t.id), ['t1']);
  assert.deepEqual(before.overdue.map(t => t.id), ['t4']);
  assert.deepEqual(before.ringing, []);

  const after = dueTasks(tasks, new Date(2026, 9, 10, 9, 30));
  assert.deepEqual(after.ringing.map(t => t.id), ['t1']);
});

test('às 22h no Brasil o dia ainda é hoje (a data não vem do horário de Londres)', () => {
  assert.equal(localDateString(new Date(2026, 9, 10, 22, 30)), '2026-10-10');
});

test('o resumo do dia fala só do que existe', () => {
  assert.equal(digestText({ today: [1], overdue: [] }), '1 tarefa para hoje');
  assert.equal(digestText({ today: [1, 2], overdue: [1] }), '2 tarefas para hoje e 1 atrasada');
  assert.equal(digestText({ today: [], overdue: [1, 2] }), '2 atrasadas');
});
