/**
 * EDX Digital - The AI features: opportunity analysis and message suggestions
 * The server writes the prompt from the opportunity saved in the database and calls the AI with
 * the system's own key (server/ai). Nobody configures a key; each company has a daily allowance.
 * When the AI cannot answer, the caller is told so: nothing is made up.
 */

import { getIdToken, isCloudSession } from './auth-service.js';

// The key each browser used to keep for Gemini. It is no longer used.
const OLD_GEMINI_KEY = 'edx_gemini_api_key';

export function forgetOldGeminiKey() {
  try {
    localStorage.removeItem(OLD_GEMINI_KEY);
  } catch { /* storage blocked: nothing to forget */ }
}

export class AiUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'demo' | 'daily_limit' | 'plan_expired' | 'refused' | ...
  }
}

function apiBase() {
  return typeof window.getApiBaseUrl === 'function' ? window.getApiBaseUrl() : '';
}

async function askServer(task, customerId) {
  if (!isCloudSession()) {
    throw new AiUnavailableError('demo', 'A inteligência artificial funciona na conta da sua empresa. Na demonstração ela não está disponível.');
  }
  let res;
  try {
    const token = await getIdToken();
    res = await fetch(`${apiBase()}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task, customerId })
    });
  } catch {
    throw new AiUnavailableError('offline', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AiUnavailableError(data.error || 'refused', data.message || 'A inteligência artificial não respondeu agora. Tente de novo em instantes.');
  }
  return data;
}

/**
 * Analyses one opportunity (the version saved in the database)
 * @returns {Promise<{probability:number, summary:string, keyPoints:string[], objections:string[], recommendedAction:string, proposalEmail:string}>}
 */
export async function analyzeDeal(customer) {
  const { analysis } = await askServer('analysis', customer.id);
  return analysis;
}

/** Three WhatsApp message suggestions for this opportunity */
export async function suggestMessages(customer) {
  const { messages } = await askServer('messages', customer.id);
  return messages;
}
