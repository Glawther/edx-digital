/**
 * EDX Digital - Inbox for leads sent by forms
 * One JSON file on the server's disk. It is a short-lived queue, not a database: each CRM
 * account collects its own leads within seconds and they are then kept in the cloud.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const { DATA_DIR, WEBHOOK_FILE } = require('../config/constants');

const MAX_TOTAL = 5000;          // across every inbox
const MAX_PER_INBOX = 500;       // waiting to be collected by one account
const KEEP_PROCESSED_MS = 24 * 60 * 60 * 1000;

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
    const cutoff = Date.now() - KEEP_PROCESSED_MS;
    const current = (await readLeads()).filter(lead => lead.status !== 'processed' || Date.parse(lead.createdAt) > cutoff);
    const next = change(current);
    await fsPromises.writeFile(WEBHOOK_FILE, JSON.stringify(next), 'utf-8');
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

function getWebhookLeads() {
  return queue.then(readLeads);
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
  getWebhookLeads,
  updateLeads,
  normalizeLeadPayload,
  MAX_TOTAL,
  MAX_PER_INBOX
};
