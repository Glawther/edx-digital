/**
 * EDX Digital - Google Gemini
 * Opportunity analysis and message suggestions, with the Gemini key of whoever is using the CRM.
 * Without a key, or when Google refuses the call, the caller is told so: nothing is made up.
 */

import { getStageName } from '../core/crm-store.js';

const GEMINI_KEY_STORAGE = 'edx_gemini_api_key';
// Tried in this order; the first one the key has access to answers
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

export class AiUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'no-key' | 'refused'
  }
}

export function getSavedGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

export function saveGeminiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

/**
 * Sends a prompt and returns the parsed JSON answer
 */
export async function askGeminiForJson(prompt) {
  const apiKey = getSavedGeminiKey();
  if (!apiKey) {
    throw new AiUnavailableError('no-key', 'Para usar a IA, informe a sua chave do Google Gemini em Ferramentas.');
  }

  let lastError = null;
  for (const model of MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        // the key goes in a header so it never ends up in an address
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (!text) throw new Error('resposta vazia');
      if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw new AiUnavailableError('refused', `O Google Gemini não respondeu (${lastError ? lastError.message : 'sem detalhe'}). Confira a chave em Ferramentas e tente de novo.`);
}

/**
 * Analyses one opportunity
 * @returns {Promise<{probability:number, summary:string, keyPoints:string[], objections:string[], recommendedAction:string, proposalEmail:string}>}
 */
export async function analyzeDealWithGemini(customer, context = {}) {
  const pendingTasks = (customer.tasks || []).filter(t => !t.completed).map(t => `${t.title} (${t.dueDate || 'sem data'})`);
  const recent = (customer.activities || []).slice(-6).map(a => `${a.title}: ${a.text || ''}`.slice(0, 200));
  const prompt = `
Você apoia um vendedor de uma pequena empresa brasileira. Analise a oportunidade abaixo usando só o que está escrito.
Não invente fatos sobre o cliente. Se faltar informação, diga o que falta.

Quem vende: ${context.companyName || 'não informado'}
Contato: ${customer.name || 'não informado'}${customer.role ? `, ${customer.role}` : ''}
Empresa do contato: ${customer.company || 'não informada'}
Valor: R$ ${customer.dealValue || 0}
Etapa do funil: ${getStageName(customer.stage || 'lead')}
Prioridade: ${customer.priority || 'medium'}
Previsão de fechamento: ${customer.expectedCloseDate || 'não informada'}
Etiquetas: ${(customer.tags || []).join(', ') || 'nenhuma'}
Anotações: ${customer.notes || 'nenhuma'}
Tarefas pendentes: ${pendingTasks.join('; ') || 'nenhuma'}
Últimos registros: ${recent.join(' | ') || 'nenhum'}

Responda em JSON, em português do Brasil, neste formato:
{
  "probability": número de 0 a 100,
  "summary": "até 2 parágrafos curtos",
  "keyPoints": ["até 3 pontos a favor, com base nos dados"],
  "objections": ["até 3 objeções prováveis, cada uma com uma forma de responder"],
  "recommendedAction": "o próximo passo, em uma frase",
  "proposalEmail": "Assunto: ...\\n\\nrascunho curto de e-mail para o contato, assinado por ${context.userName || 'quem vende'}"
}`;

  const result = await askGeminiForJson(prompt);
  const list = (value) => (Array.isArray(value) ? value.map(String).slice(0, 5) : []);
  return {
    probability: Math.max(0, Math.min(100, Number(result.probability) || 0)),
    summary: String(result.summary || ''),
    keyPoints: list(result.keyPoints),
    objections: list(result.objections),
    recommendedAction: String(result.recommendedAction || ''),
    proposalEmail: String(result.proposalEmail || '')
  };
}
