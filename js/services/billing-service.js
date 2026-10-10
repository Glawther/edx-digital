/**
 * Nexus CRM - Billing & Payment Gateway Service
 * Handles plan checkout, PIX instant payment, Credit Card validation,
 * recurring subscription management, and invoice receipts.
 */

import { getSavedOrganization, saveOrganization } from '../core/config.js';
import { logAudit, AUDIT_ACTIONS, AUDIT_SEVERITY } from './audit-service.js';
import { sendPushNotification, NOTIFICATION_TYPES } from './notification-service.js';

const INVOICES_STORAGE_KEY = 'nexus_crm_invoices';

export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    badge: 'Iniciante',
    priceMonthly: 49,
    priceYearly: 470,
    maxLeads: 500,
    maxUsers: 2,
    aiQuotaMonth: 30,
    features: [
      'Até 500 leads ativos',
      '2 vendedores / consultores',
      '30 análises de IA (Gemini Flash)/mês',
      'Kanban comercial drag & drop',
      'Backup e exportação CSV'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Nexus Pro',
    badge: 'Mais Popular',
    priceMonthly: 149,
    priceYearly: 1430,
    maxLeads: 5000,
    maxUsers: 10,
    aiQuotaMonth: 150,
    features: [
      'Até 5.000 leads ativos',
      '10 membros da equipe com papéis',
      '150 análises de IA/mês',
      'Customização Whitelabel completa',
      'Sincronização Cloud Firestore',
      'Notificações Push no navegador'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    badge: 'Corporativo',
    priceMonthly: 349,
    priceYearly: 3350,
    maxLeads: 999999,
    maxUsers: 999,
    aiQuotaMonth: 9999,
    features: [
      'Leads ilimitados',
      'Equipe e consultores ilimitados',
      'Cota de IA ilimitada (Gemini BYOK)',
      'Histórico de auditoria',
      'Multi-tenant com isolamento total',
      'Suporte prioritário VIP 24/7'
    ]
  }
};

/**
 * Generates an SVG QR code visual for PIX payments without external dependencies
 */
export function generatePixQRCodeSVG(text) {
  // A clean, high-contrast procedural SVG QR-code placeholder matrix
  const size = 200;
  const cellSize = 8;
  const count = 25;
  
  // Seedable pseudo-random grid based on input text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  let rects = '';
  // Corner markers (Finder patterns)
  function addFinderPattern(x, y) {
    rects += `<rect x="${x}" y="${y}" width="56" height="56" fill="#000" rx="4"/>`;
    rects += `<rect x="${x + 8}" y="${y + 8}" width="40" height="40" fill="#fff" rx="2"/>`;
    rects += `<rect x="${x + 16}" y="${y + 16}" width="24" height="24" fill="#000" rx="2"/>`;
  }

  addFinderPattern(8, 8);
  addFinderPattern(136, 8);
  addFinderPattern(8, 136);

  // Generate data modules inside the remaining grid
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      // Skip finder pattern zones
      const inTopLeft = r < 9 && c < 9;
      const inTopRight = r < 9 && c > 15;
      const inBottomLeft = r > 15 && c < 9;
      if (inTopLeft || inTopRight || inBottomLeft) continue;

      const val = Math.sin(hash + r * 17 + c * 31);
      if (val > 0.05) {
        rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize - 0.5}" height="${cellSize - 0.5}" fill="#0f172a" rx="1"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="180" height="180" style="background:#ffffff; border-radius:12px; padding:12px; box-shadow:0 8px 24px rgba(0,0,0,0.15);">
    ${rects}
  </svg>`;
}

/**
 * Generates dynamic PIX payload string (BR Code standard simulation)
 */
export function generatePixPayload(planId, cycle = 'monthly') {
  const plan = PLANS[planId] || PLANS.pro;
  const value = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
  const txId = 'NEXUS' + Date.now().toString(36).toUpperCase();
  const cents = value.toFixed(2);
  
  // Real-looking PIX EMVCo string
  return `00020126580014br.gov.bcb.pix0136nexus-crm-financeiro@nexuscrm.com.br520400005303986540${cents.length < 10 ? '0' + cents.length : cents}${cents}5802BR5916NEXUS CRM SAAS6009SAO PAULO62190515${txId}6304ABCD`;
}

/**
 * Validates credit card details
 */
export function validateCreditCard(cardData) {
  const { number, name, expiry, cvv } = cardData;
  const cleanNumber = (number || '').replace(/\D/g, '');
  
  if (cleanNumber.length < 13 || cleanNumber.length > 19) {
    return { valid: false, error: 'Número do cartão inválido (deve conter entre 13 e 19 dígitos).' };
  }

  if (!name || name.trim().length < 3) {
    return { valid: false, error: 'Nome impresso no cartão é obrigatório.' };
  }

  const cleanExpiry = (expiry || '').replace(/\D/g, '');
  if (cleanExpiry.length !== 4) {
    return { valid: false, error: 'Validade do cartão deve ser no formato MM/AA.' };
  }

  const month = parseInt(cleanExpiry.substring(0, 2), 10);
  if (month < 1 || month > 12) {
    return { valid: false, error: 'Mês de validade inválido (01 a 12).' };
  }

  const cleanCvv = (cvv || '').replace(/\D/g, '');
  if (cleanCvv.length < 3 || cleanCvv.length > 4) {
    return { valid: false, error: 'CVV inválido (deve conter 3 ou 4 dígitos).' };
  }

  return { valid: true, brand: detectCardBrand(cleanNumber) };
}

/**
 * Detects card brand from number
 */
export function detectCardBrand(number) {
  const clean = (number || '').replace(/\D/g, '');
  if (/^4/.test(clean)) return 'Visa ';
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[0-1]|2720)/.test(clean)) return 'Mastercard ';
  if (/^3[47]/.test(clean)) return 'American Express ';
  if (/^6(011|5)/.test(clean)) return 'Discover ';
  if (/^(4011|4389|4514|4576|5041|5066|5090)/.test(clean)) return 'Elo ';
  return 'Cartão de Crédito ';
}

/**
 * Processes a checkout transaction (PIX or Credit Card)
 * @param {Object} paymentInfo - { planId, cycle, method, cardData, customerInfo }
 * @returns {Promise<Object>} Result with invoice receipt
 */
export async function processPayment(paymentInfo) {
  const { planId, cycle = 'monthly', method = 'pix', cardData = null, customerInfo = {} } = paymentInfo;
  const plan = PLANS[planId] || PLANS.pro;
  const amount = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;

  // Validate card if method is credit card
  if (method === 'credit_card') {
    const cardValidation = validateCreditCard(cardData || {});
    if (!cardValidation.valid) {
      return { success: false, error: cardValidation.error };
    }
  }

  // Simulate payment processing delay (instant gateway response)
  await new Promise(resolve => setTimeout(resolve, 800));

  const invoiceId = 'INV-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100);
  const now = new Date();
  const nextBilling = new Date();
  if (cycle === 'yearly') {
    nextBilling.setFullYear(nextBilling.getFullYear() + 1);
  } else {
    nextBilling.setMonth(nextBilling.getMonth() + 1);
  }

  const invoice = {
    id: invoiceId,
    planId: plan.id,
    planName: plan.name,
    cycle,
    amount,
    currency: 'BRL',
    method: method === 'pix' ? 'PIX Instantâneo' : 'Cartão de Crédito',
    status: 'paid',
    cardLast4: method === 'credit_card' ? (cardData?.number || '').slice(-4) : null,
    paidAt: now.toISOString(),
    validUntil: nextBilling.toISOString(),
    customerEmail: customerInfo.email || 'contato@empresa.com',
    customerName: customerInfo.name || 'Cliente Nexus'
  };

  // Save invoice to local storage
  saveInvoice(invoice);

  // Update Organization subscription plan limits
  const currentOrg = getSavedOrganization();
  const updatedOrg = {
    ...currentOrg,
    plan: plan.id,
    planName: plan.name,
    planStatus: 'active',
    maxLeads: plan.maxLeads,
    maxUsers: plan.maxUsers,
    aiQuotaMonth: plan.aiQuotaMonth,
    planExpiresAt: nextBilling.toISOString(),
    lastPayment: {
      invoiceId: invoice.id,
      amount: invoice.amount,
      method: invoice.method,
      paidAt: invoice.paidAt
    }
  };
  saveOrganization(updatedOrg);

  // Log in Audit Trail
  logAudit(AUDIT_ACTIONS.PLAN_CHANGED, {
    planId: plan.id,
    planName: plan.name,
    cycle,
    amount,
    method: invoice.method,
    invoiceId: invoice.id
  }, AUDIT_SEVERITY.INFO);

  // Send push notification
  sendPushNotification(`Assinatura ${plan.name} Confirmada!`, {
    body: `Seu pagamento de R$ ${amount.toFixed(2)} foi processado com sucesso. Todos os recursos foram liberados!`,
    data: { type: NOTIFICATION_TYPES.SYSTEM, invoiceId: invoice.id }
  });

  return {
    success: true,
    invoice,
    organization: updatedOrg
  };
}

/**
 * Gets all stored invoices
 */
export function getInvoices() {
  try {
    const raw = localStorage.getItem(INVOICES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Saves a new invoice to storage
 */
export function saveInvoice(invoice) {
  const invoices = getInvoices();
  invoices.unshift(invoice);
  // Keep last 50 invoices
  if (invoices.length > 50) invoices.length = 50;
  localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(invoices));
}
