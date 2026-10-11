/**
 * EDX Digital - Report by period
 * Pure functions: what was created, won and lost inside a period, in total and per salesperson.
 * Tests: tests/unit/report.test.mjs
 */

import { attentionOf } from './attention.js';
import { isConversation } from './history.js';

export const REPORT_PERIODS = [
  { id: 'month', label: 'Este mês' },
  { id: 'last_month', label: 'Mês passado' },
  { id: '90d', label: 'Últimos 90 dias' },
  { id: 'year', label: 'Este ano' },
  { id: 'all', label: 'Todo o período' }
];

/**
 * [start, end) of a period, in the person's own time zone
 */
export function periodRange(periodId, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const tomorrow = new Date(year, month, now.getDate() + 1);
  switch (periodId) {
    case 'month': return [new Date(year, month, 1), tomorrow];
    case 'last_month': return [new Date(year, month - 1, 1), new Date(year, month, 1)];
    case '90d': return [new Date(year, month, now.getDate() - 89), tomorrow];
    case 'year': return [new Date(year, 0, 1), tomorrow];
    default: return [new Date(0), tomorrow];
  }
}

function within(iso, [start, end]) {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return time >= start.getTime() && time < end.getTime();
}

// Records from before the closing date was stored fall back to the last change
const wonDate = (c) => c.wonAt || c.updatedAt || c.createdAt;
const lostDate = (c) => c.lostAt || c.updatedAt || c.createdAt;

function emptyRow(name, id = '') {
  return {
    id,
    name,
    // inside the period
    created: 0, wonCount: 0, wonValue: 0, lostCount: 0, contacts: 0,
    // as it stands now
    openCount: 0, openValue: 0, stalled: 0, lateTasks: 0
  };
}

// Won out of what was decided, and the average sale; null when there is nothing to divide by
function withRates(row) {
  const decided = row.wonCount + row.lostCount;
  return {
    ...row,
    conversionRate: decided > 0 ? Math.round((row.wonCount / decided) * 100) : null,
    avgTicket: row.wonCount > 0 ? row.wonValue / row.wonCount : null
  };
}

const cleanName = (name) => String(name || '').replace(/\s*\(.*\)$/, '');

/**
 * @param {Array} customers - the opportunities the person can see
 * @param {Array<{id: string, name: string}>} [members] - people of the team, so that someone with
 *        no opportunity at all still gets a row (it is the row a manager most needs to see)
 * @returns totals for the period, the same split per salesperson, and the lost ones (for the reasons chart)
 */
export function periodReport(customers, periodId, now = new Date(), members = []) {
  const range = periodRange(periodId, now);
  const totals = emptyRow('Total');
  const people = new Map();
  const lost = [];
  members.forEach(member => {
    if (member && member.id && !people.has(member.id)) people.set(member.id, emptyRow(cleanName(member.name) || 'Sem nome', member.id));
  });

  customers.forEach(c => {
    const key = c.assignedTo?.id || c.assignedTo?.email || 'none';
    if (!people.has(key)) {
      people.set(key, emptyRow(cleanName(c.assignedTo?.name || c.assignedTo?.email) || 'Sem responsável', key === 'none' ? '' : key));
    }
    const row = people.get(key);
    const value = Number(c.dealValue) || 0;
    const add = (field, amount = 1) => { row[field] += amount; totals[field] += amount; };

    if (within(c.createdAt, range)) add('created');
    if (c.stage === 'won') {
      if (within(wonDate(c), range)) { add('wonCount'); add('wonValue', value); }
    } else if (c.stage === 'lost') {
      if (within(lostDate(c), range)) { add('lostCount'); lost.push(c); }
    } else {
      add('openCount');
      add('openValue', value);
      const flags = attentionOf(c, now);
      if (flags.stalled) add('stalled');
      if (flags.lateTask) add('lateTasks');
    }

    // calls, messages and meetings registered in the period, whoever the opportunity is with now
    const talks = (c.activities || []).filter(activity => isConversation(activity) && within(activity.timestamp, range)).length;
    if (talks) add('contacts', talks);
  });

  const summary = withRates(totals);
  return {
    range,
    totals,
    conversionRate: summary.conversionRate,
    avgTicket: summary.avgTicket,
    people: [...people.values()].map(withRates)
      .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue || a.name.localeCompare(b.name)),
    lost
  };
}

/**
 * The per-salesperson table as rows of text, for a spreadsheet
 */
export function sellerReportRows(report) {
  const money = (amount) => (Number(amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const header = ['Vendedor', 'Vendas', 'Valor vendido (R$)', 'Ticket médio (R$)', 'Conversão (%)', 'Perdidas', 'Novas', 'Conversas',
    'Em aberto', 'Valor em aberto (R$)', 'Paradas', 'Com tarefa atrasada'];
  const line = (row) => [
    row.name, row.wonCount, money(row.wonValue), row.avgTicket === null ? '' : money(row.avgTicket),
    row.conversionRate === null ? '' : row.conversionRate, row.lostCount, row.created, row.contacts,
    row.openCount, money(row.openValue), row.stalled, row.lateTasks
  ].map(String);
  return [header, ...report.people.map(line)];
}
