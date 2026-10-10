/**
 * Oportunidades que pedem atenção e a conferência de senhas novas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionOf, matchesFocus, countAttention, passwordProblem } from '../../js/core/attention.js';

const NOW = new Date(2026, 9, 10, 15, 0);
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const fresh = { stage: 'lead', updatedAt: daysAgo(1), tasks: [{ id: 't', dueDate: '2026-10-12', completed: false }] };
const stalled = { stage: 'proposal', updatedAt: daysAgo(4), tasks: [{ id: 't', dueDate: '2026-10-12', completed: false }] };
const noTask = { stage: 'contact', updatedAt: daysAgo(0), tasks: [{ id: 't', dueDate: '2026-10-01', completed: true }] };
const late = { stage: 'negotiation', updatedAt: daysAgo(0), tasks: [{ id: 't', dueDate: '2026-10-09', completed: false }] };
const won = { stage: 'won', updatedAt: daysAgo(40), tasks: [] };

test('parada, sem próxima tarefa e tarefa atrasada são coisas diferentes', () => {
  assert.deepEqual(attentionOf(fresh, NOW), { open: true, stalled: false, noTask: false, lateTask: false });
  assert.equal(attentionOf(stalled, NOW).stalled, true);
  assert.equal(attentionOf(noTask, NOW).noTask, true, 'tarefa concluída não conta como próxima');
  assert.equal(attentionOf(late, NOW).lateTask, true);
  assert.equal(attentionOf({ stage: 'lead', updatedAt: daysAgo(0), tasks: [{ id: 't', dueDate: '2026-10-10', completed: false }] }, NOW).lateTask, false, 'a de hoje ainda não está atrasada');
});

test('venda fechada e oportunidade perdida não pedem atenção', () => {
  assert.deepEqual(attentionOf(won, NOW), { open: false, stalled: false, noTask: false, lateTask: false });
  assert.equal(matchesFocus(won, 'stalled', NOW), false);
  assert.equal(matchesFocus(won, 'all', NOW), true);
});

test('o filtro e a contagem concordam', () => {
  const all = [fresh, stalled, noTask, late, won];
  const counts = countAttention(all, NOW);
  assert.deepEqual(counts, { stalled: 1, noTask: 1, lateTask: 1 });
  for (const focus of ['stalled', 'noTask', 'lateTask']) {
    assert.equal(all.filter(c => matchesFocus(c, focus, NOW)).length, counts[focus]);
  }
});

test('senhas: curtas, óbvias, só de números e iguais ao nome são recusadas', () => {
  assert.match(passwordProblem('abc123'), /8 caracteres/);
  assert.match(passwordProblem('12345678'), /primeiras/);
  assert.match(passwordProblem('Senha123'), /primeiras/);
  assert.match(passwordProblem('aaaaaaaaaa'), /primeiras/);
  assert.match(passwordProblem('48291736'), /letras/);
  assert.match(passwordProblem('glawther123', { email: 'glawther@empresa.com' }), /nome ou o seu e-mail/);
  assert.match(passwordProblem('Fernanda', { name: 'Fernanda Lima' }), /nome ou o seu e-mail/);
  assert.match(passwordProblem('x'.repeat(200)), /128/);
});

test('senhas razoáveis passam, inclusive frases e números longos', () => {
  for (const ok of ['cavalo-verde-27', 'Tr0car!agora', 'minha loja fica na esquina', '482917365502', 'Fernanda#Lima#2026']) {
    assert.equal(passwordProblem(ok, { email: 'ana@loja.com', name: 'Ana Souza' }), '', ok);
  }
});
