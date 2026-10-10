/**
 * EDX Digital - Webhook Integration Service
 * Manages webhook endpoints, API tokens, and automatic lead ingestion.
 */

import { storage } from '../core/storage-manager.js';
import { crmStore } from '../core/crm-store.js';
import { notify } from './notification-service.js';
import { logAudit, AUDIT_ACTIONS } from './audit-service.js';

const WEBHOOK_CONFIG_KEY = 'edx_webhook_config';

/**
 * Gets or initializes the webhook configuration
 */
function newWebhookToken() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return 'nxwh_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function getWebhookConfig() {
  try {
    const raw = localStorage.getItem(WEBHOOK_CONFIG_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Older tokens were short and guessable; they are replaced on first use
      if (!/^nxwh_[0-9a-f]{40}$/.test(saved.token || '')) {
        saved.token = newWebhookToken();
        saveWebhookConfig(saved);
      }
      return saved;
    }
  } catch (e) {
    console.warn('[Webhook] Error loading config:', e);
  }

  // Default configuration
  const defaultConfig = {
    enabled: true,
    token: newWebhookToken(),
    autoAssignRole: 'employee',
    notifyOnIngest: true,
    lastIngestCheck: null
  };
  saveWebhookConfig(defaultConfig);
  return defaultConfig;
}

/**
 * Saves webhook configuration
 */
export function saveWebhookConfig(config) {
  localStorage.setItem(WEBHOOK_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Generates a new webhook token
 */
export function regenerateWebhookToken() {
  const cfg = getWebhookConfig();
  cfg.token = newWebhookToken();
  saveWebhookConfig(cfg);
  logAudit(AUDIT_ACTIONS.SECURITY_ALERT, { action: 'webhook_token_regenerated' });
  return cfg.token;
}

function getBase() {
  if (typeof window !== 'undefined' && typeof window.getApiBaseUrl === 'function') {
    return window.getApiBaseUrl();
  }
  return '';
}

/**
 * Fetches pending leads from the local backend server endpoint
 */
export async function pollWebhookInbox() {
  try {
    const token = getWebhookConfig().token;
    const res = await fetch(getBase() + '/api/webhook/leads', { headers: { 'x-webhook-token': token } });
    if (!res.ok) return { count: 0, leads: [] };
    const data = await res.json();
    if (!data.leads || data.leads.length === 0) return { count: 0, leads: [] };

    const unreadLeads = data.leads.filter(l => l.status === 'unread');
    if (unreadLeads.length === 0) return { count: 0, leads: [] };

    // Ingest each unread lead into CRM Store via StorageManager
    const currentLeads = storage.getCustomers();
    const existingPhones = new Set(currentLeads.map(l => (l.phone || '').replace(/\D/g, '')));
    const existingEmails = new Set(currentLeads.map(l => (l.email || '').toLowerCase()));

    const newlyIngested = [];
    const acknowledgedIds = [];

    for (const item of unreadLeads) {
      acknowledgedIds.push(item.id);
      
      // Prevent duplicates if already present
      const cleanP = (item.phone || '').replace(/\D/g, '');
      const cleanE = (item.email || '').toLowerCase();
      if ((cleanP && existingPhones.has(cleanP)) || (cleanE && existingEmails.has(cleanE))) {
        continue;
      }

      const newCustomer = {
        id: 'wh-lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        name: item.name || 'Contato sem nome',
        email: item.email || '',
        phone: item.phone || '',
        company: item.company || '',
        dealValue: Number(item.value) || 0,
        stage: 'lead',
        priority: 'medium',
        tags: [item.source ? item.source.split(' ')[0] : 'Formulário'],
        notes: item.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activities: [
          {
            id: 'act-' + Date.now(),
            type: 'note',
            title: 'Recebido por formulário',
            text: item.source ? `Origem: ${item.source}.` : '',
            author: 'Integração',
            timestamp: new Date().toISOString()
          }
        ],
        tasks: []
      };

      await storage.saveCustomer(newCustomer);
      newlyIngested.push(newCustomer);

      notify('Novo contato recebido', `${newCustomer.name}${newCustomer.company ? ', ' + newCustomer.company : ''} entrou no funil${item.source ? ' por ' + item.source : ''}.`, { view: 'pipeline' });

      // Audit log
      logAudit(AUDIT_ACTIONS.LEAD_CREATED, {
        method: 'webhook_api',
        leadName: item.name,
        source: item.source,
        value: item.value
      });
    }

    if (newlyIngested.length > 0 && crmStore) {
      crmStore.emitChange();
    }

    // Acknowledge processed leads to backend
    if (acknowledgedIds.length > 0) {
      fetch(getBase() + '/api/webhook/leads/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-token': token },
        body: JSON.stringify({ leadIds: acknowledgedIds })
      }).catch(e => console.warn('[Webhook] ACK failed:', e));
    }

    return { count: newlyIngested.length, leads: newlyIngested };
  } catch (err) {
    // Quietly ignore if offline or server not running endpoints
    return { count: 0, leads: [] };
  }
}

/**
 * Sends a test lead payload to verify the webhook integration
 */
export async function sendTestWebhookLead(token) {
  const testPayload = {
    name: 'Dra. Camila Vasconcelos',
    email: 'camila.vasconcelos@clinicaestetica.com.br',
    phone: '(11) 99123-4567',
    company: 'Clínica Vasconcelos Dermatologia',
    value: 12500,
    source: 'Meta Ads (Instagram Formulário)',
    notes: 'Interessada no plano Enterprise para equipe de 8 atendentes.'
  };

  const response = await fetch(getBase() + '/api/webhook/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-token': token || getWebhookConfig().token
    },
    body: JSON.stringify(testPayload)
  });

  if (!response.ok) {
    throw new Error(`Falha ao disparar webhook: HTTP ${response.status}`);
  }

  const result = await response.json();
  // Immediately poll inbox to reflect in CRM
  await pollWebhookInbox();
  return result;
}
