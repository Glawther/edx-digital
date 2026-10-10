/**
 * EDX Digital - What is sent to the customer: WhatsApp messages, proposals, and the AI analysis
 */

import { messagesFor } from '../core/message-templates.js';
import { getStageName } from '../core/crm-store.js';
import { getSavedOrganization } from '../core/config.js';
import { storage } from '../core/storage-manager.js';
import { getCurrentUser } from '../services/auth-service.js';
import { analyzeDealWithGemini, getSavedGeminiKey, saveGeminiKey } from '../services/gemini-service.js';
import {
  buildWhatsAppLink,
  generateAIOutreachMessages,
  recordWhatsAppContact
} from '../services/whatsapp-service.js';
import { escapeHtml, formatBRL, showToast } from '../ui/ui-renderer.js';

let activeWhatsAppCustomerId = null;

let activeProposalCustomerId = null;

// ==========================================================================
// WhatsApp Templates & AI Outreach Assistant Modal
// ==========================================================================
export function setupWhatsAppModalEvents() {
  const dialog = document.getElementById('whatsapp-dialog');
  const btnClose = document.getElementById('btn-close-whatsapp-dialog');
  const leadNameEl = document.getElementById('wa-lead-name');
  const leadMetaEl = document.getElementById('wa-lead-meta');
  const leadPhoneEl = document.getElementById('wa-lead-phone');
  const templatesContainer = document.getElementById('wa-templates-container');
  const messagePreview = document.getElementById('wa-message-preview');
  const charCountEl = document.getElementById('wa-char-count');
  const btnGenerateAi = document.getElementById('btn-wa-generate-ai');
  const btnCopy = document.getElementById('btn-wa-copy');
  const btnSendDirect = document.getElementById('btn-wa-send-direct');

  const closeDialog = () => dialog && dialog.close();
  if (btnClose) btnClose.addEventListener('click', closeDialog);

  if (messagePreview && charCountEl) {
    messagePreview.addEventListener('input', () => {
      charCountEl.textContent = `${messagePreview.value.length} caracteres`;
    });
  }

  window.handleOpenWhatsAppModal = function(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) {
      showToast('Oportunidade não encontrada.', 'error');
      return;
    }
    const phone = customer.phone || customer.whatsapp;
    if (!phone) {
      showToast('Este contato não tem telefone cadastrado.', 'error');
      return;
    }

    activeWhatsAppCustomerId = customerId;
    const org = getSavedOrganization();
    const user = getCurrentUser();

    if (leadNameEl) leadNameEl.textContent = customer.name;
    if (leadMetaEl) leadMetaEl.textContent = customer.company ? `, ${customer.company}` : '';
    if (leadPhoneEl) leadPhoneEl.textContent = phone;

    // The company's own templates, or the standard ones; the one that fits the stage comes first
    renderTemplatesList(messagesFor(org, {
      customer,
      userName: user?.name,
      companyName: org.name,
      stageName: getStageName(customer.stage || 'lead')
    }), customer);

    if (dialog) dialog.showModal();
  };

  function renderTemplatesList(items) {
    if (!templatesContainer) return;

    const select = (idx) => {
      templatesContainer.querySelectorAll('.wa-template').forEach((button, i) => {
        button.classList.toggle('active', i === idx);
        button.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
      });
      if (items[idx] && messagePreview) {
        messagePreview.value = items[idx].text;
        if (charCountEl) charCountEl.textContent = `${items[idx].text.length} caracteres`;
      }
    };

    templatesContainer.innerHTML = items.map((item, idx) => `
      <button type="button" class="wa-template" data-idx="${idx}" aria-pressed="false">${escapeHtml(item.tone)}</button>
    `).join('');
    templatesContainer.querySelectorAll('.wa-template').forEach((button, idx) => {
      button.addEventListener('click', () => select(idx));
    });
    select(0);
  }

  // AI Generator button
  if (btnGenerateAi) {
    btnGenerateAi.addEventListener('click', async () => {
      const customer = storage.getCustomer(activeWhatsAppCustomerId);
      if (!customer) return;

      btnGenerateAi.disabled = true;
      btnGenerateAi.textContent = 'Gerando sugestões...';

      const org = getSavedOrganization();
      const user = getCurrentUser();

      try {
        const aiOptions = await generateAIOutreachMessages(customer, {
          companyName: org.name,
          userName: user?.name
        });

        renderTemplatesList(aiOptions, customer);
        showToast('Sugestões do Gemini prontas. Escolha uma e ajuste o texto.', 'success');
      } catch (err) {
        showToast(err.message, err.code === 'no-key' ? 'info' : 'error', err.code === 'no-key'
          ? { label: 'Informar a chave', onClick: () => document.getElementById('sidebar-gemini-btn')?.click() }
          : null);
      } finally {
        btnGenerateAi.disabled = false;
        btnGenerateAi.textContent = 'Sugerir com IA';
      }
    });
  }

  // Copy button
  if (btnCopy && messagePreview) {
    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(messagePreview.value);
        showToast('Mensagem copiada.', 'success');
      } catch {
        messagePreview.select();
        document.execCommand('copy');
        showToast('Mensagem copiada.', 'success');
      }
    });
  }

  // Direct send via wa.me
  if (btnSendDirect && messagePreview) {
    btnSendDirect.addEventListener('click', async () => {
      const customer = storage.getCustomer(activeWhatsAppCustomerId);
      if (!customer) return;

      const phone = customer.phone || customer.whatsapp;
      const message = messagePreview.value.trim();
      const link = buildWhatsAppLink(phone, message);

      if (!link) {
        showToast('O telefone deste contato não é válido para o WhatsApp. Confira o número.', 'error');
        return;
      }

      // Log contact action
      recordWhatsAppContact(customer);
      await storage.addActivity(customer.id, {
        type: 'whatsapp',
        title: 'Mensagem pelo WhatsApp',
        text: message
      });

      // Open WhatsApp Web
      window.open(link, '_blank', 'noopener');
      closeDialog();
      showToast('WhatsApp aberto. A mensagem ficou registrada no histórico.', 'success');
    });
  }
}

// ==========================================================================
// Firebase Configuration Dialog
// ==========================================================================
// ==========================================================================
// Gemini AI Modals & Handlers
// ==========================================================================
export function setupGeminiModals() {
  const geminiDialog = document.getElementById('gemini-dialog');
  const btnClose = document.getElementById('btn-close-gemini-dialog');
  const btnCloseFooter = document.getElementById('btn-close-gemini-modal-footer');
  const btnCopyEmail = document.getElementById('btn-copy-proposal-email');

  const closeDialog = () => geminiDialog && geminiDialog.close();
  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDialog);

  if (btnCopyEmail) {
    btnCopyEmail.addEventListener('click', () => {
      const emailContent = document.getElementById('gemini-email-draft').textContent;
      navigator.clipboard.writeText(emailContent).then(() => {
        showToast("Rascunho de e-mail copiado para a área de transferência!", "success");
      }).catch(() => {
        showToast("Não foi possível copiar automaticamente.", "error");
      });
    });
  }

  // Gemini API Key Config Dialog
  const keyDialog = document.getElementById('gemini-key-dialog');
  const btnOpenKey = document.getElementById('sidebar-gemini-btn');
  const btnCloseKey = document.getElementById('btn-close-gemini-key-dialog');
  const btnCancelKey = document.getElementById('btn-cancel-gemini-key');
  const keyForm = document.getElementById('gemini-key-form');
  const keyInput = document.getElementById('input-gemini-key');

  if (btnOpenKey && keyDialog) {
    btnOpenKey.addEventListener('click', () => {
      if (keyInput) keyInput.value = getSavedGeminiKey();
      keyDialog.showModal();
    });
  }

  const closeKeyDialog = () => keyDialog && keyDialog.close();
  if (btnCloseKey) btnCloseKey.addEventListener('click', closeKeyDialog);
  if (btnCancelKey) btnCancelKey.addEventListener('click', closeKeyDialog);

  if (keyForm) {
    keyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = keyInput ? keyInput.value : '';
      saveGeminiKey(key);
      keyDialog.close();
      showToast(key ? "Chave do Google Gemini salva neste navegador." : "Chave do Gemini removida.", "success");
    });
  }
}

window.handleAnalyzeWithAI = async function(customerId) {
  const geminiDialog = document.getElementById('gemini-dialog');
  const customer = storage.getCustomer(customerId);
  if (!customer || !geminiDialog) return;

  const show = (id) => ['gemini-loading', 'gemini-results', 'gemini-unavailable'].forEach(part => {
    const el = document.getElementById(part);
    if (el) el.style.display = part === id ? 'block' : 'none';
  });
  const fill = (id, items) => {
    document.getElementById(id).innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  };

  document.getElementById('gemini-dialog-customer-name').textContent = customer.name;
  document.getElementById('gemini-dialog-customer-meta').textContent = [customer.company, formatBRL(customer.dealValue)].filter(Boolean).join(', ');
  show('gemini-loading');
  geminiDialog.showModal();

  try {
    const analysis = await analyzeDealWithGemini(customer, {
      companyName: getSavedOrganization().name,
      userName: getCurrentUser()?.name
    });
    const prob = Math.round(analysis.probability);
    document.getElementById('gemini-probability-number').textContent = `${prob}%`;
    document.getElementById('gemini-probability-bar').style.width = `${prob}%`;
    document.getElementById('gemini-summary-text').textContent = analysis.summary;
    fill('gemini-keypoints-list', analysis.keyPoints);
    fill('gemini-objections-list', analysis.objections);
    document.getElementById('gemini-recommended-action').textContent = analysis.recommendedAction;
    document.getElementById('gemini-email-draft').textContent = analysis.proposalEmail;
    show('gemini-results');
  } catch (err) {
    // No key, or Google refused: say so instead of showing an analysis nobody made
    document.getElementById('gemini-unavailable-text').textContent = err.code === 'no-key'
      ? 'A análise é feita pelo Google Gemini com a sua própria chave, que é gratuita para começar. Informe a chave para usar este recurso.'
      : err.message;
    show('gemini-unavailable');
  }
};

// ==========================================================================
// Proposal Modal Events (One-Click Proposal & PDF Print)
// ==========================================================================
export function setupProposalModalEvents() {
  const dialog = document.getElementById('proposal-dialog');
  const btnClose = document.getElementById('btn-close-proposal-dialog');
  const btnCloseFooter = document.getElementById('btn-close-proposal-footer');
  const btnPrint = document.getElementById('btn-print-proposal');
  const btnSendWA = document.getElementById('btn-send-proposal-wa');

  const closeDialog = () => {
    activeProposalCustomerId = null;
    if (dialog) dialog.close();
  };
  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDialog);

  window.handleOpenProposalModal = function(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    activeProposalCustomerId = customerId;

    // The proposal goes out in the name of the company using the CRM
    const org = getSavedOrganization();
    const issuer = org.legalName || org.name || 'Sua empresa';
    const user = getCurrentUser();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('prop-issuer-name', issuer);
    set('prop-issuer-details', org.cnpj ? `CNPJ ${org.cnpj}` : '');
    set('prop-number', `Proposta ${new Date().getFullYear()}-${(customer.id.replace(/\D/g, '').slice(-4) || '0001')}`);
    set('prop-date', new Date().toLocaleDateString('pt-BR'));
    set('prop-client-name', customer.name || '');
    set('prop-client-role', customer.role ? `, ${customer.role}` : '');
    set('prop-client-company', customer.company || '');
    set('prop-client-contact', [customer.email, customer.phone].filter(Boolean).join(', '));
    set('prop-scope-text', customer.notes || 'Nada escrito ainda. Edite a oportunidade e descreva em Anotações o que está sendo proposto: o texto aparece aqui. Este aviso não sai na impressão.');
    document.getElementById('prop-scope-text')?.classList.toggle('is-placeholder', !customer.notes);
    set('prop-price-display', formatBRL(customer.dealValue));
    set('prop-assigned-name', (customer.assignedTo?.name || user?.name || '').replace(/\s*\(.*\)$/, ''));
    set('prop-assigned-email', customer.assignedTo?.email || user?.email || '');
    set('prop-sign-client', customer.company || customer.name || 'Cliente');
    set('prop-sign-issuer', issuer);

    if (dialog) dialog.showModal();
  };

  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      window.print();
    });
  }

  if (btnSendWA) {
    btnSendWA.addEventListener('click', async () => {
      if (!activeProposalCustomerId) return;
      const customer = storage.getCustomer(activeProposalCustomerId);
      if (!customer || !customer.phone) {
        showToast("Este cliente não tem telefone cadastrado.", "error");
        return;
      }

      const orgName = getSavedOrganization().name || 'nossa empresa';
      const msg = `Olá, ${customer.name}. Preparamos a proposta da ${orgName}${customer.company ? ` para a ${customer.company}` : ''}, no valor de ${formatBRL(customer.dealValue)}. Vou enviar o documento em seguida. Qualquer dúvida, é só responder aqui.`;
      const link = buildWhatsAppLink(customer.phone, msg);
      if (link) {
        await storage.addActivity(customer.id, {
          type: 'whatsapp',
          title: 'Proposta avisada pelo WhatsApp',
          text: `Mensagem sobre a proposta de ${formatBRL(customer.dealValue)} enviada para ${customer.phone}.`
        });
        window.open(link, '_blank', 'noopener');
        showToast("WhatsApp aberto com a mensagem. Anexe o PDF da proposta na conversa.", "success");
      }
    });
  }
}
