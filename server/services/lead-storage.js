/**
 * EDX Digital - Lead Storage Service
 * Handles asynchronous, non-blocking I/O for webhook leads with data sanitization.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const { DATA_DIR, WEBHOOK_FILE } = require('../config/constants');

/**
 * Initializes data directory and storage file
 */
function initStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WEBHOOK_FILE)) {
    fs.writeFileSync(WEBHOOK_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

/**
 * Escapes HTML characters to prevent XSS payloads
 * @param {string} str 
 * @returns {string}
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Reads leads asynchronously from the webhook JSON file
 * @returns {Promise<Array>}
 */
async function getWebhookLeads() {
  try {
    const raw = await fsPromises.readFile(WEBHOOK_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Storage Service] Error reading leads file:', err);
    return [];
  }
}

/**
 * Writes leads asynchronously to the webhook JSON file
 * @param {Array} leads 
 * @returns {Promise<boolean>}
 */
async function saveWebhookLeads(leads) {
  try {
    await fsPromises.writeFile(WEBHOOK_FILE, JSON.stringify(leads, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Storage Service] Error saving leads file:', err);
    return false;
  }
}

/**
 * Normalizes and sanitizes an incoming raw lead payload
 * @param {Object} rawData 
 * @returns {Object}
 */
function normalizeLeadPayload(rawData) {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  
  return {
    id: 'lead-wh-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    name: sanitizeString(data.name || data.nome || data.full_name) || 'Novo Lead (Tráfego)',
    email: sanitizeString(data.email || ''),
    phone: sanitizeString(data.phone || data.whatsapp || data.telefone || data.celular || ''),
    company: sanitizeString(data.company || data.empresa) || 'Empresa Direta',
    value: Number(data.value || data.valor || 0) || 0,
    stage: 'novo',
    priority: sanitizeString(data.priority || data.prioridade) || 'alta',
    source: sanitizeString(data.source || data.origem) || 'Webhook (Meta/Kiwify)',
    notes: sanitizeString(data.notes || data.mensagem || data.message) || 'Lead capturado automaticamente via Webhook API.',
    createdAt: new Date().toISOString(),
    status: 'unread'
  };
}

module.exports = {
  initStorage,
  getWebhookLeads,
  saveWebhookLeads,
  normalizeLeadPayload
};
