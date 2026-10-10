/**
 * EDX Digital - Rules a company sets for its own funnel, and searching through it
 *   - what an opportunity must have before it enters a stage;
 *   - the month's goal of each salesperson;
 *   - recurring sales;
 *   - finding an opportunity by what was written or said about it.
 * Pure functions. Tests: tests/unit/pipeline-rules.test.mjs
 */

/** What can be required before a stage */
export const REQUIREMENT_FIELDS = [
  { id: 'value', label: 'Valor' },
  { id: 'closeDate', label: 'Previsão de fechamento' },
  { id: 'contact', label: 'Telefone ou e-mail' },
  { id: 'company', label: 'Empresa' },
  { id: 'task', label: 'Próxima tarefa agendada' }
];

/** The stages that can ask for something (nothing is asked to register or to lose an opportunity) */
export const REQUIREMENT_STAGES = ['contact', 'proposal', 'negotiation', 'won'];

const FIELD_IDS = REQUIREMENT_FIELDS.map(field => field.id);

/** What a company saved, made safe: known stages, known fields, nothing repeated */
export function cleanRequirements(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const stage of REQUIREMENT_STAGES) {
    const wanted = Array.isArray(raw[stage]) ? [...new Set(raw[stage].filter(id => FIELD_IDS.includes(id)))] : [];
    if (wanted.length > 0) clean[stage] = wanted;
  }
  return clean;
}

const has = {
  value: (customer) => Number(customer.dealValue) > 0,
  closeDate: (customer) => /^\d{4}-\d{2}-\d{2}/.test(String(customer.expectedCloseDate || '')),
  contact: (customer) => Boolean(String(customer.phone || '').trim() || String(customer.email || '').trim()),
  company: (customer) => Boolean(String(customer.company || '').trim()),
  // a deal that was won needs no next step
  task: (customer, stage) => stage === 'won' || (customer.tasks || []).some(task => !task.completed)
};

/**
 * What the opportunity still lacks to enter a stage
 * @returns {string[]} the labels of what is missing; empty when it may enter
 */
export function missingForStage(customer, stage, requirements) {
  const wanted = cleanRequirements(requirements)[stage] || [];
  return REQUIREMENT_FIELDS.filter(field => wanted.includes(field.id) && !has[field.id](customer || {}, stage)).map(field => field.label);
}

/** "Para ir para Proposta, falta: Valor e Previsão de fechamento." */
export function missingMessage(stageName, missing) {
  if (missing.length === 0) return '';
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}`;
  return `Para ir para ${stageName}, falta: ${list}.`;
}

// ---------------------------------------------------------------- goals

/** { memberId: amount } with only real, positive amounts */
export function cleanSellerGoals(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [id, amount] of Object.entries(raw).slice(0, 100)) {
    const value = Number(amount);
    if (/^[A-Za-z0-9_.@-]{1,128}$/.test(id) && Number.isFinite(value) && value > 0) clean[id] = Math.min(value, 1e12);
  }
  return clean;
}

/**
 * How each person stands against their goal of the month
 * @param {Array<{id: string, name: string, wonValue: number}>} people - rows of the month's report
 */
export function goalProgress(people, goals) {
  const clean = cleanSellerGoals(goals);
  return people
    .filter(person => clean[person.id])
    .map(person => {
      const goal = clean[person.id];
      return { id: person.id, name: person.name, goal, sold: person.wonValue, percent: Math.round((person.wonValue / goal) * 100), left: Math.max(0, goal - person.wonValue) };
    })
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- recurring sales

/** What the sales marked as monthly add up to: won ones count, and the open ones are what may come */
export function recurringRevenue(customers) {
  const monthly = (customers || []).filter(customer => customer.recurring === true);
  const sum = (list) => list.reduce((total, customer) => total + (Number(customer.dealValue) || 0), 0);
  const won = monthly.filter(customer => customer.stage === 'won');
  const open = monthly.filter(customer => customer.stage !== 'won' && customer.stage !== 'lost');
  return { monthly: sum(won), contracts: won.length, inNegotiation: sum(open), openCount: open.length };
}

// ---------------------------------------------------------------- search

const fold = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function snippetAround(text, at, length) {
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + length + 50);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '...' : ''}`;
}

/**
 * Where an opportunity matches what was typed, or null.
 * The name, company, e-mail, tags and phone come first; then the notes and the history.
 * Accents and upper case make no difference.
 * @returns {{where: 'main'|'notes'|'history', snippet: string}|null}
 */
export function matchCustomer(customer, query) {
  const wanted = fold(query).trim();
  if (wanted.length < 2) return null;
  const main = fold(`${customer.name || ''} ${customer.company || ''} ${customer.email || ''} ${(customer.tags || []).join(' ')}`);
  if (main.includes(wanted)) return { where: 'main', snippet: '' };
  const digits = wanted.replace(/\D/g, '');
  if (digits.length >= 4 && String(customer.phone || '').replace(/\D/g, '').includes(digits)) return { where: 'main', snippet: '' };
  // fewer than three letters would match half of every history
  if (wanted.length < 3) return null;

  const notes = String(customer.notes || '');
  const inNotes = fold(notes).indexOf(wanted);
  if (inNotes >= 0) return { where: 'notes', snippet: snippetAround(notes, inNotes, wanted.length) };

  // the most recent mention first
  const activities = [...(customer.activities || [])].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  for (const activity of activities) {
    const text = `${activity.title || ''}: ${activity.text || ''}`;
    const at = fold(text).indexOf(wanted);
    if (at >= 0) return { where: 'history', snippet: snippetAround(text, at, wanted.length) };
  }
  for (const task of customer.tasks || []) {
    const at = fold(task.title).indexOf(wanted);
    if (at >= 0) return { where: 'history', snippet: `Tarefa: ${snippetAround(String(task.title), at, wanted.length)}` };
  }
  return null;
}

/** The opportunities that match, the ones matching by name first */
export function searchCustomers(customers, query, limit = 8) {
  const found = [];
  for (const customer of customers || []) {
    const match = matchCustomer(customer, query);
    if (match) found.push({ customer, ...match });
  }
  const order = { main: 0, notes: 1, history: 2 };
  return found.sort((a, b) => order[a.where] - order[b.where]).slice(0, limit);
}
