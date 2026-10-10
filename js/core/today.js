/**
 * EDX Digital - What to do today
 * From the opportunities a person can see, what needs them now: tasks that are late or due
 * today, deals about to close, deals nobody touched for days, deals with no next step.
 * Pure functions. Tests: tests/unit/today.test.mjs
 */

import { attentionOf, STALLED_DAYS } from './attention.js';
import { lastContact } from './history.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const CLOSING_WINDOW_DAYS = 7;

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const dayNumber = (dateText) => Math.round(Date.parse(dateText + 'T00:00:00Z') / DAY_MS);
const value = (customer) => Number(customer.dealValue) || 0;

/**
 * @param {Array} customers - the opportunities the person can see
 * @returns the five lists of the "Hoje" screen, each in the order it should be worked
 */
export function todayPanel(customers, now = new Date()) {
  const today = localDate(now);
  const todayNumber = dayNumber(today);
  const lateTasks = [];
  const todayTasks = [];
  const closing = [];
  const stalled = [];
  const noTask = [];

  customers.forEach(customer => {
    const flags = attentionOf(customer, now);
    if (!flags.open) return;

    (customer.tasks || []).forEach(task => {
      if (task.completed || !task.dueDate) return;
      if (task.dueDate < today) lateTasks.push({ customer, task, daysLate: todayNumber - dayNumber(task.dueDate) });
      else if (task.dueDate === today) todayTasks.push({ customer, task });
    });

    const closeDate = String(customer.expectedCloseDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) {
      const inDays = dayNumber(closeDate) - todayNumber;
      if (inDays <= CLOSING_WINDOW_DAYS) closing.push({ customer, inDays });
    }

    if (flags.stalled) {
      const last = new Date(customer.updatedAt || customer.createdAt || now).getTime();
      stalled.push({ customer, days: Math.floor((now.getTime() - last) / DAY_MS), lastContact: lastContact(customer) });
    }
    if (flags.noTask) noTask.push(customer);
  });

  // the oldest delay first; today's by time, the ones without a time last
  lateTasks.sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate) || value(b.customer) - value(a.customer));
  todayTasks.sort((a, b) => (a.task.dueTime || '99:99').localeCompare(b.task.dueTime || '99:99'));
  // the closest date first (the ones already past come before); then the largest
  closing.sort((a, b) => a.inDays - b.inDays || value(b.customer) - value(a.customer));
  stalled.sort((a, b) => b.days - a.days || value(b.customer) - value(a.customer));
  noTask.sort((a, b) => value(b) - value(a));

  return {
    lateTasks, todayTasks, closing, stalled, noTask,
    nothing: lateTasks.length + todayTasks.length + closing.length + stalled.length + noTask.length === 0,
    // what the menu shows next to "Hoje": things with a date that is today or already gone
    urgent: lateTasks.length + todayTasks.length
  };
}

export function daysLabel(n, { past = 'há', future = 'em' } = {}) {
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `${future} ${n} dias` : `${past} ${-n} dias`;
}

export { STALLED_DAYS };
