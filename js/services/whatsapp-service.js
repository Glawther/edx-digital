/**
 * EDX Digital - WhatsApp messages
 * The wa.me link (the AI suggestions are in ai-service.js). The ready-made messages are in js/core/message-templates.js
 */

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

export function recordWhatsAppContact(lead) {
  logAudit(AUDIT_ACTIONS.LEAD_UPDATED, { action: 'whatsapp_contact', leadId: lead.id, leadName: lead.name });
}
