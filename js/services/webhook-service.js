/**
 * EDX Digital - Leads from forms: the company's address token
 * The server writes each lead straight into the company's opportunities; here the
 * administrator only reads the token, issues a new one, and sends a test lead.
 */

import { getIdToken } from './auth-service.js';

// Before, the token lived only in the browser that created it. It is no longer used.
const OLD_CONFIG_KEY = 'edx_webhook_config';

export function forgetOldWebhookToken() {
  try {
    localStorage.removeItem(OLD_CONFIG_KEY);
  } catch { /* storage blocked: nothing to forget */ }
}

function apiBase() {
  return typeof window.getApiBaseUrl === 'function' ? window.getApiBaseUrl() : '';
}

async function tokenRequest(method) {
  const session = await getIdToken();
  const res = await fetch(`${apiBase()}/api/webhook/token`, { method, headers: { Authorization: `Bearer ${session}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Não foi possível falar com o servidor. Tente de novo em instantes.');
  return data.token || null;
}

/** The company's token, or null when none was issued yet */
export const fetchWebhookToken = () => tokenRequest('GET');

/** A new token; the previous one stops working at once */
export const issueWebhookToken = () => tokenRequest('POST');

/** Sends a sample lead through the same address a form uses */
export async function sendTestWebhookLead(token) {
  const res = await fetch(`${apiBase()}/api/webhook/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-token': token },
    body: JSON.stringify({
      name: 'Contato de teste',
      email: `teste.${Date.now().toString(36)}@exemplo.com.br`,
      phone: '(11) 99123-4567',
      company: 'Empresa de teste',
      value: 1000,
      source: 'Teste do EDX Digital',
      notes: 'Enviado pelo botão de teste. Pode excluir.'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}