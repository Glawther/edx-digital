/**
 * Regras do funil de cada empresa, metas por vendedor, vendas recorrentes e a busca.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRequirements, missingForStage, missingMessage, cleanSellerGoals, goalProgress, recurringRevenue, matchCustomer, searchCustomers
} from '../../js/core/pipeline-rules.js';

test('exigências por etapa: só etapas e campos conhecidos são guardados', () => {
  assert.deepEqual(cleanRequirements({ proposal: ['value', 'closeDate', 'value', 'inventado'], lead: ['value'], won: [], contact: 'value' }), { proposal: ['value', 'closeDate'] });
  assert.deepEqual(cleanRequirements(null), {});
  assert.deepEqual(cleanRequirements(['proposal']), {});
});

test('exigências por etapa: diz o que falta para a oportunidade entrar', () => {
  const rules = { proposal: ['value', 'closeDate', 'contact'], negotiation: ['task', 'company'], won: ['value', 'task'] };
  const bare = { name: 'X', dealValue: 0 };
  assert.deepEqual(missingForStage(bare, 'proposal', rules), ['Valor', 'Previsão de fechamento', 'Telefone ou e-mail']);
  assert.deepEqual(missingForStage({ dealValue: 10, expectedCloseDate: '2026-11-01', email: 'a@b.com' }, 'proposal', rules), []);
  assert.deepEqual(missingForStage({ company: 'Loja', tasks: [{ completed: true }] }, 'negotiation', rules), ['Próxima tarefa agendada']);
  assert.deepEqual(missingForStage({ company: 'Loja', tasks: [{ completed: false }] }, 'negotiation', rules), []);
  // venda fechada não precisa de próximo passo, mesmo que a regra peça
  assert.deepEqual(missingForStage({ dealValue: 10, tasks: [] }, 'won', rules), []);
  // etapa sem exigência, e empresa sem regra nenhuma
  assert.deepEqual(missingForStage(bare, 'contact', rules), []);
  assert.deepEqual(missingForStage(bare, 'proposal', undefined), []);
});

test('a mensagem lista o que falta em português corrente', () => {
  assert.equal(missingMessage('Proposta', []), '');
  assert.equal(missingMessage('Proposta', ['Valor']), 'Para ir para Proposta, falta: Valor.');
  assert.equal(missingMessage('Proposta', ['Valor', 'Empresa', 'Telefone ou e-mail']), 'Para ir para Proposta, falta: Valor, Empresa e Telefone ou e-mail.');
});

test('metas por vendedor: só valores positivos, e o andamento de quem tem meta', () => {
  assert.deepEqual(cleanSellerGoals({ ana: 10000, beto: 0, caio: 'abc', 'dani@x.com': '5000', 'com espaço': 10 }), { ana: 10000, 'dani@x.com': 5000 });
  const people = [{ id: 'ana', name: 'Ana', wonValue: 12000 }, { id: 'beto', name: 'Beto', wonValue: 900 }, { id: 'caio', name: 'Caio', wonValue: 2500 }];
  assert.deepEqual(goalProgress(people, { ana: 10000, caio: 10000 }), [
    { id: 'ana', name: 'Ana', goal: 10000, sold: 12000, percent: 120, left: 0 },
    { id: 'caio', name: 'Caio', goal: 10000, sold: 2500, percent: 25, left: 7500 }
  ]);
  assert.deepEqual(goalProgress(people, {}), []);
});

test('receita recorrente: soma as vendas mensais fechadas; as em aberto são o que pode entrar', () => {
  const result = recurringRevenue([
    { stage: 'won', dealValue: 500, recurring: true },
    { stage: 'won', dealValue: 300, recurring: true },
    { stage: 'won', dealValue: 9000 },                       // venda única
    { stage: 'proposal', dealValue: 700, recurring: true },
    { stage: 'lost', dealValue: 400, recurring: true },
    { stage: 'won', dealValue: 100, recurring: 'sim' }       // só o valor verdadeiro conta
  ]);
  assert.deepEqual(result, { monthly: 800, contracts: 2, inNegotiation: 700, openCount: 1 });
  assert.deepEqual(recurringRevenue([]), { monthly: 0, contracts: 0, inNegotiation: 0, openCount: 0 });
});

const deals = [
  { id: '1', name: 'Mariana Albuquerque', company: 'Móveis Albuquerque', email: 'mari@moveis.com', phone: '(11) 98888-7777', tags: ['Indicação'], notes: 'Prefere contato à tarde.', activities: [], tasks: [] },
  { id: '2', name: 'João Silva', company: 'Padaria Central', notes: '', tasks: [{ title: 'Enviar tabela de preços' }],
    activities: [{ title: 'Ligação', text: 'Pediu desconto para pagamento à vista e prazo de entrega menor.', timestamp: '2026-10-05T10:00:00Z' }, { title: 'Reunião', text: 'Falou de desconto de novo.', timestamp: '2026-10-08T10:00:00Z' }] },
  { id: '3', name: 'Desconto Atacado Ltda', company: '', notes: '', activities: [], tasks: [] }
];

test('busca: nome, empresa, e-mail, etiqueta e telefone, sem ligar para acento nem maiúscula', () => {
  assert.equal(matchCustomer(deals[0], 'ALBUQUERQUE').where, 'main');
  assert.equal(matchCustomer(deals[0], 'moveis').where, 'main');
  assert.equal(matchCustomer(deals[0], 'indicacao').where, 'main');
  assert.equal(matchCustomer(deals[0], '98888').where, 'main');
  assert.equal(matchCustomer(deals[0], 'x'), null);
  assert.equal(matchCustomer(deals[0], 'nada disso'), null);
});

test('busca: acha pelo que foi anotado ou conversado, e mostra o trecho', () => {
  const notes = matchCustomer(deals[0], 'a tarde');
  assert.deepEqual([notes.where, notes.snippet], ['notes', 'Prefere contato à tarde.']);
  const history = matchCustomer(deals[1], 'desconto');
  assert.equal(history.where, 'history');
  assert.match(history.snippet, /^Reunião: Falou de desconto de novo\.$/); // a menção mais recente
  assert.match(matchCustomer(deals[1], 'tabela').snippet, /^Tarefa: Enviar tabela de preços$/);
  // duas letras não vasculham o histórico
  assert.equal(matchCustomer(deals[1], 'de'), null);
});

test('busca: quem tem o termo no nome vem antes de quem só o tem no histórico', () => {
  assert.deepEqual(searchCustomers(deals, 'desconto').map(item => [item.customer.id, item.where]), [['3', 'main'], ['2', 'history']]);
  assert.equal(searchCustomers(deals, 'desconto', 1).length, 1);
  assert.deepEqual(searchCustomers(deals, ''), []);
});
