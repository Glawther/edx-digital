/**
 * EDX Digital - The history of an opportunity
 * What was said to the customer (calls, messages, meetings), notes, and what the system
 * recorded by itself (stage changes, tasks). Tests: tests/unit/history.test.mjs
 */

/** What a person can register by hand, in the order the form shows it */
export const CONTACT_TYPES = [
  { id: 'call', label: 'Ligação' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
  { id: 'meeting', label: 'Reunião' },
  { id: 'note', label: 'Nota' }
];

// A note is not a conversation with the customer
const CONVERSATION = new Set(['call', 'whatsapp', 'email', 'meeting']);
const MANUAL = new Set(CONTACT_TYPES.map(type => type.id));

export const HISTORY_FILTERS = [
  { id: 'all', label: 'Tudo' },
  { id: 'contacts', label: 'Conversas' },
  { id: 'notes', label: 'Notas' },
  { id: 'system', label: 'Mudanças' }
];

export function isConversation(activity) {
  return CONVERSATION.has(activity && activity.type);
}

/** Only what a person wrote by hand can be deleted; the system's own records stay */
export function isManual(activity) {
  return MANUAL.has(activity && activity.type) && activity.manual === true;
}

function matches(activity, filter) {
  if (filter === 'contacts') return isConversation(activity);
  if (filter === 'notes') return activity.type === 'note';
  if (filter === 'system') return !CONVERSATION.has(activity.type) && activity.type !== 'note';
  return true;
}

/** Newest first, by when it happened (a contact can be registered days later) */
export function sortedHistory(customer, filter = 'all') {
  return ((customer && customer.activities) || [])
    .filter(activity => matches(activity, filter))
    .slice()
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

export function countHistory(customer) {
  const activities = (customer && customer.activities) || [];
  return Object.fromEntries(HISTORY_FILTERS.map(filter => [filter.id, activities.filter(a => matches(a, filter.id)).length]));
}

/** The most recent conversation with the customer, or null when there was none */
export function lastContact(customer) {
  return sortedHistory(customer, 'contacts')[0] || null;
}

/** "hoje", "ontem", "há 5 dias" */
export function daysAgoLabel(timestamp, now = new Date()) {
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return '';
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86400000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}

/** The value a datetime-local field expects, in the person's own time zone */
export function toLocalInput(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Checks what the contact form holds and returns the record to save.
 * @returns {{ok: true, activity: object} | {ok: false, message: string}}
 */
export function buildContact({ type, when, text }, now = new Date()) {
  const kind = CONTACT_TYPES.find(item => item.id === type);
  if (!kind) return { ok: false, message: 'Escolha o tipo de contato.' };
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, message: 'Escreva o que foi conversado.' };
  if (clean.length > 5000) return { ok: false, message: 'O texto passa de 5.000 caracteres.' };

  let moment = now;
  if (when) {
    moment = new Date(when);
    if (Number.isNaN(moment.getTime())) return { ok: false, message: 'A data do contato não é válida.' };
    // a minute of slack: the field has no seconds
    if (moment.getTime() > now.getTime() + 60000) return { ok: false, message: 'A data do contato não pode estar no futuro. Para algo que ainda vai acontecer, agende uma tarefa.' };
  }
  return { ok: true, activity: { type: kind.id, title: kind.label, text: clean, timestamp: moment.toISOString(), manual: true } };
}
