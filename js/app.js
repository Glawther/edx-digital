/**
 * Nexus CRM - Application Orchestrator
 * Wires the screens to the store, the storage and the services
 */

import { storage } from './core/storage-manager.js';
import { crmStore, STAGES, LOSS_REASONS, SALES_TEAM } from './core/crm-store.js';
import {
  renderKPIs,
  renderKanban,
  renderTable,
  renderTasksView,
  renderDetailedMetrics,
  renderLeadTimeline,
  toggleLostColumn,
  renderConnectionStatus,
  renderAuthBadge,
  renderSecurityView,
  showToast,
  getWhatsAppLink,
  formatBRL,
  escapeHtml
} from './ui/ui-renderer.js';
import { 
  getSavedOrganization, 
  saveOrganization, 
  applyWhitelabelStyles, 
  getAiUsageMetrics 
} from './core/config.js';
import { analyzeDealWithGemini, getSavedGeminiKey, saveGeminiKey } from './services/gemini-service.js';
import {
  initAuth,
  onAuthChange,
  setUserRole,
  getCurrentRole,
  isAdmin,
  USER_ROLES,
  getCurrentUser,
  isSessionActive,
  isCloudSession,
  isDemoSession,
  loginAsDemoRole,
  signIn,
  registerCompany,
  joinCompany,
  sendPasswordReset,
  changeOwnPassword,
  logoutToPortal,
  deleteOwnAccount,
  deleteCompany,
  isCompanyOwner,
  markActivity,
  isIdleTooLong
} from './services/auth-service.js';
import { describeAuthError } from './services/firebase-app.js';
import {
  exportCustomersToCSV,
  exportAuditLogsToCSV
} from './services/export-service.js';
import { 
  formatCPF, 
  validateCPF, 
  maskCPF, 
  generateTemporaryPassword, 
  saveEmployee, 
  getEmployees, 
  resetEmployeePassword, 
  toggleEmployeeStatus, 
  deleteEmployee, 
  generateCredentialsShareText, 
  onEmployeesChange,
  startEmployeeSync,
  stopEmployeeSync
} from './services/employee-service.js';
import {
  initTheme,
  toggleTheme
} from './core/theme-manager.js';
import {
  logAudit,
  AUDIT_ACTIONS,
  AUDIT_SEVERITY,
  initAuditFirestore,
  getLocalAuditLogs,
  getAuditStats,
  formatAuditAction,
  exportAuditToCSV,
  onAuditLog
} from './services/audit-service.js';
import { getFirestoreDb } from './services/firebase-service.js';
import {
  generateInviteShareText,
  getCompanyTeamInviteCode,
  replaceCompanyTeamInviteCode
} from './services/team-invite-service.js';
import {
  requestNotificationPermission,
  getNotificationPermission,
  getInAppNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  onNotificationsChange,
  getNotificationIcon,
  scheduleFollowUpReminder,
  notifyDealEvent,
  NOTIFICATION_TYPES
} from './services/notification-service.js';
import {
  PLANS
} from './services/billing-service.js';
import {
  buildWhatsAppLink,
  generateAIOutreachMessages,
  recordWhatsAppContact,
  OUTREACH_TEMPLATES
} from './services/whatsapp-service.js';
import {
  getWebhookConfig,
  regenerateWebhookToken,
  pollWebhookInbox,
  sendTestWebhookLead
} from './services/webhook-service.js';

// ==========================================================================
// Dynamic Cloud Backend API Base URL Resolver
// ==========================================================================
window.getApiBaseUrl = function() {
  if (typeof window === 'undefined') return '';
  const custom = localStorage.getItem('nexus_cloud_backend_url');
  if (custom) return custom.replace(/\/$/, '');

  const host = window.location.hostname;
  // If hosted locally or directly on Render (frontend served by same Node process)
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('onrender.com')) {
    return '';
  }
  // If hosted on Firebase Hosting (*.web.app or *.firebaseapp.com) or static CDN
  return 'https://nexus-crm-yfof.onrender.com';
};

let draggedCustomerId = null;
let activeWhatsAppCustomerId = null;
let activeLeadDetailsCustomerId = null;
let activeProposalCustomerId = null;

// ==========================================================================
// Initialization
// ==========================================================================
async function initApp() {
  try {
    initTheme();
    setupNavigation();
    setupFilterEvents();
    setupDialogEvents();
    setupGeminiModals();
    setupExportEvents();
    setupTasksEvents();
    setupWhatsAppModalEvents();
    setupLossReasonEvents();
    setupLeadDetailsEvents();
    setupBackupEvents();
    setupProposalModalEvents();
    setupImportModalEvents();
    setupAuthPortalEvents();
    setupCommandPalette();
    setupKeyboardShortcuts();
    setupPWA();
    setupHeaderToolsMenu();
    setupEmployeeManagementEvents();
    applyWhitelabelStyles();
    setupWhitelabelEvents();
    setupBillingEvents();
    setupCheckoutModalEvents();
    setupTeamInviteEvents();
    setupAuditTrailView();
    setupNotificationCenter();
    setupWebhookModalEvents();
    setupAccountDialog();
    setupIdleSignOut();

    // Periodic poll for Webhook incoming leads (every 15s)
    setInterval(async () => {
      if (!isSessionActive() || !isAdmin()) return;
      const res = await pollWebhookInbox();
      if (res && res.count > 0) {
        if (crmStore) crmStore.emitChange();
        showToast(`${res.count} novo(s) lead(s) capturado(s) via Webhook!`, 'success');
      }
    }, 15000);

    // Subscribe state store changes to DOM rendering
    crmStore.subscribe((state) => {
      renderKPIs(state.metrics, state.permissions);
      renderKanban(state.filteredCustomers, state.metrics, state.permissions, state.visibleCustomers.length);
      renderTable(state.filteredCustomers, state.permissions);
      renderTasksView(state.tasks, state.taskFilter, state.allCustomers);
      renderDetailedMetrics(state.metrics, state.visibleCustomers, state.permissions);
      renderSecurityView(state);
      renderConnectionStatus(state.storageMode);
      updateNavCounters(state);
      applyRoleUIRestrictions(state.permissions);

      // If lead details modal is currently open, refresh its timeline
      if (activeLeadDetailsCustomerId) {
        const currentCustomer = state.allCustomers.find(c => c.id === activeLeadDetailsCustomerId);
        if (currentCustomer) {
          renderLeadTimeline(currentCustomer);
        } else {
          // The opportunity was deleted while its window was open
          activeLeadDetailsCustomerId = null;
          document.getElementById('lead-details-dialog')?.close();
        }
      }
    });

    // Subscribe storage engine changes to CRM store
    storage.subscribe((customers, mode) => {
      crmStore.setCustomers(customers, mode);
    });

    onAuthChange((user) => {
      renderAuthBadge(user);
      if (crmStore) crmStore.emitChange();
    });

    // Restore the session first (signed-in account, demo, or none): which data is loaded depends on it
    await initAuth();
    if (isIdleTooLong()) {
      await logoutToPortal();
    }
    await enterSession({ resumed: true });
  } catch (err) {
    console.error("Erro crítico na inicialização do Nexus CRM:", err);
    // Assegurar que o container do aplicativo permaneça visível
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.style.display = '';
  }
}

/**
 * Loads everything that belongs to the current session, or shows the sign-in screen when there is none.
 * Called on page load and after every sign-in.
 */
async function enterSession({ resumed = false } = {}) {
  document.body.classList.remove('auth-pending');

  if (!isSessionActive()) {
    stopEmployeeSync();
    storage.reset();
    initAuditFirestore(null);
    window.showAuthPortal();
    if (typeof window.handleAuthHashRouting === 'function') window.handleAuthHashRouting();
    return;
  }

  window.hideAuthPortal();
  markActivity();
  const result = await storage.init();
  await startEmployeeSync().catch((err) => console.warn('Team list could not start:', err));
  initAuditFirestore(isCloudSession() ? getFirestoreDb() : null);

  if (typeof window.refreshTeamInviteCard === 'function') window.refreshTeamInviteCard();
  if (typeof window.navigateToView === 'function') window.navigateToView('pipeline');
  crmStore.emitChange();

  if (isCloudSession() && !result.success) {
    showToast("Não foi possível carregar os dados da empresa. Verifique a conexão e recarregue a página.", "error");
  }

  logAudit(AUDIT_ACTIONS.USER_LOGIN, { method: resumed ? 'session_resume' : (isCloudSession() ? 'email_password' : 'demo') });

  const user = getCurrentUser();
  if (user && user.mustChangePassword) {
    const firstAccessDialog = document.getElementById('first-access-password-dialog');
    const spanName = document.getElementById('first-access-employee-name');
    if (spanName) spanName.textContent = user.name;
    if (firstAccessDialog && !firstAccessDialog.open) firstAccessDialog.showModal();
  }
}

// ==========================================================================
// Account, data export and deletion
// ==========================================================================
function setupAccountDialog() {
  const dialog = document.getElementById('account-dialog');
  const form = document.getElementById('form-account-delete');
  if (!dialog || !form) return;

  const close = () => { form.reset(); dialog.close(); };
  document.getElementById('btn-close-account-dialog')?.addEventListener('click', close);
  document.getElementById('btn-close-account-footer')?.addEventListener('click', close);

  // What has to be typed to confirm: the company name for the owner, the word EXCLUIR otherwise
  const confirmationPhrase = () => (isCompanyOwner() ? (getSavedOrganization().name || '').trim() : 'EXCLUIR');

  document.getElementById('btn-menu-account')?.addEventListener('click', () => {
    const toolsMenu = document.getElementById('header-tools-menu');
    if (toolsMenu) toolsMenu.style.display = 'none';

    const user = getCurrentUser();
    const org = getSavedOrganization();
    const cloud = isCloudSession();
    const owner = isCompanyOwner();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };

    set('account-summary', user ? `${user.name}, ${user.email}. ${isAdmin() ? 'Administrador' : 'Vendedor'} em ${org.name}.` : '');
    show('account-terms', cloud);
    show('account-export-block', isAdmin());
    show('account-delete-block', cloud);
    show('account-demo-note', !cloud);

    if (cloud) {
      set('account-delete-title', owner ? 'Excluir a empresa e todos os dados' : 'Excluir a minha conta');
      set('account-delete-text', owner
        ? 'Apaga para sempre todos os clientes, oportunidades, históricos, a equipe e a sua conta. Não dá para desfazer. Baixe os dados antes, se precisar deles.'
        : 'Apaga o seu acesso e os seus dados de cadastro. As oportunidades que você atendia continuam com a empresa. Não dá para desfazer.');
      set('account-delete-phrase-label', owner ? `Digite o nome da empresa: ${confirmationPhrase()}` : 'Digite EXCLUIR');
    }
    dialog.showModal();
  });

  document.getElementById('btn-account-export')?.addEventListener('click', () => {
    if (typeof window.handleDownloadBackup === 'function') window.handleDownloadBackup();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('account-delete-password').value;
    const typed = document.getElementById('account-delete-phrase').value.trim();
    if (typed !== confirmationPhrase()) {
      showToast('O texto de confirmação não confere.', 'error');
      return;
    }

    const button = document.getElementById('btn-account-delete');
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      if (isCompanyOwner()) {
        await deleteCompany(password);
      } else {
        await deleteOwnAccount(password);
      }
      clearCompanyDataFromBrowser();
      close();
      await enterSession();
      showToast('Conta excluída. Os dados foram apagados.', 'info');
    } catch (err) {
      showToast(describeAuthError(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Excluir definitivamente';
    }
  });
}

// A signed-in account left untouched for hours is signed out, so an unattended
// computer does not keep the company's data open.
function setupIdleSignOut() {
  let lastMark = 0;
  const onActivity = () => {
    const now = Date.now();
    if (now - lastMark > 60000) {
      lastMark = now;
      markActivity();
    }
  };
  ['click', 'keydown', 'pointerdown'].forEach(evt => document.addEventListener(evt, onActivity, { passive: true }));

  const check = async () => {
    if (!isCloudSession() || !isIdleTooLong()) return;
    await logoutToPortal();
    clearCompanyDataFromBrowser();
    await enterSession();
    showToast('Você ficou muito tempo sem usar o CRM e a sessão foi encerrada. Entre de novo.', 'info');
  };
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

// Nothing that belongs to a company stays in this browser after its session ends.
// Kept on purpose: theme, the Gemini key and the webhook token (device settings),
// and the demo's sample data.
function clearCompanyDataFromBrowser() {
  [
    'nexus_crm_audit_logs',
    'nexus_crm_notifications',
    'nexus_crm_ai_usage_metrics',
    'nexus_crm_last_activity',
    'nexus_jwt_token',
    'nexus_tenant_id'
  ].forEach(key => localStorage.removeItem(key));
}

/**
 * People a lead can be assigned to in the current session
 */
function getAssignableMembers() {
  const active = getEmployees().filter(e => e.status !== 'blocked');
  if (isCloudSession()) {
    const me = getCurrentUser();
    const self = { id: me.uid, name: me.name, email: me.email, jobTitle: isAdmin() ? 'Administrador' : 'Vendedor' };
    return isAdmin() ? [self, ...active] : [self];
  }
  const demoAdmin = SALES_TEAM.find(m => m.role === 'admin');
  return [...active, { ...demoAdmin, jobTitle: 'Administrador' }];
}

function fillAssigneeSelect(select, selectedEmail) {
  const members = getAssignableMembers();
  select.innerHTML = members.map(m => `
    <option value="${escapeHtml(m.email)}">${escapeHtml(m.name)} (${escapeHtml(m.jobTitle || 'Vendedor')})</option>
  `).join('');
  const wanted = members.find(m => m.email === selectedEmail);
  select.value = wanted ? wanted.email : (members[0] ? members[0].email : '');
}

// Inicialização imediata se o DOM já estiver pronto, ou no evento DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function applyRoleUIRestrictions(permissions) {
  const geminiBtn = document.getElementById('sidebar-gemini-btn');
  const exportBtn = document.getElementById('btn-export-csv');

  const isAdmin = !!permissions.isAdmin;

  // 1. Restrição das abas exclusivas do Administrador: Equipe & Convites, Auditoria e Tríade CID
  const navTeam = document.getElementById('nav-item-team') || document.querySelector('.nav-item[data-view="team"]')?.closest('li');
  const navAudit = document.getElementById('nav-item-audit') || document.querySelector('.nav-item[data-view="audit"]')?.closest('li');
  const navSecurity = document.getElementById('nav-item-security') || document.querySelector('.nav-item[data-view="security"]')?.closest('li');

  if (navTeam) navTeam.style.display = isAdmin ? '' : 'none';
  if (navAudit) navAudit.style.display = isAdmin ? '' : 'none';
  if (navSecurity) navSecurity.style.display = isAdmin ? '' : 'none';

  // Se o usuário não for admin e estiver em uma das abas protegidas, redireciona imediatamente para o funil
  const adminOnlyViews = ['team', 'audit', 'security'];
  const state = crmStore.getState();
  if (!isAdmin && adminOnlyViews.includes(state.activeView)) {
    if (window.navigateToView) {
      window.navigateToView('pipeline');
    }
  }

  // 2. Menu de Ferramentas da Barra Lateral (Governança exclusiva de Administrador)
  const btnMenuExportAudit = document.getElementById('btn-menu-export-audit');
  const btnMenuBilling = document.getElementById('btn-menu-billing');
  const btnMenuWhitelabel = document.getElementById('btn-menu-whitelabel');
  const btnMenuWebhook = document.getElementById('btn-menu-webhook');
  const groupCompany = document.getElementById('tools-group-company');
  const dividerCompany = document.getElementById('tools-divider-company');

  if (btnMenuExportAudit) btnMenuExportAudit.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuBilling) btnMenuBilling.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuWhitelabel) btnMenuWhitelabel.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuWebhook) btnMenuWebhook.style.display = isAdmin ? 'flex' : 'none';
  if (groupCompany) groupCompany.style.display = isAdmin ? 'block' : 'none';
  if (dividerCompany) dividerCompany.style.display = isAdmin ? 'block' : 'none';

  // Oculta área de faturamento e configuração de PIX para funcionários

  const adminSettingsSection = document.getElementById('chk-admin-settings-section');
  // Where subscription payments go is the platform operator's setting, not each customer's
  const isPlatformOwner = localStorage.getItem('nexus_platform_owner') === '1';
  if (adminSettingsSection) adminSettingsSection.style.display = (isAdmin && isPlatformOwner) ? 'block' : 'none';

  // 3. Configurações de Nuvem & IA (Gemini / Firebase)
  if (permissions.canAccessCloudConfig) {
    if (geminiBtn) {
      geminiBtn.style.opacity = '1';
      geminiBtn.title = 'Configuração da Chave Gemini AI';
      geminiBtn.disabled = false;
    }
  } else {
    // Restrito para Funcionários pela Confidencialidade (Tríade CID)
    if (geminiBtn) {
      geminiBtn.style.opacity = '0.4';
      geminiBtn.title = 'Só administradores configuram a IA';
    }
  }

  if (exportBtn) {
    if (permissions.canExportAll) {
      exportBtn.title = 'Exportar base completa para CSV';
    } else {
      exportBtn.title = 'Exportar meus leads atribuídos para CSV (Confidencialidade)';
    }
  }
}

// Switches between the two sample profiles. Real accounts keep the role their company gave them.
window.handleToggleRole = async function() {
  if (!isDemoSession()) return;
  const role = getCurrentRole();
  const nextRole = role === USER_ROLES.ADMIN ? USER_ROLES.EMPLOYEE : USER_ROLES.ADMIN;
  setUserRole(nextRole);
  await storage.init();
  logAudit(AUDIT_ACTIONS.ROLE_SWITCHED, { fromRole: role, toRole: nextRole });
  showToast(nextRole === USER_ROLES.ADMIN
    ? "Agora você vê a demonstração como administrador."
    : "Agora você vê a demonstração como vendedor.", "info");
};

// ==========================================================================
// Navigation & Views
// ==========================================================================
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const viewSections = document.querySelectorAll('.view-section');

  window.navigateToView = function(targetView) {
    const adminOnlyViews = ['team', 'audit', 'security'];
    const state = crmStore.getState();
    const isAdmin = !!state.permissions?.isAdmin;

    if (adminOnlyViews.includes(targetView) && !isAdmin) {
      showToast('Equipe, Auditoria e Segurança são só para administradores.', 'warning');
      targetView = 'pipeline';
    }

    navItems.forEach(n => n.classList.remove('active'));
    const item = document.querySelector(`.nav-item[data-view="${targetView}"]`);
    if (item) item.classList.add('active');

    viewSections.forEach(section => {
      section.classList.toggle('active', section.id === `view-${targetView}`);
    });

    // Update header title
    const pageTitle = document.getElementById('current-page-title');
    if (pageTitle && item) {
      pageTitle.textContent = item.dataset.title || 'Pipeline de Vendas';
    }

    document.body.dataset.view = targetView;
    crmStore.setActiveView(targetView);
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.dataset.view;
      window.navigateToView(targetView);
    });
  });

  // Deep linking and hash navigation protection
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    if (hash && !hash.startsWith('checkout') && !hash.startsWith('register')) {
      const validViews = ['pipeline', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security'];
      if (validViews.includes(hash)) {
        window.navigateToView(hash);
      }
    }
  });

  // Initialize view from URL hash if present
  const initialHash = window.location.hash.replace('#', '').split('?')[0];
  const validInitialViews = ['pipeline', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security'];
  if (initialHash && validInitialViews.includes(initialHash)) {
    window.navigateToView(initialHash);
  }
}

function updateNavCounters(state) {
  const pipelineCount = document.getElementById('nav-count-pipeline');
  const customersCount = document.getElementById('nav-count-customers');
  const tasksCount = document.getElementById('nav-count-tasks');

  if (pipelineCount) pipelineCount.textContent = state.allCustomers.length;
  if (customersCount) customersCount.textContent = state.allCustomers.length;
  if (tasksCount) {
    const pendingCount = (state.tasks || []).filter(t => !t.completed).length;
    tasksCount.textContent = pendingCount;
  }

  // Update team counter
  const teamCount = document.getElementById('nav-count-team');
  if (teamCount) {
    const employees = getEmployees();
    teamCount.textContent = employees.length;
  }

  // Update audit counter
  const auditCount = document.getElementById('nav-count-audit');
  if (auditCount) {
    const stats = getAuditStats();
    auditCount.textContent = stats.todayLogs;
  }
}

// ==========================================================================
// Filters & Search
// ==========================================================================
function setupFilterEvents() {
  const searchInput = document.getElementById('global-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      crmStore.setSearchQuery(e.target.value);
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
  event.currentTarget.classList.add('dragging');
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

  try {
    await storage.updateStage(customerId, targetStage);
    const stageObj = STAGES.find(s => s.id === targetStage);
    const cust = storage.getCustomer(customerId);
    showToast(`Oportunidade movida para "${stageObj ? stageObj.name : targetStage}".`, "success");

    // Audit & Notification
    if (targetStage === 'won') {
      logAudit(AUDIT_ACTIONS.LEAD_WON, { customerId, name: cust?.name, value: cust?.dealValue || 0 });
      notifyDealEvent(NOTIFICATION_TYPES.DEAL_WON, cust?.name || 'Cliente', cust?.dealValue || 0);
    } else {
      logAudit(AUDIT_ACTIONS.LEAD_STAGE_CHANGED, { customerId, name: cust?.name, newStage: targetStage });
      notifyDealEvent(NOTIFICATION_TYPES.LEAD_UPDATE, cust?.name || 'Cliente');
    }

    setTimeout(() => window.scrollToKanbanStage(targetStage), 100);
  } catch (err) {
    showToast("Erro ao mover estágio: " + err.message, "error");
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

  try {
    await storage.updateStage(customerId, newStage);
    const stageObj = STAGES.find(s => s.id === newStage);
    showToast(`Oportunidade movida para "${stageObj ? stageObj.name : newStage}".`, "success");

    // Audit & Notification
    if (newStage === 'won') {
      logAudit(AUDIT_ACTIONS.LEAD_WON, { customerId, name: cust?.name, value: cust?.dealValue || 0 });
      notifyDealEvent(NOTIFICATION_TYPES.DEAL_WON, cust?.name || 'Cliente', cust?.dealValue || 0);
    } else {
      logAudit(AUDIT_ACTIONS.LEAD_STAGE_CHANGED, { customerId, name: cust?.name, newStage });
    }

    setTimeout(() => window.scrollToKanbanStage(newStage), 100);
  } catch (err) {
    // Revert select back to previous stage
    const select = document.querySelector(`.lead-card[data-id="${customerId}"] .move-stage-select`);
    if (select && currentStage) select.value = currentStage;
    showToast("Erro ao mover oportunidade: " + err.message, "error");
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
function setupLossReasonEvents() {
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
        const select = document.querySelector(`.lead-card[data-id="${activeLossCustomerId}"] .move-stage-select`);
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
        // Store the reason id (the metrics group by id); the label is resolved when displaying
        await storage.setLossReason(customerId, reasonVal, details);
        logAudit(AUDIT_ACTIONS.LEAD_LOST, { customerId, name: cust?.name, reason: reasonLabel, details }, AUDIT_SEVERITY.INFO);
        notifyDealEvent(NOTIFICATION_TYPES.DEAL_LOST, cust?.name || 'Cliente', cust?.dealValue || 0);
        activeLossCustomerId = null;
        dialog.close();
        showToast("Oportunidade arquivada como perdida.", "info");
        setTimeout(() => window.scrollToKanbanStage('lost'), 100);
      } catch (err) {
        showToast("Erro ao registrar perda: " + err.message, "error");
      }
    });
  }
}

// ==========================================================================
// WhatsApp Templates & AI Outreach Assistant Modal
// ==========================================================================
function setupWhatsAppModalEvents() {
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
      showToast('Esta oportunidade não possui número de telefone cadastrado.', 'error');
      return;
    }

    activeWhatsAppCustomerId = customerId;
    const org = getSavedOrganization();
    const user = getCurrentUser();

    if (leadNameEl) leadNameEl.textContent = customer.name;
    if (leadMetaEl) {
      const stageName = (STAGES.find(s => s.id === customer.stage) || {}).name || customer.stage;
      leadMetaEl.textContent = `${customer.company || 'Pessoa Física'} • Funil: ${stageName}`;
    }
    if (leadPhoneEl) leadPhoneEl.textContent = phone;

    // Render fast templates
    renderTemplatesList([
      { tone: 'Primeiro Contato', text: OUTREACH_TEMPLATES.first_contact.template(customer, user, org.name) },
      { tone: 'Acompanhamento de Proposta', text: OUTREACH_TEMPLATES.proposal_followup.template(customer, user, org.name) },
      { tone: 'Quebra de Objeção', text: OUTREACH_TEMPLATES.negotiation.template(customer, user, org.name) },
      { tone: 'Reativação de Lead', text: OUTREACH_TEMPLATES.cold_lead.template(customer, user, org.name) }
    ], customer);

    if (dialog) dialog.showModal();
  };

  function renderTemplatesList(items, customer) {
    if (!templatesContainer) return;
    templatesContainer.innerHTML = items.map((item, idx) => `
      <div class="wa-template-card ${idx === 0 ? 'selected' : ''}" style="background: var(--bg-surface-elevated, #1f2533); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.6rem 0.85rem; cursor: pointer; transition: all 150ms ease;" data-idx="${idx}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
          <strong style="font-size: 0.78rem; color: var(--color-primary, #3b82f6);">${escapeHtml(item.tone)}</strong>
          <span style="font-size: 0.68rem; color: var(--text-muted);">Clique para selecionar</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(item.text)}
        </div>
      </div>
    `).join('');

    // Set first message
    if (items[0] && messagePreview) {
      messagePreview.value = items[0].text;
      if (charCountEl) charCountEl.textContent = `${items[0].text.length} caracteres`;
    }

    // Attach click events
    const cards = templatesContainer.querySelectorAll('.wa-template-card');
    cards.forEach((card, idx) => {
      card.addEventListener('click', () => {
        cards.forEach(c => {
          c.classList.remove('selected');
          c.style.borderColor = 'var(--border-color)';
        });
        card.classList.add('selected');
        card.style.borderColor = 'var(--color-primary, #3b82f6)';
        if (items[idx] && messagePreview) {
          messagePreview.value = items[idx].text;
          if (charCountEl) charCountEl.textContent = `${items[idx].text.length} caracteres`;
        }
      });
    });
  }

  // AI Generator button
  if (btnGenerateAi) {
    btnGenerateAi.addEventListener('click', async () => {
      const customer = storage.getCustomer(activeWhatsAppCustomerId);
      if (!customer) return;

      btnGenerateAi.disabled = true;
      btnGenerateAi.textContent = 'Criando abordagens personalizadas com Gemini...';

      const org = getSavedOrganization();
      const user = getCurrentUser();

      try {
        const aiOptions = await generateAIOutreachMessages(customer, {
          companyName: org.name,
          userName: user?.name
        });

        renderTemplatesList(aiOptions, customer);
        showToast('3 Novas opções de abordagem geradas pela IA!', 'success');
      } catch (err) {
        showToast('Erro ao gerar com IA: ' + err.message, 'error');
      } finally {
        btnGenerateAi.disabled = false;
        btnGenerateAi.textContent = 'Gerar com IA Gemini';
      }
    });
  }

  // Copy button
  if (btnCopy && messagePreview) {
    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(messagePreview.value);
        showToast('Mensagem copiada para a área de transferência!', 'success');
      } catch {
        messagePreview.select();
        document.execCommand('copy');
        showToast('Mensagem selecionada e copiada!', 'success');
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
        showToast('Número de WhatsApp inválido para envio.', 'error');
        return;
      }

      // Log contact action
      recordWhatsAppContact(customer, message);
      await storage.addActivity(customer.id, {
        type: 'whatsapp',
        title: 'Mensagem de WhatsApp Enviada',
        text: message
      });

      // Open WhatsApp Web
      window.open(link, '_blank');
      closeDialog();
      showToast('Conversa aberta no WhatsApp Web e registrada no histórico!', 'success');
    });
  }
}

// ==========================================================================
// Webhook & Lead Ingestion Modal
// ==========================================================================
function setupWebhookModalEvents() {
  const dialog = document.getElementById('webhook-dialog');
  const btnOpen = document.getElementById('btn-menu-webhook');
  const btnClose = document.getElementById('btn-close-webhook-dialog');
  const btnCloseFooter = document.getElementById('btn-close-webhook-footer');

  const urlInput = document.getElementById('webhook-url-input');
  const tokenInput = document.getElementById('webhook-token-input');
  const btnCopyUrl = document.getElementById('btn-copy-webhook-url');
  const btnCopyToken = document.getElementById('btn-copy-webhook-token');
  const btnToggleToken = document.getElementById('btn-toggle-show-token');
  const btnRegenerateToken = document.getElementById('btn-regenerate-webhook-token');
  const btnSendTest = document.getElementById('btn-send-test-webhook');

  function updateFields() {
    const cfg = getWebhookConfig();
    if (urlInput) {
      const base = typeof window.getApiBaseUrl === 'function' && window.getApiBaseUrl() ? window.getApiBaseUrl() : window.location.origin;
      urlInput.value = `${base}/api/webhook/leads`;
    }
    if (tokenInput) {
      tokenInput.value = cfg.token;
    }
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      updateFields();
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';
      dialog.showModal();
    });
  }

  const closeDialog = () => dialog && dialog.close();
  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDialog);

  if (btnCopyUrl && urlInput) {
    btnCopyUrl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(urlInput.value);
        showToast('URL do Webhook copiada!', 'success');
      } catch {
        urlInput.select();
        document.execCommand('copy');
        showToast('URL do Webhook selecionada/copiada!', 'success');
      }
    });
  }

  if (btnCopyToken && tokenInput) {
    btnCopyToken.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tokenInput.value);
        showToast('Token do Webhook copiado!', 'success');
      } catch {
        tokenInput.select();
        document.execCommand('copy');
        showToast('Token selecionado/copiado!', 'success');
      }
    });
  }

  if (btnToggleToken && tokenInput) {
    btnToggleToken.addEventListener('click', () => {
      const isPassword = tokenInput.type === 'password';
      tokenInput.type = isPassword ? 'text' : 'password';
      btnToggleToken.textContent = isPassword ? 'Ocultar' : 'Ver';
    });
  }

  if (btnRegenerateToken) {
    btnRegenerateToken.addEventListener('click', () => {
      const newToken = regenerateWebhookToken();
      if (tokenInput) tokenInput.value = newToken;
      showToast('Novo token gerado e ativado com segurança!', 'info');
    });
  }

  if (btnSendTest) {
    btnSendTest.addEventListener('click', async () => {
      btnSendTest.disabled = true;
      btnSendTest.textContent = 'Enviando lead de teste...';
      try {
        const res = await sendTestWebhookLead();
        if (crmStore) crmStore.emitChange();
        showToast(`Lead de teste (${res.lead.name}) recebido e adicionado ao funil!`, 'success');
      } catch (err) {
        showToast('Erro ao disparar teste: ' + err.message, 'error');
      } finally {
        btnSendTest.disabled = false;
        btnSendTest.textContent = 'Simular Envio de Lead via Webhook';
      }
    });
  }
}

// ==========================================================================
// Lead Details & Activity Timeline Modal
// ==========================================================================
function setupLeadDetailsEvents() {
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

    activeLeadDetailsCustomerId = customerId;
    renderLeadTimeline(customer);
    dialog.showModal();
  };

  // Quick activity logging buttons
  const quickFormContainer = document.getElementById('quick-activity-form-container');
  const quickTitle = document.getElementById('quick-activity-title');
  const quickType = document.getElementById('quick-activity-type');
  const quickText = document.getElementById('quick-activity-text');
  const btnSaveQuick = document.getElementById('btn-save-quick-activity');
  const btnCancelQuick = document.getElementById('btn-cancel-quick-activity');

  const openQuickForm = (type, title) => {
    quickType.value = type;
    quickTitle.textContent = title;
    quickText.value = '';
    quickFormContainer.style.display = 'block';
    quickText.focus();
  };

  const btnLogCall = document.getElementById('btn-quick-log-call');
  const btnLogMeeting = document.getElementById('btn-quick-log-meeting');
  const btnLogNote = document.getElementById('btn-quick-log-note');

  if (btnLogCall) btnLogCall.addEventListener('click', () => openQuickForm('call', 'Registrar Ligação Telefônica'));
  if (btnLogMeeting) btnLogMeeting.addEventListener('click', () => openQuickForm('meeting', 'Registrar Reunião Comercial'));
  if (btnLogNote) btnLogNote.addEventListener('click', () => openQuickForm('note', 'Adicionar Nota Interna'));

  if (btnCancelQuick) {
    btnCancelQuick.addEventListener('click', () => {
      quickFormContainer.style.display = 'none';
    });
  }

  if (btnSaveQuick) {
    btnSaveQuick.addEventListener('click', async () => {
      if (!activeLeadDetailsCustomerId) return;
      const text = quickText.value.trim();
      if (!text) {
        showToast("Digite o conteúdo da interação.", "error");
        return;
      }

      const type = quickType.value;
      const titleMap = {
        call: 'Ligação Telefônica Realizada',
        meeting: 'Reunião Comercial Realizada',
        note: 'Nota Interna Adicionada'
      };

      await storage.addActivity(activeLeadDetailsCustomerId, {
        type,
        title: titleMap[type] || 'Interação',
        text
      });

      quickFormContainer.style.display = 'none';
      const updatedCustomer = storage.getCustomer(activeLeadDetailsCustomerId);
      if (updatedCustomer) renderLeadTimeline(updatedCustomer);
      showToast("Interação registrada com sucesso!", "success");
    });
  }
}

// ==========================================================================
// Tasks Management (Activity-Based Selling)
// ==========================================================================
function setupTasksEvents() {
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
        await storage.addTask(customerId, { title, type, dueDate });
        const cust = storage.getCustomer(customerId);
        scheduleFollowUpReminder({ id: customerId, name: cust?.name || 'Cliente' }, dueDate, title);
        taskForm.reset();
        document.getElementById('task-input-date').value = new Date().toISOString().split('T')[0];
        showToast("Tarefa comercial agendada com sucesso!", "success");
      } catch (err) {
        showToast("Erro ao agendar tarefa: " + err.message, "error");
      }
    });

    // Default task date to today
    const dateInput = document.getElementById('task-input-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  }

  window.handleToggleTask = async function(customerId, taskId) {
    try {
      await storage.toggleTask(customerId, taskId);
      showToast("Status da tarefa atualizado.", "success");
    } catch (err) {
      showToast("Erro ao atualizar tarefa: " + err.message, "error");
    }
  };
}

// ==========================================================================
// Security & Input Sanitization Engine (Tríade CID: Integridade)
// ==========================================================================
function sanitizeInput(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[<>]/g, '') // Strip angle brackets to eliminate stored HTML/XSS injection at ingress
    .trim();
}

function parseSafeDealValue(val) {
  if (!val) return 0;
  const cleaned = String(val).replace(/[^\d.,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) || num < 0 ? 0 : Math.min(num, 1000000000);
}

// ==========================================================================
// Customer Dialog (Add / Edit)
// ==========================================================================
function setupDialogEvents() {
  const customerDialog = document.getElementById('customer-dialog');
  const customerForm = document.getElementById('customer-form');
  const btnNewLead = document.getElementById('btn-new-lead');
  const btnBottomRightLead = document.getElementById('btn-bottom-right-lead');
  const btnCloseDialog = document.getElementById('btn-close-customer-dialog');
  const btnCancelDialog = document.getElementById('btn-cancel-customer-dialog');

  const openNewLead = () => {
    if (!customerDialog) return;
    document.getElementById('dialog-customer-id').value = '';
    document.getElementById('customer-dialog-title').textContent = 'Nova oportunidade';
    customerForm.reset();
    document.getElementById('input-deal-stage').value = 'lead';
    document.getElementById('input-deal-priority').value = 'medium';
    document.getElementById('input-deal-forecast').value = '';
    const assignedSelect = document.getElementById('input-customer-assigned');
    if (assignedSelect) {
      fillAssigneeSelect(assignedSelect, getCurrentUser()?.email);
    }
    customerDialog.showModal();
    document.getElementById('input-customer-name').focus();
  };

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
        assignedTo: {
          id: assignedMember.id,
          name: assignedMember.name,
          email: assignedMember.email
        }
      };

      if (id) {
        customerPayload.id = id;
      }

      try {
        await storage.saveCustomer(customerPayload);
        customerDialog.close();
        showToast(id ? "Oportunidade atualizada." : "Oportunidade criada.", "success");

        // Audit & Notification
        if (id) {
          logAudit(AUDIT_ACTIONS.LEAD_UPDATED, { customerId: id, name, company, dealValue, stage });
          notifyDealEvent(NOTIFICATION_TYPES.LEAD_UPDATE, name, dealValue);
        } else {
          logAudit(AUDIT_ACTIONS.LEAD_CREATED, { name, company, dealValue, stage });
          notifyDealEvent(NOTIFICATION_TYPES.LEAD_UPDATE, name, dealValue);
        }

        setTimeout(() => {
          window.scrollToKanbanStage(stage || 'lead');
        }, 150);
      } catch (err) {
        showToast("Erro ao salvar: " + err.message, "error");
      }
    });
  }
}

window.handleOpenEditCustomer = function(customerId) {
  const customerDialog = document.getElementById('customer-dialog');
  const customer = storage.getCustomer(customerId);
  if (!customer || !customerDialog) return;

  document.getElementById('dialog-customer-id').value = customer.id;
  document.getElementById('customer-dialog-title').textContent = 'Editar oportunidade';
  document.getElementById('input-customer-name').value = customer.name || '';
  document.getElementById('input-customer-company').value = customer.company || '';
  document.getElementById('input-customer-role').value = customer.role || '';
  document.getElementById('input-customer-email').value = customer.email || '';
  document.getElementById('input-customer-phone').value = customer.phone || '';
  document.getElementById('input-deal-value').value = customer.dealValue || 0;
  document.getElementById('input-deal-stage').value = customer.stage || 'lead';
  document.getElementById('input-deal-priority').value = customer.priority || 'medium';
  document.getElementById('input-deal-forecast').value = customer.expectedCloseDate ? customer.expectedCloseDate.split('T')[0] : '';
  document.getElementById('input-customer-tags').value = (customer.tags || []).join(', ');
  document.getElementById('input-customer-notes').value = customer.notes || '';

  const assignedSelect = document.getElementById('input-customer-assigned');
  if (assignedSelect) {
    fillAssigneeSelect(assignedSelect, customer.assignedTo?.email);
  }

  customerDialog.showModal();
};

window.handleDeleteCustomer = async function(customerId) {
  if (!isAdmin()) {
    showToast("Só administradores podem excluir oportunidades.", "error");
    logAudit(AUDIT_ACTIONS.PERMISSION_DENIED, { action: 'delete_customer', customerId }, AUDIT_SEVERITY.WARNING);
    return;
  }

  if (!confirm("Excluir esta oportunidade? A exclusão fica registrada na auditoria e não pode ser desfeita.")) return;
  try {
    const cust = storage.getCustomer(customerId);
    await storage.deleteCustomer(customerId);
    logAudit(AUDIT_ACTIONS.LEAD_DELETED, { customerId, name: cust?.name, company: cust?.company }, AUDIT_SEVERITY.WARNING);
    showToast("Oportunidade excluída.", "info");
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
};

// ==========================================================================
// Firebase Configuration Dialog
// ==========================================================================
// ==========================================================================
// Gemini AI Modals & Handlers
// ==========================================================================
function setupGeminiModals() {
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
      showToast(key ? "Chave do Google Gemini salva com sucesso!" : "Chave do Gemini removida. Usando motor heurístico.", "success");
    });
  }
}

window.handleAnalyzeWithAI = async function(customerId) {
  const geminiDialog = document.getElementById('gemini-dialog');
  const customer = storage.getCustomer(customerId);
  if (!customer || !geminiDialog) return;

  // Header info
  document.getElementById('gemini-dialog-customer-name').textContent = customer.name;
  document.getElementById('gemini-dialog-customer-meta').textContent = `${customer.company || 'Empresa'} • R$ ${Number(customer.dealValue || 0).toLocaleString('pt-BR')}`;

  // Reset to loading state
  document.getElementById('gemini-loading').style.display = 'block';
  document.getElementById('gemini-results').style.display = 'none';
  geminiDialog.showModal();

  try {
    const analysis = await analyzeDealWithGemini(customer);

    // Probability
    const prob = Math.round(analysis.probability || 0);
    document.getElementById('gemini-probability-number').textContent = `${prob}%`;
    document.getElementById('gemini-probability-bar').style.width = `${prob}%`;
    document.getElementById('gemini-summary-text').textContent = analysis.summary || '';

    // Keypoints
    const keypointsList = document.getElementById('gemini-keypoints-list');
    keypointsList.innerHTML = (analysis.keyPoints || []).map(p => `<li>${p}</li>`).join('');

    // Objections
    const objectionsList = document.getElementById('gemini-objections-list');
    objectionsList.innerHTML = (analysis.objections || []).map(o => `<li>${o}</li>`).join('');

    // Recommended Action
    document.getElementById('gemini-recommended-action').textContent = analysis.recommendedAction || 'Dar continuidade ao contato comercial.';

    // Email Draft
    document.getElementById('gemini-email-draft').textContent = analysis.proposalEmail || '';

    // Show results
    document.getElementById('gemini-loading').style.display = 'none';
    document.getElementById('gemini-results').style.display = 'block';
  } catch (err) {
    showToast("Erro ao processar análise da IA: " + err.message, "error");
    geminiDialog.close();
  }
};

// ==========================================================================
// Whitelabel & Branding Customizer
// ==========================================================================
function setupWhitelabelEvents() {
  const dialog = document.getElementById('whitelabel-dialog');
  const btnOpen = document.getElementById('btn-menu-whitelabel');
  const btnClose = document.getElementById('btn-close-whitelabel-dialog');
  const form = document.getElementById('form-whitelabel');
  const btnReset = document.getElementById('btn-whitelabel-reset');

  const inputName = document.getElementById('whitelabel-input-name');
  const inputLegal = document.getElementById('whitelabel-input-legal');
  const inputLogo = document.getElementById('whitelabel-input-logo');
  const fileLogo = document.getElementById('whitelabel-file-logo');
  const inputColor = document.getElementById('whitelabel-input-color');
  const colorBtns = document.querySelectorAll('.whitelabel-color-btn');

  const previewName = document.getElementById('whitelabel-preview-name');
  const previewIcon = document.getElementById('whitelabel-preview-icon');

  function updatePreview(name, logo, color) {
    if (previewName) previewName.textContent = name || 'Nexus CRM';
    if (previewIcon) {
      if (color) previewIcon.style.background = color;
      if (logo) {
        previewIcon.innerHTML = `<img src="${logo}" style="width: 100%; height: 100%; object-fit: contain;">`;
      } else {
        previewIcon.textContent = (name || 'N').charAt(0).toUpperCase();
      }
    }
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      const org = getSavedOrganization();
      if (inputName) inputName.value = org.name || '';
      if (inputLegal) inputLegal.value = org.legalName || '';
      if (inputLogo) inputLogo.value = org.logoUrl || '';
      if (inputColor) inputColor.value = org.brandColor || '#3b82f6';
      
      updatePreview(org.name, org.logoUrl, org.brandColor);

      // Close tools dropdown if open
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';

      dialog.showModal();
    });
  }

  if (inputName) {
    inputName.addEventListener('input', () => {
      updatePreview(inputName.value, inputLogo?.value, inputColor?.value);
    });
  }

  if (inputLogo) {
    inputLogo.addEventListener('input', () => {
      updatePreview(inputName?.value, inputLogo.value, inputColor?.value);
    });
  }

  if (fileLogo) {
    fileLogo.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const base64 = evt.target.result;
          if (inputLogo) inputLogo.value = base64;
          updatePreview(inputName?.value, base64, inputColor?.value);
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Color preset buttons
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const color = btn.getAttribute('data-color');
      if (inputColor) inputColor.value = color;
      updatePreview(inputName?.value, inputLogo?.value, color);
    });
  });

  if (inputColor) {
    inputColor.addEventListener('input', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      updatePreview(inputName?.value, inputLogo?.value, inputColor.value);
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => dialog && dialog.close());
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const defaultOrg = {
        name: 'Empresa Exemplo',
        legalName: 'Nexus Soluções Comerciais e Tecnologia Ltda',
        logoUrl: '',
        brandColor: '#3b82f6'
      };
      saveOrganization(defaultOrg);
      if (inputName) inputName.value = defaultOrg.name;
      if (inputLegal) inputLegal.value = defaultOrg.legalName;
      if (inputLogo) inputLogo.value = '';
      if (inputColor) inputColor.value = defaultOrg.brandColor;
      updatePreview(defaultOrg.name, '', defaultOrg.brandColor);
      showToast("Identidade visual restaurada para o padrão!", "info");
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const org = getSavedOrganization();
      const updated = {
        ...org,
        name: inputName?.value.trim() || 'Nexus CRM',
        legalName: inputLegal?.value.trim() || '',
        logoUrl: inputLogo?.value.trim() || '',
        brandColor: inputColor?.value || '#3b82f6'
      };
      saveOrganization(updated);
      dialog.close();
      showToast("Identidade visual atualizada com sucesso!", "success");
    });
  }
}


// ==========================================================================
// Export CSV Events
// ==========================================================================
function setupExportEvents() {
  const btnExport = document.getElementById('btn-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const customers = crmStore.getState().filteredCustomers;
      try {
        exportCustomersToCSV(customers);
        logAudit(AUDIT_ACTIONS.DATA_EXPORTED, { type: 'customers_csv', count: customers.length });
        showToast("Planilha CSV exportada com sucesso!", "success");
      } catch (err) {
        showToast("Erro ao exportar: " + err.message, "error");
      }
    });
  }
}

// ==========================================================================
// Disaster Recovery & Backup Events (Tríade CID: Disponibilidade)
// ==========================================================================
function setupBackupEvents() {
  const backupFileInput = document.getElementById('backup-file-input');

  window.handleDownloadBackup = function() {
    try {
      const snapshot = storage.createBackupSnapshot();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snapshot, null, 2));
      const downloadAnchor = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `nexus_crm_backup_${timestamp}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      logAudit(AUDIT_ACTIONS.BACKUP_CREATED, { totalCustomers: snapshot?.customers?.length || 0 });
      showToast("Snapshot de contingência exportado com sucesso!", "success");
    } catch (err) {
      showToast("Erro ao exportar backup: " + err.message, "error");
    }
  };

  window.handleTriggerRestoreBackup = function() {
    if (!isAdmin()) {
      showToast("Só administradores podem restaurar uma cópia de segurança.", "error");
      logAudit(AUDIT_ACTIONS.PERMISSION_DENIED, { action: 'restore_backup' }, AUDIT_SEVERITY.WARNING);
      return;
    }
    if (backupFileInput) backupFileInput.click();
  };

  if (backupFileInput) {
    backupFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          await storage.restoreBackupSnapshot(data);
          logAudit(AUDIT_ACTIONS.BACKUP_RESTORED, { restoredCustomers: data?.customers?.length || 0 }, AUDIT_SEVERITY.WARNING);
          showToast("Banco restaurado com sucesso a partir do snapshot!", "success");
        } catch (err) {
          showToast("Falha na restauração do backup: " + err.message, "error");
        } finally {
          backupFileInput.value = '';
        }
      };
      reader.onerror = () => {
        showToast("Erro ao ler o arquivo de backup.", "error");
        backupFileInput.value = '';
      };
      reader.readAsText(file);
    });
  }
}


// ==========================================================================
// Proposal Modal Events (One-Click Proposal & PDF Print)
// ==========================================================================
function setupProposalModalEvents() {
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
    set('prop-scope-text', customer.notes || 'Escreva nas anotações da oportunidade o que está sendo proposto: esse texto aparece aqui.');
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
      const link = getWhatsAppLink(customer.phone, msg);
      if (link) {
        await storage.addActivity(customer.id, {
          type: 'whatsapp',
          title: 'Proposta avisada pelo WhatsApp',
          text: `Mensagem sobre a proposta de ${formatBRL(customer.dealValue)} enviada para ${customer.phone}.`
        });
        window.open(link, '_blank');
        showToast("WhatsApp aberto com a mensagem. Anexe o PDF da proposta na conversa.", "success");
      }
    });
  }
}

// ==========================================================================
// Lead Import Modal Events (Excel / CSV / Paste)
// ==========================================================================
function setupImportModalEvents() {
  const dialog = document.getElementById('import-dialog');
  const btnOpen = document.getElementById('btn-open-import-modal');
  const btnClose = document.getElementById('btn-close-import-dialog');
  const btnCancel = document.getElementById('btn-cancel-import');
  const btnConfirm = document.getElementById('btn-confirm-import');
  const dropzone = document.getElementById('import-dropzone-area');
  const fileInput = document.getElementById('input-csv-file');
  const textarea = document.getElementById('textarea-import-raw');
  const previewContainer = document.getElementById('import-preview-container');
  const previewTbody = document.getElementById('import-preview-tbody');
  const countLabel = document.getElementById('import-count-label');

  let parsedLeads = [];

  const closeDialog = () => {
    if (dialog) dialog.close();
    parsedLeads = [];
  };

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      if (textarea) textarea.value = '';
      if (previewContainer) previewContainer.style.display = 'none';
      if (btnConfirm) btnConfirm.disabled = true;
      if (dialog) dialog.showModal();
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCancel) btnCancel.addEventListener('click', closeDialog);

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        if (textarea) {
          textarea.value = event.target.result;
          parseAndRenderPreview(textarea.value);
        }
      };
      reader.readAsText(file);
    });
  }

  if (textarea) {
    textarea.addEventListener('input', () => {
      parseAndRenderPreview(textarea.value);
    });
  }

  function parseAndRenderPreview(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    parsedLeads = [];

    lines.forEach(line => {
      if (line.toLowerCase().startsWith('nome')) return; // Header skip
      const parts = line.includes(';') ? line.split(';') : line.split(',');
      if (parts.length >= 2) {
        const name = parts[0]?.trim();
        const company = parts[1]?.trim() || '';
        const phone = parts[2]?.trim() || '';
        const dealVal = parseFloat(parts[3]?.replace(/[^\d.]/g, '')) || 25000;
        const email = parts[4]?.trim() || '';

        if (name) {
          parsedLeads.push({
            name,
            company,
            phone,
            dealValue: dealVal,
            email,
            stage: 'lead',
            priority: 'medium',
            tags: ['#Importado']
          });
        }
      }
    });

    if (parsedLeads.length > 0) {
      previewContainer.style.display = 'block';
      countLabel.textContent = `${parsedLeads.length} lead(s) identificado(s) prontos para inclusão`;
      previewTbody.innerHTML = parsedLeads.slice(0, 10).map(l => `
        <tr>
          <td><strong>${escapeHtml(l.name)}</strong></td>
          <td>${escapeHtml(l.company)}</td>
          <td>${escapeHtml(l.phone || '-')}</td>
          <td style="color:#16a34a; font-weight:600;">${formatBRL(l.dealValue)}</td>
        </tr>
      `).join('') + (parsedLeads.length > 10 ? `<tr><td colspan="4" style="text-align:center; color:#64748b;">+ ${parsedLeads.length - 10} outros contatos...</td></tr>` : '');
      btnConfirm.disabled = false;
    } else {
      previewContainer.style.display = 'none';
      btnConfirm.disabled = true;
    }
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (parsedLeads.length === 0) return;

      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Importando leads...';

      try {
        for (const lead of parsedLeads) {
          await storage.saveCustomer(lead);
        }
        crmStore.addAuditLog('Importação em Lote de Leads', `${parsedLeads.length} novos leads importados via planilha/texto com sucesso.`);
        closeDialog();
        showToast(`${parsedLeads.length} oportunidades importadas com sucesso para o pipeline!`, "success");
      } catch (err) {
        showToast("Erro durante a importação: " + err.message, "error");
      } finally {
        btnConfirm.textContent = 'Confirmar e Inserir no Pipeline';
      }
    });
  }
}

// ==========================================================================
// Authentication & Registration Portal Events (Tríade CID & RBAC)
// ==========================================================================
function setupAuthPortalEvents() {
  const portalScreen = document.getElementById('auth-portal-screen');
  const appContainer = document.getElementById('app-container');
  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const panelLogin = document.getElementById('auth-panel-login');
  const panelRegister = document.getElementById('auth-panel-register');
  const btnQuickAdmin = document.getElementById('btn-quick-login-admin');
  const btnQuickEmployee = document.getElementById('btn-quick-login-employee');
  const formLogin = document.getElementById('form-auth-login');
  const formRegister = document.getElementById('form-auth-register');

  window.showAuthPortal = function() {
    if (portalScreen) portalScreen.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
  };

  window.hideAuthPortal = function() {
    if (portalScreen) portalScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = '';
  };

  window.handleLogoutToPortal = async function() {
    const wasCloud = isCloudSession();
    await logAudit(AUDIT_ACTIONS.USER_LOGOUT, { reason: 'user_action' });
    await logoutToPortal();
    if (wasCloud) clearCompanyDataFromBrowser();
    await enterSession();
    showToast("Você saiu.", "info");
  };

  // Shows a busy label on a submit button and gives back a function that restores it
  const setBusy = (button, label) => {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
    return () => {
      button.disabled = false;
      button.innerHTML = original;
    };
  };

  const clearRegisterHash = () => {
    if (window.location.hash && (window.location.hash.includes('register') || window.location.hash.includes('checkout'))) {
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch {
        window.location.hash = '#pipeline';
      }
    }
  };

  // Tab switching
  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      if (panelLogin) panelLogin.style.display = 'block';
      if (panelRegister) panelRegister.style.display = 'none';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      if (panelLogin) panelLogin.style.display = 'none';
      if (panelRegister) panelRegister.style.display = 'block';
    });
  }

  // Sample data: nothing typed here reaches the cloud
  if (btnQuickAdmin) {
    btnQuickAdmin.addEventListener('click', async () => {
      loginAsDemoRole(USER_ROLES.ADMIN);
      await enterSession();
      showToast("Demonstração aberta como administrador. Os dados são de exemplo e ficam só neste navegador.", "info");
    });
  }

  if (btnQuickEmployee) {
    btnQuickEmployee.addEventListener('click', async () => {
      loginAsDemoRole(USER_ROLES.EMPLOYEE);
      await enterSession();
      showToast("Demonstração aberta como vendedor. Os dados são de exemplo e ficam só neste navegador.", "info");
    });
  }

  // Sign in
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-input-email').value.trim();
      const password = document.getElementById('login-input-password').value;

      if (!email || !password) {
        showToast("Informe o e-mail e a senha.", "error");
        return;
      }

      const restore = setBusy(formLogin.querySelector('button[type="submit"]'), 'Entrando...');
      try {
        const user = await signIn(email, password);
        formLogin.reset();
        await enterSession();
        showToast(`Olá, ${user.name}.`, "success");
      } catch (err) {
        showToast(describeAuthError(err), "error");
      } finally {
        restore();
      }
    });
  }

  // Forgotten password: the person gets an e-mail to choose a new one
  const btnForgot = document.getElementById('btn-forgot-password');
  if (btnForgot) {
    btnForgot.addEventListener('click', async () => {
      const email = document.getElementById('login-input-email').value.trim();
      if (!email || !email.includes('@')) {
        showToast("Digite o seu e-mail no campo acima e clique de novo.", "info");
        document.getElementById('login-input-email').focus();
        return;
      }
      try {
        await sendPasswordReset(email);
      } catch (err) {
        // Same answer whether or not the address has an account, so it cannot be used to probe for accounts
        if (err.code === 'auth/network-request-failed' || err.code === 'auth/too-many-requests') {
          showToast(describeAuthError(err), "error");
          return;
        }
      }
      showToast("Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.", "info");
    });
  }

  // Registration: own company vs joining with an invite
  const tabRegOwner = document.getElementById('tab-reg-type-owner');
  const tabRegEmployee = document.getElementById('tab-reg-type-employee');
  const regContainerOwner = document.getElementById('reg-container-owner');
  const regContainerEmployee = document.getElementById('reg-container-employee');

  if (tabRegOwner && tabRegEmployee) {
    tabRegOwner.addEventListener('click', () => {
      tabRegOwner.classList.add('active');
      tabRegEmployee.classList.remove('active');
      if (regContainerOwner) regContainerOwner.style.display = 'block';
      if (regContainerEmployee) regContainerEmployee.style.display = 'none';
    });

    tabRegEmployee.addEventListener('click', () => {
      tabRegEmployee.classList.add('active');
      tabRegOwner.classList.remove('active');
      if (regContainerOwner) regContainerOwner.style.display = 'none';
      if (regContainerEmployee) regContainerEmployee.style.display = 'block';
    });
  }

  // New company: whoever registers it is its first administrator
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-input-name').value.trim();
      const email = document.getElementById('reg-input-email').value.trim();
      const company = document.getElementById('reg-input-company').value.trim();
      const password = document.getElementById('reg-input-password').value;
      const plan = document.getElementById('reg-input-plan')?.value || 'pro';

      if (!name || !email || !company || !password) {
        showToast("Preencha todos os campos.", "error");
        return;
      }
      if (password.length < 8) {
        showToast("A senha precisa ter pelo menos 8 caracteres.", "warning");
        return;
      }

      const restore = setBusy(document.getElementById('btn-submit-register'), 'Criando a empresa...');
      try {
        await registerCompany({ name, email, company, password, plan });
        formRegister.reset();
        clearRegisterHash();
        await enterSession();
        logAudit(AUDIT_ACTIONS.USER_REGISTERED, { role: 'admin', company, plan });
        showToast(`Empresa "${company}" criada. Você é o administrador.`, "success");
      } catch (err) {
        showToast(describeAuthError(err), "error");
      } finally {
        restore();
      }
    });
  }

  // Joining a company with its invite code
  const formJoinTeam = document.getElementById('form-auth-join-team');
  if (formJoinTeam) {
    formJoinTeam.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inviteCode = document.getElementById('join-input-code')?.value?.trim().toUpperCase();
      const name = document.getElementById('join-input-name')?.value?.trim();
      const email = document.getElementById('join-input-email')?.value?.trim();
      const password = document.getElementById('join-input-password')?.value;

      if (!inviteCode || !name || !email || !password) {
        showToast("Preencha todos os campos.", "error");
        return;
      }
      if (password.length < 8) {
        showToast("A senha precisa ter pelo menos 8 caracteres.", "warning");
        return;
      }

      const restore = setBusy(document.getElementById('btn-submit-join-team'), 'Conferindo o convite...');
      try {
        await joinCompany({ inviteCode, name, email, password });
        formJoinTeam.reset();
        clearRegisterHash();
        await enterSession();
        logAudit(AUDIT_ACTIONS.USER_REGISTERED, { role: 'employee', method: 'invite_code' });
        showToast(`Bem-vindo(a) à equipe, ${name}.`, "success");
      } catch (err) {
        showToast(describeAuthError(err), "error");
      } finally {
        restore();
      }
    });
  }

  // Deep link from the plans page (#register?plan=...)
  const handleAuthHashRouting = () => {
    const rawHash = window.location.hash || '';
    if (!(rawHash.includes('register') || rawHash.includes('checkout'))) return;
    if (isSessionActive()) return;

    window.showAuthPortal();
    if (tabRegister) tabRegister.click();

    const planMatch = rawHash.match(/plan=([a-zA-Z0-9_-]+)/);
    const planBadge = document.getElementById('auth-selected-plan-badge');
    const planLabel = document.getElementById('auth-plan-name-label');
    const planInput = document.getElementById('reg-input-plan');

    if (planMatch && planBadge && planLabel) {
      const planKey = planMatch[1].toLowerCase();
      const planNames = {
        starter: 'Starter (R$ 97/mês)',
        pro: 'Professional (R$ 197/mês)',
        enterprise: 'Enterprise (R$ 497/mês)'
      };
      planLabel.textContent = planNames[planKey] || planKey.toUpperCase();
      planBadge.style.display = 'block';
      if (planInput) planInput.value = planKey;
    }
  };
  window.handleAuthHashRouting = handleAuthHashRouting;
  window.addEventListener('hashchange', handleAuthHashRouting);
}

// ==========================================================================
// Command Palette Engine (Spotlight / Raycast-style Ctrl+K Launcher)
// ==========================================================================
function setupCommandPalette() {
  const dialog = document.getElementById('command-palette-dialog');
  const input = document.getElementById('command-palette-input');
  const body = document.getElementById('command-palette-body');
  const btnTrigger = document.getElementById('btn-open-command-palette');

  if (!dialog || !input || !body) return;

  window.openCommandPalette = function() {
    dialog.showModal();
    input.value = '';
    renderPaletteItems('');
    setTimeout(() => input.focus(), 50);
  };

  window.closeCommandPalette = function() {
    dialog.close();
  };

  if (btnTrigger) {
    btnTrigger.addEventListener('click', window.openCommandPalette);
  }

  // Click outside backdrop to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      window.closeCommandPalette();
    }
  });

  input.addEventListener('input', (e) => {
    renderPaletteItems(e.target.value);
  });

  // Keyboard navigation inside the palette (ArrowUp, ArrowDown, Enter)
  input.addEventListener('keydown', (e) => {
    const items = body.querySelectorAll('.command-item');
    if (items.length === 0) return;

    let activeIndex = Array.from(items).findIndex(el => el.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIndex >= 0) items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex + 1) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex >= 0) items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (targetItem) targetItem.click();
    }
  });

  function renderPaletteItems(query) {
    const q = (query || '').toLowerCase().trim();
    const state = crmStore.getState();
    const customers = state.allCustomers || [];

    const isUserAdmin = !!state.permissions?.isAdmin;

    const allActions = [
      {
        id: 'action-toggle-theme',
        icon: '',
        title: 'Alternar Modo Noturno / Claro (Doctor+)',
        hint: 'Atalho: Alt + T',
        category: 'Aparência & Interface',
        run: () => {
          window.closeCommandPalette();
          const newTheme = toggleTheme();
          showToast(newTheme === 'dark' ? 'Modo Noturno Doctor+ ativado' : 'Modo Claro ativado', 'info');
        }
      },
      {
        id: 'action-new-lead',
        icon: '',
        title: 'Nova Oportunidade / Lead',
        hint: 'Atalho: N',
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          document.getElementById('btn-new-lead')?.click();
        }
      },
      {
        id: 'action-import-csv',
        icon: '',
        title: 'Importar Leads (CSV / Excel)',
        hint: 'Atalho: I',
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          document.getElementById('btn-open-import-modal')?.click();
        }
      },
      {
        id: 'action-export-csv',
        icon: '',
        title: 'Exportar Base de Clientes (Excel CSV)',
        hint: 'Download UTF-8',
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          document.getElementById('btn-export-csv')?.click();
        }
      },
      {
        id: 'action-export-audit',
        icon: '',
        title: 'Exportar relatório de auditoria',
        hint: 'Logs imutáveis',
        adminOnly: true,
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          try {
            exportAuditLogsToCSV(state.auditLogs);
            showToast("Relatório de auditoria exportado com sucesso!", "success");
          } catch (err) {
            showToast("Erro ao exportar logs: " + err.message, "error");
          }
        }
      },
      {
        id: 'action-toggle-role',
        icon: '',
        title: 'Alternar Papel (Administrador / Funcionário)',
        hint: 'Equipe',
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          window.handleToggleRole();
        }
      },
      {
        id: 'action-shortcuts',
        icon: '',
        title: 'Guia de Atalhos do Teclado',
        hint: 'Atalho: ?',
        category: 'Ações Rápidas',
        run: () => {
          window.closeCommandPalette();
          document.getElementById('shortcuts-dialog')?.showModal();
        }
      },
      {
        id: 'nav-pipeline',
        icon: '',
        title: 'Ir para Funil de Vendas (Kanban)',
        hint: 'Atalho: 1',
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('pipeline') : (window.location.hash = 'pipeline');
        }
      },
      {
        id: 'nav-customers',
        icon: '',
        title: 'Ir para Clientes & Leads',
        hint: 'Atalho: 2',
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('customers') : (window.location.hash = 'customers');
        }
      },
      {
        id: 'nav-tasks',
        icon: '',
        title: 'Ir para Tarefas & Follow-up',
        hint: 'Atalho: 3',
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('tasks') : (window.location.hash = 'tasks');
        }
      },
      {
        id: 'nav-metrics',
        icon: '',
        title: 'Ir para Métricas, Metas Q4 e Comissões',
        hint: 'Atalho: 4',
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('metrics') : (window.location.hash = 'metrics');
        }
      },
      {
        id: 'nav-team',
        icon: '',
        title: 'Ir para Equipe & Convites',
        hint: 'Gestão de Time',
        adminOnly: true,
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('team') : (window.location.hash = 'team');
        }
      },
      {
        id: 'nav-audit',
        icon: '',
        title: 'Ir para Trilha de Auditoria & Logs',
        hint: 'Auditoria',
        adminOnly: true,
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('audit') : (window.location.hash = 'audit');
        }
      },
      {
        id: 'nav-security',
        icon: '',
        title: 'Ir para Segurança',
        hint: 'Atalho: 5',
        adminOnly: true,
        category: 'Navegação',
        run: () => {
          window.closeCommandPalette();
          window.navigateToView ? window.navigateToView('security') : (window.location.hash = 'security');
        }
      }
    ];

    const defaultActions = allActions.filter(a => !a.adminOnly || isUserAdmin);

    let html = '';

    if (!q) {
      const categories = ['Ações Rápidas', 'Navegação'];
      categories.forEach(cat => {
        const items = defaultActions.filter(a => a.category === cat);
        html += `<div class="command-group-title">${cat}</div>`;
        items.forEach((item, idx) => {
          const isFirst = cat === 'Ações Rápidas' && idx === 0;
          html += `
            <div class="command-item ${isFirst ? 'active' : ''}" data-action-id="${item.id}">
              <div class="command-item-left">
                <span class="command-item-icon">${item.icon}</span>
                <span>${escapeHtml(item.title)}</span>
              </div>
              <span class="command-item-hint">${escapeHtml(item.hint)}</span>
            </div>
          `;
        });
      });
    } else {
      const matchedActions = defaultActions.filter(a => 
        a.title.toLowerCase().includes(q) || 
        a.hint.toLowerCase().includes(q)
      );

      const matchedCustomers = customers.filter(c => 
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      ).slice(0, 8);

      if (matchedActions.length > 0) {
        html += `<div class="command-group-title">Ações do Sistema</div>`;
        matchedActions.forEach((item, idx) => {
          html += `
            <div class="command-item ${idx === 0 ? 'active' : ''}" data-action-id="${item.id}">
              <div class="command-item-left">
                <span class="command-item-icon">${item.icon}</span>
                <span>${escapeHtml(item.title)}</span>
              </div>
              <span class="command-item-hint">${escapeHtml(item.hint)}</span>
            </div>
          `;
        });
      }

      if (matchedCustomers.length > 0) {
        html += `<div class="command-group-title">Oportunidades &amp; Clientes (${matchedCustomers.length})</div>`;
        matchedCustomers.forEach((c, idx) => {
          const isAct = matchedActions.length === 0 && idx === 0;
          html += `
            <div class="command-item ${isAct ? 'active' : ''}" data-customer-id="${c.id}">
              <div class="command-item-left">
                <span class="command-item-icon"></span>
                <div>
                  <div style="font-weight: 600; font-size: 0.82rem;">${escapeHtml(c.name)}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(c.company || 'Sem empresa')} • ${formatBRL(c.dealValue)}</div>
                </div>
              </div>
              <span class="command-item-hint">Ver Detalhes ↵</span>
            </div>
          `;
        });
      }

      if (matchedActions.length === 0 && matchedCustomers.length === 0) {
        html = `
          <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            Nenhum resultado encontrado para "<strong>${escapeHtml(q)}</strong>".
          </div>
        `;
      }
    }

    body.innerHTML = html;

    body.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const actionId = item.getAttribute('data-action-id');
        const customerId = item.getAttribute('data-customer-id');

        if (actionId) {
          const action = defaultActions.find(a => a.id === actionId);
          if (action) action.run();
        } else if (customerId) {
          window.closeCommandPalette();
          window.handleOpenLeadDetails(customerId);
        }
      });
    });
  }
}

// ==========================================================================
// Keyboard Shortcuts Engine (?)
// ==========================================================================
function setupKeyboardShortcuts() {
  const shortcutsDialog = document.getElementById('shortcuts-dialog');
  const btnOpenShortcuts = document.getElementById('btn-open-shortcuts');
  const btnCloseShortcuts = document.getElementById('btn-close-shortcuts-dialog');
  const btnCloseShortcutsFooter = document.getElementById('btn-close-shortcuts-footer');

  if (btnOpenShortcuts && shortcutsDialog) {
    btnOpenShortcuts.addEventListener('click', () => shortcutsDialog.showModal());
  }
  if (btnCloseShortcuts && shortcutsDialog) {
    btnCloseShortcuts.addEventListener('click', () => shortcutsDialog.close());
  }
  if (btnCloseShortcutsFooter && shortcutsDialog) {
    btnCloseShortcutsFooter.addEventListener('click', () => shortcutsDialog.close());
  }

  document.addEventListener('keydown', (e) => {
    // Ctrl+K or Cmd+K: Open Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (window.openCommandPalette) window.openCommandPalette();
      return;
    }

    // Do not trigger single-key shortcuts while typing in inputs
    const activeEl = document.activeElement;
    const isTyping = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    if (isTyping) {
      if (e.key === 'Escape') activeEl.blur();
      return;
    }

    // Global Single-Key Shortcuts
    if (e.key === '?') {
      e.preventDefault();
      if (shortcutsDialog) shortcutsDialog.showModal();
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      const customerDialog = document.getElementById('customer-dialog');
      if (customerDialog) {
        document.getElementById('customer-form')?.reset();
        document.getElementById('dialog-customer-id').value = '';
        document.getElementById('customer-dialog-title').textContent = 'Nova Oportunidade / Lead';
        customerDialog.showModal();
      }
    } else if (e.key.toLowerCase() === 'i') {
      e.preventDefault();
      const importDialog = document.getElementById('import-dialog');
      if (importDialog) importDialog.showModal();
    } else if (e.key === '1') {
      window.navigateToView ? window.navigateToView('pipeline') : (window.location.hash = 'pipeline');
    } else if (e.key === '2') {
      window.navigateToView ? window.navigateToView('customers') : (window.location.hash = 'customers');
    } else if (e.key === '3') {
      window.navigateToView ? window.navigateToView('tasks') : (window.location.hash = 'tasks');
    } else if (e.key === '4') {
      window.navigateToView ? window.navigateToView('metrics') : (window.location.hash = 'metrics');
    } else if (e.key === '5') {
      if (crmStore.getState().permissions?.isAdmin) {
        window.navigateToView ? window.navigateToView('security') : (window.location.hash = 'security');
      } else {
        showToast('A tela de Segurança é só para administradores.', 'warning');
      }
    }
  });
}

// ==========================================================================
// Progressive Web App (PWA) & Service Worker Registration
// ==========================================================================
function setupPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[Nexus PWA] Service Worker registrado com sucesso no escopo:', reg.scope);
      }).catch((err) => {
        console.warn('[Nexus PWA] Falha ao registrar Service Worker:', err);
      });
    });
  }

  let deferredPrompt = null;
  const btnInstall = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) {
      btnInstall.style.display = 'inline-flex';
    }
  });

  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast("Nexus CRM instalado com sucesso no seu sistema!", "success");
      }
      deferredPrompt = null;
      btnInstall.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    if (btnInstall) btnInstall.style.display = 'none';
    showToast("Nexus CRM configurado como aplicativo nativo!", "success");
  });
}

// ==========================================================================
// Unified Header Tools & Actions Dropdown Menu
// ==========================================================================
function setupHeaderToolsMenu() {
  const btnTools = document.getElementById('btn-header-tools');
  const menu = document.getElementById('header-tools-menu');
  const btnMenuImport = document.getElementById('btn-menu-import');
  const btnMenuExportCsv = document.getElementById('btn-menu-export-csv');
  const btnMenuExportAudit = document.getElementById('btn-menu-export-audit');
  const btnMenuShortcuts = document.getElementById('btn-menu-shortcuts');
  const btnMenuPwa = document.getElementById('btn-menu-pwa');
  const legacyInstallBtn = document.getElementById('btn-install-pwa');

  if (!btnTools || !menu) return;

  function toggleMenu(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const isHidden = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = isHidden ? 'block' : 'none';
    btnTools.classList.toggle('active', isHidden);
    if (isHidden) {
      menu.classList.add('open');
    } else {
      menu.classList.remove('open');
    }
  }

  function closeMenu() {
    menu.style.display = 'none';
    menu.classList.remove('open');
    btnTools.classList.remove('active');
  }

  if (btnTools && menu) {
    btnTools.addEventListener('click', toggleMenu);
  }

  const btnSidebarGemini = document.getElementById('sidebar-gemini-btn');

  if (btnSidebarGemini) {
    btnSidebarGemini.addEventListener('click', () => {
      closeMenu();
    });
  }

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !btnTools.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.style.display === 'block') {
      closeMenu();
    }
  });

  if (btnMenuImport) {
    btnMenuImport.addEventListener('click', () => {
      closeMenu();
      const importDialog = document.getElementById('import-dialog');
      if (importDialog) importDialog.showModal();
    });
  }

  if (btnMenuExportCsv) {
    btnMenuExportCsv.addEventListener('click', () => {
      closeMenu();
      const exportBtn = document.getElementById('btn-export-csv');
      if (exportBtn) exportBtn.click();
    });
  }

  if (btnMenuExportAudit) {
    btnMenuExportAudit.addEventListener('click', () => {
      closeMenu();
      try {
        const state = crmStore.getState();
        exportAuditLogsToCSV(state.auditLogs);
        showToast("Relatório de auditoria exportado com sucesso!", "success");
      } catch (err) {
        showToast("Erro ao exportar logs: " + err.message, "error");
      }
    });
  }

  if (btnMenuShortcuts) {
    btnMenuShortcuts.addEventListener('click', () => {
      closeMenu();
      const shortcutsDialog = document.getElementById('shortcuts-dialog');
      if (shortcutsDialog) shortcutsDialog.showModal();
    });
  }

  if (btnMenuPwa) {
    btnMenuPwa.addEventListener('click', () => {
      closeMenu();
      if (legacyInstallBtn) legacyInstallBtn.click();
    });
  }

  window.addEventListener('beforeinstallprompt', () => {
    if (btnMenuPwa) btnMenuPwa.style.display = 'flex';
  });
  window.addEventListener('appinstalled', () => {
    if (btnMenuPwa) btnMenuPwa.style.display = 'none';
  });
}

// ==========================================================================
// Employee Management Events (Tríade CID / RBAC)
// ==========================================================================
function setupEmployeeManagementEvents() {
  const dialog = document.getElementById('employee-dialog');
  const form = document.getElementById('employee-form');
  const inputName = document.getElementById('emp-input-name');
  const inputCpf = document.getElementById('emp-input-cpf');
  const inputEmail = document.getElementById('emp-input-email');
  const inputPhone = document.getElementById('emp-input-phone');
  const inputJob = document.getElementById('emp-input-job');
  const inputDept = document.getElementById('emp-input-department');
  const selectRole = document.getElementById('emp-select-role');
  const inputPassword = document.getElementById('emp-input-password');
  const checkRequire = document.getElementById('emp-check-require-change');
  const feedbackCpf = document.getElementById('cpf-validation-feedback');

  const btnClose = document.getElementById('btn-close-employee-dialog');
  const btnCancel = document.getElementById('btn-cancel-employee');
  const btnGenerate = document.getElementById('btn-generate-temp-password');
  const btnCopyField = document.getElementById('btn-copy-temp-password-field');

  // First Access Password Modal
  const firstAccessDialog = document.getElementById('first-access-password-dialog');
  const formFirstAccess = document.getElementById('form-first-access-password');
  const inputFirstAccessEmpId = document.getElementById('first-access-employee-id');
  const inputFirstAccessNew = document.getElementById('first-access-new-password');
  const inputFirstAccessConfirm = document.getElementById('first-access-confirm-password');

  // Open modal
  window.openEmployeeModal = function(empToEdit = null) {
    if (!dialog) return;
    form.reset();
    document.getElementById('employee-id').value = '';
    if (feedbackCpf) {
      feedbackCpf.textContent = '';
      feedbackCpf.className = 'field-feedback-badge';
    }

    if (empToEdit) {
      document.getElementById('employee-dialog-title').textContent = 'Editar Colaborador';
      document.getElementById('employee-id').value = empToEdit.id;
      inputName.value = empToEdit.name;
      inputCpf.value = empToEdit.cpf;
      inputEmail.value = empToEdit.email;
      inputPhone.value = empToEdit.phone || '';
      inputJob.value = empToEdit.jobTitle || '';
      inputDept.value = empToEdit.department || 'Comercial B2B';
      selectRole.value = empToEdit.role || USER_ROLES.EMPLOYEE;
      inputPassword.value = '';
      checkRequire.checked = !!empToEdit.requirePasswordChange;
    } else {
      document.getElementById('employee-dialog-title').textContent = 'Cadastrar Novo Colaborador';
      inputPassword.value = generateTemporaryPassword();
      checkRequire.checked = true;
    }

    // The temporary password only exists while a new account is being created
    const passwordBox = document.getElementById('emp-password-box');
    if (passwordBox) passwordBox.style.display = empToEdit ? 'none' : '';
    inputPassword.required = !empToEdit;
    inputEmail.readOnly = !!empToEdit && isCloudSession();

    dialog.showModal();
    setTimeout(() => inputName.focus(), 50);
  };

  if (dialog) {
    document.addEventListener('click', (e) => {
      if (e.target && (e.target.id === 'btn-open-employee-modal' || e.target.closest('#btn-open-employee-modal'))) {
        window.openEmployeeModal();
      }
    });

    if (btnClose) btnClose.addEventListener('click', () => dialog.close());
    if (btnCancel) btnCancel.addEventListener('click', () => dialog.close());

    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => {
        inputPassword.value = generateTemporaryPassword();
      });
    }

    if (btnCopyField) {
      btnCopyField.addEventListener('click', () => {
        if (!inputPassword.value) return;
        navigator.clipboard.writeText(inputPassword.value);
        showToast('Senha temporária copiada!', 'success');
      });
    }

    // Live CPF formatting and validation
    if (inputCpf) {
      inputCpf.addEventListener('input', () => {
        const raw = inputCpf.value;
        const formatted = formatCPF(raw);
        inputCpf.value = formatted;

        const clean = raw.replace(/\D/g, '');
        if (clean.length === 11) {
          const isValid = validateCPF(clean);
          if (isValid) {
            feedbackCpf.textContent = 'CPF válido';
            feedbackCpf.className = 'field-feedback-badge valid';
          } else {
            feedbackCpf.textContent = 'CPF inválido';
            feedbackCpf.className = 'field-feedback-badge invalid';
          }
        } else {
          feedbackCpf.textContent = '';
          feedbackCpf.className = 'field-feedback-badge';
        }
      });
    }

    // Submit form
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isEdit = !!document.getElementById('employee-id').value;
      const empData = {
        id: document.getElementById('employee-id').value || null,
        name: inputName.value.trim(),
        cpf: inputCpf.value.trim(),
        email: inputEmail.value.trim(),
        phone: inputPhone.value.trim(),
        jobTitle: inputJob.value.trim(),
        department: inputDept.value,
        role: selectRole.value,
        tempPassword: inputPassword.value.trim(),
        requirePasswordChange: checkRequire.checked
      };

      const btnSave = document.getElementById('btn-save-employee');
      const originalLabel = btnSave ? btnSave.textContent : '';
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.textContent = 'Salvando...';
      }

      const result = await saveEmployee(empData);

      if (btnSave) {
        btnSave.disabled = false;
        btnSave.textContent = originalLabel;
      }

      if (!result.success) {
        showToast(result.error, 'error');
        return;
      }

      dialog.close();
      logAudit(AUDIT_ACTIONS.EMPLOYEE_CREATED, {
        empId: result.employee.id,
        name: result.employee.name,
        role: result.employee.role,
        cpf: maskCPF(result.employee.cpf)
      });

      if (isEdit) {
        showToast(`Dados de ${result.employee.name} atualizados.`, 'success');
      } else if (result.demo) {
        showToast(`${result.employee.name} entrou na lista. Na demonstração nenhum login é criado.`, 'info');
      } else {
        // The only moment the temporary password is available: hand it over now
        showCredentialsDialog(result.employee, generateCredentialsShareText(result.employee, result.tempPassword));
      }
      renderSecurityView(crmStore.getState());
    });
  }

  // Shows the access details once, with a copy button
  function showCredentialsDialog(employee, shareText) {
    const credDialog = document.getElementById('credentials-dialog');
    const credText = document.getElementById('credentials-text');
    const credTitle = document.getElementById('credentials-title');
    if (!credDialog || !credText) {
      showToast(`Acesso de ${employee.name} criado.`, 'success');
      return;
    }
    if (credTitle) credTitle.textContent = `Acesso de ${employee.name} criado`;
    credText.value = shareText;
    credDialog.showModal();
  }

  const btnCopyCredentials = document.getElementById('btn-copy-credentials');
  if (btnCopyCredentials) {
    btnCopyCredentials.addEventListener('click', async () => {
      const credText = document.getElementById('credentials-text');
      try {
        await navigator.clipboard.writeText(credText.value);
        showToast('Copiado. Envie para a pessoa.', 'success');
      } catch {
        credText.select();
        showToast('Selecione o texto e copie com Ctrl+C.', 'info');
      }
    });
  }
  const btnCloseCredentials = document.getElementById('btn-close-credentials');
  if (btnCloseCredentials) {
    btnCloseCredentials.addEventListener('click', () => {
      document.getElementById('credentials-text').value = '';
      document.getElementById('credentials-dialog').close();
    });
  }

  // First access: the person replaces the temporary password with their own
  if (formFirstAccess) {
    formFirstAccess.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = inputFirstAccessNew.value;
      const confirmPass = inputFirstAccessConfirm.value;

      if (!newPass || newPass.length < 8) {
        showToast('A senha precisa ter pelo menos 8 caracteres.', 'error');
        return;
      }
      if (newPass !== confirmPass) {
        showToast('As duas senhas não são iguais.', 'error');
        return;
      }

      try {
        await changeOwnPassword(newPass);
        formFirstAccess.reset();
        if (firstAccessDialog) firstAccessDialog.close();
        showToast('Senha pessoal criada.', 'success');
      } catch (err) {
        showToast(describeAuthError(err), 'error');
      }
    });

    // The dialog cannot be dismissed with Esc: the temporary password must be replaced
    if (firstAccessDialog) {
      firstAccessDialog.addEventListener('cancel', (e) => e.preventDefault());
    }
  }

  // Reactive updates on employee list
  onEmployeesChange(() => {
    if (crmStore) {
      renderSecurityView(crmStore.getState());
      crmStore.emitChange();
    }
  });

  // Global Handlers for table buttons
  window.handleToggleCPFVisibility = function(empId) {
    const textSpan = document.getElementById(`cpf-text-${empId}`);
    if (!textSpan) return;
    const isMasked = textSpan.textContent.includes('*');
    textSpan.textContent = isMasked ? textSpan.dataset.raw : textSpan.dataset.masked;
  };

  window.handleEditEmployee = function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (emp) window.openEmployeeModal(emp);
  };

  window.handleResetEmployeePassword = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    if (!confirm(`Enviar para ${emp.email} um e-mail para criar uma nova senha?`)) {
      return;
    }

    const res = await resetEmployeePassword(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_PASSWORD_RESET, { empId, name: emp.name }, AUDIT_SEVERITY.WARNING);
    showToast(`E-mail de nova senha enviado para ${emp.email}.`, 'success');
  };

  window.handleToggleEmployeeStatus = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    const action = emp.status === 'active' ? 'bloquear' : 'liberar';
    if (!confirm(`Deseja ${action} o acesso de ${emp.name}?`)) {
      return;
    }

    const res = await toggleEmployeeStatus(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_STATUS_CHANGED, { empId, name: emp.name, status: res.status }, AUDIT_SEVERITY.WARNING);
    showToast(res.status === 'active' ? `Acesso de ${emp.name} liberado.` : `Acesso de ${emp.name} bloqueado.`, 'info');
    renderSecurityView(crmStore.getState());
  };

  window.handleDeleteEmployee = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    if (!confirm(`Excluir o cadastro de ${emp.name}? A pessoa perde o acesso aos dados da empresa. Os leads dela continuam no sistema.`)) {
      return;
    }

    const res = await deleteEmployee(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_DELETED, { empId, name: emp.name }, AUDIT_SEVERITY.CRITICAL);
    showToast(`Cadastro de ${emp.name} excluído.`, 'info');
    renderSecurityView(crmStore.getState());
  };
}

// ==========================================================================
// Billing & Subscription Events
// ==========================================================================
function setupBillingEvents() {
  const dialog = document.getElementById('billing-dialog');
  const btnOpen = document.getElementById('btn-menu-billing');
  const btnClose = document.getElementById('btn-close-billing-dialog');
  const btnCloseFooter = document.getElementById('btn-close-billing-dialog-footer');

  function refreshBillingData() {
    const org = getSavedOrganization();
    const metrics = getAiUsageMetrics();
    const employees = getEmployees();
    const state = crmStore?.getState();
    const totalLeads = state?.allCustomers?.length || 0;

    const planNames = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
    const plan = PLANS[org.plan] || PLANS.pro;
    const onTrial = org.planStatus === 'trial';
    const unlimited = org.plan === 'enterprise';
    const limit = (n) => (unlimited ? 'sem limite' : n.toLocaleString('pt-BR'));
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('billing-plan-name', planNames[org.plan] || 'Professional');
    set('billing-plan-badge', onTrial ? `Período de teste: ${org.trialDaysLeft ?? 14} dias restantes` : 'Assinatura ativa');

    const used = metrics.used || 0;
    const quota = plan.aiQuotaMonth;
    set('billing-ai-count', `${used} de ${limit(quota)}`);
    const aiBar = document.getElementById('billing-ai-bar');
    if (aiBar) aiBar.style.width = `${Math.min(100, Math.round((used / quota) * 100))}%`;

    set('billing-leads-count', `${totalLeads} de ${limit(plan.maxLeads)}`);
    set('billing-users-count', `${employees.length + 1} de ${limit(plan.maxUsers)}`);

    // During the trial every plan can still be subscribed to, including the current one
    document.querySelectorAll('.btn-plan-select').forEach(btn => {
      const isCurrent = btn.dataset.plan === org.plan;
      btn.disabled = isCurrent && !onTrial;
      btn.textContent = isCurrent && !onTrial ? 'Plano atual' : `Assinar ${planNames[btn.dataset.plan] || btn.dataset.plan}`;
    });
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';
      refreshBillingData();
      dialog.showModal();
    });
  }

  if (btnClose) btnClose.addEventListener('click', () => dialog?.close());
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => dialog?.close());

  // Plan selection buttons -> opens checkout modal
  document.querySelectorAll('.btn-plan-select').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan;
      if (!plan) return;
      if (window.openCheckout) {
        window.openCheckout(plan);
      }
    });
  });
}

// ==========================================================================
// Checkout & Payment Gateway Events (PIX Instantâneo & Cartão de Crédito)
// ==========================================================================
// ==========================================================================
// Team Invite System Events
// ==========================================================================
function setupTeamInviteEvents() {
  const displayTeamCode = document.getElementById('display-team-invite-code');
  const btnCopyTeamCode = document.getElementById('btn-copy-team-code');
  const btnNewTeamCode = document.getElementById('btn-new-team-code');

  function renderTeamView() {
    const employees = getEmployees();
    const statMembers = document.getElementById('stat-total-members');
    const statAdmin = document.getElementById('stat-admin-count');
    const statBlocked = document.getElementById('stat-blocked-members');

    // +1: the signed-in administrator is not in the list
    if (statMembers) statMembers.textContent = employees.filter(e => e.status !== 'blocked').length + 1;
    if (statAdmin) statAdmin.textContent = employees.filter(e => e.role === 'admin').length + 1;
    if (statBlocked) statBlocked.textContent = employees.filter(e => e.status === 'blocked').length;

    if (displayTeamCode) displayTeamCode.textContent = getCompanyTeamInviteCode() || 'sem código';
    if (btnNewTeamCode) btnNewTeamCode.style.display = isCloudSession() ? '' : 'none';
  }
  window.refreshTeamInviteCard = renderTeamView;

  if (btnCopyTeamCode) {
    btnCopyTeamCode.addEventListener('click', () => {
      const code = getCompanyTeamInviteCode();
      if (!code) return;
      if (isDemoSession()) {
        showToast('Na demonstração o código é só um exemplo. Numa conta real, ele deixa sua equipe criar o próprio acesso.', 'info');
        return;
      }
      navigator.clipboard.writeText(generateInviteShareText(code)).then(() => {
        showToast('Convite copiado. Envie para quem deve entrar na equipe.', 'success');
      }).catch(() => {
        showToast(`Código da equipe: ${code}`, 'info');
      });
    });
  }

  if (btnNewTeamCode) {
    btnNewTeamCode.addEventListener('click', async () => {
      if (!confirm('Gerar um novo código? O código atual para de funcionar na hora. Quem já entrou na equipe não é afetado.')) return;
      const result = await replaceCompanyTeamInviteCode();
      if (!result.success) {
        showToast(result.error, 'error');
        return;
      }
      renderTeamView();
      showToast('Novo código gerado. O anterior não vale mais.', 'success');
    });
  }

  renderTeamView();
  onEmployeesChange(renderTeamView);
}

// ==========================================================================
// Audit Trail View & Rendering
// ==========================================================================
function setupAuditTrailView() {
  function renderAuditView() {
    const stats = getAuditStats();
    const logs = getLocalAuditLogs(100);

    const statTotal = document.getElementById('audit-stat-total');
    const statToday = document.getElementById('audit-stat-today');
    const statWarnings = document.getElementById('audit-stat-warnings');

    if (statTotal) statTotal.textContent = stats.totalLogs;
    if (statToday) statToday.textContent = stats.todayLogs;
    if (statWarnings) statWarnings.textContent = (stats.warningCount || 0) + (stats.criticalCount || 0);

    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Nada registrado ainda.</td></tr>`;
      return;
    }

    // Internal field names are turned into words; technical fields are left out
    const detailLabels = {
      name: 'nome', company: 'empresa', dealValue: 'valor', stage: 'etapa', customerId: 'oportunidade',
      fromRole: 'de', toRole: 'para', role: 'perfil', status: 'situação', plan: 'plano', type: 'tipo',
      leadName: 'lead', source: 'origem', value: 'valor', empId: 'colaborador', cpf: 'CPF', reason: 'motivo'
    };
    const hiddenDetails = ['userAgent', 'screenSize', 'method', 'action'];
    const methodLabels = {
      session_resume: 'sessão retomada', email_password: 'e-mail e senha', demo: 'demonstração',
      invite_code: 'código de convite', webhook_api: 'recebido por webhook'
    };

    tbody.innerHTML = logs.slice(0, 50).map(log => {
      const date = new Date(log.timestamp);
      const when = `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const details = log.details || {};
      const parts = Object.entries(details)
        .filter(([k, v]) => !hiddenDetails.includes(k) && v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${detailLabels[k] || k}: ${v}`);
      if (details.method && methodLabels[details.method]) parts.unshift(methodLabels[details.method]);
      const needsAttention = log.severity === 'warning' || log.severity === 'critical';

      return `<tr>
        <td class="nowrap muted">${when}</td>
        <td>${formatAuditAction(log.action)}${needsAttention ? ' <span class="status-text blocked">(atenção)</span>' : ''}</td>
        <td>${escapeHtml(log.userName || '')}<div class="cell-sub">${log.userRole === 'admin' ? 'Administrador' : 'Vendedor'}</div></td>
        <td class="muted">${escapeHtml(parts.join(', ').substring(0, 120))}</td>
      </tr>`;
    }).join('');
  }

  // Export audit CSV
  const btnExport = document.getElementById('btn-export-audit-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const csv = exportAuditToCSV();
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `nexus_audit_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      showToast('Histórico exportado.', 'success');
      logAudit(AUDIT_ACTIONS.DATA_EXPORTED, { type: 'audit_csv' });
    });
  }

  // Subscribe to audit events for live rendering
  onAuditLog(() => renderAuditView());

  // Initial render
  renderAuditView();
}

// ==========================================================================
// Notification Center (Bell Icon + Dropdown)
// ==========================================================================
function setupNotificationCenter() {
  const bellBtn = document.getElementById('btn-notification-bell');
  const dropdown = document.getElementById('notification-dropdown');
  const badge = document.getElementById('notification-badge');
  const markAllBtn = document.getElementById('btn-mark-all-read');
  const enablePushBtn = document.getElementById('btn-enable-push');

  function updateBadge() {
    const count = getUnreadCount();
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderNotificationList() {
    const listEl = document.getElementById('notification-list');
    if (!listEl) return;

    const notifications = getInAppNotifications(20);
    if (notifications.length === 0) {
      listEl.innerHTML = `<div class="notification-empty" style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">
        Nenhuma notificação ainda.
      </div>`;
      return;
    }

    listEl.innerHTML = notifications.map(n => {
      const icon = getNotificationIcon(n.type);
      const date = new Date(n.timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMin = Math.floor(diffMs / 60000);
      let timeAgo;
      if (diffMin < 1) timeAgo = 'Agora';
      else if (diffMin < 60) timeAgo = `${diffMin}min atrás`;
      else if (diffMin < 1440) timeAgo = `${Math.floor(diffMin / 60)}h atrás`;
      else timeAgo = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

      return `<div class="notification-item ${n.read ? '' : 'unread'}" style="background: ${n.read ? 'var(--bg-surface)' : '#1c263c'} !important; border-bottom: 1px solid var(--border-subtle) !important; ${n.read ? '' : 'border-left: 4px solid #3b82f6 !important;'}" onclick="window.handleNotificationClick('${n.id}')">
        <div class="notification-item-icon" style="background: #22293a !important; border: 1px solid var(--border-subtle) !important; color: #ffffff !important;">${icon}</div>
        <div class="notification-item-content">
          <div class="notification-item-title" style="color: #ffffff !important; font-weight: 600; font-size: 0.86rem;">${escapeHtml(n.title)}</div>
          <div class="notification-item-body" style="color: var(--text-secondary) !important; font-size: 0.78rem; line-height: 1.4;">${escapeHtml(n.body)}</div>
          <div class="notification-item-time" style="color: var(--text-secondary) !important; font-size: 0.7rem; margin-top: 4px;">${timeAgo}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Toggle dropdown
  if (bellBtn) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) renderNotificationList();
      }
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (dropdown && dropdown.style.display !== 'none') {
      const wrapper = document.getElementById('notification-bell-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    }
  });

  // Mark all as read
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      markAllAsRead();
      renderNotificationList();
      updateBadge();
      showToast('Todas as notificações marcadas como lidas.', 'info');
    });
  }

  // Enable push notifications
  if (enablePushBtn) {
    enablePushBtn.addEventListener('click', async () => {
      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        showToast('Notificações push ativadas!', 'success');
        enablePushBtn.textContent = 'Notificações Push Ativas';
        enablePushBtn.disabled = true;
      } else if (permission === 'denied') {
        showToast('Permissão de notificações foi negada pelo navegador.', 'error');
      } else {
        showToast('Notificações não são suportadas neste navegador.', 'info');
      }
    });

    // Update button state
    if (getNotificationPermission() === 'granted') {
      enablePushBtn.textContent = 'Notificações Push Ativas';
      enablePushBtn.disabled = true;
    }
  }

  // Notification click handler
  window.handleNotificationClick = function(notifId) {
    markAsRead(notifId);
    renderNotificationList();
    updateBadge();
  };

  // Subscribe to changes
  onNotificationsChange(() => {
    updateBadge();
  });

  // Initial state
  updateBadge();
}

// ==========================================================================
// Commercial Subscription & 1-Click PIX Checkout Engine
// ==========================================================================
function setupCheckoutModalEvents() {
  const modal = document.getElementById('modal-checkout');
  const btnCloseModal = document.getElementById('btn-close-checkout-modal');
  const btnCloseFooter = document.getElementById('btn-close-checkout-footer');
  const btnCopyPix = document.getElementById('btn-copy-pix-code');
  const pixInput = document.getElementById('chk-pix-copypaste-input');
  const pixQrImg = document.getElementById('chk-pix-qrcode-img');
  const gatewayCardLink = document.getElementById('chk-gateway-card-link');
  const whatsappLink = document.getElementById('chk-whatsapp-receipt-link');
  const currentPlanBadge = document.getElementById('chk-current-plan-badge');
  const trialDaysBadge = document.getElementById('chk-trial-days-badge');
  const quotaUsers = document.getElementById('chk-quota-users');
  const quotaLeads = document.getElementById('chk-quota-leads');
  const trialPillText = document.getElementById('trial-pill-text');

  // Admin settings elements
  const btnToggleAdmin = document.getElementById('btn-toggle-payment-settings');
  const adminDrawer = document.getElementById('chk-admin-settings-drawer');
  const cfgPixKey = document.getElementById('cfg-pix-key');
  const cfgPixName = document.getElementById('cfg-pix-name');
  const cfgSupportWhatsapp = document.getElementById('cfg-support-whatsapp');
  const cfgBackendUrl = document.getElementById('cfg-backend-url');
  const btnSaveSettings = document.getElementById('btn-save-payment-settings');

  let activeSelectedPlan = 'pro';

  async function loadCheckoutData(plan = 'pro') {
    activeSelectedPlan = plan;
    const token = localStorage.getItem('nexus_jwt_token');

    const prices = { starter: 97, pro: 197, enterprise: 497 };
    const amount = prices[plan] || 197;
    const customPixKey = localStorage.getItem('nexus_custom_pix_key') || 'contato@nexuscrm.com.br';
    const customPixName = localStorage.getItem('nexus_custom_pix_name') || 'NEXUS CRM ENTERPRISE';
    const customWhatsapp = localStorage.getItem('nexus_custom_whatsapp') || '5511999999999';

    const fallbackPix = `00020126580014br.gov.bcb.pix0136${customPixKey}520400005303986540${amount}.005802BR5916${customPixName.substring(0, 16).toUpperCase()}6009SAO PAULO62070503***6304ABCD`;

    if (pixInput) pixInput.value = fallbackPix;
    if (pixQrImg) pixQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(fallbackPix)}`;
    if (gatewayCardLink) gatewayCardLink.href = `/checkout?plan=${plan}&cycle=monthly`;
    if (whatsappLink) {
      const cleanWa = customWhatsapp.replace(/\D/g, '');
      const waTarget = cleanWa.startsWith('55') ? cleanWa : `55${cleanWa}`;
      whatsappLink.href = `https://wa.me/${waTarget}?text=${encodeURIComponent(`Olá! Realizei o pagamento PIX do Plano ${plan.toUpperCase()} (R$ ${amount},00) do Nexus CRM. Segue o comprovante em anexo para ativação da conta!`)}`;
    }

    try {
      const baseUrl = window.getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/v1/commercial/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          plan,
          billingCycle: 'monthly',
          customer: {
            pixKey: customPixKey,
            pixName: customPixName
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pix) {
          if (pixInput) pixInput.value = data.pix.copyPaste;
          if (pixQrImg) pixQrImg.src = data.pix.qrCodeUrl;
        }
        if (data.cardCheckoutUrl && gatewayCardLink) {
          gatewayCardLink.href = data.cardCheckoutUrl;
        }
        if (data.whatsappConfirmationUrl && whatsappLink) {
          whatsappLink.href = data.whatsappConfirmationUrl;
        }
      }
    } catch {
      // Local fallback mode
    }
  }

  async function refreshSubscriptionInfo() {
    const token = localStorage.getItem('nexus_jwt_token');
    const org = getSavedOrganization();
    let planName = ({ starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' })[org.plan] || 'Professional';
    let daysRemaining = org.trialDaysLeft ?? 14;
    const onTrial = org.planStatus === 'trial';
    if (currentPlanBadge) currentPlanBadge.textContent = planName;
    if (trialDaysBadge) trialDaysBadge.textContent = onTrial ? `Período de teste: ${daysRemaining} dias restantes` : 'Assinatura ativa';

    try {
      if (token) {
        const baseUrl = window.getApiBaseUrl();
        const res = await fetch(`${baseUrl}/api/v1/commercial/subscription`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.data) {
            planName = data.data.planName || data.data.plan || planName;
            daysRemaining = data.data.trialDaysRemaining ?? 7;
            if (currentPlanBadge) currentPlanBadge.textContent = planName;
            if (trialDaysBadge) trialDaysBadge.textContent = `Período de teste: ${daysRemaining} dias restantes`;
            if (quotaUsers && data.data.quotas) quotaUsers.textContent = `${data.data.quotas.users.used} / ${data.data.quotas.users.limit}`;
            if (quotaLeads && data.data.quotas) quotaLeads.textContent = `${data.data.quotas.leads.used} / ${data.data.quotas.leads.limit.toLocaleString()}`;
          }
        }
      }
    } catch {
      // Local fallback
    }

    if (trialPillText) {
      trialPillText.textContent = onTrial ? `Teste: ${daysRemaining} dias restantes` : '';
      const pill = trialPillText.closest('button, a, div');
      if (pill) pill.style.display = onTrial ? '' : 'none';
    }
  }

  // Populate admin settings drawer fields
  if (cfgPixKey) cfgPixKey.value = localStorage.getItem('nexus_custom_pix_key') || '';
  if (cfgPixName) cfgPixName.value = localStorage.getItem('nexus_custom_pix_name') || '';
  if (cfgSupportWhatsapp) cfgSupportWhatsapp.value = localStorage.getItem('nexus_custom_whatsapp') || '';
  if (cfgBackendUrl) cfgBackendUrl.value = localStorage.getItem('nexus_cloud_backend_url') || 'https://nexus-crm-yfof.onrender.com';

  if (btnToggleAdmin && adminDrawer) {
    btnToggleAdmin.addEventListener('click', () => {
      adminDrawer.style.display = adminDrawer.style.display === 'none' ? 'block' : 'none';
    });
  }

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const pixKey = cfgPixKey?.value.trim() || '';
      const pixName = cfgPixName?.value.trim() || '';
      const supportWhatsapp = cfgSupportWhatsapp?.value.trim() || '';
      const backendUrl = cfgBackendUrl?.value.trim() || '';

      if (pixKey) localStorage.setItem('nexus_custom_pix_key', pixKey);
      if (pixName) localStorage.setItem('nexus_custom_pix_name', pixName);
      if (supportWhatsapp) localStorage.setItem('nexus_custom_whatsapp', supportWhatsapp);
      if (backendUrl) localStorage.setItem('nexus_cloud_backend_url', backendUrl);

      // Attempt to sync with backend if logged in
      const token = localStorage.getItem('nexus_jwt_token');
      if (token) {
        try {
          const baseUrl = window.getApiBaseUrl();
          await fetch(`${baseUrl}/api/v1/commercial/payment-settings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ pixKey, pixName, supportWhatsapp })
          });
        } catch (e) {
          console.warn('[Billing Config] Local save preserved, backend sync deferred:', e);
        }
      }

      showToast('Recebimento salvo.', 'success');
      loadCheckoutData(activeSelectedPlan);
    });
  }

  window.openCheckoutModal = function(plan = 'pro') {
    if (!isSessionActive()) return;
    if (modal) {
      modal.showModal();
      window.selectCheckoutPlan(plan);
      refreshSubscriptionInfo();
    }
  };

  window.selectCheckoutPlan = function(plan) {
    document.querySelectorAll('.checkout-plan-card').forEach(card => {
      card.classList.toggle('active', card.dataset.plan === plan);
    });
    loadCheckoutData(plan);
  };

  // One way to subscribe: plan buttons and links from the plans page all land here
  window.openCheckout = function(plan = 'pro') {
    const billingDialog = document.getElementById('billing-dialog');
    if (billingDialog && billingDialog.open) billingDialog.close();
    window.openCheckoutModal(plan);
  };

  if (btnCloseModal) btnCloseModal.addEventListener('click', () => modal?.close());
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => modal?.close());

  if (btnCopyPix && pixInput) {
    btnCopyPix.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pixInput.value);
        showToast('Código PIX copiado. Cole no aplicativo do seu banco.', 'success');
        btnCopyPix.textContent = 'Copiado!';
        setTimeout(() => { btnCopyPix.textContent = 'Copiar'; }, 3000);
      } catch {
        pixInput.select();
        document.execCommand('copy');
        showToast('Código PIX copiado!', 'success');
      }
    });
  }

  refreshSubscriptionInfo();
}
