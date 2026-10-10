/**
 * EDX Digital - Which opportunities need someone's attention, and a check on new passwords.
 * Pure functions. Tests: tests/unit/attention.test.mjs
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALLED_DAYS = 3;

export const FOCUS_OPTIONS = [
  { id: 'all', label: 'Todas' },
  { id: 'stalled', label: 'Paradas' },
  { id: 'noTask', label: 'Sem próxima tarefa' },
  { id: 'lateTask', label: 'Tarefa atrasada' }
];

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * What stands out about one opportunity right now. Won and lost ones need nothing.
 */
export function attentionOf(customer, now = new Date()) {
  const open = customer.stage !== 'won' && customer.stage !== 'lost';
  if (!open) return { open, stalled: false, noTask: false, lateTask: false };
  const pending = (customer.tasks || []).filter(task => !task.completed);
  const last = new Date(customer.updatedAt || customer.createdAt || now).getTime();
  const today = localDate(now);
  return {
    open,
    stalled: (now.getTime() - last) / DAY_MS >= STALLED_DAYS,
    noTask: pending.length === 0,
    lateTask: pending.some(task => task.dueDate && task.dueDate < today)
  };
}

export function matchesFocus(customer, focus, now = new Date()) {
  if (!focus || focus === 'all') return true;
  return attentionOf(customer, now)[focus] === true;
}

export function countAttention(customers, now = new Date()) {
  const counts = { stalled: 0, noTask: 0, lateTask: 0 };
  customers.forEach(customer => {
    const flags = attentionOf(customer, now);
    Object.keys(counts).forEach(key => { if (flags[key]) counts[key] += 1; });
  });
  return counts;
}

const COMMON_PASSWORDS = [
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'senha123',
  'senha1234', '12341234', 'qwertyui', 'qwerty123', 'abc12345', 'abcd1234', 'a1b2c3d4', 'iloveyou', 'brasil123',
  'mudar123', 'trocar123', 'admin123', 'admin1234', 'teste123', 'teste1234', '123mudar', 'edxdigital'
];

/**
 * Why a new password is not acceptable, or '' when it is.
 * Length first; then the passwords everyone tries first, and the person's own name or e-mail.
 */
export function passwordProblem(password, { email = '', name = '' } = {}) {
  const value = String(password || '');
  if (value.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (value.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.includes(lower) || /^(.)\1+$/.test(value)) return 'Essa senha é das primeiras que alguém tentaria. Escolha outra.';
  if (/^\d+$/.test(value) && value.length < 12) return 'Use também letras: uma senha só de números é fácil de adivinhar.';
  const own = [String(email).split('@')[0], ...String(name).split(/\s+/)].map(part => part.toLowerCase()).filter(part => part.length >= 4);
  if (own.some(part => lower === part || lower === part + '123' || lower === part + '1234')) return 'A senha não pode ser o seu nome ou o seu e-mail.';
  return '';
}
