/**
 * EDX Digital - Report by period
 * Pure functions: what was created, won and lost inside a period, in total and per salesperson.
 * Tests: tests/unit/report.test.mjs
 */

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

function emptyRow(name) {
  return { name, created: 0, wonCount: 0, wonValue: 0, lostCount: 0, openCount: 0, openValue: 0 };
}

/**
 * @param {Array} customers - the opportunities the person can see
 * @returns totals for the period, the same split per salesperson, and the lost ones (for the reasons chart)
 */
export function periodReport(customers, periodId, now = new Date()) {
  const range = periodRange(periodId, now);
  const totals = emptyRow('Total');
  const people = new Map();
  const lost = [];

  customers.forEach(c => {
    const key = c.assignedTo?.id || c.assignedTo?.email || 'none';
    if (!people.has(key)) {
      const name = (c.assignedTo?.name || c.assignedTo?.email || 'Sem responsável').replace(/\s*\(.*\)$/, '');
      people.set(key, emptyRow(name));
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
    }
  });

  const decided = totals.wonCount + totals.lostCount;
  return {
    range,
    totals,
    conversionRate: decided > 0 ? Math.round((totals.wonCount / decided) * 100) : null,
    avgTicket: totals.wonCount > 0 ? totals.wonValue / totals.wonCount : null,
    people: [...people.values()].sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue || a.name.localeCompare(b.name)),
    lost
  };
}
