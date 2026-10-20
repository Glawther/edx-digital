/**
 * EDX Digital - What is sent to the customer: WhatsApp messages, proposals, and the AI analysis
 */

import { cleanItems, itemsTotal, lineTotal, formatQuantity, MAX_ITEMS, MAX_ITEM_TEXT } from '../core/proposal-items.js';
import { messagesFor } from '../core/message-templates.js';
import { getStageName } from '../core/crm-store.js';
import { getSavedOrganization } from '../core/config.js';
import { storage } from '../core/storage-manager.js';
import { getCurrentUser, isReadOnly } from '../services/auth-service.js';
import { analyzeDeal, suggestMessages } from '../services/ai-service.js';
import { buildWhatsAppLink, recordWhatsAppContact } from '../services/whatsapp-service.js';
import { escapeHtml, formatBRL, showToast } from '../ui/ui-renderer.js';
import { reportError } from './shared.js';

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
      btnGenerateAi.textContent = 'Gerando sugestões…';

      try {
        renderTemplatesList(await suggestMessages(customer), customer);
        showToast('Sugestões prontas. Escolha uma e ajuste o texto.', 'success');
      } catch (err) {
        showToast(err.message, ['demo', 'daily_limit', 'plan_expired'].includes(err.code) ? 'info' : 'error');
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

      // Open WhatsApp Web first: it must open even when the history note cannot be written
      recordWhatsAppContact(customer);
      window.open(link, '_blank', 'noopener');
      closeDialog();
      if (isReadOnly()) {
        showToast('WhatsApp aberto. Com o CRM em modo de leitura, a mensagem não fica no histórico.', 'info');
        return;
      }
      try {
        await storage.addActivity(customer.id, {
          type: 'whatsapp',
          title: 'Mensagem pelo WhatsApp',
          text: message
        });
        showToast('WhatsApp aberto. A mensagem ficou registrada no histórico.', 'success');
      } catch (err) {
        showToast(`WhatsApp aberto. A mensagem não ficou no histórico: ${err.message}`, 'warning');
      }
    });
  }
}

// ==========================================================================
// AI analysis dialog
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
}

window.handleAnalyzeWithAI = async function(customerId) {
  const geminiDialog = document.getElementById('gemini-dialog');
  const customer = storage.getCustomer(customerId);
  if (!customer || !geminiDialog) return;

  const show = (id) => ['gemini-loading', 'gemini-results', 'gemini-unavailable'].forEach(part => {
    const el = document.getElementById(part);
    if (el) el.style.display = part === id ? 'block' : 'none';
  });
  // an empty list means the data did not support any item: said plainly, never left blank
  const fill = (id, items) => {
    document.getElementById(id).innerHTML = items.length > 0
      ? items.map(item => `<li>${escapeHtml(item)}</li>`).join('')
      : '<li class="empty-note">Os dados desta oportunidade não indicam nenhum. Registre mais detalhes no histórico para uma análise melhor.</li>';
  };
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  document.getElementById('gemini-dialog-customer-name').textContent = customer.name;
  document.getElementById('gemini-dialog-customer-meta').textContent = [customer.company, formatBRL(customer.dealValue)].filter(Boolean).join(', ');
  show('gemini-loading');
  geminiDialog.showModal();

  try {
    const analysis = await analyzeDeal(customer);
    const prob = Math.round(analysis.probability);
    const closed = analysis.mode === 'won' || analysis.mode === 'lost';
    const titles = {
      open: ['Chance de fechar, na avaliação da IA', 'Pontos a favor', 'Objeções prováveis e como responder', 'Próximo passo sugerido'],
      won: ['Venda fechada: pós-venda', 'O que ajudou a fechar', 'Riscos no pós-venda e como evitar', 'Próximo passo do pós-venda'],
      lost: ['Venda perdida: o que aprender', 'O que foi bem', 'Motivos prováveis da perda', 'Vale retomar o contato?']
    }[analysis.mode] || [];
    ['gemini-probability-title', 'gemini-keypoints-title', 'gemini-objections-title', 'gemini-action-title']
      .forEach((id, index) => titles[index] && setText(id, titles[index]));
    // a closed deal has no chance left to estimate
    ['gemini-probability-number', 'gemini-probability-wrapper'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = closed ? 'none' : '';
    });
    document.getElementById('gemini-probability-number').textContent = `${prob}%`;
    document.getElementById('gemini-probability-bar').style.width = `${prob}%`;
    document.getElementById('gemini-summary-text').textContent = analysis.summary;
    fill('gemini-keypoints-list', analysis.keyPoints);
    fill('gemini-objections-list', analysis.objections);
    document.getElementById('gemini-recommended-action').textContent = analysis.recommendedAction;
    document.getElementById('gemini-email-draft').textContent = analysis.proposalEmail;
    show('gemini-results');
  } catch (err) {
    // The AI did not answer: say so instead of showing an analysis nobody made
    document.getElementById('gemini-unavailable-text').textContent = err.message;
    show('gemini-unavailable');
  }
};

// ==========================================================================
// Proposal Modal Events (One-Click Proposal & PDF Print)
// ==========================================================================
// The items being edited in the proposal window, as typed
let editingItems = [];

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

  // The proposal shows its own text, never the opportunity's notes (those are internal)
  function showProposalText(customer) {
    const box = document.getElementById('prop-scope-text');
    if (!box) return;
    box.textContent = customer.proposalText || 'Nada escrito ainda. Abra "Texto da proposta", acima, e descreva o que está sendo proposto. Este aviso não sai na impressão.';
    box.classList.toggle('is-placeholder', !customer.proposalText);
  }

  document.getElementById('btn-save-proposal-text')?.addEventListener('click', async () => {
    const customer = storage.getCustomer(activeProposalCustomerId);
    if (!customer) return;
    const proposalText = String(document.getElementById('proposal-text-input')?.value || '').replace(/[<>]/g, '').trim().slice(0, 5000);
    try {
      const saved = await storage.saveCustomer({ id: customer.id, proposalText });
      showProposalText(saved);
      showToast('Texto da proposta salvo.', 'success');
    } catch (err) {
      reportError('Não foi possível salvar o texto', err);
    }
  });

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
    showProposalText(customer);
    const textEditor = document.getElementById('proposal-text-editor');
    if (textEditor) {
      textEditor.open = !customer.proposalText && !isReadOnly();
      textEditor.hidden = isReadOnly();
    }
    const textInput = document.getElementById('proposal-text-input');
    if (textInput) textInput.value = customer.proposalText || '';
    editingItems = cleanItems(customer.items).map(item => ({ ...item }));
    renderItemRows();
    renderProposalItems(customer);
    const editor = document.getElementById('proposal-items-editor');
    if (editor) {
      editor.open = false;
      editor.hidden = isReadOnly();
    }
    set('prop-assigned-name', (customer.assignedTo?.name || user?.name || '').replace(/\s*\(.*\)$/, ''));
    set('prop-assigned-email', customer.assignedTo?.email || user?.email || '');
    set('prop-sign-client', customer.company || customer.name || 'Cliente');
    set('prop-sign-issuer', issuer);

    if (dialog) dialog.showModal();
  };

  // ---- items: what is being sold, line by line
  const rowsBox = document.getElementById('proposal-items-rows');
  const money = (amount) => (amount ? amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  function renderItemRows() {
    if (!rowsBox) return;
    rowsBox.innerHTML = editingItems.length === 0
      ? '<p class="empty-note" style="margin: 0 0 0.6rem;">Nenhum item ainda.</p>'
      : editingItems.map((item, index) => `
        <div class="proposal-item-row">
          <input type="text" class="form-input" value="${escapeHtml(item.description)}" maxlength="${MAX_ITEM_TEXT}" placeholder="Descrição" data-index="${index}" data-part="description" aria-label="Descrição do item ${index + 1}">
          <input type="text" class="form-input" value="${escapeHtml(item.quantity ? formatQuantity(item.quantity) : '')}" inputmode="decimal" placeholder="Qtd." data-index="${index}" data-part="quantity" aria-label="Quantidade do item ${index + 1}">
          <input type="text" class="form-input" value="${escapeHtml(money(item.unitPrice))}" inputmode="decimal" placeholder="Preço" data-index="${index}" data-part="unitPrice" aria-label="Preço unitário do item ${index + 1}">
          <button type="button" class="link-btn danger" data-index="${index}" data-part="remove">Remover</button>
        </div>`).join('');
    const add = document.getElementById('btn-add-proposal-item');
    if (add) add.disabled = editingItems.length >= MAX_ITEMS;
  }

  // The printed sheet: a table when there are items, otherwise just the value
  function renderProposalItems(customer) {
    const items = cleanItems(customer.items);
    const block = document.getElementById('prop-items-block');
    if (block) block.hidden = items.length === 0;
    const body = document.getElementById('prop-items-body');
    if (body) {
      body.innerHTML = items.map(item => `
        <tr><td>${escapeHtml(item.description)}</td><td class="num">${formatQuantity(item.quantity)}</td><td class="num">${formatBRL(item.unitPrice)}</td><td class="num">${formatBRL(lineTotal(item))}</td></tr>`).join('');
    }
    const title = document.getElementById('prop-price-title');
    if (title) title.textContent = items.length > 0 ? 'Valor total' : 'Valor';
    const price = document.getElementById('prop-price-display');
    if (price) price.textContent = formatBRL(customer.dealValue) + (customer.recurring ? ' por mês' : '');
    // the items and the opportunity's value are two numbers: say so when they differ
    const total = itemsTotal(items);
    const note = document.getElementById('prop-items-mismatch');
    if (note) note.remove();
    if (items.length > 0 && Math.abs(total - (Number(customer.dealValue) || 0)) > 0.005 && block) {
      block.insertAdjacentHTML('beforeend', `<p class="empty-note is-placeholder" id="prop-items-mismatch">A soma dos itens é ${formatBRL(total)} e o valor da oportunidade é ${formatBRL(customer.dealValue)}. Este aviso não sai na impressão.</p>`);
    }
  }

  rowsBox?.addEventListener('input', (event) => {
    const { index, part } = event.target.dataset;
    if (part && part !== 'remove') editingItems[Number(index)][part] = event.target.value;
  });
  rowsBox?.addEventListener('click', (event) => {
    const { index, part } = event.target.dataset;
    if (part !== 'remove') return;
    editingItems.splice(Number(index), 1);
    renderItemRows();
  });
  document.getElementById('btn-add-proposal-item')?.addEventListener('click', () => {
    if (editingItems.length >= MAX_ITEMS) return;
    editingItems.push({ description: '', quantity: '', unitPrice: '' });
    renderItemRows();
    const inputs = rowsBox.querySelectorAll('input[data-part="description"]');
    inputs[inputs.length - 1]?.focus();
  });
  document.getElementById('btn-save-proposal-items')?.addEventListener('click', async () => {
    const customer = storage.getCustomer(activeProposalCustomerId);
    if (!customer) return;
    const items = cleanItems(editingItems);
    const typed = editingItems.filter(item => String(item.description || '').trim() || String(item.unitPrice || '').trim()).length;
    if (items.length < typed) {
      showToast('Todo item precisa de uma descrição.', 'error');
      return;
    }
    const useTotal = document.getElementById('proposal-items-set-value')?.checked && items.length > 0;
    try {
      const saved = await storage.saveCustomer({ id: customer.id, items, ...(useTotal ? { dealValue: itemsTotal(items) } : {}) });
      editingItems = cleanItems(saved.items).map(item => ({ ...item }));
      renderItemRows();
      renderProposalItems(saved);
      showToast(items.length === 0 ? 'Itens removidos.' : `Itens salvos. Total: ${formatBRL(itemsTotal(items))}.`, 'success');
    } catch (err) {
      showToast(`Não foi possível salvar os itens: ${err.message}`, 'error');
    }
  });

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
        // WhatsApp opens first, while the click still counts (pop-up blockers), and whatever
        // happens to the history note
        window.open(link, '_blank', 'noopener');
        const opened = 'WhatsApp aberto com a mensagem. Anexe o PDF da proposta na conversa.';
        if (isReadOnly()) {
          showToast(`${opened} Com o CRM em modo de leitura, o aviso não fica no histórico.`, 'info');
          return;
        }
        try {
          await storage.addActivity(customer.id, {
            type: 'whatsapp',
            title: 'Proposta avisada pelo WhatsApp',
            text: `Mensagem sobre a proposta de ${formatBRL(customer.dealValue)} enviada para ${customer.phone}.`
          });
          showToast(opened, 'success');
        } catch (err) {
          showToast(`${opened} O aviso não ficou no histórico: ${err.message}`, 'warning');
        }
      }
    });
  }
}
