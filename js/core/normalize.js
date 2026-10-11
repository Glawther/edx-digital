/**
 * EDX Digital - Records as the screens expect them
 *
 * Whatever is stored, a record that reaches the screens has every field in the type the
 * screens assume. A record written around the app (or by an older version) can then look
 * odd, but it can never stop the funnel from drawing for everyone else.
 * Tests: tests/unit/normalize.test.mjs
 */

import { cleanItems } from './proposal-items.js';
import { isSafeId } from './html.js';

const STAGE_IDS = ['lead', 'contact', 'proposal', 'negotiation', 'won', 'lost'];
const PRIORITIES = ['high', 'medium', 'low'];

const text = (value, max = 2000) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '').slice(0, max);
const isoDate = (value) => (typeof value === 'string' && !isNaN(Date.parse(value)) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const plainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

function normalizeTask(raw) {
  const task = plainObject(raw);
  if (!task || !isSafeId(task.id)) return null;
  return {
    ...task,
    id: task.id,
    title: text(task.title, 300) || 'Tarefa',
    type: text(task.type, 30) || 'followup',
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : '',
    dueTime: /^\d{2}:\d{2}$/.test(task.dueTime) ? task.dueTime : '',
    completed: task.completed === true
  };
}

function normalizeActivity(raw) {
  const activity = plainObject(raw);
  if (!activity || !isSafeId(activity.id)) return null;
  return {
    ...activity,
    id: activity.id,
    type: text(activity.type, 30) || 'note',
    title: text(activity.title, 300),
    text: text(activity.text, 5000),
    author: text(activity.author, 200),
    timestamp: isoDate(activity.timestamp) || new Date(0).toISOString()
  };
}

function normalizeAssignee(raw) {
  const person = plainObject(raw);
  if (!person) return null;
  const id = text(person.id, 200);
  const email = text(person.email, 320);
  const name = text(person.name, 200) || email || 'Sem nome';
  return id || email ? { id, name, email } : null;
}

/**
 * @param {Object} raw - a customer document as stored
 * @returns {Object} the same record, every field in the expected type
 */
export function normalizeCustomer(raw) {
  const data = plainObject(raw) || {};
  const custom = {};
  Object.entries(plainObject(data.custom) || {}).forEach(([key, value]) => {
    if (/^cf_[a-z0-9]{1,24}$/.test(key) && (typeof value === 'string' || typeof value === 'number')) custom[key] = value;
  });
  const value = Number(data.dealValue);
  const stage = data.stage === 'contacted' ? 'contact' : data.stage;
  const createdAt = isoDate(data.createdAt) || new Date(0).toISOString();

  return {
    ...data,
    name: text(data.name, 300) || 'Sem nome',
    company: text(data.company, 300),
    role: text(data.role, 300),
    email: text(data.email, 320),
    phone: text(data.phone, 60),
    notes: text(data.notes, 20000),
    dealValue: Number.isFinite(value) && value > 0 ? value : 0,
    stage: STAGE_IDS.includes(stage) ? stage : 'lead',
    priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
    recurring: data.recurring === true,
    pipelineId: typeof data.pipelineId === 'string' && /^(default|p_[a-z0-9]{4,16})$/.test(data.pipelineId) ? data.pipelineId : 'default',
    items: cleanItems(data.items),
    expectedCloseDate: typeof data.expectedCloseDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data.expectedCloseDate) ? data.expectedCloseDate : '',
    tags: list(data.tags).filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.slice(0, 60)).slice(0, 30),
    tasks: list(data.tasks).map(normalizeTask).filter(Boolean),
    activities: list(data.activities).map(normalizeActivity).filter(Boolean),
    assignedTo: normalizeAssignee(data.assignedTo),
    custom,
    lossReason: text(data.lossReason, 100) || null,
    lossDetails: text(data.lossDetails, 2000),
    createdAt,
    updatedAt: isoDate(data.updatedAt) || createdAt,
    wonAt: isoDate(data.wonAt),
    lostAt: isoDate(data.lostAt),
    createdBy: text(data.createdBy, 200),
    updatedBy: text(data.updatedBy, 200)
  };
}
