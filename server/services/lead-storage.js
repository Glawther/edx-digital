/**
 * EDX Digital - Inbox for leads sent by forms
 * A short-lived queue, not a database: each CRM account collects its own leads within
 * seconds and keeps them with its other data.
 *
 * Two places to keep the queue, behind the same four operations:
 *   - Firestore (collection webhook_leads, closed to the app by the rules) in production,
 *     where the function has no disk of its own and may run as several copies;
 *   - one JSON file on disk on the developer's machine and in the tests.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const { DATA_DIR, WEBHOOK_FILE } = require('../config/constants');
const { firestoreEmulatorHost, onGoogleCloud } = require('../billing/google-auth');
const { queryDocs, setDoc, deleteDoc } = require('../billing/firestore-store');

const MAX_TOTAL = 5000;          // across every inbox (file only)
const MAX_PER_INBOX = 500;       // waiting to be collected by one account
const KEEP_PROCESSED_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- file

function initStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WEBHOOK_FILE)) fs.writeFileSync(WEBHOOK_FILE, '[]', 'utf-8');
}

async function readLeads() {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(WEBHOOK_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Two requests arriving together used to read the same file and one overwrote the other.
// Every change now waits for the one before it.
let queue = Promise.resolve();

/**
 * Reads the list, lets `change` return the new one, and writes it back, one caller at a time
 * @param {(leads: Array) => Array} change
 */
function updateLeads(change) {
  const run = queue.then(async () => {
    initStorage();
    const cutoff = Date.now() - KEEP_PROCESSED_MS;
    const current = (await readLeads()).filter(lead => lead.status !== 'processed' || Date.parse(lead.createdAt) > cutoff);
    const next = change(current);
    await fsPromises.writeFile(WEBHOOK_FILE, JSON.stringify(next), 'utf-8');
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

const fileInbox = {
  /** @returns {Promise<boolean>} false when this inbox already holds as many as it may */
  async add(lead) {
    let full = false;
    await updateLeads((leads) => {
      const waiting = leads.filter(item => item.inbox === lead.inbox && item.status === 'unread').length;
      if (waiting >= MAX_PER_INBOX) {
        full = true;
        return leads;
      }
      return [lead, ...leads].slice(0, MAX_TOTAL);
    });
    return !full;
  },

  async list(inbox) {
    return (await queue.then(readLeads)).filter(lead => lead.inbox === inbox);
  },

  /** @param {string[]|null} ids - null acknowledges everything in the inbox */
  async acknowledge(inbox, ids) {
    await updateLeads(leads => leads.map(lead => (
      lead.inbox === inbox && (!ids || ids.includes(lead.id)) ? { ...lead, status: 'processed' } : lead
    )));
  }
};

// ---------------------------------------------------------------- Firestore

const COLLECTION = 'webhook_leads';

const firestoreInbox = {
  async add(lead) {
    const waiting = await queryDocs(COLLECTION, [['inbox', lead.inbox], ['status', 'unread']], MAX_PER_INBOX);
    if (waiting.length >= MAX_PER_INBOX) return false;
    await setDoc(`${COLLECTION}/${lead.id}`, lead);
    return true;
  },

  async list(inbox) {
    return (await queryDocs(COLLECTION, [['inbox', inbox]], MAX_PER_INBOX)).map(doc => doc.data);
  },

  // Once collected, a lead lives in the company's own data: here it is simply removed
  async acknowledge(inbox, ids) {
    const mine = await queryDocs(COLLECTION, [['inbox', inbox]], MAX_PER_INBOX);
    const wanted = mine.filter(doc => !ids || ids.includes(doc.data.id));
    await Promise.all(wanted.map(doc => deleteDoc(`${COLLECTION}/${doc.id}`)));
  }
};

/** Firestore in production (and against the emulator when asked); the file otherwise */
function leadInbox() {
  if (onGoogleCloud()) return firestoreInbox;
  if (process.env.LEADS_STORE === 'firestore' && firestoreEmulatorHost()) return firestoreInbox;
  return fileInbox;
}

// Plain text with a size limit. Escaping for the screen is the screen's job.
function text(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, '').trim().slice(0, max);
}

/**
 * Keeps the fields the CRM understands, under the names it uses
 */
function normalizeLeadPayload(rawData) {
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};
  const value = Number(data.value ?? data.valor ?? 0);
  return {
    id: 'lead-wh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: text(data.name || data.nome || data.full_name, 200),
    email: text(data.email, 200),
    phone: text(data.phone || data.whatsapp || data.telefone || data.celular, 40),
    company: text(data.company || data.empresa, 200),
    value: Number.isFinite(value) && value > 0 ? Math.min(value, 1000000000) : 0,
    source: text(data.source || data.origem, 80),
    notes: text(data.notes || data.mensagem || data.message, 2000),
    createdAt: new Date().toISOString(),
    status: 'unread'
  };
}

module.exports = {
  initStorage,
  leadInbox,
  fileInbox,
  firestoreInbox,
  normalizeLeadPayload,
  MAX_TOTAL,
  MAX_PER_INBOX
};
