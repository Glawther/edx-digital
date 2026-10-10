/**
 * Nexus CRM - Central State Store & Metrics Calculator
 * Enterprise Multi-Module State with Forecast, Loss Reasons & Activity Tracking
 */

export const STAGES = [
  { id: 'lead', name: 'Novo Lead', color: '#0284c7', bg: '#f0f9ff' },
  { id: 'contact', name: 'Primeiro Contato', color: '#2563eb', bg: '#eff6ff' },
  { id: 'proposal', name: 'Proposta Enviada', color: '#d97706', bg: '#fffbeb' },
  { id: 'negotiation', name: 'Em Negociação', color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'won', name: 'Fechado Ganho', color: '#16a34a', bg: '#f0fdf4' },
  { id: 'lost', name: 'Perdido', color: '#dc2626', bg: '#fef2f2' }
];

export const PRIORITIES = [
  { id: 'high', label: 'Alta Prioridade', color: '#e11d48' },
  { id: 'medium', label: 'Média Prioridade', color: '#d97706' },
  { id: 'low', label: 'Baixa Prioridade', color: '#16a34a' }
];

export const LOSS_REASONS = [
  { id: 'price', label: 'Preço ou orçamento' },
  { id: 'competitor', label: 'Fechou com um concorrente' },
  { id: 'timing', label: 'Projeto adiado' },
  { id: 'features', label: 'O produto não atendia' },
  { id: 'ghosting', label: 'Parou de responder' },
  { id: 'cancelled', label: 'O cliente desistiu da compra' },
  { id: 'other', label: 'Outro motivo' }
];

/**
 * Resolves a stored loss reason to its id. Older records stored the label instead of the id.
 */
export function getLossReasonId(stored) {
  if (!stored) return 'other';
  const match = LOSS_REASONS.find(r => r.id === stored || r.label === stored);
  return match ? match.id : 'other';
}

/**
 * Human-readable label for a stored loss reason (id or legacy label)
 */
export function getLossReasonLabel(stored) {
  if (!stored) return '';
  const match = LOSS_REASONS.find(r => r.id === stored || r.label === stored);
  return match ? match.label : String(stored);
}

export const TASK_TYPES = [
  { id: 'call', label: 'Ligação', icon: '' },
  { id: 'meeting', label: 'Reunião', icon: '' },
  { id: 'whatsapp', label: 'WhatsApp', icon: '' },
  { id: 'followup', label: 'Retorno', icon: '' }
];

import { getCurrentRole, getCurrentUser, USER_ROLES } from '../services/auth-service.js';

export const SALES_TEAM = [
  { id: 'employee-user-02', name: 'Lucas Mendes (Consultor)', email: 'lucas.vendas@nexuscrm.com', role: 'employee' },
  { id: 'employee-user-03', name: 'Mariana Costa (Consultora)', email: 'mariana.vendas@nexuscrm.com', role: 'employee' },
  { id: 'admin-user-01', name: 'Paula Andrade', email: 'admin@nexuscrm.com', role: 'admin' }
];

class CRMStore {
  constructor() {
    this.customers = [];
    this.storageMode = 'local';
    this.searchQuery = '';
    this.selectedPriority = 'all';
    this.selectedSalesperson = 'all'; // Admin filter: 'all' | employee email
    this.activeView = 'pipeline'; // 'pipeline' | 'customers' | 'tasks' | 'metrics' | 'security'
    this.taskFilter = 'pending'; // 'pending' | 'today' | 'all' | 'completed'
    this.auditLogs = [];
    this.availability = {
      isOnline: navigator.onLine,
      mode: 'online',
      latency: 42,
      lastBackupTime: null
    };
    this.subscribers = [];
    
    // Listen to network status for Availability (Disponibilidade)
    window.addEventListener('online', () => this.updateNetworkStatus(true));
    window.addEventListener('offline', () => this.updateNetworkStatus(false));
  }

  updateNetworkStatus(isOnline) {
    this.availability.isOnline = isOnline;
    this.availability.mode = isOnline ? 'online' : 'offline_cache';
    this.emitChange();
  }

  addAuditLog(action, details, targetLead = null) {
    const user = getCurrentUser() || { name: 'Sistema', role: 'admin', email: 'system@local' };
    const logEntry = {
      id: 'audit-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      action,
      details,
      targetLead: targetLead ? { id: targetLead.id, name: targetLead.name, company: targetLead.company } : null,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role || getCurrentRole(),
      timestamp: new Date().toISOString()
    };

    this.auditLogs.unshift(logEntry);
    if (this.auditLogs.length > 50) this.auditLogs.pop(); // Keep 50 recent logs
    this.emitChange();
    return logEntry;
  }

  setCustomers(customers, mode = 'local') {
    this.customers = customers;
    this.storageMode = mode;
    this.emitChange();
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.emitChange();
  }

  setPriorityFilter(priority) {
    this.selectedPriority = priority;
    this.emitChange();
  }

  setSalespersonFilter(salesperson) {
    this.selectedSalesperson = salesperson;
    this.emitChange();
  }

  setActiveView(view) {
    this.activeView = view;
    this.emitChange();
  }

  setTaskFilter(filter) {
    this.taskFilter = filter;
    this.emitChange();
  }

  subscribe(callback) {
    this.subscribers.push(callback);
    callback(this.getState());
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  emitChange() {
    const state = this.getState();
    this.subscribers.forEach(cb => cb(state));
  }

  getState() {
    const role = getCurrentRole();
    const user = getCurrentUser();
    const isUserAdmin = role === USER_ROLES.ADMIN;

    // 1. CONFIDENCIALIDADE (C): Filtragem de visibilidade por perfil
    // Se for Funcionário (Employee), ele só pode ver os leads atribuídos a ele!
    // Se for Admin, vê todos (com opção de filtro por vendedor)
    const baseCustomers = this.customers.filter(c => {
      if (!isUserAdmin) {
        // Regra de Menor Privilégio (Least Privilege):
        // Funcionário vê leads da sua carteira, leads criados por ele, e leads gerais sem atribuição ou em triagem
        if (!c.assignedTo) return true;
        const userEmail = (user && user.email ? user.email.toLowerCase() : '');
        const userName = (user && user.name ? user.name.toLowerCase() : '');
        const assignedEmail = (c.assignedTo.email ? c.assignedTo.email.toLowerCase() : '');
        const assignedName = (c.assignedTo.name ? c.assignedTo.name.toLowerCase() : '');
        const createdBy = (c.createdBy ? c.createdBy.toLowerCase() : '');

        // 1. Criado pelo funcionário: sempre visível
        if (createdBy && userName && createdBy === userName) {
          return true;
        }

        // 2. Atribuído explicitamente ao funcionário (email ou nome)
        if ((userEmail && assignedEmail === userEmail) || (userName && assignedName === userName)) {
          return true;
        }

        // 3. Leads gerais do sistema (atribuídos ao Admin ou equipe geral para triagem / pool comum)
        if (assignedEmail === 'admin@nexuscrm.com' || assignedName.includes('administrador') || !assignedEmail) {
          return true;
        }

        return false;
      } else {
        // Admin: pode filtrar por vendedor específico se desejar
        if (this.selectedSalesperson !== 'all' && c.assignedTo && c.assignedTo.email !== this.selectedSalesperson) {
          return false;
        }
        return true;
      }
    });

    const filteredCustomers = baseCustomers.filter(c => {
      // Priority filter
      if (this.selectedPriority !== 'all' && c.priority !== this.selectedPriority) {
        return false;
      }
      // Search filter
      if (this.searchQuery) {
        const target = `${c.name || ''} ${c.company || ''} ${c.email || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
        if (target.includes(this.searchQuery)) return true;
        const digits = this.searchQuery.replace(/\D/g, '');
        return digits.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(digits);
      }
      return true;
    });

    // Calcula métricas para os leads visíveis ao usuário atual
    const metrics = this.calculateMetrics(baseCustomers);
    const allTasks = this.extractAllTasks(baseCustomers);

    // Permissões da Tríade CID
    const permissions = {
      isAdmin: isUserAdmin,
      isEmployee: !isUserAdmin,
      canDelete: isUserAdmin, // INTEGRIDADE: Somente Admin pode deletar registros
      canViewGlobalFinance: isUserAdmin, // CONFIDENCIALIDADE: Somente Admin vê faturamento geral da empresa
      canAccessCloudConfig: isUserAdmin, // CONFIDENCIALIDADE: Somente Admin altera chaves de API
      canManageTeam: isUserAdmin,
      canExportAll: isUserAdmin,
      canDisasterRecovery: isUserAdmin // DISPONIBILIDADE: Somente Admin cria e restaura backups
    };

    return {
      allCustomers: this.customers, // Raw list (for admin)
      visibleCustomers: baseCustomers, // Filtered by role
      filteredCustomers, // Filtered by role + search + priority
      metrics,
      tasks: allTasks,
      taskFilter: this.taskFilter,
      activeView: this.activeView,
      searchQuery: this.searchQuery,
      selectedPriority: this.selectedPriority,
      selectedSalesperson: this.selectedSalesperson,
      storageMode: this.storageMode,
      permissions,
      currentRole: role,
      auditLogs: this.auditLogs,
      availability: this.availability,
      salesTeam: SALES_TEAM
    };
  }

  /**
   * Consolidates all tasks from visible leads
   */
  extractAllTasks(customerList = this.customers) {
    const tasks = [];
    customerList.forEach(customer => {
      if (Array.isArray(customer.tasks)) {
        customer.tasks.forEach(t => {
          tasks.push({
            ...t,
            customerId: customer.id,
            customerName: customer.name,
            customerCompany: customer.company
          });
        });
      }
    });

    // Sort by dueDate
    return tasks.sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));
  }

  calculateMetrics(customerList = this.customers) {
    let pipelineTotal = 0;
    let wonTotal = 0;
    let wonCount = 0;
    let lostCount = 0;
    let activeDealsCount = 0;
    let rottingCount = 0;

    const stageSums = {};
    const stageCounts = {};
    const lossReasonCounts = {};

    STAGES.forEach(s => {
      stageSums[s.id] = 0;
      stageCounts[s.id] = 0;
    });

    LOSS_REASONS.forEach(r => {
      lossReasonCounts[r.id] = { count: 0, label: r.label, totalValue: 0 };
    });

    const now = Date.now();
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    let currentMonthForecast = 0;

    customerList.forEach(c => {
      const val = Number(c.dealValue) || 0;
      const stage = c.stage || 'lead';

      if (stageSums[stage] !== undefined) {
        stageSums[stage] += val;
        stageCounts[stage] += 1;
      }

      // Check Deal Rotting (> 3 days without update in active stage)
      if (stage !== 'won' && stage !== 'lost') {
        const updatedTime = new Date(c.updatedAt || c.createdAt || now).getTime();
        const daysIdle = (now - updatedTime) / (1000 * 60 * 60 * 24);
        if (daysIdle >= 3) {
          rottingCount++;
        }

        // Expected close forecast
        if (c.expectedCloseDate) {
          const expDate = new Date(c.expectedCloseDate);
          if (expDate.getMonth() === currentMonth && expDate.getFullYear() === currentYear) {
            currentMonthForecast += val;
          }
        }
      }

      if (stage === 'won') {
        wonTotal += val;
        wonCount += 1;
      } else if (stage === 'lost') {
        lostCount += 1;
        const reasonId = getLossReasonId(c.lossReason);
        lossReasonCounts[reasonId].count += 1;
        lossReasonCounts[reasonId].totalValue += val;
      } else {
        pipelineTotal += val;
        activeDealsCount += 1;
      }
    });

    const totalDecided = wonCount + lostCount;
    const conversionRate = totalDecided > 0 ? ((wonCount / totalDecided) * 100).toFixed(1) : "0.0";
    const avgTicket = wonCount > 0 ? (wonTotal / wonCount) : (this.customers.length > 0 ? (pipelineTotal / this.customers.length) : 0);

    return {
      pipelineTotal,
      wonTotal,
      wonCount,
      lostCount,
      activeDealsCount,
      conversionRate,
      avgTicket,
      stageSums,
      stageCounts,
      rottingCount,
      lossReasonCounts,
      currentMonthForecast
    };
  }
}

export const crmStore = new CRMStore();
