/**
 * EDX Digital - One opportunity: its window (tasks, contacts, history) and the form that creates or edits it
 */

import { escapeHtml } from '../core/html.js';
import { pipelineIdOf } from '../core/pipelines.js';
import { getSavedOrganization } from '../core/config.js';
import { missingForStage, missingMessage } from '../core/pipeline-rules.js';
import { crmStore, STAGES } from '../core/crm-store.js';
import { buildContact, CONTACT_TYPES, toLocalInput } from '../core/history.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, AUDIT_SEVERITY, logAudit } from '../services/audit-service.js';
import { getCurrentUser, isAdmin, isCloudSession, isReadOnly } from '../services/auth-service.js';
import { currentPlan, describeLimit, leadsRoom } from '../services/billing-service.js';
import { findDuplicate } from '../services/import-service.js';
import { localDateString } from '../services/reminder-service.js';
import { collectCustomFieldValues, renderCustomFieldInputs } from '../ui/customize-dialog.js';
import { renderLeadTimeline, setHistoryFilter, showToast } from '../ui/ui-renderer.js';
import {
  fillAssigneeSelect,
  fillStageSelect,
  formatMoneyField,
  getAssignableMembers,
  parseSafeDealValue,
  reportError,
  sanitizeInput,
  snapshotOf,
  undoAction
} from './shared.js';

let activeLeadDetailsCustomerId = null;

// The funnels the opportunity can be in (the field only shows when the company has more than one)
function fillPipelineSelect(selectedId) {
  const select = document.getElementById('input-deal-pipeline');
  if (!select) return;
  select.innerHTML = crmStore.getState().pipelines.map(pipeline => `<option value="${escapeHtml(pipeline.id)}" ${pipeline.id === selectedId ? 'selected' : ''}>${escapeHtml(pipeline.name)}</option>`).join('');
}

// Keeps the opportunity window in step with the data while it is open
export function refreshOpenOpportunity(state) {
  if (!activeLeadDetailsCustomerId) return;
  const currentCustomer = state.allCustomers.find(c => c.id === activeLeadDetailsCustomerId);
  if (currentCustomer) {
    renderLeadTimeline(currentCustomer);
  } else {
    // The opportunity was deleted while its window was open
    activeLeadDetailsCustomerId = null;
    document.getElementById('lead-details-dialog')?.close();
  }
}

// ==========================================================================
// Lead Details & Activity Timeline Modal
// ==========================================================================
export function setupLeadDetailsEvents() {
  const dialog = document.getElementById('lead-details-dialog');
  const btnClose = document.getElementById('btn-close-lead-details');
  const btnCloseFooter = document.getElementById('btn-close-lead-details-footer');

  const closeDialog = () => {
    activeLeadDetailsCustomerId = null;
    dialog && dialog.close();
  };
  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDialog);

  window.handleOpenLeadDetails = function(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    // an opportunity of another funnel brings that funnel to the screen, so the stage names are its own
    const state = crmStore.getState();
    crmStore.setActivePipeline(pipelineIdOf(customer, state.pipelines));

    activeLeadDetailsCustomerId = customerId;
    resetContactForm();
    renderLeadTimeline(customer);
    const taskForm = document.getElementById('lead-task-form');
    if (taskForm) {
      taskForm.reset();
      document.getElementById('lead-task-date').value = localDateString();
    }
    if (!dialog.open) dialog.showModal();
  };

  document.getElementById('lead-task-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeLeadDetailsCustomerId) return;
    const title = sanitizeInput(document.getElementById('lead-task-title').value);
    const dueDate = document.getElementById('lead-task-date').value;
    const dueTime = document.getElementById('lead-task-time').value;
    if (!title || !dueDate) return;
    try {
      await storage.addTask(activeLeadDetailsCustomerId, { title, type: 'followup', dueDate, ...(dueTime ? { dueTime } : {}) });
      e.target.reset();
      document.getElementById('lead-task-date').value = localDateString();
      showToast('Tarefa agendada.', 'success');
    } catch (err) {
      reportError('Não foi possível agendar a tarefa', err);
    }
  });

  // Registering a contact: what was said, by which means and when
  const contactForm = document.getElementById('contact-log-form');
  const contactType = document.getElementById('contact-log-type');
  const contactWhen = document.getElementById('contact-log-when');
  const contactText = document.getElementById('contact-log-text');
  if (contactType) {
    contactType.innerHTML = CONTACT_TYPES.map(type => `<option value="${type.id}">${type.label}</option>`).join('');
  }

  function resetContactForm() {
    if (!contactForm) return;
    contactForm.reset();
    contactWhen.value = toLocalInput();
    contactWhen.max = toLocalInput();
    setHistoryFilter('all');
  }

  contactForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeLeadDetailsCustomerId) return;
    const result = buildContact({ type: contactType.value, when: contactWhen.value, text: sanitizeInput(contactText.value) });
    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }
    try {
      await storage.addActivity(activeLeadDetailsCustomerId, result.activity);
    } catch (err) {
      reportError('Não foi possível registrar', err);
      return;
    }
    const type = contactType.value;
    contactForm.reset();
    contactType.value = type;
    contactWhen.value = toLocalInput();
    showToast('Registrado no histórico.', 'success');
  });

  window.handleHistoryFilter = function(filter) {
    setHistoryFilter(filter);
    const customer = storage.getCustomer(activeLeadDetailsCustomerId);
    if (customer) renderLeadTimeline(customer);
  };

  window.handleDeleteActivity = async function(customerId, activityId) {
    if (!confirm('Excluir este registro do histórico?')) return;
    try {
      await storage.deleteActivity(customerId, activityId);
      showToast('Registro excluído.', 'success');
    } catch (err) {
      reportError('Não foi possível excluir', err);
    }
  };
}

// ==========================================================================
// Tasks Management (Activity-Based Selling)
// ==========================================================================
export function setupTasksEvents() {
  const taskForm = document.getElementById('new-task-form');
  const filterPills = document.querySelectorAll('#task-filter-pills .filter-pill');

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      crmStore.setTaskFilter(pill.dataset.taskFilter);
    });
  });

  if (taskForm) {
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('task-input-title').value.trim();
      const type = document.getElementById('task-input-type').value;
      const customerId = document.getElementById('task-input-customer').value;
      const dueDate = document.getElementById('task-input-date').value;

      if (!customerId) {
        showToast("Selecione um cliente para vincular a tarefa.", "error");
        return;
      }

      try {
        const dueTime = document.getElementById('task-input-time')?.value || '';
        await storage.addTask(customerId, { title, type, dueDate, ...(dueTime ? { dueTime } : {}) });
        taskForm.reset();
        document.getElementById('task-input-date').value = localDateString();
        showToast("Tarefa agendada.", "success");
      } catch (err) {
        reportError("Não foi possível agendar a tarefa", err);
      }
    });

    // Default task date to today
    const dateInput = document.getElementById('task-input-date');
    if (dateInput) dateInput.value = localDateString();
  }

  window.handleDeleteTask = async function(customerId, taskId) {
    const task = (storage.getCustomer(customerId)?.tasks || []).find(item => item.id === taskId);
    if (!task || !confirm(`Excluir a tarefa "${task.title}"?`)) return;
    try {
      await storage.deleteTask(customerId, taskId);
      showToast('Tarefa excluída.', 'info');
    } catch (err) {
      reportError('Não foi possível excluir a tarefa', err);
    }
  };

  window.handleToggleTask = async function(customerId, taskId) {
    try {
      await storage.toggleTask(customerId, taskId);
    } catch (err) {
      reportError("Não foi possível atualizar a tarefa", err);
    }
  };
}

// ==========================================================================
// Customer Dialog (Add / Edit)
// ==========================================================================
export function setupDialogEvents() {
  const customerDialog = document.getElementById('customer-dialog');
  const customerForm = document.getElementById('customer-form');
  const btnNewLead = document.getElementById('btn-new-lead');
  const btnBottomRightLead = document.getElementById('btn-bottom-right-lead');
  const btnCloseDialog = document.getElementById('btn-close-customer-dialog');
  const btnCancelDialog = document.getElementById('btn-cancel-customer-dialog');

  const openNewLead = () => {
    if (!customerDialog) return;
    if (isReadOnly()) {
      window.handleReadOnlyAttempt();
      return;
    }
    // Better to hear about the limit now than after filling in the form
    if (isCloudSession()) {
      const room = leadsRoom(storage.getCustomers());
      if (room.left <= 0) {
        reportError('', { code: 'plan-limit', message: `O plano ${currentPlan().name} comporta ${describeLimit(room.limit)} oportunidades em aberto, e esse limite foi atingido. Feche ou exclua oportunidades, ou mude de plano.` });
        return;
      }
    }
    document.getElementById('dialog-customer-id').value = '';
    document.getElementById('customer-dialog-title').textContent = 'Nova oportunidade';
    customerForm.reset();
    fillStageSelect();
    renderCustomFieldInputs({});
    document.getElementById('input-deal-stage').value = 'lead';
    fillPipelineSelect(crmStore.getState().activePipelineId);
    document.getElementById('input-deal-priority').value = 'medium';
    document.getElementById('input-deal-forecast').value = '';
    const assignedSelect = document.getElementById('input-customer-assigned');
    if (assignedSelect) {
      fillAssigneeSelect(assignedSelect, getCurrentUser()?.email);
    }
    const more = document.getElementById('customer-form-more');
    if (more) more.open = false;
    customerDialog.showModal();
    document.getElementById('input-customer-name').focus();
  };

  // The amount accepts only digits, dot and comma, and is tidied up when the field is left
  const valueInput = document.getElementById('input-deal-value');
  if (valueInput) {
    valueInput.addEventListener('input', () => {
      const cleaned = valueInput.value.replace(/[^\d.,]/g, '');
      if (cleaned !== valueInput.value) valueInput.value = cleaned;
    });
    valueInput.addEventListener('blur', () => {
      if (valueInput.value.trim() !== '') valueInput.value = formatMoneyField(parseSafeDealValue(valueInput.value));
    });
    valueInput.addEventListener('focus', () => valueInput.select());
  }

  // (11) 98888-7777 while typing; numbers that start with + are left as typed
  const phoneInput = document.getElementById('input-customer-phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      const raw = phoneInput.value;
      if (raw.trim().startsWith('+')) return;
      const d = raw.replace(/\D/g, '').slice(0, 11);
      if (d.length <= 2) phoneInput.value = d;
      else if (d.length <= 6) phoneInput.value = `(${d.slice(0, 2)}) ${d.slice(2)}`;
      else if (d.length <= 10) phoneInput.value = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      else phoneInput.value = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    });
  }

  if (btnNewLead) btnNewLead.addEventListener('click', openNewLead);
  if (btnBottomRightLead) btnBottomRightLead.addEventListener('click', openNewLead);

  const closeDialog = () => customerDialog && customerDialog.close();
  if (btnCloseDialog) btnCloseDialog.addEventListener('click', closeDialog);
  if (btnCancelDialog) btnCancelDialog.addEventListener('click', closeDialog);

  if (customerForm) {
    customerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('dialog-customer-id').value;
      const name = sanitizeInput(document.getElementById('input-customer-name').value);
      const company = sanitizeInput(document.getElementById('input-customer-company').value);
      const role = sanitizeInput(document.getElementById('input-customer-role').value);
      const email = sanitizeInput(document.getElementById('input-customer-email').value);
      const phone = sanitizeInput(document.getElementById('input-customer-phone').value);
      const dealValue = parseSafeDealValue(document.getElementById('input-deal-value').value);
      const stage = document.getElementById('input-deal-stage').value;
      const priority = document.getElementById('input-deal-priority').value;
      const expectedCloseDate = document.getElementById('input-deal-forecast').value;
      const rawTags = document.getElementById('input-customer-tags').value;
      const tags = rawTags.split(',').map(t => sanitizeInput(t)).filter(Boolean);
      const notes = sanitizeInput(document.getElementById('input-customer-notes').value);

      // Responsável pelo lead
      const assignedSelect = document.getElementById('input-customer-assigned');
      const members = getAssignableMembers();
      const assignedMember = members.find(m => m.email === (assignedSelect ? assignedSelect.value : '')) || members[0];

      const customerPayload = {
        name,
        company,
        role,
        email,
        phone,
        dealValue,
        stage,
        priority,
        expectedCloseDate,
        tags,
        notes,
        recurring: document.getElementById('input-deal-recurring')?.checked === true,
        pipelineId: document.getElementById('input-deal-pipeline')?.value || crmStore.getState().activePipelineId,
        custom: collectCustomFieldValues(),
        assignedTo: {
          id: assignedMember.id,
          name: assignedMember.name,
          email: assignedMember.email
        }
      };

      // entering a stage (a new opportunity, or one that changes stage here) asks for what the company set
      const previous = id ? storage.getCustomer(id) : null;
      if (!previous || previous.stage !== stage) {
        const missing = missingForStage({ ...(previous || {}), ...customerPayload }, stage, getSavedOrganization().stageRequirements);
        if (missing.length > 0) {
          showToast(missingMessage(STAGES.find(st => st.id === stage)?.name || stage, missing), 'warning');
          return;
        }
      }

      if (id) {
        customerPayload.id = id;
      } else {
        const twin = findDuplicate(storage.getCustomers(), { email, phone });
        if (twin && !confirm(`Já existe uma oportunidade com este ${twin.email && twin.email.toLowerCase() === email.toLowerCase() && email ? 'e-mail' : 'telefone'}: ${twin.name}${twin.company ? `, ${twin.company}` : ''}, na etapa ${STAGES.find(st => st.id === twin.stage)?.name || twin.stage}.\n\nCadastrar outra mesmo assim?`)) {
          return;
        }
      }

      try {
        await storage.saveCustomer(customerPayload);
        customerDialog.close();
        showToast(id ? "Oportunidade atualizada." : "Oportunidade criada.", "success");

        // Audit & Notification
        if (id) {
          logAudit(AUDIT_ACTIONS.LEAD_UPDATED, { customerId: id, name, company, dealValue, stage });
        } else {
          logAudit(AUDIT_ACTIONS.LEAD_CREATED, { name, company, dealValue, stage });
        }

        setTimeout(() => {
          window.scrollToKanbanStage(stage || 'lead');
        }, 150);
      } catch (err) {
        reportError("Não foi possível salvar", err);
      }
    });
  }
}

window.handleOpenEditCustomer = function(customerId) {
  if (isReadOnly()) {
    window.handleReadOnlyAttempt();
    return;
  }
  const customerDialog = document.getElementById('customer-dialog');
  const customer = storage.getCustomer(customerId);
  if (!customer || !customerDialog) return;

  fillStageSelect();
  renderCustomFieldInputs(customer.custom || {});
  document.getElementById('dialog-customer-id').value = customer.id;
  document.getElementById('customer-dialog-title').textContent = 'Editar oportunidade';
  document.getElementById('input-customer-name').value = customer.name || '';
  document.getElementById('input-customer-company').value = customer.company || '';
  document.getElementById('input-customer-role').value = customer.role || '';
  document.getElementById('input-customer-email').value = customer.email || '';
  document.getElementById('input-customer-phone').value = customer.phone || '';
  document.getElementById('input-deal-value').value = formatMoneyField(customer.dealValue);
  document.getElementById('input-deal-stage').value = customer.stage || 'lead';
  document.getElementById('input-deal-priority').value = customer.priority || 'medium';
  document.getElementById('input-deal-forecast').value = customer.expectedCloseDate ? customer.expectedCloseDate.split('T')[0] : '';
  document.getElementById('input-customer-tags').value = (customer.tags || []).join(', ');
  document.getElementById('input-customer-notes').value = customer.notes || '';
  const recurringBox = document.getElementById('input-deal-recurring');
  if (recurringBox) recurringBox.checked = customer.recurring === true;
  fillPipelineSelect(pipelineIdOf(customer, crmStore.getState().pipelines));

  const assignedSelect = document.getElementById('input-customer-assigned');
  if (assignedSelect) {
    fillAssigneeSelect(assignedSelect, customer.assignedTo?.email);
  }
  const more = document.getElementById('customer-form-more');
  if (more) more.open = true;

  customerDialog.showModal();
};

window.handleDeleteCustomer = async function(customerId) {
  if (!isAdmin()) {
    showToast("Só administradores podem excluir oportunidades.", "error");
    logAudit(AUDIT_ACTIONS.PERMISSION_DENIED, { action: 'delete_customer', customerId }, AUDIT_SEVERITY.WARNING);
    return;
  }

  const before = snapshotOf(customerId);
  if (!confirm(`Excluir ${before?.name || 'esta oportunidade'}? Você pode desfazer logo em seguida; depois disso, não.`)) return;
  try {
    const cust = storage.getCustomer(customerId);
    await storage.deleteCustomer(customerId);
    logAudit(AUDIT_ACTIONS.LEAD_DELETED, { customerId, name: cust?.name, company: cust?.company }, AUDIT_SEVERITY.WARNING);
    showToast(`${cust?.name || 'Oportunidade'} excluída.`, "info", undoAction(before, 'Oportunidade restaurada.'));
  } catch (err) {
    reportError("Não foi possível excluir", err);
  }
};
