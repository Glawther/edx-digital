/**
 * EDX Digital - UI Renderer & DOM Templates
 * Sober Executive White Theme with WhatsApp Templates, Deal Rotting, Tasks & Timeline
 */

import { countByPipeline } from '../core/pipelines.js';
import { formatBytes } from '../core/attachments.js';
import { weekDays, weekTitle, tasksByDay, googleCalendarUrl } from '../core/agenda.js';
import { goalProgress, recurringRevenue } from '../core/pipeline-rules.js';
import { STAGES, TASK_TYPES, LOSS_REASONS, getLossReasonLabel, getLossReasonId, crmStore } from '../core/crm-store.js';
import { REPORT_PERIODS, periodReport, sellerReportRows } from '../core/report.js';
import { todayPanel, daysLabel, CLOSING_WINDOW_DAYS } from '../core/today.js';
import { downloadCsv } from '../services/export-service.js';
import { localDateString } from '../services/reminder-service.js';
import { customFacts } from './customize-dialog.js';
import { escapeHtml, safeImageUrl } from '../core/html.js';
import { HISTORY_FILTERS, sortedHistory, countHistory, lastContact, daysAgoLabel, isManual } from '../core/history.js';
import { FOCUS_OPTIONS } from '../core/attention.js';
import { getSavedOrganization } from '../core/config.js';
import { getEmployees, maskCPF } from '../services/employee-service.js';
import { isDemoSession, isCloudSession, getCurrentUser, isAdmin } from '../services/auth-service.js';

export function formatBRL(amount) {
  const value = Number(amount) || 0;
  // Whole amounts stay short; an amount with cents keeps them (it used to be rounded away)
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0
  }).format(value);
}

export { escapeHtml };

/**
 * Updates Top KPI Summary Cards
 */
export function renderKPIs(metrics, permissions = {}) {
  const container = document.getElementById('kpi-container');
  if (!container) return;

  const isEmp = permissions.isEmployee;

  container.innerHTML = `
    <div class="kpi-card" style="--card-accent: var(--color-lead);">
      <div class="kpi-header">
        <span class="kpi-title">${isEmp ? 'Minha carteira em aberto' : 'Em aberto no funil'}</span>
        <div class="kpi-icon-wrap" style="color: var(--color-lead); background: var(--color-lead-bg); border-color: var(--color-lead-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
      </div>
      <div class="kpi-value">${formatBRL(metrics.pipelineTotal)}</div>
      <div class="kpi-subtext">
        ${metrics.activeDealsCount} ${metrics.activeDealsCount === 1 ? 'oportunidade ativa' : 'oportunidades ativas'}
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-won);">
      <div class="kpi-header">
        <span class="kpi-title">${isEmp ? 'Minhas vendas fechadas' : 'Vendas fechadas'}</span>
        <div class="kpi-icon-wrap" style="color: var(--color-won); background: var(--color-won-bg); border-color: var(--color-won-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
      </div>
      <div class="kpi-value">${formatBRL(metrics.wonTotal)}</div>
      <div class="kpi-subtext">
        ${metrics.wonCount} ${metrics.wonCount === 1 ? 'contrato' : 'contratos'}
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-contact);">
      <div class="kpi-header">
        <span class="kpi-title">Taxa de conversão</span>
        <div class="kpi-icon-wrap" style="color: var(--color-contact); background: var(--color-contact-bg); border-color: var(--color-contact-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div>
      </div>
      <div class="kpi-value">${metrics.wonCount + metrics.lostCount === 0 ? 'sem dados' : `${Math.round(Number(metrics.conversionRate))}%`}</div>
      <div class="kpi-subtext">
        ${metrics.wonCount} ganhas de ${metrics.wonCount + metrics.lostCount} decididas
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-negotiation);">
      <div class="kpi-header">
        <span class="kpi-title">Ticket médio</span>
        <div class="kpi-icon-wrap" style="color: var(--color-negotiation); background: var(--color-negotiation-bg); border-color: var(--color-negotiation-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
        </div>
      </div>
      <div class="kpi-value">${metrics.avgTicket === null ? 'sem vendas' : formatBRL(metrics.avgTicket)}</div>
      <div class="kpi-subtext">
        ${metrics.avgTicket === null ? 'Aparece depois da primeira venda' : 'Por venda fechada'}
      </div>
    </div>
  `;
}

const SHOW_LOST_KEY = 'edx_show_lost';

/**
 * Renders the funnel. The "lost" column stays folded until asked for, so the stages that
 * are still in play fit on a laptop screen without sideways scrolling.
 */
export function renderKanban(customers, metrics, permissions = {}, totalCount = customers.length) {
  const container = document.getElementById('pipeline-columns');
  if (!container) return;

  // A brand-new account sees what to do first instead of six empty columns
  const emptyState = document.getElementById('pipeline-empty');
  const bar = document.querySelector('#view-pipeline .pipeline-actions-bar');
  const isFirstRun = totalCount === 0;
  document.body.classList.toggle('is-first-run', isFirstRun);
  if (emptyState) emptyState.hidden = !isFirstRun;
  if (bar) bar.style.display = isFirstRun ? 'none' : '';
  container.style.display = isFirstRun ? 'none' : '';
  const teamButton = document.getElementById('first-run-team');
  if (teamButton) teamButton.style.display = permissions.isAdmin ? '' : 'none';
  if (isFirstRun) {
    container.innerHTML = '';
    return;
  }

  const showLost = localStorage.getItem(SHOW_LOST_KEY) === '1';

  container.innerHTML = STAGES.map(stage => {
    const stageCustomers = customers.filter(c => (c.stage || 'lead') === stage.id);
    const stageSum = metrics.stageSums[stage.id] || 0;
    const dropAttrs = `data-stage="${stage.id}" data-drop="${stage.id}"`;

    if (stage.id === 'lost' && !showLost) {
      return `
        <button type="button" class="pipeline-column is-folded" ${dropAttrs} data-click="handleToggleLostColumn"
                title="Mostrar as oportunidades perdidas" aria-label="Mostrar as ${stageCustomers.length} oportunidades perdidas">
          <span class="column-indicator" style="background-color: ${stage.color};"></span>
          <span class="folded-count">${stageCustomers.length}</span>
          <span class="folded-label">Perdidas</span>
        </button>
      `;
    }

    return `
      <div class="pipeline-column" ${dropAttrs}>
        <div class="column-header">
          <div class="column-title-wrap">
            <span class="column-indicator" style="background-color: ${stage.color};"></span>
            <h3 class="column-title">${escapeHtml(stage.name)}</h3>
            <span class="column-count">${stageCustomers.length}</span>
          </div>
          ${stage.id === 'lost'
            ? `<button type="button" class="link-btn" data-click="handleToggleLostColumn">Recolher</button>`
            : `<span class="column-amount">${formatBRL(stageSum)}</span>`}
        </div>

        <div class="cards-container">
          ${stageCustomers.length === 0
            ? `<div class="column-empty">Nada aqui</div>`
            : stageCustomers.map(customer => renderLeadCard(customer, permissions)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * The "Atenção" filter above the funnel, each option with how many opportunities it holds
 */
export function renderFocusPills(focus, counts = {}) {
  const container = document.getElementById('focus-filter-pills');
  if (!container) return;
  container.innerHTML = FOCUS_OPTIONS.map(option => {
    const count = option.id === 'all' ? '' : ` <span class="pill-count">${counts[option.id] || 0}</span>`;
    return `<button type="button" class="filter-pill ${focus === option.id ? 'active' : ''}" aria-pressed="${focus === option.id}"
              data-click="handleFocus" data-a="${option.id}">${option.label}${count}</button>`;
  }).join('');
}

export function toggleLostColumn() {
  const next = localStorage.getItem(SHOW_LOST_KEY) === '1' ? '0' : '1';
  localStorage.setItem(SHOW_LOST_KEY, next);
}

function daysWithoutUpdate(customer) {
  const updatedTime = new Date(customer.updatedAt || customer.createdAt || Date.now()).getTime();
  return Math.floor((Date.now() - updatedTime) / (1000 * 60 * 60 * 24));
}

/**
 * One card: what you need to recognise the deal, nothing to click by accident.
 * The card itself opens the opportunity, where every action lives.
 */
function renderLeadCard(customer, permissions = {}) {
  // only the three known values ever reach the class attribute
  const priorityClass = ['high', 'medium', 'low'].includes(customer.priority) ? customer.priority : 'medium';
  const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[priorityClass] || 'Média';
  const isClosed = customer.stage === 'won' || customer.stage === 'lost';
  const daysIdle = daysWithoutUpdate(customer);
  const isRotting = !isClosed && daysIdle >= 3;
  const pendingTasks = (customer.tasks || []).filter(t => !t.completed);
  const company = [customer.company, customer.role].filter(Boolean).map(escapeHtml).join(', ');

  const meta = [];
  if (customer.assignedTo) {
    const owner = customer.assignedTo.name || customer.assignedTo.email || '';
    if (owner) meta.push(`<span title="Responsável: ${escapeHtml(owner)}">${escapeHtml(owner.split(/[\s@]/)[0])}</span>`);
  }
  if (customer.expectedCloseDate && !isClosed) {
    const closeDate = new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    meta.push(`<span title="Previsão de fechamento">Fecha em ${closeDate}</span>`);
  }
  const today = localDateString();
  const lateTasks = pendingTasks.filter(t => t.dueDate && t.dueDate < today).length;
  if (lateTasks > 0) {
    meta.push(`<span class="is-warning">${lateTasks === 1 ? '1 tarefa atrasada' : `${lateTasks} tarefas atrasadas`}</span>`);
  } else if (pendingTasks.length > 0) {
    meta.push(`<span>${pendingTasks.length} tarefa${pendingTasks.length > 1 ? 's' : ''}</span>`);
  } else if (!isClosed) {
    // an open deal with nothing scheduled is the one that gets forgotten
    meta.push(`<span class="is-quiet" title="Nenhuma tarefa agendada para esta oportunidade">Sem próxima tarefa</span>`);
  }
  if (isRotting) {
    meta.push(`<span class="is-warning" title="Sem nenhuma atualização nesse período">Parado há ${daysIdle} dias</span>`);
  }


  return `
    <div class="lead-card ${isRotting ? 'is-rotting' : ''}"
         draggable="true" tabindex="0" role="button"
         aria-label="${escapeHtml(customer.name)}, ${formatBRL(customer.dealValue)}. Abrir a oportunidade."
         data-click="handleOpenLeadDetails" data-enter data-a="${escapeHtml(customer.id)}"
         data-drag="${escapeHtml(customer.id)}"
         data-id="${escapeHtml(customer.id)}">
      <div class="lead-card-header">
        <div class="lead-name">${escapeHtml(customer.name)}</div>
        ${priorityClass === 'medium' ? '' : `<span class="priority-badge ${priorityClass}" title="Prioridade ${priorityLabel.toLowerCase()}">${priorityLabel}</span>`}
      </div>

      ${company ? `<div class="lead-company">${company}</div>` : ''}

      <div class="lead-value">${formatBRL(customer.dealValue)}${customer.recurring ? '<span class="lead-recurring" title="Venda recorrente: o valor se repete todo mês"> por mês</span>' : ''}</div>

      ${meta.length > 0 ? `<div class="lead-meta">${meta.join('')}</div>` : ''}

      ${customer.stage === 'lost' && customer.lossReason ? `
        <div class="lead-loss">Motivo: ${escapeHtml(getLossReasonLabel(customer.lossReason))}</div>
      ` : ''}

      <div class="card-footer">
        <select class="move-stage-select" data-change="handleMoveStage" data-a="${escapeHtml(customer.id)}" data-value aria-label="Mover ${escapeHtml(customer.name)} para outra etapa">
          ${STAGES.map(s => `<option value="${s.id}" ${customer.stage === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
        ${customer.phone ? `
          <button type="button" class="card-icon-btn wa" data-click="handleOpenWhatsAppModal" data-a="${escapeHtml(customer.id)}" title="Mensagem pelo WhatsApp" aria-label="Mensagem pelo WhatsApp para ${escapeHtml(customer.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Renders the Customer Data Table View with Salesperson attribution
 */
const customersView = { stage: 'all', sort: 'recent' };

export function setCustomersView(change) {
  Object.assign(customersView, change);
}

const SORTERS = {
  recent: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  name: (a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'),
  value: (a, b) => (Number(b.dealValue) || 0) - (Number(a.dealValue) || 0),
  // the ones with a date first, soonest on top
  close: (a, b) => (a.expectedCloseDate || '9999').localeCompare(b.expectedCloseDate || '9999')
};

export function renderTable(allCustomers, permissions = {}) {
  const tbody = document.getElementById('customer-table-body');
  if (!tbody) return;

  const stageSelect = document.getElementById('customers-stage-filter');
  if (stageSelect) {
    const options = [['all', 'Todas'], ['open', 'Em aberto'], ...STAGES.map(st => [st.id, st.name])];
    stageSelect.innerHTML = options.map(([id, label]) => `<option value="${id}" ${customersView.stage === id ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }
  const sortSelect = document.getElementById('customers-sort');
  if (sortSelect) sortSelect.value = customersView.sort;

  const customers = allCustomers
    .filter(c => customersView.stage === 'all'
      || (customersView.stage === 'open' ? c.stage !== 'won' && c.stage !== 'lost' : c.stage === customersView.stage))
    .sort(SORTERS[customersView.sort] || SORTERS.recent);

  const countEl = document.getElementById('customers-count-label');
  if (countEl) {
    const total = customers.length === 1 ? '1 cliente' : `${customers.length} clientes`;
    countEl.textContent = customers.length === allCustomers.length ? total : `${total} de ${allCustomers.length}`;
  }

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          ${allCustomers.length === 0
            ? 'Nenhum cliente aqui ainda. Use "Nova oportunidade" para cadastrar o primeiro, ou limpe a busca.'
            : 'Nenhum cliente nesta etapa. Escolha outra em Etapa.'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(customer => {
    const stageObj = STAGES.find(s => s.id === customer.stage) || STAGES[0];
    const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[customer.priority] || 'Média';
    const closeDate = customer.expectedCloseDate
      ? new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      : '';

    return `
      <tr>
        <td>
          <button type="button" class="cell-title" data-click="handleOpenLeadDetails" data-a="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</button>
          <div class="cell-sub">${escapeHtml(customer.company || 'Sem empresa')}</div>
        </td>
        <td>
          <div>${escapeHtml(customer.email || 'Sem e-mail')}</div>
          <div class="cell-sub">
            ${escapeHtml(customer.phone || 'Sem telefone')}
            ${customer.phone ? `<button type="button" class="link-btn" data-click="handleOpenWhatsAppModal" data-a="${escapeHtml(customer.id)}">WhatsApp</button>` : ''}
          </div>
        </td>
        <td>${customer.assignedTo ? escapeHtml((customer.assignedTo.name || customer.assignedTo.email || '').replace(/\s*\(.*\)$/, '')) : '<span class="muted">Ninguém</span>'}</td>
        <td class="num">
          <div class="cell-value">${formatBRL(customer.dealValue)}</div>
          ${closeDate ? `<div class="cell-sub">fecha em ${closeDate}</div>` : ''}
        </td>
        <td>
          <span class="stage-text"><span class="stage-dot" style="background: ${stageObj.color}"></span>${escapeHtml(stageObj.name)}</span>
          <div class="cell-sub">Prioridade ${priorityLabel.toLowerCase()}</div>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="link-btn" data-click="handleOpenLeadDetails" data-a="${escapeHtml(customer.id)}">Histórico</button>
            <button type="button" class="link-btn" data-click="handleOpenProposalModal" data-a="${escapeHtml(customer.id)}">Proposta</button>
            <button type="button" class="link-btn" data-click="handleAnalyzeWithAI" data-a="${escapeHtml(customer.id)}" title="Análise da oportunidade com IA">Analisar</button>
            <button type="button" class="link-btn" data-click="handleOpenEditCustomer" data-a="${escapeHtml(customer.id)}">Editar</button>
            ${permissions && permissions.canDelete === false ? '' : `<button type="button" class="link-btn danger" data-click="handleDeleteCustomer" data-a="${escapeHtml(customer.id)}">Excluir</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders Tasks View
 */
export function renderTasksView(tasks, filter, customers) {
  const container = document.getElementById('tasks-list-container');
  const customerSelect = document.getElementById('task-input-customer');
  if (!container) return;

  // Populate customer select
  if (customerSelect) {
    customerSelect.innerHTML = customers.map(c => `
      <option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.company || 'Sem empresa')})</option>
    `).join('');
  }

  if (filter === 'week') {
    renderWeek(container, tasks);
    return;
  }

  // Filter tasks
  const todayStr = localDateString();
  const filtered = tasks.filter(t => {
    if (filter === 'completed') return t.completed;
    if (filter === 'pending') return !t.completed;
    if (filter === 'today') return !t.completed && (t.dueDate === todayStr);
    return true; // all
  });

  if (filtered.length === 0) {
    const emptyText = {
      pending: 'Nenhuma tarefa pendente.',
      today: 'Nada marcado para hoje.',
      completed: 'Nenhuma tarefa concluída ainda.',
      all: 'Nenhuma tarefa cadastrada. Use o formulário ao lado para agendar a primeira.'
    }[filter] || 'Nenhuma tarefa.';
    container.innerHTML = `<p class="empty-note" style="padding: 1.5rem 0;">${emptyText}</p>`;
    return;
  }

  container.innerHTML = filtered.map(task => {
    const isOverdue = !task.completed && task.dueDate && task.dueDate < todayStr;
    const isToday = !task.completed && task.dueDate === todayStr;
    const typeObj = TASK_TYPES.find(t => t.id === task.type) || TASK_TYPES[0];
    const dateText = task.dueDate ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'sem data';
    const timeText = task.dueTime ? ` às ${escapeHtml(task.dueTime)}` : '';

    return `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${escapeHtml(task.id)}" data-customer-id="${escapeHtml(task.customerId)}">
        <div class="task-left">
          <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} aria-label="Concluir: ${escapeHtml(task.title)}"
                 data-change="handleToggleTask" data-a="${escapeHtml(task.customerId)}" data-b="${escapeHtml(task.id)}">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-customer-link">
              ${typeObj.label} com
              <button type="button" class="link-btn" data-click="handleOpenLeadDetails" data-a="${escapeHtml(task.customerId)}">${escapeHtml(task.customerName)}</button>${task.customerCompany ? `, ${escapeHtml(task.customerCompany)}` : ''}
            </div>
          </div>
        </div>
        <span class="task-due-date ${isOverdue ? 'is-overdue' : ''}">
          ${isOverdue ? `Atrasada desde ${dateText}` : isToday ? `Hoje${timeText}` : `${dateText}${timeText}`}
          <button type="button" class="link-btn danger task-delete" data-click="handleDeleteTask" data-a="${escapeHtml(task.customerId)}" data-b="${escapeHtml(task.id)}" aria-label="Excluir a tarefa ${escapeHtml(task.title)}">Excluir</button>
        </span>
      </div>
    `;
  }).join('');
}

/**
 * The funnel selectors (in the funnel, in the list of customers, in the opportunity form).
 * A company with a single funnel never sees them.
 */
export function renderPipelineSwitch(pipelines, activeId, customers = []) {
  const many = pipelines.length > 1;
  document.querySelectorAll('.pipeline-switch').forEach(wrapper => { wrapper.hidden = !many; });
  if (!many) return;
  const counts = countByPipeline(customers, pipelines);
  document.querySelectorAll('select[data-pipeline-switch]').forEach(select => {
    select.innerHTML = pipelines.map(pipeline => `<option value="${escapeHtml(pipeline.id)}" ${pipeline.id === activeId ? 'selected' : ''}>${escapeHtml(pipeline.name)} (${counts[pipeline.id]})</option>`).join('');
  });
}

// Which week the agenda shows, counted from the current one
let weekOffset = 0;
export function moveWeek(step) {
  weekOffset = step === 0 ? 0 : weekOffset + step;
}

function renderWeek(container, tasks) {
  const days = weekDays(new Date(), weekOffset);
  const byDay = tasksByDay(tasks, days);
  const today = localDateString();
  const item = (task) => {
    const late = !task.completed && task.dueDate < today;
    const calendar = task.completed ? '' : googleCalendarUrl(task);
    return `
      <div class="week-task ${task.completed ? 'completed' : ''} ${late ? 'is-late' : ''}">
        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} aria-label="Concluir: ${escapeHtml(task.title)}"
               data-change="handleToggleTask" data-a="${escapeHtml(task.customerId)}" data-b="${escapeHtml(task.id)}">
        <div class="week-task-main">
          <span class="week-task-title">${task.dueTime ? `<span class="week-task-time">${escapeHtml(task.dueTime)}</span> ` : ''}${escapeHtml(task.title)}</span>
          <button type="button" class="link-btn" data-click="handleOpenLeadDetails" data-a="${escapeHtml(task.customerId)}">${escapeHtml(task.customerName)}</button>
          ${calendar ? `<a class="link-btn week-task-calendar" href="${escapeHtml(calendar)}" target="_blank" rel="noopener noreferrer">Pôr no Google Agenda</a>` : ''}
        </div>
      </div>`;
  };
  const pending = tasks.filter(task => !task.completed && task.dueDate).length;
  container.innerHTML = `
    <div class="week-head">
      <div class="week-nav">
        <button type="button" class="btn btn-outline btn-sm" data-click="handleWeek" data-a="-1" aria-label="Semana anterior">Anterior</button>
        <button type="button" class="btn btn-outline btn-sm" data-click="handleWeek" data-a="0" ${weekOffset === 0 ? 'disabled' : ''}>Esta semana</button>
        <button type="button" class="btn btn-outline btn-sm" data-click="handleWeek" data-a="1" aria-label="Semana seguinte">Seguinte</button>
      </div>
      <strong class="week-title">${weekTitle(days)}</strong>
      <button type="button" class="link-btn" data-click="handleExportAgenda" ${pending === 0 ? 'disabled' : ''} title="Arquivo que o Google Agenda, o Outlook e o calendário do celular importam">Baixar a agenda (.ics)</button>
    </div>
    <div class="week-grid">
      ${days.map(day => `
        <div class="week-day ${day.isToday ? 'is-today' : ''}">
          <div class="week-day-head">${day.weekday}<span>${day.label}</span></div>
          ${byDay[day.date].length === 0 ? '<p class="week-empty">Nada marcado</p>' : byDay[day.date].map(item).join('')}
        </div>`).join('')}
    </div>`;
}

const REPORT_PERIOD_KEY = 'edx_report_period';

function getReportPeriod() {
  const saved = localStorage.getItem(REPORT_PERIOD_KEY);
  return REPORT_PERIODS.some(period => period.id === saved) ? saved : 'month';
}

export function setReportPeriod(periodId) {
  if (REPORT_PERIODS.some(period => period.id === periodId)) localStorage.setItem(REPORT_PERIOD_KEY, periodId);
}

function barRow(label, figures, pct, kind = '') {
  return `
    <div class="bar-row">
      <div class="bar-row-head">
        <span>${label}</span>
        <span class="bar-row-figures">${figures}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${kind}" style="width: ${pct}%"></div></div>
    </div>
  `;
}

/**
 * Renders the reports view: what happened in the chosen period, then how the funnel stands now.
 * Every number comes from the opportunities the person can see; nothing is a target or an estimate.
 */
export function renderDetailedMetrics(metrics, customers = [], permissions = {}, everything = customers) {
  const container = document.getElementById('metrics-content');
  if (!container) return;

  const state = crmStore.getState();
  const funnel = state.pipelines.length > 1 ? state.pipelines.find(pipeline => pipeline.id === state.activePipelineId) : null;
  const funnelPicker = !funnel ? '' : `
    <label class="inline-field">Funil
      <select class="form-select form-select-sm" data-change="handlePipeline" data-value aria-label="Funil">
        ${state.pipelines.map(pipeline => `<option value="${escapeHtml(pipeline.id)}" ${pipeline.id === funnel.id ? 'selected' : ''}>${escapeHtml(pipeline.name)}</option>`).join('')}
      </select>
    </label>`;

  if (customers.length === 0) {
    container.innerHTML = `<section class="settings-section">${funnelPicker}<p class="empty-note" style="margin: ${funnel ? '0.75rem' : '0'} 0 0;">${funnel ? `Ainda não há oportunidades no funil ${escapeHtml(funnel.name)}.` : 'Ainda não há oportunidades para gerar relatórios. Cadastre a primeira em "Nova oportunidade".'}</p></section>`;
    return;
  }

  const periodId = getReportPeriod();
  const report = periodReport(customers, periodId, new Date(), reportMembers(permissions));
  const { totals } = report;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const periodPills = REPORT_PERIODS.map(period => `
    <button type="button" class="filter-pill ${period.id === periodId ? 'active' : ''}" aria-pressed="${period.id === periodId}"
            data-click="handleReportPeriod" data-a="${period.id}">${period.label}</button>
  `).join('');

  // Value per stage as it stands now, bars relative to the largest stage
  const stageRows = STAGES.filter(st => st.id !== 'lost' && st.id !== 'won');
  const maxStage = Math.max(1, ...stageRows.map(st => metrics.stageSums[st.id] || 0));
  const funnelHtml = stageRows.map(st => {
    const value = metrics.stageSums[st.id] || 0;
    const count = metrics.stageCounts[st.id] || 0;
    return barRow(escapeHtml(st.name), `${plural(count, 'oportunidade', 'oportunidades')}<strong>${formatBRL(value)}</strong>`, Math.round((value / maxStage) * 100));
  }).join('');

  // Why the ones lost in the period were lost
  const reasonCounts = {};
  report.lost.forEach(c => {
    const id = getLossReasonId(c.lossReason);
    const row = reasonCounts[id] || (reasonCounts[id] = { count: 0, value: 0 });
    row.count += 1;
    row.value += Number(c.dealValue) || 0;
  });
  const reasons = LOSS_REASONS.filter(r => reasonCounts[r.id]).map(r => ({ label: r.label, ...reasonCounts[r.id] })).sort((a, b) => b.count - a.count);
  const lossHtml = reasons.length === 0
    ? '<p class="empty-note">Nenhuma oportunidade perdida neste período.</p>'
    : reasons.map(r => barRow(escapeHtml(r.label), `${r.count} de ${totals.lostCount}<strong>${formatBRL(r.value)}</strong>`, Math.round((r.count / totals.lostCount) * 100), 'lost')).join('');

  const rate = (row) => row.conversionRate === null ? '<span class="is-quiet">sem dados</span>' : `${row.conversionRate}%`;
  const ticket = (row) => row.avgTicket === null ? '<span class="is-quiet">sem dados</span>' : formatBRL(row.avgTicket);
  const flag = (n) => n > 0 ? `<span class="is-warning">${n}</span>` : '0';
  const peopleHtml = permissions.isAdmin && report.people.length > 0 ? `
    <section class="settings-section" id="seller-report">
      <div class="settings-section-head">
        <div>
          <h2>Por vendedor</h2>
          <p>O que cada pessoa fez no período escolhido. Conversas são as ligações, mensagens, e-mails e reuniões registrados nas oportunidades.</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-click="handleExportSellerReport">Exportar</button>
      </div>
      <div class="table-scroll">
        <table class="plain-table">
          <thead><tr><th>Vendedor</th><th class="num">Vendas</th><th class="num">Valor vendido</th><th class="num">Ticket médio</th><th class="num">Conversão</th><th class="num">Perdidas</th><th class="num">Novas</th><th class="num">Conversas</th></tr></thead>
          <tbody>
            ${report.people.map(row => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td class="num">${row.wonCount}</td>
                <td class="num">${formatBRL(row.wonValue)}</td>
                <td class="num">${ticket(row)}</td>
                <td class="num">${rate(row)}</td>
                <td class="num">${row.lostCount}</td>
                <td class="num">${row.created}</td>
                <td class="num">${row.contacts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <h3 class="section-title" style="margin: 1.25rem 0 0;">Carteira de cada um, agora</h3>
      <div class="table-scroll">
        <table class="plain-table">
          <thead><tr><th>Vendedor</th><th class="num">Em aberto</th><th class="num">Valor em aberto</th><th class="num">Paradas há 3 dias ou mais</th><th class="num">Com tarefa atrasada</th></tr></thead>
          <tbody>
            ${report.people.map(row => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td class="num">${row.openCount}</td>
                <td class="num">${formatBRL(row.openValue)}</td>
                <td class="num">${flag(row.stalled)}</td>
                <td class="num">${flag(row.lateTasks)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  ` : '';

  // Each person's goal of the month: everyone to an administrator, their own to a salesperson
  const monthPeople = periodReport(everything, 'month', new Date(), reportMembers(permissions)).people;
  const myId = getCurrentUser()?.uid;
  const goalRows = goalProgress(monthPeople, getSavedOrganization().sellerGoals).filter(row => permissions.isAdmin || row.id === myId);
  const sellerGoalsHtml = goalRows.length === 0 ? '' : `
    <section class="settings-section" id="seller-goals">
      <div class="settings-section-head"><div><h2>${permissions.isAdmin ? 'Meta de cada vendedor' : 'Sua meta do mês'}</h2><p>Vendas fechadas neste mês diante da meta.</p></div></div>
      <div class="bar-list">${goalRows.map(row => barRow(escapeHtml(row.name), `${row.percent}%<strong>${formatBRL(row.sold)} de ${formatBRL(row.goal)}</strong>`, Math.min(100, row.percent), row.percent >= 100 ? 'won' : '')).join('')}</div>
    </section>`;

  const recurring = recurringRevenue(everything);
  const recurringHtml = recurring.contracts + recurring.openCount === 0 ? '' : `
      <div class="figure-box">
        <div class="figure-label">Receita recorrente por mês</div>
        <div class="figure-value">${formatBRL(recurring.monthly)}</div>
        <div class="figure-note">${recurring.contracts} ${recurring.contracts === 1 ? 'venda mensal fechada' : 'vendas mensais fechadas'}${recurring.openCount ? `. Em aberto: ${formatBRL(recurring.inNegotiation)} por mês.` : '.'}</div>
      </div>`;

  // The month's goal is the company's: shown to whoever administers
  const goal = Number(getSavedOrganization().monthlyGoal) || 0;
  const soldThisMonth = periodReport(everything, 'month').totals.wonValue;
  const goalPct = goal > 0 ? Math.round((soldThisMonth / goal) * 100) : 0;
  const goalHtml = permissions.isAdmin && goal > 0 ? `
    <section class="settings-section">
      <div class="settings-section-head"><div><h2>Meta do mês</h2><p>${goalPct >= 100 ? 'Meta batida.' : `Faltam ${formatBRL(goal - soldThisMonth)} para a meta.`}</p></div></div>
      <div class="bar-list">${barRow('Vendido neste mês', `${goalPct}%<strong>${formatBRL(soldThisMonth)} de ${formatBRL(goal)}</strong>`, Math.min(100, goalPct), goalPct >= 100 ? 'won' : '')}</div>
    </section>
  ` : '';

  container.innerHTML = `
    <div class="report-period">
      <h2 class="section-title">No período${funnel ? `, no funil ${escapeHtml(funnel.name)}` : ''}</h2>
      ${funnelPicker}
      <div class="filter-pills" role="group" aria-label="Período do relatório">${periodPills}</div>
    </div>

    <div class="figure-row">
      <div class="figure-box">
        <div class="figure-label">Vendas fechadas</div>
        <div class="figure-value">${formatBRL(totals.wonValue)}</div>
        <div class="figure-note">${plural(totals.wonCount, 'venda', 'vendas')}</div>
      </div>
      <div class="figure-box">
        <div class="figure-label">Novas oportunidades</div>
        <div class="figure-value">${totals.created}</div>
        <div class="figure-note">Cadastradas no período.</div>
      </div>
      <div class="figure-box">
        <div class="figure-label">Taxa de conversão</div>
        <div class="figure-value">${report.conversionRate === null ? 'sem dados' : `${report.conversionRate}%`}</div>
        <div class="figure-note">${report.conversionRate === null ? 'Nada foi ganho nem perdido no período.' : `${totals.wonCount} ganhas de ${totals.wonCount + totals.lostCount} decididas.`}</div>
      </div>
      <div class="figure-box">
        <div class="figure-label">Ticket médio</div>
        <div class="figure-value">${report.avgTicket === null ? 'sem dados' : formatBRL(report.avgTicket)}</div>
        <div class="figure-note">Por venda fechada no período.</div>
      </div>
      <div class="figure-box">
        <div class="figure-label">Conversas registradas</div>
        <div class="figure-value">${totals.contacts}</div>
        <div class="figure-note">Ligações, mensagens, e-mails e reuniões.</div>
      </div>
    </div>

    ${peopleHtml}

    <section class="settings-section">
      <div class="settings-section-head"><div><h2>Motivos de perda</h2><p>O que foi registrado nas oportunidades perdidas no período.</p></div></div>
      <div class="bar-list">${lossHtml}</div>
    </section>

    <div class="report-period">
      <h2 class="section-title">Agora</h2>
    </div>

    ${goalHtml}
    ${sellerGoalsHtml}

    <div class="figure-pair">
      <div class="figure-box">
        <div class="figure-label">Previsto para fechar este mês</div>
        <div class="figure-value">${formatBRL(metrics.currentMonthForecast)}</div>
        <div class="figure-note">Soma das oportunidades em aberto com data de fechamento neste mês.</div>
      </div>
      <div class="figure-box">
        <div class="figure-label">Paradas há 3 dias ou mais</div>
        <div class="figure-value">${metrics.rottingCount}</div>
        <div class="figure-note">Oportunidades em aberto sem nenhuma atualização nesse período.</div>
      </div>${recurringHtml}
    </div>

    <section class="settings-section">
      <div class="settings-section-head"><div><h2>Valor em aberto por etapa</h2><p>Quanto há em cada etapa do funil neste momento.</p></div></div>
      <div class="bar-list">${funnelHtml}</div>
    </section>
  `;
}

// In a real account everyone on the team gets a row, even with no opportunity yet.
// The demonstration's sample people do not share ids with its sample opportunities.
function reportMembers(permissions) {
  if (!permissions.isAdmin || !isCloudSession()) return [];
  const me = getCurrentUser();
  return [...(me ? [{ id: me.uid, name: me.name }] : []), ...getEmployees().filter(person => person.status !== 'blocked')];
}

export function exportSellerReport(customers) {
  const periodId = getReportPeriod();
  const report = periodReport(customers, periodId, new Date(), reportMembers({ isAdmin: isAdmin() }));
  if (report.people.length === 0) throw new Error('Não há dados para exportar.');
  downloadCsv(sellerReportRows(report), `edx-digital-vendedores-${periodId}.csv`);
}

/**
 * The "Hoje" screen: what needs the person now, in the order to work through it
 */
// Whose day an administrator is looking at on the "Hoje" screen ('' = everyone's)
let todayOwner = '';
export function setTodayOwner(ownerId) {
  todayOwner = typeof ownerId === 'string' ? ownerId : '';
}

const ownerKey = (customer) => (customer.assignedTo && (customer.assignedTo.id || customer.assignedTo.email)) || '';

export function renderToday(allCustomers = [], permissions = {}) {
  const container = document.getElementById('today-content');
  if (!container) return;

  // one line per person who has open opportunities, with what is urgent for them
  const people = new Map();
  if (permissions.isAdmin) {
    allCustomers.forEach(customer => {
      const key = ownerKey(customer);
      if (!key || customer.stage === 'won' || customer.stage === 'lost') return;
      if (!people.has(key)) people.set(key, { id: key, name: (customer.assignedTo.name || customer.assignedTo.email || '').replace(/\s*\(.*\)$/, ''), list: [] });
      people.get(key).list.push(customer);
    });
  }
  if (todayOwner && !people.has(todayOwner)) todayOwner = '';
  const customers = todayOwner ? people.get(todayOwner).list : allCustomers;
  const ownerPills = people.size < 2 ? '' : `
    <div class="filter-pills today-owners" role="group" aria-label="Ver o dia de quem">
      <button type="button" class="filter-pill ${todayOwner === '' ? 'active' : ''}" aria-pressed="${todayOwner === ''}" data-click="handleTodayOwner" data-a="">Todos</button>
      ${[...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(person => {
        const urgent = todayPanel(person.list).urgent;
        return `<button type="button" class="filter-pill ${todayOwner === person.id ? 'active' : ''}" aria-pressed="${todayOwner === person.id}" data-click="handleTodayOwner" data-a="${escapeHtml(person.id)}">${escapeHtml(person.name.split(/[\s@]/)[0])}${urgent ? ` <span class="pill-count">${urgent}</span>` : ''}</button>`;
      }).join('')}
    </div>`;

  const now = new Date();
  const dateText = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heading = `<div class="today-head"><p class="today-date">${dateText.charAt(0).toUpperCase()}${dateText.slice(1)}</p>${ownerPills}</div>`;

  if (allCustomers.length === 0) {
    container.innerHTML = `
      ${heading}
      <section class="settings-section">
        <div class="settings-section-head"><div><h2>Nada por aqui ainda</h2><p>Esta tela mostra o que fazer hoje: tarefas do dia, oportunidades paradas e as que estão perto de fechar. Ela se preenche assim que houver oportunidades.</p></div></div>
        <div class="today-empty-actions">
          <button type="button" class="btn btn-primary btn-sm" data-click="openNewOpportunity">Cadastrar a primeira oportunidade</button>
          ${permissions.isAdmin ? '<button type="button" class="btn btn-outline btn-sm" data-click="openImport">Importar de uma planilha</button>' : ''}
        </div>
      </section>`;
    return;
  }

  const panel = todayPanel(customers, now);
  const LIMIT = 6;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // an administrator sees everyone's work, so each line says whose it is
  const owner = (customer) => {
    if (!permissions.isAdmin || todayOwner || !customer.assignedTo) return '';
    const name = (customer.assignedTo.name || customer.assignedTo.email || '').replace(/\s*\(.*\)$/, '');
    return name ? `<span class="today-owner">${escapeHtml(name.split(/[\s@]/)[0])}</span>` : '';
  };
  const company = (customer) => customer.company ? `, ${escapeHtml(customer.company)}` : '';

  const taskRow = ({ customer, task, daysLate }) => `
    <div class="today-row">
      <input type="checkbox" class="task-checkbox" aria-label="Concluir: ${escapeHtml(task.title)}"
             data-change="handleToggleTask" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(task.id)}">
      <div class="today-main">
        <span class="today-title">${escapeHtml(task.title)}</span>
        <span class="today-sub"><button type="button" class="link-btn" data-click="handleOpenLeadDetails" data-a="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</button>${company(customer)}</span>
      </div>
      ${owner(customer)}
      <span class="today-when ${daysLate ? 'is-warning' : ''}">${daysLate ? `Atrasada ${daysLabel(-daysLate)}` : (task.dueTime ? `Hoje às ${escapeHtml(task.dueTime)}` : 'Hoje')}</span>
    </div>`;

  const dealRow = (customer, note, warn = false) => `
    <button type="button" class="today-row is-link" data-click="handleOpenLeadDetails" data-a="${escapeHtml(customer.id)}">
      <span class="today-main">
        <span class="today-title">${escapeHtml(customer.name)}${customer.company ? `<span class="today-company">${company(customer)}</span>` : ''}</span>
        <span class="today-sub ${warn ? 'is-warning' : ''}">${note}</span>
      </span>
      ${owner(customer)}
      <span class="today-when">${formatBRL(customer.dealValue)}</span>
    </button>`;

  const section = (id, title, hint, rows, total, more) => total === 0 ? '' : `
    <section class="settings-section today-section" id="today-${id}">
      <div class="settings-section-head"><div><h2>${title} <span class="today-count">${total}</span></h2><p>${hint}</p></div></div>
      <div class="today-list">${rows.join('')}</div>
      ${total > rows.length ? `<button type="button" class="link-btn today-more" data-click="${more.action}" data-a="${more.arg}">Ver ${more.label}</button>` : ''}
    </section>`;

  const tasks = [...panel.lateTasks, ...panel.todayTasks];
  const summary = [
    panel.lateTasks.length ? plural(panel.lateTasks.length, 'tarefa atrasada', 'tarefas atrasadas') : '',
    panel.todayTasks.length ? plural(panel.todayTasks.length, 'tarefa para hoje', 'tarefas para hoje') : '',
    panel.closing.length ? plural(panel.closing.length, 'oportunidade perto de fechar', 'oportunidades perto de fechar') : '',
    panel.stalled.length ? plural(panel.stalled.length, 'parada', 'paradas') : '',
    panel.noTask.length ? `${panel.noTask.length} sem próxima tarefa` : ''
  ].filter(Boolean).join(', ');

  if (panel.nothing) {
    container.innerHTML = `
      ${heading}
      <section class="settings-section">
        <div class="settings-section-head"><div><h2>Nada pendente</h2><p>${todayOwner ? 'Para esta pessoa: nenhuma' : 'Nenhuma'} tarefa para hoje nem atrasada, e todas as oportunidades em aberto têm próximo passo e foram atualizadas nos últimos dias.</p></div></div>
      </section>`;
    return;
  }

  const closeNote = ({ customer, inDays }) => inDays < 0
    ? `A previsão de fechamento passou ${daysLabel(inDays)}`
    : `Previsão de fechamento: ${daysLabel(inDays)}`;
  const stalledNote = ({ days, lastContact }) => `Sem atualização há ${days} dias${lastContact ? `. Último contato: ${escapeHtml(lastContact.title.toLowerCase())}` : '. Nenhuma conversa registrada'}`;

  container.innerHTML = `
    ${heading}
    <p class="today-summary">${summary}.</p>
    ${section('tasks', 'Tarefas', 'As atrasadas primeiro, depois as de hoje. Marque para concluir.', tasks.slice(0, LIMIT).map(taskRow), tasks.length, { action: 'openView', arg: 'tasks', label: `as ${tasks.length} em Tarefas` })}
    ${section('closing', 'Perto de fechar', `Oportunidades com fechamento previsto para os próximos ${CLOSING_WINDOW_DAYS} dias, ou com a data já vencida.`, panel.closing.slice(0, LIMIT).map(item => dealRow(item.customer, closeNote(item), item.inDays < 0)), panel.closing.length, { action: 'openView', arg: 'pipeline', label: `as ${panel.closing.length} no funil` })}
    ${section('stalled', 'Paradas', 'Em aberto e sem nenhuma atualização há 3 dias ou mais. As mais antigas primeiro.', panel.stalled.slice(0, LIMIT).map(item => dealRow(item.customer, stalledNote(item))), panel.stalled.length, { action: 'openFunnelFocus', arg: 'stalled', label: `as ${panel.stalled.length} no funil` })}
    ${section('notask', 'Sem próxima tarefa', 'Em aberto e sem nada agendado: são as que acabam esquecidas. Abra e agende o próximo passo.', panel.noTask.slice(0, LIMIT).map(customer => dealRow(customer, 'Nenhuma tarefa agendada')), panel.noTask.length, { action: 'openFunnelFocus', arg: 'noTask', label: `as ${panel.noTask.length} no funil` })}
  `;
}

// Which part of the history the opportunity window shows
let historyFilter = 'all';
export function setHistoryFilter(filter) {
  historyFilter = HISTORY_FILTERS.some(item => item.id === filter) ? filter : 'all';
}

/**
 * Renders the Customer Timeline in Modal
 */
export function renderLeadTimeline(customer) {
  const container = document.getElementById('lead-details-timeline');
  const nameEl = document.getElementById('lead-details-name');
  const metaEl = document.getElementById('lead-details-meta');
  if (!container || !customer) return;

  if (nameEl) nameEl.textContent = customer.name;
  if (metaEl) metaEl.textContent = [customer.company, customer.role].filter(Boolean).join(', ');

  const summaryEl = document.getElementById('lead-details-summary');
  if (summaryEl) {
    const closeDate = customer.expectedCloseDate
      ? new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
      : '';
    const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[customer.priority] || 'Média';
    const fact = (label, value) => value ? `<div class="fact"><dt>${label}</dt><dd>${value}</dd></div>` : '';
    summaryEl.innerHTML = `
      <dl class="fact-grid">
        ${fact('Valor', `<strong>${formatBRL(customer.dealValue)}</strong>${customer.recurring ? ' por mês' : ''}`)}
        <div class="fact">
          <dt><label for="lead-details-stage">Etapa</label></dt>
          <dd>
            <select id="lead-details-stage" class="form-select form-select-sm" data-change="handleMoveStage" data-a="${escapeHtml(customer.id)}" data-value>
              ${STAGES.map(s => `<option value="${s.id}" ${customer.stage === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </dd>
        </div>
        ${fact('Responsável', customer.assignedTo ? escapeHtml((customer.assignedTo.name || customer.assignedTo.email || '').replace(/\s*\(.*\)$/, '')) : '')}
        ${fact('Previsão de fechamento', closeDate)}
        ${fact('Prioridade', priorityLabel)}
        ${fact('E-mail', customer.email ? `<a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a>` : '')}
        ${fact('Telefone', customer.phone ? `<a href="tel:${escapeHtml(customer.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(customer.phone)}</a>` : '')}
        ${fact('Etiquetas', (customer.tags || []).map(escapeHtml).join(', '))}
        ${customFacts(customer).map(item => fact(escapeHtml(item.label), escapeHtml(item.value))).join('')}
      </dl>
      ${customer.stage === 'lost' && customer.lossReason ? `<p class="fact-note"><strong>Motivo da perda:</strong> ${escapeHtml(getLossReasonLabel(customer.lossReason))}${customer.lossDetails ? `. ${escapeHtml(customer.lossDetails)}` : ''}</p>` : ''}
      ${customer.notes ? `<p class="fact-note">${escapeHtml(customer.notes)}</p>` : ''}
    `;
  }

  const actionsEl = document.getElementById('lead-details-actions');
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-primary btn-sm" data-click="handleOpenEditCustomer" data-a="${escapeHtml(customer.id)}">Editar</button>
      ${customer.phone ? `<button type="button" class="btn btn-outline btn-sm" data-click="handleOpenWhatsAppModal" data-a="${escapeHtml(customer.id)}">WhatsApp</button>` : ''}
      <button type="button" class="btn btn-outline btn-sm" data-click="handleOpenProposalModal" data-a="${escapeHtml(customer.id)}">Proposta</button>
      <button type="button" class="btn btn-outline btn-sm" data-click="handleAnalyzeWithAI" data-a="${escapeHtml(customer.id)}">Analisar com IA</button>
      ${isAdmin() ? `<button type="button" class="btn btn-outline btn-sm btn-danger-outline push-right" data-click="handleDeleteCustomer" data-a="${escapeHtml(customer.id)}">Excluir</button>` : ''}
    `;
  }

  // Attached files exist only for a company's account (they are kept in the cloud)
  const attachBlock = document.getElementById('lead-attachments-block');
  const attachList = document.getElementById('lead-details-attachments');
  if (attachBlock && attachList) {
    attachBlock.hidden = !isCloudSession();
    const files = customer.attachments || [];
    attachList.innerHTML = files.length === 0
      ? '<p class="empty-note" style="margin: 0 0 0.75rem;">Nenhum arquivo. Guarde aqui a proposta assinada, o contrato ou o que o cliente enviou.</p>'
      : files.map(file => `
          <div class="lead-task attachment-row">
            <span class="attachment-kind">${escapeHtml(file.ext)}</span>
            <button type="button" class="link-btn attachment-name" data-click="handleOpenAttachment" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(file.id)}" title="Baixar">${escapeHtml(file.name)}</button>
            <span class="task-due-date">${formatBytes(file.size)}${file.by ? `, ${escapeHtml(file.by)}` : ''}</span>
            <button type="button" class="link-btn danger task-delete" data-click="handleDeleteAttachment" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(file.id)}" aria-label="Excluir o arquivo ${escapeHtml(file.name)}">Excluir</button>
          </div>`).join('');
  }

  const tasksEl = document.getElementById('lead-details-tasks');
  if (tasksEl) {
    const today = localDateString();
    const tasks = (customer.tasks || []).slice().sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || '').localeCompare(b.dueDate || ''));
    const pending = tasks.filter(task => !task.completed);
    const done = tasks.filter(task => task.completed).slice(-3);
    tasksEl.innerHTML = pending.length + done.length === 0
      ? '<p class="empty-note" style="margin: 0 0 0.75rem;">Nenhuma tarefa. Agende o próximo passo para esta oportunidade não ficar esquecida.</p>'
      : [...pending, ...done].map(task => {
          const late = !task.completed && task.dueDate && task.dueDate < today;
          const when = task.dueDate
            ? `${task.dueDate === today ? 'Hoje' : new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${task.dueTime ? ` às ${escapeHtml(task.dueTime)}` : ''}`
            : 'sem data';
          return `
            <div class="lead-task ${task.completed ? 'completed' : ''}">
              <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} aria-label="Concluir: ${escapeHtml(task.title)}"
                     data-change="handleToggleTask" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(task.id)}">
              <span class="lead-task-title">${escapeHtml(task.title)}</span>
              <span class="task-due-date ${late ? 'is-overdue' : ''}">${late ? `Atrasada desde ${when}` : when}</span>
              <button type="button" class="link-btn danger task-delete" data-click="handleDeleteTask" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(task.id)}" aria-label="Excluir a tarefa ${escapeHtml(task.title)}">Excluir</button>
            </div>
          `;
        }).join('');
  }

  const lastTalk = lastContact(customer);
  const lastEl = document.getElementById('lead-details-last-contact');
  if (lastEl) {
    lastEl.textContent = lastTalk
      ? `Último contato: ${lastTalk.title.toLowerCase()}, ${daysAgoLabel(lastTalk.timestamp)}.`
      : 'Nenhuma conversa registrada com este cliente ainda.';
  }

  const pillsEl = document.getElementById('history-filter-pills');
  if (pillsEl) {
    const counts = countHistory(customer);
    pillsEl.innerHTML = HISTORY_FILTERS.map(filter => `
      <button type="button" class="filter-pill ${historyFilter === filter.id ? 'active' : ''}" aria-pressed="${historyFilter === filter.id}"
              data-click="handleHistoryFilter" data-a="${filter.id}">${filter.label}${filter.id === 'all' ? '' : ` <span class="pill-count">${counts[filter.id]}</span>`}</button>
    `).join('');
  }

  const activities = sortedHistory(customer, historyFilter);

  if (activities.length === 0) {
    container.innerHTML = `<p class="empty-note">${historyFilter === 'all' ? 'Nada registrado ainda nesta oportunidade.' : 'Nada deste tipo no histórico.'}</p>`;
    return;
  }

  const canWrite = !document.body.classList.contains('is-read-only');
  container.innerHTML = activities.map(act => {
    const dateFormatted = new Date(act.timestamp).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const dotClass = ['note', 'task', 'stage_change', 'loss', 'whatsapp', 'call', 'meeting', 'email'].includes(act.type) ? act.type : 'note';

    return `
      <div class="timeline-item">
        <div class="timeline-dot ${dotClass}"></div>
        <div class="timeline-item-header">
          <span class="timeline-item-title">${escapeHtml(act.title || 'Interação')}</span>
          <span class="timeline-item-date">${dateFormatted}, ${escapeHtml(act.author || 'Você')}${canWrite && isManual(act) && isAdmin()
            ? ` <button type="button" class="link-btn danger" data-click="handleDeleteActivity" data-a="${escapeHtml(customer.id)}" data-b="${escapeHtml(act.id)}" aria-label="Excluir este registro">Excluir</button>` : ''}</span>
        </div>
        <div class="timeline-item-text">${escapeHtml(act.text || '')}</div>
      </div>
    `;
  }).join('');
}

/**
 * Updates User Authentication Status Badge
 */
/**
 * Updates User Authentication Status Badge with Role (Admin vs Employee) in Sidebar Footer
 */
export function renderAuthBadge(user) {
  const container = document.getElementById('auth-status-container');
  if (!container) return;

  const role = user?.role || 'admin';
  const roleLabel = role === 'admin' ? 'Administrador' : 'Vendedor';
  const roleClass = role === 'admin' ? 'admin' : 'employee';

  if (user) {
    container.innerHTML = `
      <div class="sidebar-user-card" id="sidebar-user-card">
        <div class="sidebar-user-avatar">
          ${safeImageUrl(user.photoURL) ? `<img src="${escapeHtml(safeImageUrl(user.photoURL))}" class="user-avatar-img" alt="${escapeHtml(user.name)}">` : `
            <div class="sidebar-user-avatar-placeholder">
              ${(user.name || 'U')[0].toUpperCase()}
            </div>
          `}
        </div>
        <div class="sidebar-user-details">
          <span class="sidebar-user-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
          <div class="sidebar-user-role-line">
            <span class="cid-role-badge ${roleClass}">
              ${roleLabel}
            </span>
          </div>
        </div>
        
        <div class="sidebar-user-actions">
          ${isDemoSession() ? `
          <button type="button" class="btn-sidebar-user-action" id="btn-toggle-role" title="Ver a demonstração com o outro perfil" aria-label="Ver a demonstração com o outro perfil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          </button>` : ''}

          <button type="button" class="btn-sidebar-user-action logout" id="btn-portal-logout" title="Sair" aria-label="Sair">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
    `;

    const btnToggle = document.getElementById('btn-toggle-role');
    if (btnToggle) btnToggle.addEventListener('click', window.handleToggleRole);

    const btnPortalLogout = document.getElementById('btn-portal-logout');
    if (btnPortalLogout) btnPortalLogout.addEventListener('click', window.handleLogoutToPortal);
  } else {
    container.innerHTML = '';
  }
}

/**
 * Updates Connection Pill in Header & Sidebar
 */
export function renderConnectionStatus(mode) {
  const pill = document.getElementById('connection-status-pill');
  if (!pill) return;

  if (mode === 'firestore') {
    pill.className = 'connection-pill online';
    pill.innerHTML = `
      <span class="pulse-dot"></span>
      <span>Sincronizado</span>
    `;
    pill.title = 'Os dados da empresa são salvos na nuvem e atualizados em tempo real';
  } else {
    pill.className = 'connection-pill local';
    pill.innerHTML = `
      <span class="pulse-dot"></span>
      <span>Dados de exemplo</span>
    `;
    pill.title = 'Demonstração: os dados são de exemplo e ficam só neste navegador';
  }
}

/**
 * Renders the "Segurança" view: the team and its access, who can do what, backup and recent activity.
 * Everything stated here is enforced by the database rules, not only by the screen.
 */
export function renderSecurityView(state) {
  const container = document.getElementById('security-content-container');
  if (!container) return;

  const isAdm = state.currentRole === 'admin';
  const demo = isDemoSession();
  const employees = getEmployees();
  const me = getCurrentUser();

  // how many opportunities in play each person holds
  const openBy = {};
  (state.allCustomers || []).forEach(c => {
    if (c.assignedTo && c.assignedTo.id && c.stage !== 'won' && c.stage !== 'lost') openBy[c.assignedTo.id] = (openBy[c.assignedTo.id] || 0) + 1;
  });

  const teamRows = employees.map(emp => {
    const initials = (emp.name || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const isBlocked = emp.status === 'blocked';
    const jobLine = [emp.jobTitle, emp.department].filter(Boolean).map(escapeHtml).join(', ');
    const open = openBy[emp.id] || 0;
    return `
      <tr>
        <td>
          <div class="employee-profile-cell">
            <div class="employee-avatar-circle">${escapeHtml(initials)}</div>
            <div>
              <div class="employee-name-title">${escapeHtml(emp.name)}</div>
              ${jobLine ? `<div class="employee-job-meta">${jobLine}</div>` : ''}
            </div>
          </div>
        </td>
        <td>${escapeHtml(emp.email)}</td>
        <td>
          ${emp.cpf ? `
            <span class="cpf-text" id="cpf-text-${escapeHtml(emp.id)}" data-masked="${escapeHtml(maskCPF(emp.cpf))}" data-raw="${escapeHtml(emp.cpf)}">${escapeHtml(maskCPF(emp.cpf))}</span>
            <button type="button" class="link-btn" data-click="handleToggleCPFVisibility" data-a="${escapeHtml(emp.id)}">mostrar</button>
          ` : '<span class="muted">não informado</span>'}
        </td>
        <td>${emp.role === 'admin' ? 'Administrador' : 'Vendedor'}</td>
        <td class="num">${open}${open > 0 ? ` <button type="button" class="link-btn" data-click="handleReassignLeads" data-a="${escapeHtml(emp.id)}">transferir</button>` : ''}</td>
        <td>
          ${isBlocked
            ? '<span class="status-text blocked">Bloqueado</span>'
            : emp.requirePasswordChange
              ? '<span class="status-text pending">Ainda não trocou a senha temporária</span>'
              : '<span class="status-text active">Ativo</span>'}
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="link-btn" data-click="handleEditEmployee" data-a="${escapeHtml(emp.id)}">Editar</button>
            ${demo ? '' : `<button type="button" class="link-btn" data-click="handleResetEmployeePassword" data-a="${escapeHtml(emp.id)}" title="Envia um e-mail para a pessoa criar uma nova senha">Nova senha</button>`}
            <button type="button" class="link-btn" data-click="handleToggleEmployeeStatus" data-a="${escapeHtml(emp.id)}">${isBlocked ? 'Liberar' : 'Bloquear'}</button>
            <button type="button" class="link-btn danger" data-click="handleDeleteEmployee" data-a="${escapeHtml(emp.id)}">Excluir</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const permissionRows = [
    ['Ver clientes e oportunidades', 'Todos da empresa', 'Só os atribuídos a si'],
    ['Cadastrar e editar oportunidades', 'Sim, e atribuir a qualquer pessoa', 'Sim, na própria carteira'],
    ['Excluir oportunidades', 'Sim', 'Não'],
    ['Ver faturamento e métricas da empresa', 'Sim', 'Só os próprios números'],
    ['Cadastrar, bloquear e excluir pessoas da equipe', 'Sim', 'Não'],
    ['Ver o histórico de atividade', 'Sim', 'Não'],
    ['Backup e restauração', 'Sim', 'Não']
  ].map(([what, admin, seller]) => `<tr><td>${what}</td><td>${admin}</td><td>${seller}</td></tr>`).join('');

  const teamContainer = document.getElementById('team-list-container');
  if (teamContainer) {
    teamContainer.innerHTML = !isAdm ? '' : `
      <section class="settings-section">
        <div class="settings-section-head">
          <div>
            <h2>Quem tem acesso</h2>
            <p>${employees.length === 0 ? 'Só você tem acesso por enquanto.' : `${employees.length + 1} pessoas com cadastro, contando você${me ? ` (${escapeHtml(me.email || '')})` : ''}. Você tem ${openBy[me?.uid] || 0} ${(openBy[me?.uid] || 0) === 1 ? 'oportunidade em aberto' : 'oportunidades em aberto'}.`}</p>
          </div>
        </div>
        ${employees.length === 0 ? `
          <p class="empty-note">Cadastre alguém acima, ou envie o código de convite para a pessoa criar a própria conta.</p>
        ` : `
          <div class="table-scroll">
            <table class="plain-table">
              <thead>
                <tr><th>Pessoa</th><th>E-mail de login</th><th>CPF</th><th>Perfil</th><th class="num">Em aberto</th><th>Situação</th><th></th></tr>
              </thead>
              <tbody>${teamRows}</tbody>
            </table>
          </div>
        `}
      </section>
    `;
  }

  container.innerHTML = `
    ${demo ? `
      <div class="notice-bar">
        <span>Você está na demonstração, como ${isAdm ? 'administrador' : 'vendedor'}. Os dados são de exemplo e ficam só neste navegador.</span>
        <button type="button" class="btn btn-outline btn-sm" data-click="handleToggleRole">
          Ver como ${isAdm ? 'vendedor' : 'administrador'}
        </button>
      </div>
    ` : ''}

    <section class="settings-section">
      <div class="settings-section-head">
        <div>
          <h2>O que cada perfil pode fazer</h2>
          <p>${isCloudSession() ? 'Estas regras são aplicadas no servidor: não dependem do que a tela mostra.' : 'Numa conta real, estas regras são aplicadas no servidor.'}</p>
        </div>
      </div>
      <div class="table-scroll">
        <table class="plain-table">
          <thead><tr><th></th><th>Administrador</th><th>Vendedor</th></tr></thead>
          <tbody>${permissionRows}</tbody>
        </table>
      </div>
    </section>

    ${isAdm ? `
      <section class="settings-section">
        <div class="settings-section-head">
          <div>
            <h2>Cópia de segurança</h2>
            <p>Baixa um arquivo com todos os clientes e oportunidades. Restaurar grava os registros do arquivo de volta na empresa.</p>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-outline btn-sm" data-click="handleDownloadBackup">Baixar cópia</button>
            <button type="button" class="btn btn-outline btn-sm" data-click="handleTriggerRestoreBackup">Restaurar de um arquivo</button>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-head">
          <div>
            <h2>Atividade desta sessão</h2>
            <p>O histórico completo, com filtros e exportação, fica em Auditoria.</p>
          </div>
        </div>
        ${state.auditLogs.length === 0 ? `
          <p class="empty-note">Nada registrado desde que você entrou.</p>
        ` : `
          <div class="table-scroll">
            <table class="plain-table">
              <thead><tr><th>Quando</th><th>O quê</th><th>Quem</th><th>Detalhes</th></tr></thead>
              <tbody>
                ${state.auditLogs.map(log => `
                  <tr>
                    <td class="nowrap muted">${new Date(log.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>${escapeHtml(log.action)}</td>
                    <td>${escapeHtml(log.userName)}</td>
                    <td class="muted">${escapeHtml(log.details)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>
    ` : ''}
  `;
}

/**
 * Global Toast Notifications
 */
export function showToast(message, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const iconSvg = type === 'success'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : type === 'error'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

  toast.innerHTML = `
    ${iconSvg}
    <span>${escapeHtml(message)}</span>
  `;

  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  };

  // An action (such as "Desfazer") keeps the notice on screen longer
  if (action && action.label && typeof action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
    toast.appendChild(button);
  }

  container.appendChild(toast);
  setTimeout(dismiss, action ? 8000 : 4000);
}
