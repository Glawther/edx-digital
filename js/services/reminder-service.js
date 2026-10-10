/**
 * EDX Digital - Task reminders
 *
 * While the CRM is open (or installed and running), it reminds each person of their own tasks:
 *   - once a day, a summary of what is due today and what is overdue;
 *   - at the time set on a task, a notice for that task.
 * The pure part (what is due, for whom) is tested in tests/unit/reminder-service.test.mjs.
 */

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The tasks a person should be reminded of: pending ones on opportunities assigned to them.
 * An administrator is also reminded of tasks on opportunities with nobody assigned.
 */
export function tasksOf(customers, user, isAdmin) {
  const email = (user?.email || '').toLowerCase();
  const tasks = [];
  customers.forEach(customer => {
    const owner = customer.assignedTo;
    const mine = owner
      ? (owner.id && owner.id === user?.uid) || (email && (owner.email || '').toLowerCase() === email)
      : isAdmin;
    if (!mine) return;
    (customer.tasks || []).forEach(task => {
      if (!task.completed) tasks.push({ ...task, customerId: customer.id, customerName: customer.name });
    });
  });
  return tasks;
}

/**
 * Splits pending tasks by where they stand at this moment
 */
export function dueTasks(tasks, now = new Date()) {
  const today = localDateString(now);
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    overdue: tasks.filter(t => t.dueDate && t.dueDate < today),
    today: tasks.filter(t => t.dueDate === today),
    // tasks with a time that has arrived (today only: yesterday's are in "overdue")
    ringing: tasks.filter(t => t.dueDate === today && t.dueTime && t.dueTime <= clock)
  };
}

export function digestText({ today, overdue }) {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (today.length) parts.push(count(today.length, 'tarefa para hoje', 'tarefas para hoje'));
  if (overdue.length) parts.push(count(overdue.length, 'atrasada', 'atrasadas'));
  return parts.join(' e ');
}

const DIGEST_KEY = 'edx_reminder_digest';
const RUNG_KEY = 'edx_reminder_rung';

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

let timer = null;

/**
 * @param {Object} deps
 * @param {Function} deps.getContext - () => ({ customers, user, isAdmin }) or null when nobody is signed in
 * @param {Function} deps.notify     - (title, body, data) => void
 */
export function startTaskReminders({ getContext, notify }) {
  stopTaskReminders();

  const check = () => {
    const context = getContext();
    if (!context || !context.user) return;
    const who = context.user.uid || context.user.email || 'demo';
    const due = dueTasks(tasksOf(context.customers, context.user, context.isAdmin));

    const digest = readJson(DIGEST_KEY, {});
    const today = localDateString();
    if (digest[who] !== today && (due.today.length || due.overdue.length)) {
      digest[who] = today;
      localStorage.setItem(DIGEST_KEY, JSON.stringify(digest));
      notify('Suas tarefas', `Você tem ${digestText(due)}.`, { view: 'tasks' });
    }

    const rung = readJson(RUNG_KEY, []);
    const fresh = due.ringing.filter(task => !rung.includes(`${task.id}@${today}`));
    if (fresh.length) {
      fresh.forEach(task => {
        notify(`${task.title}, às ${task.dueTime}`, `Tarefa com ${task.customerName || 'cliente'}.`, { view: 'tasks', customerId: task.customerId });
        rung.push(`${task.id}@${today}`);
      });
      localStorage.setItem(RUNG_KEY, JSON.stringify(rung.slice(-200)));
    }
  };

  // The first look waits for the company's data to arrive
  setTimeout(check, 4000);
  timer = setInterval(check, 60000);
  return check;
}

export function stopTaskReminders() {
  if (timer) clearInterval(timer);
  timer = null;
}
