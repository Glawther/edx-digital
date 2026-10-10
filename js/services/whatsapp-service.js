/**
 * EDX Digital - WhatsApp messages
 * Suggestions from Gemini and the wa.me link. The ready-made messages are in js/core/message-templates.js
 */

import { askGeminiForJson } from './gemini-service.js';
import { getStageName } from '../core/crm-store.js';
import { logAudit, AUDIT_ACTIONS } from './audit-service.js';

/**
 * Digits only, with Brazil's country code when the number has none
 */
export function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits.length >= 10 ? digits : '';
}

export function buildWhatsAppLink(phone, message = '') {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return '';
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

/**
 * Three message suggestions written by Gemini for this opportunity.
 * Throws AiUnavailableError when there is no key or Google refuses the call.
 */
export async function generateAIOutreachMessages(lead, context = {}) {
  const prompt = `Escreva 3 mensagens curtas de WhatsApp, em português do Brasil, para um vendedor enviar a um contato.
Tom natural, sem hashtags, sem emojis, sem prometer desconto ou condição que não esteja nos dados.

Contato: ${lead.name || 'não informado'}
Empresa do contato: ${lead.company || 'não informada'}
Etapa do funil: ${getStageName(lead.stage || 'lead')}
Valor: R$ ${lead.dealValue || 0}
Anotações: ${lead.notes || 'nenhuma'}
Quem envia: ${context.userName || 'vendedor'}, da ${context.companyName || 'empresa'}

Responda em JSON: [{ "tone": "nome curto do estilo", "text": "mensagem" }, ...]`;

  const result = await askGeminiForJson(prompt);
  const items = (Array.isArray(result) ? result : [])
    .filter(item => item && item.text)
    .map(item => ({ tone: String(item.tone || 'Sugestão'), text: String(item.text) }))
    .slice(0, 3);
  if (items.length === 0) throw new Error('O Gemini não devolveu sugestões. Tente de novo.');
  return items;
}

export function recordWhatsAppContact(lead) {
  logAudit(AUDIT_ACTIONS.LEAD_UPDATED, { action: 'whatsapp_contact', leadId: lead.id, leadName: lead.name });
}
