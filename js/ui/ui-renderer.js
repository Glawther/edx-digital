/**
 * Nexus CRM - UI Renderer & DOM Templates
 * Sober Executive White Theme with WhatsApp Templates, Deal Rotting, Tasks & Timeline
 */

import { STAGES, TASK_TYPES, getLossReasonLabel } from '../core/crm-store.js';
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

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const WA_TEMPLATES = [
  {
    id: 'intro',
    title: 'Apresentação Comercial',
    getText: (c) => `Olá ${c.name || ''}, tudo bem? Sou da equipe comercial do Nexus CRM. Recebi seu contato e gostaria de entender seus principais desafios comerciais hoje na ${c.company || 'sua empresa'}.`
  },
  {
    id: 'proposal',
    title: 'Envio de Proposta',
    getText: (c) => `Olá ${c.name || ''}! Preparamos a proposta comercial para a ${c.company || 'sua empresa'} com investimento previsto de ${formatBRL(c.dealValue)}. Gostaria de alinhar os detalhes com você. Tem 5 minutos hoje?`
  },
  {
    id: 'followup',
    title: 'Follow-up de Proposta',
    getText: (c) => `Olá ${c.name || ''}, tudo bem? Passando para checar se você conseguiu avaliar a proposta que enviamos para a ${c.company || 'sua empresa'}. Ficou com alguma dúvida que possamos esclarecer?`
  },
  {
    id: 'meeting',
    title: 'Agendamento de Reunião',
    getText: (c) => `Olá ${c.name || ''}, tudo bem? Gostaria de agendar uma breve conversa de 15 minutos esta semana para demonstrar como o Nexus CRM pode otimizar a operação da ${c.company || 'sua empresa'}. Qual melhor dia para você?`
  }
];

export function getWhatsAppLink(phone, message) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 8) return null;
  const fullNumber = digits.length <= 11 ? `55${digits}` : digits;
  const greeting = encodeURIComponent(message || 'Olá, gostaria de falar sobre nossa oportunidade no Nexus CRM.');
  return `https://wa.me/${fullNumber}?text=${greeting}`;
}

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
      <div class="kpi-value">${metrics.conversionRate}%</div>
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
      <div class="kpi-value">${formatBRL(metrics.avgTicket)}</div>
      <div class="kpi-subtext">
        ${metrics.wonCount > 0 ? 'Por venda fechada' : 'Estimado pelo funil em aberto'}
      </div>
    </div>
  `;
}

const SHOW_LOST_KEY = 'nexus_crm_show_lost';

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
    const dropAttrs = `data-stage="${stage.id}" ondragover="event.preventDefault(); this.classList.add('is-drop-target')" ondragleave="if (!this.contains(event.relatedTarget)) this.classList.remove('is-drop-target')" ondrop="this.classList.remove('is-drop-target'); window.handleDropCard(event, '${stage.id}')"`;

    if (stage.id === 'lost' && !showLost) {
      return `
        <button type="button" class="pipeline-column is-folded" ${dropAttrs} onclick="window.handleToggleLostColumn()"
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
            <h3 class="column-title">${stage.name}</h3>
            <span class="column-count">${stageCustomers.length}</span>
          </div>
          ${stage.id === 'lost'
            ? `<button type="button" class="link-btn" onclick="window.handleToggleLostColumn()">Recolher</button>`
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
  const priorityClass = customer.priority || 'medium';
  const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[priorityClass] || 'Média';
  const isClosed = customer.stage === 'won' || customer.stage === 'lost';
  const daysIdle = daysWithoutUpdate(customer);
  const isRotting = !isClosed && daysIdle >= 3;
  const pendingTasks = (customer.tasks || []).filter(t => !t.completed);
  const company = [customer.company, customer.role].filter(Boolean).map(escapeHtml).join(', ');

  const meta = [];
  if (customer.assignedTo) {
    meta.push(`<span title="Responsável: ${escapeHtml(customer.assignedTo.name)}">${escapeHtml(customer.assignedTo.name.split(' ')[0])}</span>`);
  }
  if (customer.expectedCloseDate && !isClosed) {
    const closeDate = new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    meta.push(`<span title="Previsão de fechamento">Fecha em ${closeDate}</span>`);
  }
  if (pendingTasks.length > 0) {
    meta.push(`<span>${pendingTasks.length} tarefa${pendingTasks.length > 1 ? 's' : ''}</span>`);
  }
  if (isRotting) {
    meta.push(`<span class="is-warning" title="Sem nenhuma atualização nesse período">Parado há ${daysIdle} dias</span>`);
  }

  const open = `window.handleOpenLeadDetails('${customer.id}')`;

  return `
    <div class="lead-card ${isRotting ? 'is-rotting' : ''}"
         draggable="true" tabindex="0" role="button"
         aria-label="${escapeHtml(customer.name)}, ${formatBRL(customer.dealValue)}. Abrir a oportunidade."
         ondragstart="window.handleDragStartCard(event, '${customer.id}')"
         onclick="if (!event.target.closest('select, button, a')) ${open}"
         onkeydown="if (event.key === 'Enter' && event.target === this) ${open}"
         data-id="${customer.id}">
      <div class="lead-card-header">
        <div class="lead-name">${escapeHtml(customer.name)}</div>
        ${priorityClass === 'medium' ? '' : `<span class="priority-badge ${priorityClass}" title="Prioridade ${priorityLabel.toLowerCase()}">${priorityLabel}</span>`}
      </div>

      ${company ? `<div class="lead-company">${company}</div>` : ''}

      <div class="lead-value">${formatBRL(customer.dealValue)}</div>

      ${meta.length > 0 ? `<div class="lead-meta">${meta.join('')}</div>` : ''}

      ${customer.stage === 'lost' && customer.lossReason ? `
        <div class="lead-loss">Motivo: ${escapeHtml(getLossReasonLabel(customer.lossReason))}</div>
      ` : ''}

      <div class="card-footer">
        <select class="move-stage-select" onchange="window.handleMoveStage('${customer.id}', this.value)" aria-label="Mover ${escapeHtml(customer.name)} para outra etapa">
          ${STAGES.map(s => `<option value="${s.id}" ${customer.stage === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        ${customer.phone ? `
          <button type="button" class="card-icon-btn wa" onclick="window.handleOpenWhatsAppModal('${customer.id}')" title="Mensagem pelo WhatsApp" aria-label="Mensagem pelo WhatsApp para ${escapeHtml(customer.name)}">
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
export function renderTable(customers, permissions = {}) {
  const tbody = document.getElementById('customer-table-body');
  if (!tbody) return;

  const countEl = document.getElementById('customers-count-label');
  if (countEl) {
    countEl.textContent = customers.length === 1 ? '1 cliente' : `${customers.length} clientes`;
  }

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          Nenhum cliente aqui ainda. Use "Nova oportunidade" para cadastrar o primeiro, ou limpe a busca.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(customer => {
    const stageObj = STAGES.find(s => s.id === customer.stage) || STAGES[0];
    const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[customer.priority] || 'Média';
    const closeDate = customer.expectedCloseDate
      ? new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : '';

    return `
      <tr>
        <td>
          <button type="button" class="cell-title" onclick="window.handleOpenLeadDetails('${customer.id}')">${escapeHtml(customer.name)}</button>
          <div class="cell-sub">${escapeHtml(customer.company || 'Sem empresa')}</div>
        </td>
        <td>
          <div>${escapeHtml(customer.email || 'Sem e-mail')}</div>
          <div class="cell-sub">
            ${escapeHtml(customer.phone || 'Sem telefone')}
            ${customer.phone ? `<button type="button" class="link-btn" onclick="window.handleOpenWhatsAppModal('${customer.id}')">WhatsApp</button>` : ''}
          </div>
        </td>
        <td>${customer.assignedTo ? escapeHtml(customer.assignedTo.name.replace(/\s*\(.*\)$/, '')) : '<span class="muted">Ninguém</span>'}</td>
        <td class="num">
          <div class="cell-value">${formatBRL(customer.dealValue)}</div>
          ${closeDate ? `<div class="cell-sub">fecha em ${closeDate}</div>` : ''}
        </td>
        <td>
          <span class="stage-text"><span class="stage-dot" style="background: ${stageObj.color}"></span>${stageObj.name}</span>
          <div class="cell-sub">Prioridade ${priorityLabel.toLowerCase()}</div>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="link-btn" onclick="window.handleOpenLeadDetails('${customer.id}')">Histórico</button>
            <button type="button" class="link-btn" onclick="window.handleOpenProposalModal('${customer.id}')">Proposta</button>
            <button type="button" class="link-btn" onclick="window.handleAnalyzeWithAI('${customer.id}')" title="Análise da oportunidade com IA">Analisar</button>
            <button type="button" class="link-btn" onclick="window.handleOpenEditCustomer('${customer.id}')">Editar</button>
            ${permissions && permissions.canDelete === false ? '' : `<button type="button" class="link-btn danger" onclick="window.handleDeleteCustomer('${customer.id}')">Excluir</button>`}
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
      <option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.company || 'Sem empresa')})</option>
    `).join('');
  }

  // Filter tasks
  const todayStr = new Date().toISOString().split('T')[0];
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

    return `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}" data-customer-id="${task.customerId}">
        <div class="task-left">
          <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} aria-label="Concluir: ${escapeHtml(task.title)}"
                 onchange="window.handleToggleTask('${task.customerId}', '${task.id}')">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-customer-link">
              ${typeObj.label} com
              <button type="button" class="link-btn" onclick="window.handleOpenLeadDetails('${task.customerId}')">${escapeHtml(task.customerName)}</button>${task.customerCompany ? `, ${escapeHtml(task.customerCompany)}` : ''}
            </div>
          </div>
        </div>
        <span class="task-due-date ${isOverdue ? 'is-overdue' : ''}">
          ${isOverdue ? `Atrasada desde ${dateText}` : isToday ? 'Hoje' : dateText}
        </span>
      </div>
    `;
  }).join('');
}

/**
 * Renders the reports view. Every number comes from the leads the person can see;
 * nothing here is a fixed target or an invented rate.
 */
export function renderDetailedMetrics(metrics, customers = [], permissions = {}) {
  const container = document.getElementById('metrics-content');
  if (!container) return;

  if (customers.length === 0) {
    container.innerHTML = `<section class="settings-section"><p class="empty-note" style="margin: 0;">Ainda não há oportunidades para gerar relatórios. Cadastre a primeira em "Nova oportunidade".</p></section>`;
    return;
  }

  // Value per stage, bars relative to the largest stage
  const stageRows = STAGES.filter(st => st.id !== 'lost');
  const maxStage = Math.max(1, ...stageRows.map(st => metrics.stageSums[st.id] || 0));
  const funnelHtml = stageRows.map(st => {
    const value = metrics.stageSums[st.id] || 0;
    const count = metrics.stageCounts[st.id] || 0;
    const pct = Math.round((value / maxStage) * 100);
    return `
      <div class="bar-row">
        <div class="bar-row-head">
          <span>${st.name}</span>
          <span class="bar-row-figures">${count} ${count === 1 ? 'oportunidade' : 'oportunidades'}<strong>${formatBRL(value)}</strong></span>
        </div>
        <div class="bar-track"><div class="bar-fill ${st.id === 'won' ? 'won' : ''}" style="width: ${pct}%"></div></div>
      </div>
    `;
  }).join('');

  // Loss reasons
  const reasons = Object.entries(metrics.lossReasonCounts || {})
    .map(([id, data]) => ({ id, ...data }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const totalLost = metrics.lostCount || 1;
  const lossHtml = reasons.length === 0
    ? '<p class="empty-note">Nenhuma oportunidade perdida.</p>'
    : reasons.map(r => {
        const pct = Math.round((r.count / totalLost) * 100);
        return `
          <div class="bar-row">
            <div class="bar-row-head">
              <span>${escapeHtml(r.label)}</span>
              <span class="bar-row-figures">${r.count} de ${metrics.lostCount}<strong>${formatBRL(r.totalValue)}</strong></span>
            </div>
            <div class="bar-track"><div class="bar-fill lost" style="width: ${pct}%"></div></div>
          </div>
        `;
      }).join('');

  // Per salesperson (only meaningful when the person sees more than their own leads)
  const byPerson = {};
  customers.forEach(c => {
    const key = c.assignedTo?.email || c.assignedTo?.id || 'none';
    const name = c.assignedTo?.name ? c.assignedTo.name.replace(/\s*\(.*\)$/, '') : 'Sem responsável';
    const row = byPerson[key] || (byPerson[key] = { name, openCount: 0, openValue: 0, wonCount: 0, wonValue: 0, lostCount: 0 });
    const value = Number(c.dealValue) || 0;
    if (c.stage === 'won') { row.wonCount += 1; row.wonValue += value; }
    else if (c.stage === 'lost') { row.lostCount += 1; }
    else { row.openCount += 1; row.openValue += value; }
  });
  const people = Object.values(byPerson).sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);
  const peopleHtml = permissions.isAdmin && people.length > 0 ? `
    <section class="settings-section">
      <div class="settings-section-head">
        <div>
          <h2>Por vendedor</h2>
          <p>Oportunidades atribuídas a cada pessoa.</p>
        </div>
      </div>
      <div class="table-scroll">
        <table class="plain-table">
          <thead><tr><th>Vendedor</th><th class="num">Em aberto</th><th class="num">Valor em aberto</th><th class="num">Ganhas</th><th class="num">Valor ganho</th><th class="num">Perdidas</th></tr></thead>
          <tbody>
            ${people.map(row => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td class="num">${row.openCount}</td>
                <td class="num">${formatBRL(row.openValue)}</td>
                <td class="num">${row.wonCount}</td>
                <td class="num">${formatBRL(row.wonValue)}</td>
                <td class="num">${row.lostCount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  ` : '';

  container.innerHTML = `
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
      </div>
    </div>

    <div class="report-columns">
      <section class="settings-section">
        <div class="settings-section-head"><div><h2>Valor por etapa do funil</h2><p>Quanto há em cada etapa agora.</p></div></div>
        <div class="bar-list">${funnelHtml}</div>
      </section>
      <section class="settings-section">
        <div class="settings-section-head"><div><h2>Motivos de perda</h2><p>O que foi registrado ao marcar uma oportunidade como perdida.</p></div></div>
        <div class="bar-list">${lossHtml}</div>
      </section>
    </div>

    ${peopleHtml}
  `;
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
        ${fact('Valor', `<strong>${formatBRL(customer.dealValue)}</strong>`)}
        <div class="fact">
          <dt><label for="lead-details-stage">Etapa</label></dt>
          <dd>
            <select id="lead-details-stage" class="form-select form-select-sm" onchange="window.handleMoveStage('${customer.id}', this.value)">
              ${STAGES.map(s => `<option value="${s.id}" ${customer.stage === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </dd>
        </div>
        ${fact('Responsável', customer.assignedTo ? escapeHtml(customer.assignedTo.name.replace(/\s*\(.*\)$/, '')) : '')}
        ${fact('Previsão de fechamento', closeDate)}
        ${fact('Prioridade', priorityLabel)}
        ${fact('E-mail', customer.email ? `<a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a>` : '')}
        ${fact('Telefone', customer.phone ? `<a href="tel:${escapeHtml(customer.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(customer.phone)}</a>` : '')}
        ${fact('Etiquetas', (customer.tags || []).map(escapeHtml).join(', '))}
      </dl>
      ${customer.stage === 'lost' && customer.lossReason ? `<p class="fact-note"><strong>Motivo da perda:</strong> ${escapeHtml(getLossReasonLabel(customer.lossReason))}${customer.lossDetails ? `. ${escapeHtml(customer.lossDetails)}` : ''}</p>` : ''}
      ${customer.notes ? `<p class="fact-note">${escapeHtml(customer.notes)}</p>` : ''}
    `;
  }

  const actionsEl = document.getElementById('lead-details-actions');
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-primary btn-sm" onclick="window.handleOpenEditCustomer('${customer.id}')">Editar</button>
      ${customer.phone ? `<button type="button" class="btn btn-outline btn-sm" onclick="window.handleOpenWhatsAppModal('${customer.id}')">WhatsApp</button>` : ''}
      <button type="button" class="btn btn-outline btn-sm" onclick="window.handleOpenProposalModal('${customer.id}')">Proposta</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="window.handleAnalyzeWithAI('${customer.id}')">Analisar com IA</button>
      ${isAdmin() ? `<button type="button" class="btn btn-outline btn-sm btn-danger-outline push-right" onclick="window.handleDeleteCustomer('${customer.id}')">Excluir</button>` : ''}
    `;
  }

  const activities = (customer.activities || []).slice().reverse();

  if (activities.length === 0) {
    container.innerHTML = `
      <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        Nenhuma atividade registrada ainda nesta oportunidade.
      </div>
    `;
    return;
  }

  container.innerHTML = activities.map(act => {
    const dateFormatted = new Date(act.timestamp).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const dotClass = act.type || 'note';

    return `
      <div class="timeline-item">
        <div class="timeline-dot ${dotClass}"></div>
        <div class="timeline-item-header">
          <span class="timeline-item-title">${escapeHtml(act.title || 'Interação')}</span>
          <span class="timeline-item-date">${dateFormatted}, ${escapeHtml(act.author || 'Você')}</span>
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
          ${user.photoURL ? `<img src="${user.photoURL}" class="user-avatar-img" alt="${escapeHtml(user.name)}">` : `
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

  const teamRows = employees.map(emp => {
    const initials = (emp.name || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const isBlocked = emp.status === 'blocked';
    const jobLine = [emp.jobTitle, emp.department].filter(Boolean).map(escapeHtml).join(', ');
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
            <span class="cpf-text" id="cpf-text-${emp.id}" data-masked="${escapeHtml(maskCPF(emp.cpf))}" data-raw="${escapeHtml(emp.cpf)}">${escapeHtml(maskCPF(emp.cpf))}</span>
            <button type="button" class="link-btn" onclick="window.handleToggleCPFVisibility('${emp.id}')">mostrar</button>
          ` : '<span class="muted">não informado</span>'}
        </td>
        <td>${emp.role === 'admin' ? 'Administrador' : 'Vendedor'}</td>
        <td>
          ${isBlocked
            ? '<span class="status-text blocked">Bloqueado</span>'
            : emp.requirePasswordChange
              ? '<span class="status-text pending">Ainda não trocou a senha temporária</span>'
              : '<span class="status-text active">Ativo</span>'}
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="link-btn" onclick="window.handleEditEmployee('${emp.id}')">Editar</button>
            ${demo ? '' : `<button type="button" class="link-btn" onclick="window.handleResetEmployeePassword('${emp.id}')" title="Envia um e-mail para a pessoa criar uma nova senha">Nova senha</button>`}
            <button type="button" class="link-btn" onclick="window.handleToggleEmployeeStatus('${emp.id}')">${isBlocked ? 'Liberar' : 'Bloquear'}</button>
            <button type="button" class="link-btn danger" onclick="window.handleDeleteEmployee('${emp.id}')">Excluir</button>
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

  container.innerHTML = `
    ${demo ? `
      <div class="notice-bar">
        <span>Você está na demonstração, como ${isAdm ? 'administrador' : 'vendedor'}. Os dados são de exemplo e ficam só neste navegador.</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.handleToggleRole()">
          Ver como ${isAdm ? 'vendedor' : 'administrador'}
        </button>
      </div>
    ` : ''}

    ${isAdm ? `
      <section class="settings-section">
        <div class="settings-section-head">
          <div>
            <h2>Equipe</h2>
            <p>${employees.length === 0 ? 'Só você tem acesso por enquanto.' : `${employees.length + 1} pessoas com cadastro, contando você${me ? ` (${escapeHtml(me.email || '')})` : ''}.`}</p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-open-employee-modal">Cadastrar colaborador</button>
        </div>
        ${employees.length === 0 ? `
          <p class="empty-note">Cadastre alguém aqui, ou envie o código de convite que está em Equipe para a pessoa criar a própria conta.</p>
        ` : `
          <div class="table-scroll">
            <table class="plain-table">
              <thead>
                <tr><th>Pessoa</th><th>E-mail de login</th><th>CPF</th><th>Perfil</th><th>Situação</th><th></th></tr>
              </thead>
              <tbody>${teamRows}</tbody>
            </table>
          </div>
        `}
      </section>
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
            <button type="button" class="btn btn-outline btn-sm" onclick="window.handleDownloadBackup()">Baixar cópia</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="window.handleTriggerRestoreBackup()">Restaurar de um arquivo</button>
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
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconSvg = type === 'success' 
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : type === 'error'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

  toast.innerHTML = `
    ${iconSvg}
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
