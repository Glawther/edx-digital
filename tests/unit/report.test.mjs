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

test('por vendedor: conversas do período, conversão, ticket médio e o estado da carteira agora', async () => {
  const { periodReport, sellerReportRows } = await import('../../js/core/report.js');
  const now = new Date(2026, 9, 10, 12);
  const at = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 9).toISOString();
  const ana = { id: 'ana', name: 'Ana (Vendas)' };
  const beto = { id: 'beto', name: 'Beto' };
  const talk = (type, daysAgo) => ({ id: type + daysAgo, type, title: type, timestamp: at(daysAgo) });
  const customers = [
    { id: '1', name: 'Ganha', stage: 'won', dealValue: 3000, assignedTo: ana, createdAt: at(8), wonAt: at(2), activities: [talk('call', 3), talk('meeting', 5), talk('note', 1), talk('call', 60)] },
    { id: '2', name: 'Ganha 2', stage: 'won', dealValue: 1000, assignedTo: ana, createdAt: at(40), wonAt: at(1), activities: [] },
    { id: '3', name: 'Perdida', stage: 'lost', dealValue: 500, assignedTo: ana, createdAt: at(9), lostAt: at(4), activities: [talk('whatsapp', 4)] },
    { id: '4', name: 'Parada', stage: 'proposal', dealValue: 700, assignedTo: beto, createdAt: at(30), updatedAt: at(12), tasks: [{ id: 't', title: 'ligar', dueDate: '2026-10-01' }], activities: [talk('email', 2)] },
    { id: '5', name: 'Em dia', stage: 'lead', dealValue: 200, assignedTo: beto, createdAt: at(1), updatedAt: at(0), tasks: [{ id: 'u', title: 'visita', dueDate: '2026-10-20' }], activities: [] }
  ];
  const report = periodReport(customers, 'month', now, [ana, beto, { id: 'caio', name: 'Caio' }]);
  const by = Object.fromEntries(report.people.map(row => [row.name, row]));

  assert.deepEqual(report.people.map(row => row.name), ['Ana', 'Beto', 'Caio']);
  assert.deepEqual({ won: by.Ana.wonCount, value: by.Ana.wonValue, lost: by.Ana.lostCount, rate: by.Ana.conversionRate, ticket: by.Ana.avgTicket, talks: by.Ana.contacts },
    { won: 2, value: 4000, lost: 1, rate: 67, ticket: 2000, talks: 3 });
  assert.deepEqual({ open: by.Beto.openCount, openValue: by.Beto.openValue, stalled: by.Beto.stalled, late: by.Beto.lateTasks, talks: by.Beto.contacts, rate: by.Beto.conversionRate },
    { open: 2, openValue: 900, stalled: 1, late: 1, talks: 1, rate: null });
  // quem está na equipe e não tem nenhuma oportunidade aparece, zerado
  assert.deepEqual({ won: by.Caio.wonCount, open: by.Caio.openCount, talks: by.Caio.contacts, rate: by.Caio.conversionRate }, { won: 0, open: 0, talks: 0, rate: null });
  assert.equal(report.totals.contacts, 4);

  const rows = sellerReportRows(report);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], 'Vendedor');
  assert.deepEqual(rows[1].slice(0, 2), ['Ana', '2']);
  assert.equal(rows[3][4], ''); // sem nada decidido, a conversão fica em branco, não zero
});
