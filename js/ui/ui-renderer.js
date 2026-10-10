/**
 * Nexus CRM - UI Renderer & DOM Templates
 * Sober Executive White Theme with WhatsApp Templates, Deal Rotting, Tasks & Timeline
 */

import { STAGES, PRIORITIES, LOSS_REASONS, TASK_TYPES, getLossReasonLabel } from '../core/crm-store.js';
import { getEmployees, maskCPF } from '../services/employee-service.js';

export function formatBRL(amount) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  }).format(amount || 0);
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
    title: '👋 Apresentação Comercial',
    getText: (c) => `Olá ${c.name || ''}, tudo bem? Sou da equipe comercial do Nexus CRM. Recebi seu contato e gostaria de entender seus principais desafios comerciais hoje na ${c.company || 'sua empresa'}.`
  },
  {
    id: 'proposal',
    title: '📄 Envio de Proposta',
    getText: (c) => `Olá ${c.name || ''}! Preparamos a proposta comercial para a ${c.company || 'sua empresa'} com investimento previsto de ${formatBRL(c.dealValue)}. Gostaria de alinhar os detalhes com você. Tem 5 minutos hoje?`
  },
  {
    id: 'followup',
    title: '🔔 Follow-up de Proposta',
    getText: (c) => `Olá ${c.name || ''}, tudo bem? Passando para checar se você conseguiu avaliar a proposta que enviamos para a ${c.company || 'sua empresa'}. Ficou com alguma dúvida que possamos esclarecer?`
  },
  {
    id: 'meeting',
    title: '📅 Agendamento de Reunião',
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
        <span class="kpi-title">${isEmp ? 'Minha Carteira (Pipeline)' : 'Pipeline Geral em Aberto'}</span>
        <div class="kpi-icon-wrap" style="color: var(--color-lead); background: var(--color-lead-bg); border-color: var(--color-lead-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
      </div>
      <div class="kpi-value">${formatBRL(metrics.pipelineTotal)}</div>
      <div class="kpi-subtext">
        <span class="kpi-badge positive">${metrics.activeDealsCount} oportunidades</span> ${isEmp ? 'sob sua gestão' : 'ativas na empresa'}
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-won);">
      <div class="kpi-header">
        <span class="kpi-title">${isEmp ? 'Minhas Vendas Ganhas' : 'Negócios Fechados (Total)'}</span>
        <div class="kpi-icon-wrap" style="color: var(--color-won); background: var(--color-won-bg); border-color: var(--color-won-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
      </div>
      <div class="kpi-value" style="color: var(--color-won);">${formatBRL(metrics.wonTotal)}</div>
      <div class="kpi-subtext">
        <span class="kpi-badge positive">${metrics.wonCount} contratos</span> ${isEmp ? 'fechados por você' : 'assinados no total'}
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-contact);">
      <div class="kpi-header">
        <span class="kpi-title">Taxa de Conversão</span>
        <div class="kpi-icon-wrap" style="color: var(--color-contact); background: var(--color-contact-bg); border-color: var(--color-contact-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div>
      </div>
      <div class="kpi-value">${metrics.conversionRate}%</div>
      <div class="kpi-subtext">
        ${isEmp ? 'Seu índice individual' : 'Média da equipe comercial'}
      </div>
    </div>

    <div class="kpi-card" style="--card-accent: var(--color-negotiation);">
      <div class="kpi-header">
        <span class="kpi-title">Ticket Médio</span>
        <div class="kpi-icon-wrap" style="color: var(--color-negotiation); background: var(--color-negotiation-bg); border-color: var(--color-negotiation-border);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
        </div>
      </div>
      <div class="kpi-value">${formatBRL(metrics.avgTicket)}</div>
      <div class="kpi-subtext">
        ${isEmp ? '🔒 Confidencialidade individual' : 'Visão financeira executiva'}
      </div>
    </div>
  `;
}

/**
 * Renders the Kanban Board Columns and Cards with Rotting and Task Badges
 */
export function renderKanban(customers, metrics, permissions = {}) {
  const container = document.getElementById('pipeline-columns');
  if (!container) return;

  container.innerHTML = STAGES.map(stage => {
    const stageCustomers = customers.filter(c => (c.stage || 'lead') === stage.id);
    const stageSum = metrics.stageSums[stage.id] || 0;

    return `
      <div class="pipeline-column" data-stage="${stage.id}" ondragover="event.preventDefault()" ondrop="window.handleDropCard(event, '${stage.id}')">
        <div class="column-header">
          <div class="column-title-wrap">
            <span class="column-indicator" style="background-color: ${stage.color};"></span>
            <h3 class="column-title">${stage.name}</h3>
            <span class="column-count">${stageCustomers.length}</span>
          </div>
          <span class="column-amount">${formatBRL(stageSum)}</span>
        </div>

        <div class="cards-container">
          ${stageCustomers.length === 0 ? `
            <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface-elevated);">
              Nenhum lead nesta etapa
            </div>
          ` : stageCustomers.map(customer => renderLeadCard(customer, permissions)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderLeadCard(customer, permissions = {}) {
  const priorityClass = customer.priority || 'medium';
  const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[priorityClass] || 'Média';
  const tagsHtml = (customer.tags || []).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('');

  // Deal Rotting calculation (> 3 days idle in open stage)
  const isClosed = customer.stage === 'won' || customer.stage === 'lost';
  const updatedTime = new Date(customer.updatedAt || customer.createdAt || Date.now()).getTime();
  const daysIdle = Math.floor((Date.now() - updatedTime) / (1000 * 60 * 60 * 24));
  const isRotting = !isClosed && daysIdle >= 3;

  // Pending tasks count
  const pendingTasks = (customer.tasks || []).filter(t => !t.completed);

  return `
    <div class="lead-card ${isRotting ? 'is-rotting' : ''}" 
         draggable="true" 
         ondragstart="window.handleDragStartCard(event, '${customer.id}')"
         data-id="${customer.id}">
      <div class="lead-card-header">
        <div class="lead-name" onclick="window.handleOpenLeadDetails('${customer.id}')" style="cursor: pointer;" title="Clique para ver histórico completo">
          ${escapeHtml(customer.name)}
        </div>
        <span class="priority-badge ${priorityClass}">${priorityLabel}</span>
      </div>
      
      <div class="lead-company">
        ${customer.company ? `🏢 ${escapeHtml(customer.company)}` : ''}
        ${customer.role ? ` • ${escapeHtml(customer.role)}` : ''}
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem;">
        <div class="lead-value">${formatBRL(customer.dealValue)}</div>
        ${customer.expectedCloseDate ? `
          <span style="font-size: 0.72rem; color: var(--text-muted); background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); padding: 1px 5px; border-radius: 4px;" title="Previsão de Fechamento">
            📅 ${new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
        ` : ''}
      </div>

      <!-- Salesperson & CID Attribute -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; flex-wrap: wrap; gap: 0.35rem;">
        ${customer.assignedTo ? `
          <span class="salesperson-badge" title="Responsável: ${escapeHtml(customer.assignedTo.name)}">
            👤 ${escapeHtml(customer.assignedTo.name.split(' ')[0])}
          </span>
        ` : '<span class="salesperson-badge">👤 Sem atribuição</span>'}

        ${customer.createdBy ? `
          <span style="font-size: 0.68rem; color: var(--text-muted);" title="Criado por ${escapeHtml(customer.createdBy)}">
            ✍️ ${escapeHtml(customer.createdBy.split(' ')[0])}
          </span>
        ` : ''}
      </div>

      <!-- Rotting & Task Badges -->
      <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.65rem;">
        ${isRotting ? `
          <span class="deal-rotting-badge" title="Lead estagnado: sem contato recente há mais de 3 dias">
            ⏳ Parado há ${daysIdle}d
          </span>
        ` : ''}
        ${pendingTasks.length > 0 ? `
          <span class="lead-task-badge" title="${pendingTasks.length} tarefa(s) pendente(s)">
            ✓ ${pendingTasks.length} tarefa${pendingTasks.length > 1 ? 's' : ''}
          </span>
        ` : ''}
      </div>

      ${customer.tags && customer.tags.length > 0 ? `<div class="lead-tags">${tagsHtml}</div>` : ''}

      ${customer.stage === 'lost' && customer.lossReason ? `
        <div style="font-size: 0.72rem; color: var(--color-lost); background: var(--color-lost-bg); border: 1px solid var(--color-lost-border); border-radius: 4px; padding: 3px 6px; margin-bottom: 0.5rem;">
          Motivo: ${escapeHtml(getLossReasonLabel(customer.lossReason))}
        </div>
      ` : ''}

      ${customer.notes ? `
        <div style="font-size: 0.72rem; color: var(--text-secondary); background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 4px 6px; margin-bottom: 0.5rem; max-height: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(customer.notes)}">
          💬 ${escapeHtml(customer.notes)}
        </div>
      ` : ''}

      <div class="card-footer">
        <div class="card-footer-row">
          <select class="move-stage-select" onchange="window.handleMoveStage('${customer.id}', this.value)" title="Mover estágio">
            ${STAGES.map(s => `
              <option value="${s.id}" ${customer.stage === s.id ? 'selected' : ''}>
                ${s.name}
              </option>
            `).join('')}
          </select>

          ${customer.phone ? `
            <button type="button" class="btn-wa" onclick="window.handleOpenWhatsAppModal('${customer.id}')" title="Mensagens rápidas no WhatsApp">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
              <span>Whats</span>
            </button>
          ` : ''}
        </div>

        <div class="card-actions">

          <button class="action-btn" onclick="window.handleOpenProposalModal('${customer.id}')" title="Gerar Proposta Comercial Executiva (PDF / Impressão)" style="color: var(--text-primary);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </button>
          <button class="action-btn" onclick="window.handleOpenLeadDetails('${customer.id}')" title="Histórico e Linha do Tempo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button class="action-btn" onclick="window.handleAnalyzeWithAI('${customer.id}')" title="Analisar com Google Gemini AI" style="color: #2563eb;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          </button>
          <button class="action-btn" onclick="window.handleOpenEditCustomer('${customer.id}')" title="Editar oportunidade">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>

          ${permissions && permissions.canDelete === false ? `
            <button class="action-btn disabled" disabled title="🔒 Exclusão restrita ao Administrador (Tríade CID: Integridade)" style="opacity: 0.35; cursor: not-allowed;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : `
            <button class="action-btn" onclick="window.handleDeleteCustomer('${customer.id}')" title="Excluir (Permissão de Administrador)" style="color: var(--color-lost);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          `}
        </div>
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

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted); background: var(--bg-surface);">
          Nenhum cliente ou lead encontrado com os filtros atuais.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(customer => {
    const initials = (customer.name || 'C')
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const stageObj = STAGES.find(s => s.id === customer.stage) || STAGES[0];
    const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[customer.priority] || 'Média';

    return `
      <tr>
        <td>
          <div class="customer-cell">
            <div class="customer-avatar">${initials}</div>
            <div>
              <div class="customer-name" onclick="window.handleOpenLeadDetails('${customer.id}')" style="cursor: pointer;" title="Ver histórico">${escapeHtml(customer.name)}</div>
              <div class="customer-subtext">${escapeHtml(customer.company || 'Sem empresa')}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 500;">${escapeHtml(customer.email || '-')}</div>
          <div class="customer-subtext" style="display: flex; align-items: center; gap: 0.4rem; margin-top: 2px;">
            <span>${escapeHtml(customer.phone || '-')}</span>
            ${customer.phone ? `
              <button type="button" class="btn-wa" onclick="window.handleOpenWhatsAppModal('${customer.id}')" title="Mensagens rápidas no WhatsApp" style="padding: 1px 5px; font-size: 0.68rem;">
                Whats
              </button>
            ` : ''}
          </div>
        </td>
        <td>
          ${customer.assignedTo ? `
            <span class="salesperson-badge" title="${escapeHtml(customer.assignedTo.email)}">
              👤 ${escapeHtml(customer.assignedTo.name.split(' ')[0])}
            </span>
          ` : '<span class="salesperson-badge">👤 Sem atribuição</span>'}
        </td>
        <td>
          <span style="font-weight: 700; color: var(--color-won); font-family: var(--font-heading);">
            ${formatBRL(customer.dealValue)}
          </span>
          ${customer.expectedCloseDate ? `
            <div style="font-size: 0.7rem; color: var(--text-muted);">
              Prev: ${new Date(customer.expectedCloseDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </div>
          ` : ''}
        </td>
        <td>
          <span class="stage-badge" style="background: ${stageObj.bg}; color: ${stageObj.color}; border: 1px solid ${stageObj.color}30;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${stageObj.color}"></span>
            ${stageObj.name}
          </span>
        </td>
        <td>
          <span class="priority-badge ${customer.priority || 'medium'}">${priorityLabel}</span>
        </td>
        <td>
          ${(customer.tags || []).slice(0, 3).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join(' ')}
        </td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-sm" onclick="window.handleOpenLeadDetails('${customer.id}')" style="margin-right: 0.35rem;" title="Histórico e Linha do Tempo">
            📜 Histórico
          </button>
          <button class="btn btn-outline btn-sm" onclick="window.handleAnalyzeWithAI('${customer.id}')" style="margin-right: 0.35rem; color: #2563eb; border-color: #cbd5e1;" title="Análise com Gemini AI">
            ✦ IA
          </button>
          <button class="btn btn-outline btn-sm" onclick="window.handleOpenProposalModal('${customer.id}')" style="margin-right: 0.35rem;" title="Gerar Proposta Comercial Executiva (PDF / Impressão)">
            📄 Proposta
          </button>
          <button class="btn btn-outline btn-sm" onclick="window.handleOpenEditCustomer('${customer.id}')" style="margin-right: 0.35rem;">
            Editar
          </button>
          ${permissions && permissions.canDelete === false ? `
            <button class="btn btn-outline btn-sm disabled" disabled title="🔒 Exclusão restrita ao Administrador (Integridade CID)" style="opacity: 0.35; cursor: not-allowed;">
              Excluir
            </button>
          ` : `
            <button class="btn btn-danger-ghost btn-sm" onclick="window.handleDeleteCustomer('${customer.id}')">
              Excluir
            </button>
          `}
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
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
        Nenhuma atividade encontrada com o filtro selecionado.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(task => {
    const isOverdue = !task.completed && task.dueDate && task.dueDate < todayStr;
    const typeObj = TASK_TYPES.find(t => t.id === task.type) || TASK_TYPES[0];

    return `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}" data-customer-id="${task.customerId}">
        <div class="task-left">
          <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} 
                 onchange="window.handleToggleTask('${task.customerId}', '${task.id}')">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-customer-link">
              Lead: <strong style="color: var(--text-primary); cursor: pointer;" onclick="window.handleOpenLeadDetails('${task.customerId}')">${escapeHtml(task.customerName)}</strong>
              ${task.customerCompany ? ` • ${escapeHtml(task.customerCompany)}` : ''}
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="task-type-pill">${typeObj.icon} ${typeObj.label}</span>
          <span class="task-due-date ${isOverdue ? 'is-overdue' : ''}" title="${isOverdue ? 'Atividade Atrasada!' : 'Data de vencimento'}">
            📅 ${task.dueDate ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem data'}
            ${isOverdue ? ' (Atrasada)' : ''}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renders Detailed Metrics (Forecast & Loss Reasons)
 */
export function renderDetailedMetrics(metrics, allCustomers = [], permissions = {}) {
  const forecastEl = document.getElementById('metrics-forecast-value');
  const rottingEl = document.getElementById('metrics-rotting-value');
  const lossContainer = document.getElementById('metrics-loss-reasons');

  if (forecastEl) forecastEl.textContent = formatBRL(metrics.currentMonthForecast);
  if (rottingEl) rottingEl.textContent = `${metrics.rottingCount} oportunidade(s)`;

  // Commercial Target (Meta Q4)
  const targetGoal = 250000;
  const wonVal = metrics.wonTotal || 0;
  const targetPct = Math.min(100, Math.round((wonVal / targetGoal) * 100));
  const remaining = Math.max(0, targetGoal - wonVal);

  const targetBadge = document.getElementById('target-percentage-badge');
  const targetRealized = document.getElementById('target-realized-value');
  const targetFill = document.getElementById('target-progress-fill');
  const targetRem = document.getElementById('target-remaining-label');

  if (targetBadge) {
    targetBadge.textContent = `${targetPct}% Atingido`;
    targetBadge.style.background = targetPct >= 70 ? 'var(--color-won-bg)' : 'var(--color-proposal-bg)';
    targetBadge.style.color = targetPct >= 70 ? 'var(--color-won)' : 'var(--color-proposal)';
  }
  if (targetRealized) targetRealized.textContent = formatBRL(wonVal);
  if (targetFill) targetFill.style.width = `${targetPct}%`;
  if (targetRem) {
    targetRem.textContent = remaining > 0 
      ? `Faltam ${formatBRL(remaining)} para a meta máxima`
      : `🎉 Parabéns! Meta comercial batida com sucesso!`;
  }

  // Gamification & Commissions (5% rate)
  const leaderboardEl = document.getElementById('commissions-leaderboard');
  if (leaderboardEl) {
    const wonCustomers = (allCustomers || []).filter(c => c.stage === 'won');
    const lucasWon = wonCustomers.filter(c => c.assignedTo?.email?.includes('lucas') || c.assignedTo?.name?.includes('Lucas'))
      .reduce((acc, c) => acc + (Number(c.dealValue) || 0), 0);
    const marianaWon = wonCustomers.filter(c => c.assignedTo?.email?.includes('mariana') || c.assignedTo?.name?.includes('Mariana'))
      .reduce((acc, c) => acc + (Number(c.dealValue) || 0), 0);

    const commissionRate = 0.05; // 5%
    const lucasComm = lucasWon * commissionRate;
    const marianaComm = marianaWon * commissionRate;

    leaderboardEl.innerHTML = `
      <div class="commission-row">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.1rem;">🥇</span>
          <div>
            <div style="font-weight: 600; font-size: 0.82rem;">Mariana Costa (Consultora)</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${formatBRL(marianaWon)} faturados</div>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-weight: 700; color: #16a34a; font-size: 0.88rem;">${formatBRL(marianaComm)}</span>
          <div style="font-size: 0.68rem; color: var(--text-muted);">Comissão (5%)</div>
        </div>
      </div>

      <div class="commission-row">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.1rem;">🥈</span>
          <div>
            <div style="font-weight: 600; font-size: 0.82rem;">Lucas Mendes (Consultor)</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${formatBRL(lucasWon)} faturados</div>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-weight: 700; color: #16a34a; font-size: 0.88rem;">${formatBRL(lucasComm)}</span>
          <div style="font-size: 0.68rem; color: var(--text-muted);">Comissão (5%)</div>
        </div>
      </div>
    `;
  }

  if (lossContainer && metrics.lossReasonCounts) {
    const reasons = Object.entries(metrics.lossReasonCounts)
      .map(([id, data]) => ({ id, ...data }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);

    if (reasons.length === 0) {
      lossContainer.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">
          Nenhuma perda registrada até o momento.
        </div>
      `;
    } else {
      const totalLost = metrics.lostCount || 1;
      lossContainer.innerHTML = reasons.map(r => {
        const pct = Math.round((r.count / totalLost) * 100);
        return `
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
              <span style="font-weight: 500; color: var(--text-primary);">${r.label}</span>
              <span style="font-weight: 600; color: #dc2626;">${r.count} (${pct}%)</span>
            </div>
            <div style="width: 100%; height: 6px; background: var(--bg-surface-elevated); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${pct}%; background: #dc2626; border-radius: 3px;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
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
  if (metaEl) {
    const stageObj = STAGES.find(s => s.id === customer.stage) || STAGES[0];
    metaEl.textContent = `${customer.company || 'Sem empresa'} • ${formatBRL(customer.dealValue)} • Estágio: ${stageObj.name}`;
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
          <span class="timeline-item-date">${dateFormatted} • ${escapeHtml(act.author || 'Você')}</span>
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
  const roleLabel = role === 'admin' ? '🛡️ Admin' : '💼 Funcionário';
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
          <!-- Quick Switch Button for Role (Admin vs Employee) -->
          <button type="button" class="btn-sidebar-user-action" id="btn-toggle-role" title="Alternar entre Administrador e Funcionário (RBAC)">
            🔄
          </button>

          <!-- Return to Auth & Registration Portal -->
          <button type="button" class="btn-sidebar-user-action logout" id="btn-portal-logout" title="Encerrar sessão e retornar ao Portal de Login">
            🚪
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
      <span>Google Cloud</span>
    `;
    pill.title = 'Conectado em tempo real com o Google Cloud Firestore';
  } else {
    pill.className = 'connection-pill local';
    pill.innerHTML = `
      <span class="pulse-dot" style="background-color: #d97706; box-shadow: 0 0 6px #d97706;"></span>
      <span>Modo Local</span>
    `;
    pill.title = 'Operando em modo local. Clique para sincronizar com Google Cloud';
  }
}

/**
 * Renders the Dedicated Tríade CID & Governança View
 */
export function renderSecurityView(state) {
  const container = document.getElementById('security-content-container');
  if (!container) return;

  const isAdm = state.currentRole === 'admin';

  container.innerHTML = `
    <div class="cid-status-bar">
      <div>
        <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.25rem;">
          <span style="font-weight: 700; font-size: 1.15rem; color: var(--text-primary);">Segurança &amp; Governança de Redes</span>
          <span class="cid-role-badge ${state.currentRole}">
            ${isAdm ? '🛡️ Administrador' : '💼 Consultor de Vendas'}
          </span>
        </div>
        <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0;">
          Aplicação das normas de segurança da informação (ISO 27001 / Tríade CID): menor privilégio (RBAC), auditoria imutável e resiliência offline.
        </p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.handleToggleRole()">
        ${isAdm ? 'Simular Visão do Funcionário 💼' : 'Alternar para Administrador 🛡️'}
      </button>
    </div>

    <!-- Barra de Conformidade com Normas de Segurança de Redes -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
      <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.65rem;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background: var(--color-contact-bg); color: var(--color-contact); display: flex; align-items: center; justify-content: center; font-size: 1rem;">🔒</div>
        <div>
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">Criptografia em Redes</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">TLS 1.3 &amp; AES-256</div>
        </div>
      </div>
      <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.65rem;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background: var(--color-proposal-bg); color: var(--color-proposal); display: flex; align-items: center; justify-content: center; font-size: 1rem;">🛡️</div>
        <div>
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">Controle de Acesso</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">RBAC Menor Privilégio</div>
        </div>
      </div>
      <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.65rem;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background: var(--color-lost-bg); color: var(--color-lost); display: flex; align-items: center; justify-content: center; font-size: 1rem;">📝</div>
        <div>
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">Auditoria &amp; LGPD</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">Logs Imutáveis &amp; CPF Seguro</div>
        </div>
      </div>
      <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.65rem;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background: var(--color-won-bg); color: var(--color-won); display: flex; align-items: center; justify-content: center; font-size: 1rem;">⚡</div>
        <div>
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">Disponibilidade</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">Zero Downtime (PWA)</div>
        </div>
      </div>
    </div>

    <!-- Painel de Gestão de Funcionários & Credenciais Corporativas (CID/RBAC) -->
    ${isAdm ? `
      <div class="employee-management-section">
        <div class="employee-section-header">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem;">
              <span style="font-size: 1.15rem;">👥</span>
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 0;">
                Gestão de Colaboradores &amp; Credenciais Corporativas
              </h3>
              <span class="badge-status-pending" style="font-size: 0.72rem;">
                ${getEmployees().length} Cadastrados
              </span>
            </div>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
              Cadastre funcionários via <strong>CPF</strong> com emissão de <strong>senha temporária</strong> e exigência de troca no primeiro acesso.
            </p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-open-employee-modal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Cadastrar Novo Funcionário</span>
          </button>
        </div>

        <div class="employee-table-wrapper">
          <table class="employee-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>CPF (LGPD)</th>
                <th>E-mail Corporativo</th>
                <th>Credencial / 1º Acesso</th>
                <th>Status</th>
                <th style="text-align: right;">Ações de Governança</th>
              </tr>
            </thead>
            <tbody>
              ${getEmployees().length === 0 ? `
                <tr>
                  <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    Nenhum colaborador cadastrado. Clique no botão acima para cadastrar o primeiro funcionário com CPF e senha temporária.
                  </td>
                </tr>
              ` : getEmployees().map(emp => {
                const initials = emp.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                const isBlocked = emp.status === 'blocked';
                return `
                  <tr>
                    <td>
                      <div class="employee-profile-cell">
                        <div class="employee-avatar-circle">${escapeHtml(initials)}</div>
                        <div>
                          <div class="employee-name-title">
                            ${escapeHtml(emp.name)}
                            ${emp.role === 'admin' ? '<span title="Administrador" style="font-size: 0.75rem;">🛡️</span>' : ''}
                          </div>
                          <div class="employee-job-meta">${escapeHtml(emp.jobTitle)} • ${escapeHtml(emp.department)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="cpf-cell-container" id="cpf-container-${emp.id}">
                        <span class="cpf-text" id="cpf-text-${emp.id}" data-masked="${escapeHtml(maskCPF(emp.cpf))}" data-raw="${escapeHtml(emp.cpf)}">${escapeHtml(maskCPF(emp.cpf))}</span>
                        <button type="button" class="btn-toggle-cpf" onclick="window.handleToggleCPFVisibility('${emp.id}')" title="Mostrar/Ocultar CPF completo">
                          👁️
                        </button>
                      </div>
                    </td>
                    <td style="color: var(--text-secondary); font-size: 0.82rem;">
                      ${escapeHtml(emp.email)}
                    </td>
                    <td>
                      ${emp.requirePasswordChange ? `
                        <div>
                          <span class="temp-password-badge" title="Senha temporária emitida aguardando primeiro login">
                            🔑 ${escapeHtml(emp.tempPassword || '***')}
                          </span>
                          <div style="font-size: 0.68rem; color: #b45309; margin-top: 2px;">⚠️ Troca obrigatória no 1º acesso</div>
                        </div>
                      ` : `
                        <div>
                          <span class="badge-status-active" style="font-size: 0.72rem;">
                            ✓ Senha Pessoal Ativa
                          </span>
                          <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 2px;">1º acesso concluído</div>
                        </div>
                      `}
                    </td>
                    <td>
                      ${isBlocked ? `
                        <span class="badge-status-blocked">🔴 Bloqueado</span>
                      ` : `
                        <span class="badge-status-active">🟢 Ativo</span>
                      `}
                    </td>
                    <td>
                      <div class="emp-actions-group" style="justify-content: flex-end;">
                        <button type="button" class="btn btn-outline btn-sm btn-emp-action" onclick="window.handleCopyEmployeeCredentials('${emp.id}')" title="Copiar credenciais prontas para enviar no WhatsApp ou E-mail">
                          📋 Copiar
                        </button>
                        <button type="button" class="btn btn-outline btn-sm btn-emp-action" onclick="window.handleResetEmployeePassword('${emp.id}')" title="Gerar nova senha temporária imediata">
                          🔑 Resetar
                        </button>
                        <button type="button" class="btn btn-outline btn-sm btn-emp-action" onclick="window.handleToggleEmployeeStatus('${emp.id}')" title="${isBlocked ? 'Desbloquear acesso' : 'Bloquear acesso do funcionário'}">
                          ${isBlocked ? '🔓 Liberar' : '🛡️ Bloquear'}
                        </button>
                        <button type="button" class="btn btn-outline btn-sm btn-emp-action" onclick="window.handleDeleteEmployee('${emp.id}')" title="Excluir colaborador" style="color: var(--color-lost);">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      <div class="employee-management-section">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem;">🔒</span>
          <div>
            <h3 style="font-size: 0.95rem; font-weight: 700; margin: 0; color: var(--text-primary);">
              Gestão de Credenciais Corporativas (Menor Privilégio - RBAC)
            </h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">
              Como Consultor de Vendas, a emissão e revogação de acessos por CPF é centralizada no <strong>Administrador do Sistema</strong>.
            </p>
          </div>
        </div>
      </div>
    `}

    <div class="cid-triad-grid">
      <!-- C: Confidencialidade -->
      <div class="cid-card">
        <div class="cid-card-header">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <div class="cid-icon-wrapper cid-icon-c">🔒</div>
            <div>
              <h3 style="font-size: 0.98rem; font-weight: 700; margin: 0; color: var(--text-primary);">1. Confidencialidade (C)</h3>
              <span style="font-size: 0.72rem; color: var(--text-secondary);">Isolamento &amp; Menor Privilégio</span>
            </div>
          </div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--color-contact); background: var(--color-contact-bg); border: 1px solid var(--color-contact-border); padding: 2px 7px; border-radius: 4px;">
            ${isAdm ? 'Acesso Global' : 'Acesso Restrito'}
          </span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.5rem;">
          ${isAdm 
            ? 'Como <strong>Administrador</strong>, você possui visão consolidada de faturamento global e parametrizações de infraestrutura.'
            : 'Como <strong>Consultor</strong>, você acessa <strong>somente a sua carteira</strong>. Faturamento geral da empresa e chaves de API permanecem confidenciais.'
          }
        </p>
        <table class="rbac-table">
          <thead>
            <tr>
              <th>Recurso / Operação</th>
              <th>Admin</th>
              <th>Funcionário</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Visualizar Oportunidades</td>
              <td><span style="color: var(--color-won); font-weight: 600;">✅ Todos (${state.allCustomers.length})</span></td>
              <td><span style="color: var(--color-contact); font-weight: 600;">🔒 Seus Leads (${state.visibleCustomers.length})</span></td>
            </tr>
            <tr>
              <td>Métricas de Faturamento Geral</td>
              <td><span style="color: var(--color-won); font-weight: 600;">✅ Total</span></td>
              <td><span style="color: var(--color-lost); font-weight: 600;">🔒 Oculto</span></td>
            </tr>
            <tr>
              <td>Configurações Cloud / IA</td>
              <td><span style="color: var(--color-won); font-weight: 600;">✅ Liberado</span></td>
              <td><span style="color: var(--color-lost); font-weight: 600;">🔒 Bloqueado</span></td>
            </tr>
            <tr>
              <td>Exportação Geral de Dados</td>
              <td><span style="color: var(--color-won); font-weight: 600;">✅ Total</span></td>
              <td><span style="color: var(--color-proposal); font-weight: 600;">🔒 Restrito</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- I: Integridade -->
      <div class="cid-card">
        <div class="cid-card-header">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <div class="cid-icon-wrapper cid-icon-i">🛡️</div>
            <div>
              <h3 style="font-size: 0.98rem; font-weight: 700; margin: 0; color: var(--text-primary);">2. Integridade (I)</h3>
              <span style="font-size: 0.72rem; color: var(--text-secondary);">Trilha de Auditoria &amp; Imutabilidade</span>
            </div>
          </div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--color-lost); background: var(--color-lost-bg); border: 1px solid var(--color-lost-border); padding: 2px 7px; border-radius: 4px;">
            Auditado
          </span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.5rem;">
          Garante a precisão e consistência das informações contra exclusões ou fraudes em operações:
        </p>
        <ul style="font-size: 0.79rem; color: var(--text-primary); padding-left: 1.1rem; line-height: 1.6; margin: 0.5rem 0;">
          <li><strong>Bloqueio de Exclusão:</strong> Consultores não podem apagar leads (privilégio exclusivo de Administrador).</li>
          <li><strong>Assinatura Digital de Ações:</strong> Toda transação é registrada com nome do operador e timestamp.</li>
          <li><strong>Motivo de Perda Estratégico:</strong> Cancelamentos exigem formalização do motivo.</li>
        </ul>
      </div>

      <!-- D: Disponibilidade -->
      <div class="cid-card">
        <div class="cid-card-header">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <div class="cid-icon-wrapper cid-icon-d">⚡</div>
            <div>
              <h3 style="font-size: 0.98rem; font-weight: 700; margin: 0; color: var(--text-primary);">3. Disponibilidade (D)</h3>
              <span style="font-size: 0.72rem; color: var(--text-secondary);">Resiliência &amp; Disaster Recovery</span>
            </div>
          </div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--color-won); background: var(--color-won-bg); border: 1px solid var(--color-won-border); padding: 2px 7px; border-radius: 4px;">
            ${state.availability.isOnline ? 'Online' : 'Resiliente'}
          </span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.5rem;">
          Garante operação ininterrupta do time mesmo com instabilidade de rede ou queda de servidor:
        </p>
        <div style="margin: 0.6rem 0; padding: 0.75rem; background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 0.8rem; color: var(--text-primary);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: var(--text-secondary);">Status da Conexão:</span>
            <strong>${state.availability.isOnline ? '🟢 TLS 1.3 Seguro (Online)' : '🟡 Modo Resiliente Offline'}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: var(--text-secondary);">Banco de Dados:</span>
            <strong>${state.storageMode === 'firestore' ? 'Google Cloud Firestore' : 'Cache Local / Híbrido'}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-secondary);">Tolerância a Falhas:</span>
            <span style="color: var(--color-won); font-weight: 600;">✓ Ativa (Zero Perda de Dados)</span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: auto;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.handleDownloadBackup()" style="flex: 1;" ${isAdm ? '' : 'disabled title="🔒 Apenas Administrador pode exportar backups"'}>
            💾 Exportar Backup
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.handleTriggerRestoreBackup()" style="flex: 1;" ${isAdm ? '' : 'disabled title="🔒 Apenas Administrador pode restaurar backups"'}>
            🔄 Restaurar Banco
          </button>
        </div>
      </div>
    </div>

    <!-- Audit Log Live Feed -->
    <div class="table-container" style="padding: 1.25rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
        <div>
          <h3 style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin: 0;">Trilha de Auditoria em Tempo Real (Audit Log)</h3>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0;">Registro imutável em conformidade com ISO 27001 para auditoria de segurança da informação.</p>
        </div>
        <span class="audit-tag" style="background: var(--color-contact-bg); color: var(--color-contact); border: 1px solid var(--color-contact-border);">
          ${state.auditLogs.length} eventos registrados
        </span>
      </div>

      <div style="overflow-x: auto;">
        <table class="audit-table">
          <thead>
            <tr>
              <th style="width: 130px;">Horário</th>
              <th style="width: 170px;">Ação</th>
              <th style="width: 180px;">Usuário / Papel</th>
              <th>Detalhes da Operação</th>
            </tr>
          </thead>
          <tbody>
            ${state.auditLogs.length === 0 ? `
              <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                  Nenhum evento registrado nesta sessão. As ações de criação, edição, alteração de estágio e segurança aparecerão aqui em tempo real.
                </td>
              </tr>
            ` : state.auditLogs.map(log => `
              <tr>
                <td style="color: var(--text-secondary); font-size: 0.75rem; white-space: nowrap;">
                  ${new Date(log.timestamp).toLocaleTimeString('pt-BR')} • ${new Date(log.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                </td>
                <td>
                  <span class="audit-tag">${escapeHtml(log.action)}</span>
                </td>
                <td>
                  <div style="font-weight: 600; font-size: 0.8rem;">${escapeHtml(log.userName)}</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">
                    ${log.userRole === 'admin' ? '🛡️ Admin' : '💼 Funcionário'}
                  </div>
                </td>
                <td style="color: var(--text-secondary); font-size: 0.8rem;">
                  ${escapeHtml(log.details)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
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
