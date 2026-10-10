/**
 * Relatório por período: o que foi criado, ganho e perdido, no total e por vendedor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, periodReport } from '../../js/core/report.js';

const NOW = new Date(2026, 9, 10, 15, 0); // 10 de outubro de 2026
const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const ana = { id: 'u-ana', name: 'Ana (Consultora)' };
const beto = { id: 'u-beto', name: 'Beto' };

const customers = [
  { name: 'A', stage: 'won', dealValue: 1000, assignedTo: ana, createdAt: at(2026, 9, 20), wonAt: at(2026, 10, 5) },
  { name: 'B', stage: 'won', dealValue: 3000, assignedTo: beto, createdAt: at(2026, 8, 1), wonAt: at(2026, 9, 15) },
  { name: 'C', stage: 'lost', dealValue: 500, assignedTo: ana, createdAt: at(2026, 10, 1), lostAt: at(2026, 10, 8), lossReason: 'price' },
  { name: 'D', stage: 'proposal', dealValue: 2000, assignedTo: ana, createdAt: at(2026, 10, 9) },
  { name: 'E', stage: 'lead', dealValue: 700, createdAt: at(2025, 12, 1) },
  { name: 'F', stage: 'won', dealValue: 400, assignedTo: beto, createdAt: at(2026, 1, 5), updatedAt: at(2026, 10, 2) }
];

test('os períodos começam e terminam no dia certo', () => {
  const [monthStart, monthEnd] = periodRange('month', NOW);
  assert.equal(monthStart.getDate(), 1);
  assert.equal(monthStart.getMonth(), 9);
  assert.equal(monthEnd.getDate(), 11, 'inclui o dia de hoje inteiro');

  const [lastStart, lastEnd] = periodRange('last_month', NOW);
  assert.equal(lastStart.getMonth(), 8);
  assert.equal(lastEnd.getMonth(), 9);
  assert.equal(lastEnd.getDate(), 1);

  const [janStart] = periodRange('last_month', new Date(2026, 0, 15));
  assert.equal(janStart.getFullYear(), 2025, 'mês passado em janeiro é dezembro do ano anterior');
});

test('este mês: vendas, novas oportunidades, conversão e ticket médio', () => {
  const report = periodReport(customers, 'month', NOW);
  assert.equal(report.totals.wonCount, 2, 'A (com data de venda) e F (sem data de venda, pela última alteração)');
  assert.equal(report.totals.wonValue, 1400);
  assert.equal(report.totals.lostCount, 1);
  assert.equal(report.totals.created, 2, 'C e D foram criadas em outubro');
  assert.equal(report.conversionRate, 67);
  assert.equal(report.avgTicket, 700);
  assert.deepEqual(report.lost.map(c => c.name), ['C']);
});

test('mês passado conta a venda pela data em que foi fechada, não pela de criação', () => {
  const report = periodReport(customers, 'last_month', NOW);
  assert.equal(report.totals.wonCount, 1);
  assert.equal(report.totals.wonValue, 3000);
  assert.equal(report.totals.created, 1, 'só A foi criada em setembro');
  assert.equal(report.conversionRate, 100);
});

test('o que está em aberto aparece em qualquer período, porque é o retrato de agora', () => {
  for (const period of ['month', 'last_month', 'all']) {
    const report = periodReport(customers, period, NOW);
    assert.equal(report.totals.openCount, 2);
    assert.equal(report.totals.openValue, 2700);
  }
});

test('por vendedor, com quem não tem responsável em linha própria', () => {
  const report = periodReport(customers, 'all', NOW);
  const byName = Object.fromEntries(report.people.map(p => [p.name, p]));
  assert.equal(byName['Beto'].wonValue, 3400);
  assert.equal(byName['Ana'].wonValue, 1000, 'o cargo entre parênteses sai do nome');
  assert.equal(byName['Ana'].lostCount, 1);
  assert.equal(byName['Sem responsável'].openCount, 1);
  assert.equal(report.people[0].name, 'Beto', 'quem vendeu mais vem primeiro');
});

test('sem vendas nem perdas no período, conversão e ticket ficam sem valor em vez de zero', () => {
  const report = periodReport([customers[3]], 'month', NOW);
  assert.equal(report.conversionRate, null);
  assert.equal(report.avgTicket, null);
});
