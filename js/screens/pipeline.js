/**
 * EDX Digital - The funnel: filters, moving cards between stages, the reason for a loss
 */

import { crmStore, LOSS_REASONS, STAGES } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, AUDIT_SEVERITY, logAudit } from '../services/audit-service.js';
import {
  escapeHtml,
  formatBRL,
  setCustomersView,
  setReportPeriod,
  showToast,
  toggleLostColumn
} from '../ui/ui-renderer.js';
import { reportError, snapshotOf, undoAction } from './shared.js';

let draggedCustomerId = null;

// ==========================================================================
// Filters & Search
// ==========================================================================
export function setupFilterEvents() {
  // Search: filters the lists and, from any screen, offers the matching opportunities to open
  const searchInput = document.getElementById('global-search-input');
  const searchResults = document.getElementById('search-results');
  if (searchInput && searchResults) {
    let activeIndex = -1;

    const closeResults = () => {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      searchInput.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    };

    const findMatches = (query) => {
      const text = query.toLowerCase().trim();
      const digits = text.replace(/\D/g, '');
      return crmStore.getState().visibleCustomers.filter(c => {
        const haystack = `${c.name || ''} ${c.company || ''} ${c.email || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
        if (haystack.includes(text)) return true;
        return digits.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(digits);
      });
    };

    const renderResults = () => {
      const query = searchInput.value.trim();
      if (query.length < 2) { closeResults(); return; }
      const matches = findMatches(query).slice(0, 6);
      activeIndex = -1;
      searchResults.innerHTML = matches.length === 0
        ? `<div class="search-empty">Nada encontrado para "${escapeHtml(query)}".</div>`
        : matches.map((c, i) => {
            const stage = STAGES.find(s => s.id === c.stage) || STAGES[0];
            return `
              <button type="button" class="search-result" role="option" id="search-result-${i}" data-id="${escapeHtml(c.id)}">
                <span class="search-result-main">
                  <strong>${escapeHtml(c.name)}</strong>
                  <span>${escapeHtml(c.company || 'Sem empresa')}</span>
                </span>
                <span class="search-result-side">${escapeHtml(stage.name)}<br>${formatBRL(c.dealValue)}</span>
              </button>`;
          }).join('');
      searchResults.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    };

    const openResult = (button) => {
      if (!button) return;
      const id = button.dataset.id;
      closeResults();
      window.handleOpenLeadDetails(id);
    };

    searchInput.addEventListener('input', (e) => {
      crmStore.setSearchQuery(e.target.value);
      renderResults();
    });
    searchInput.addEventListener('focus', renderResults);

    searchInput.addEventListener('keydown', (e) => {
      const options = [...searchResults.querySelectorAll('.search-result')];
      if (e.key === 'Escape') {
        if (searchInput.value) {
          searchInput.value = '';
          crmStore.setSearchQuery('');
        }
        closeResults();
        return;
      }
      if (options.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options.forEach((o, i) => o.classList.toggle('is-active', i === activeIndex));
        searchInput.setAttribute('aria-activedescendant', options[activeIndex].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openResult(options[activeIndex >= 0 ? activeIndex : 0]);
      }
    });

    searchResults.addEventListener('mousedown', (e) => {
      // mousedown, so the choice lands before the field loses focus
      const button = e.target.closest('.search-result');
      if (button) {
        e.preventDefault();
        openResult(button);
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box-large')) closeResults();
    });
  }

  const filterPills = document.querySelectorAll('.filter-pill[data-priority]');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-pressed', 'true');
      crmStore.setPriorityFilter(pill.dataset.priority);
    });
  });
}

// ==========================================================================
// Drag & Drop Kanban Handlers
// ==========================================================================
window.handleDragStartCard = function(event, customerId) {
  draggedCustomerId = customerId;
  event.dataTransfer.setData('text/plain', customerId);
  event.target.closest('.lead-card')?.classList.add('dragging');
};

window.handleDropCard = async function(event, targetStage) {
  event.preventDefault();
  const customerId = draggedCustomerId || event.dataTransfer.getData('text/plain');
  if (!customerId) return;

  const cards = document.querySelectorAll('.lead-card');
  cards.forEach(c => c.classList.remove('dragging'));

  if (targetStage === 'lost') {
    window.handleTriggerLossReason(customerId);
    draggedCustomerId = null;
    return;
  }

  const before = snapshotOf(customerId);
  if (before && before.stage === targetStage) {
    draggedCustomerId = null;
    return;
  }

  try {
    await storage.updateStage(customerId, targetStage);
    const stageObj = STAGES.find(s => s.id === targetStage);
    const cust = storage.getCustomer(customerId);
    showToast(`${cust?.name || 'Oportunidade'} movida para ${stageObj ? stageObj.name : targetStage}.`, "success", undoAction(before, 'Mudança de etapa desfeita.'));

    // Audit & Notification
    if (targetStage === 'won') {
      logAudit(AUDIT_ACTIONS.LEAD_WON, { customerId, name: cust?.name, value: cust?.dealValue || 0 });
    } else {
      logAudit(AUDIT_ACTIONS.LEAD_STAGE_CHANGED, { customerId, name: cust?.name, newStage: targetStage });
    }

    setTimeout(() => window.scrollToKanbanStage(targetStage), 100);
  } catch (err) {
    reportError("Não foi possível mover", err);
  } finally {
    draggedCustomerId = null;
  }
};

window.handleMoveStage = async function(customerId, newStage) {
  const cust = storage.getCustomer(customerId);
  const currentStage = cust ? cust.stage : null;

  if (newStage === 'lost') {
    window.handleTriggerLossReason(customerId);
    return;
  }

  const before = snapshotOf(customerId);
  try {
    await storage.updateStage(customerId, newStage);
    const stageObj = STAGES.find(s => s.id === newStage);
    showToast(`${cust?.name || 'Oportunidade'} movida para ${stageObj ? stageObj.name : newStage}.`, "success", undoAction(before, 'Mudança de etapa desfeita.'));

    // Audit & Notification
    if (newStage === 'won') {
      logAudit(AUDIT_ACTIONS.LEAD_WON, { customerId, name: cust?.name, value: cust?.dealValue || 0 });
    } else {
      logAudit(AUDIT_ACTIONS.LEAD_STAGE_CHANGED, { customerId, name: cust?.name, newStage });
    }

    setTimeout(() => window.scrollToKanbanStage(newStage), 100);
  } catch (err) {
    // Revert select back to previous stage
    const select = document.querySelector(`.lead-card[data-id="${CSS.escape(customerId)}"] .move-stage-select`);
    if (select && currentStage) select.value = currentStage;
    reportError("Não foi possível mover", err);
  }
};

// ==========================================================================
// Kanban Stage Navigation & Viewport Helpers
// ==========================================================================
window.handleToggleLostColumn = function() {
  toggleLostColumn();
  crmStore.emitChange();
};

window.scrollToKanbanStage = function(stageId) {
  const container = document.getElementById('pipeline-columns');
  const targetCol = document.querySelector(`.pipeline-column[data-stage="${stageId}"]`);
  if (container && targetCol) {
    targetCol.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    targetCol.classList.add('column-focus-pulse');
    setTimeout(() => targetCol.classList.remove('column-focus-pulse'), 1200);
  }
};

window.scrollKanbanHorizontally = function(amount) {
  const container = document.getElementById('pipeline-columns');
  if (container) {
    container.scrollBy({ left: amount, behavior: 'smooth' });
  }
};

// ==========================================================================
// Loss Reason Modal (Motivo de Perda)
// ==========================================================================
export function setupLossReasonEvents() {
  const dialog = document.getElementById('loss-reason-dialog');
  const form = document.getElementById('loss-reason-form');
  const btnClose = document.getElementById('btn-close-loss-dialog');
  const btnCancel = document.getElementById('btn-cancel-loss-dialog');

  let activeLossCustomerId = null;

  const closeDialog = () => {
    if (dialog && dialog.open) dialog.close();
    // If user cancelled, restore the select dropdown on card back to original stage
    if (activeLossCustomerId) {
      const cust = storage.getCustomer(activeLossCustomerId);
      if (cust) {
        const select = document.querySelector(`.lead-card[data-id="${CSS.escape(activeLossCustomerId)}"] .move-stage-select`);
        if (select) select.value = cust.stage || 'negotiation';
      }
      activeLossCustomerId = null;
    }
  };

  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCancel) btnCancel.addEventListener('click', closeDialog);
  if (dialog) {
    dialog.addEventListener('cancel', closeDialog);
  }

  window.handleTriggerLossReason = function(customerId) {
    activeLossCustomerId = customerId;
    document.getElementById('loss-customer-id').value = customerId;
    document.getElementById('select-loss-reason').value = 'price';
    document.getElementById('input-loss-details').value = '';
    dialog.showModal();
  };

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customerId = document.getElementById('loss-customer-id').value;
      const reasonVal = document.getElementById('select-loss-reason').value;
      const details = document.getElementById('input-loss-details').value.trim();

      const reasonObj = LOSS_REASONS.find(r => r.id === reasonVal);
      const reasonLabel = reasonObj ? reasonObj.label : reasonVal;

      try {
        const cust = storage.getCustomer(customerId);
        const before = snapshotOf(customerId);
        // Store the reason id (the metrics group by id); the label is resolved when displaying
        await storage.setLossReason(customerId, reasonVal, details);
        logAudit(AUDIT_ACTIONS.LEAD_LOST, { customerId, name: cust?.name, reason: reasonLabel, details }, AUDIT_SEVERITY.INFO);
        activeLossCustomerId = null;
        dialog.close();
        showToast(`${cust?.name || 'Oportunidade'} marcada como perdida.`, "info", undoAction(before, 'A oportunidade voltou para a etapa anterior.'));
        setTimeout(() => window.scrollToKanbanStage('lost'), 100);
      } catch (err) {
        reportError("Não foi possível registrar a perda", err);
      }
    });
  }
}

window.handleFocus = function(focus) {
  crmStore.setFocus(focus);
};

window.handleCustomersView = function(change) {
  setCustomersView(change);
  crmStore.emitChange();
};

window.handleReportPeriod = function(periodId) {
  setReportPeriod(periodId);
  crmStore.emitChange();
};
