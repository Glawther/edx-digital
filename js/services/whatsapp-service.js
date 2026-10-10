/**
 * Nexus CRM - WhatsApp Integration & AI Outreach Assistant
 * Generates high-converting sales messages and provides direct wa.me links.
 */

import { getSavedGeminiKey } from './gemini-service.js';
import { logAudit, AUDIT_ACTIONS } from './audit-service.js';
import { addInAppNotification, NOTIFICATION_TYPES } from './notification-service.js';

/**
 * Message templates based on sales pipeline stages
 */
export const OUTREACH_TEMPLATES = {
  first_contact: {
    label: 'Primeiro Contato (Apresentação)',
    template: (lead, user, company) => 
      `Olá ${lead.name || 'tudo bem'}! Aqui é o ${user?.name || 'consultor'} da ${company || 'nossa equipe'}. Vi que você demonstrou interesse em nossas soluções e gostaria de entender melhor seu momento para podermos ajudar. Teria 5 minutinhos hoje para conversarmos?`
  },
  proposal_followup: {
    label: 'Acompanhamento de Proposta',
    template: (lead, user, company) => 
      `Olá ${lead.name}! Passando para saber se você conseguiu avaliar a proposta comercial que enviamos da ${company || 'nossa empresa'}. Ficou com alguma dúvida sobre os valores ou prazos que eu possa esclarecer agora?`
  },
  negotiation: {
    label: 'Quebra de Objeção & Condição Especial',
    template: (lead, user, company) => 
      `Olá ${lead.name}! Consegui aprovar com a nossa diretoria uma condição especial de fechamento para sua proposta esta semana. Se conseguirmos assinar até sexta-feira, consigo manter os benefícios diferenciados. Podemos fechar?`
  },
  cold_lead: {
    label: 'Reativação de Lead Frio',
    template: (lead, user, company) => 
      `Olá ${lead.name}, tudo bem? Faz alguns dias que conversamos sobre seu projeto. O projeto ainda é uma prioridade para você este mês ou prefere que eu retome o contato mais adiante?`
  },
  closing: {
    label: 'Fechamento & Próximos Passos',
    template: (lead, user, company) => 
      `Excelente ${lead.name}! Estamos prontos para iniciar o seu onboarding. Vou te enviar o link para assinatura do contrato e emissão da fatura para liberarmos seu acesso hoje mesmo. Combinado?`
  }
};

/**
 * Normalizes phone number into international E.164 without plus sign
 * Handles Brazilian cell numbers (DDD + 9 digits)
 */
export function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  
  // If no country code, add 55 (Brazil)
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }
  
  return digits;
}

/**
 * Builds direct WhatsApp URL
 */
export function buildWhatsAppLink(phone, message = '') {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return '';
  const encodedText = encodeURIComponent(message);
  return `https://wa.me/${clean}?text=${encodedText}`;
}

/**
 * Generates AI-personalized outreach options using Gemini
 */
export async function generateAIOutreachMessages(lead, context = {}) {
  const cleanPhone = cleanPhoneNumber(lead.phone || lead.whatsapp);
  const companyName = context.companyName || 'Nexus CRM';
  const userName = context.userName || 'Consultor Comercial';
  
  // Fast local fallbacks
  const fallbacks = [
    {
      tone: 'Consultivo & Direto',
      text: OUTREACH_TEMPLATES.first_contact.template(lead, { name: userName }, companyName)
    },
    {
      tone: 'Focado em Valor & Urgência',
      text: OUTREACH_TEMPLATES.proposal_followup.template(lead, { name: userName }, companyName)
    },
    {
      tone: 'Condição Especial',
      text: OUTREACH_TEMPLATES.negotiation.template(lead, { name: userName }, companyName)
    }
  ];

  // Try generating contextual Gemini AI suggestions if key is configured
  const apiKey = getSavedGeminiKey();
  if (apiKey) {
    try {
      const prompt = `Você é um especialista em vendas B2B e copywriting para WhatsApp.
Gere 3 mensagens curtas, naturais e persuasivas de abordagem para enviar a este lead:
Nome: ${lead.name || 'Cliente'}
Empresa do Lead: ${lead.company || 'Não informada'}
Estágio no Funil: ${lead.stage || 'Novo Lead'}
Valor Estimado: R$ ${lead.value || 0}
Observações: ${lead.notes || 'Nenhuma'}
Nome do Vendedor: ${userName}
Nome da Empresa do Vendedor: ${companyName}

Retorne um JSON exatamente no formato:
[
  { "tone": "Nome do Estilo", "text": "Texto da mensagem em português brasileiro, natural e sem hashtags" },
  { "tone": "Nome do Estilo", "text": "..." },
  { "tone": "Nome do Estilo", "text": "..." }
]`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return parsed;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WhatsApp AI] Falling back to default outreach templates:', e);
    }
  }

  return fallbacks;
}

/**
 * Logs WhatsApp contact action
 */
export function recordWhatsAppContact(lead, message) {
  logAudit(AUDIT_ACTIONS.LEAD_UPDATED, {
    action: 'whatsapp_contact',
    leadId: lead.id,
    leadName: lead.name,
    phone: cleanPhoneNumber(lead.phone || lead.whatsapp),
    preview: message ? message.substring(0, 60) + '...' : ''
  });

  addInAppNotification({
    type: NOTIFICATION_TYPES.LEAD_UPDATE,
    title: `Contato WhatsApp: ${lead.name}`,
    body: `Mensagem enviada pelo WhatsApp para ${lead.phone || lead.name}.`
  });
}
