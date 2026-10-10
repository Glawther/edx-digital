/**
 * Tela "Hoje": o que entra em cada lista e em que ordem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayPanel, daysLabel } from '../../js/core/today.js';

const NOW = new Date(2026, 9, 10, 15, 0, 0); // sábado, 10 de outubro de 2026
const iso = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 9).toISOString();
const day = (offset) => {
  const d = new Date(2026, 9, 10 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const deal = (name, extra = {}) => ({ id: name, name, stage: 'proposal', dealValue: 1000, updatedAt: iso(0), tasks: [{ id: 't', title: 'x', dueDate: day(20) }], activities: [], ...extra });

test('tarefas: atrasadas da mais antiga para a mais nova; as de hoje pelo horário', () => {
  const panel = todayPanel([
    deal('A', { tasks: [{ id: 'a1', title: 'ligar', dueDate: day(-1) }, { id: 'a2', title: 'feita', dueDate: day(-9), completed: true }] }),
    deal('B', { tasks: [{ id: 'b1', title: 'proposta', dueDate: day(-5) }, { id: 'b2', title: 'hoje sem hora', dueDate: day(0) }] }),
    deal('C', { tasks: [{ id: 'c1', title: 'reunião', dueDate: day(0), dueTime: '09:30' }, { id: 'c2', title: 'amanhã', dueDate: day(1) }] })
  ], NOW);
  assert.deepEqual(panel.lateTasks.map(item => [item.task.id, item.daysLate]), [['b1', 5], ['a1', 1]]);
  assert.deepEqual(panel.todayTasks.map(item => item.task.id), ['c1', 'b2']);
  assert.equal(panel.urgent, 4);
});

test('fechamento previsto: entra o que vence em até 7 dias e o que já passou, o mais próximo primeiro', () => {
  const panel = todayPanel([
    deal('longe', { expectedCloseDate: day(8) }),
    deal('semana', { expectedCloseDate: day(7) }),
    deal('passou', { expectedCloseDate: day(-3) }),
    deal('hoje', { expectedCloseDate: day(0) + 'T00:00:00.000Z' }),
    deal('sem data'),
    deal('data ruim', { expectedCloseDate: 'em breve' })
  ], NOW);
  assert.deepEqual(panel.closing.map(item => [item.customer.name, item.inDays]), [['passou', -3], ['hoje', 0], ['semana', 7]]);
});

test('paradas: as que estão há mais tempo sem atualização primeiro, com o último contato', () => {
  const panel = todayPanel([
    deal('recente', { updatedAt: iso(2) }),
    deal('três', { updatedAt: iso(3) }),
    deal('dez', { updatedAt: iso(10), activities: [{ id: 'x', type: 'call', title: 'Ligação', timestamp: iso(12) }] })
  ], NOW);
  assert.deepEqual(panel.stalled.map(item => [item.customer.name, item.days]), [['dez', 10], ['três', 3]]);
  assert.equal(panel.stalled[0].lastContact.title, 'Ligação');
  assert.equal(panel.stalled[1].lastContact, null);
});

test('sem próxima tarefa: só as em aberto, a de maior valor primeiro', () => {
  const panel = todayPanel([
    deal('pequena', { tasks: [], dealValue: 500 }),
    deal('grande', { tasks: [{ id: 'f', title: 'feita', dueDate: day(-1), completed: true }], dealValue: 9000 }),
    deal('com tarefa')
  ], NOW);
  assert.deepEqual(panel.noTask.map(c => c.name), ['grande', 'pequena']);
});

test('oportunidade ganha ou perdida não aparece em nenhuma lista', () => {
  const closed = { updatedAt: iso(30), tasks: [{ id: 'z', title: 'velha', dueDate: day(-10) }], expectedCloseDate: day(0) };
  const panel = todayPanel([deal('ganha', { ...closed, stage: 'won' }), deal('perdida', { ...closed, stage: 'lost' })], NOW);
  assert.equal(panel.nothing, true);
  assert.equal(panel.urgent, 0);
});

test('nada pendente quando tudo está em dia', () => {
  assert.equal(todayPanel([deal('em dia')], NOW).nothing, true);
  assert.equal(todayPanel([], NOW).nothing, true);
});

test('quantos dias, em palavras', () => {
  assert.equal(daysLabel(0), 'hoje');
  assert.equal(daysLabel(1), 'amanhã');
  assert.equal(daysLabel(-1), 'ontem');
  assert.equal(daysLabel(5), 'em 5 dias');
  assert.equal(daysLabel(-4), 'há 4 dias');
});
