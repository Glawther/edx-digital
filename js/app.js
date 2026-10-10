/**
 * EDX Digital - Application Orchestrator
 * Wires the screens to the store, the storage and the services
 */

import { storage } from './core/storage-manager.js';
import { crmStore, STAGES, LOSS_REASONS, SALES_TEAM, applyStageNames } from './core/crm-store.js';
import {
  renderKPIs,
  renderKanban,
  renderTable,
  renderTasksView,
  renderDetailedMetrics,
  renderLeadTimeline,
  setHistoryFilter,
  toggleLostColumn,
  renderFocusPills,
  setReportPeriod,
  setCustomersView,
  renderConnectionStatus,
  renderAuthBadge,
  renderSecurityView,
  showToast,
  formatBRL,
  escapeHtml
} from './ui/ui-renderer.js';
import { safeImageUrl } from './core/html.js';
import { setupActions, registerActions } from './ui/actions.js';
import { CONTACT_TYPES, buildContact, toLocalInput } from './core/history.js';
import { passwordProblem } from './core/attention.js';
import { 
  getSavedOrganization, 
  saveOrganization, 
  applyWhitelabelStyles, 
  getPlanState
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
  changePassword,
  updateOwnName,
  isCompanyOwner,
  markActivity,
  isIdleTooLong,
  getIdToken,
  refreshOrganization,
  isReadOnly
} from './services/auth-service.js';
import { describeAuthError } from './services/firebase-app.js';
import {
  exportCustomersToCSV
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
  recheckInviteWithSeats,
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
  getAuditLogs,
  getAuditStats,
  formatAuditAction,
  exportAuditToCSV,
  onAuditLog
} from './services/audit-service.js';
import { getFirestoreDb } from './services/firebase-service.js';
import {
  generateInviteShareText,
  getCompanyTeamInviteCode,
  replaceCompanyTeamInviteCode,
  inviteShareLinks
} from './services/team-invite-service.js';
import {
  requestNotificationPermission,
  getNotificationPermission,
  getInAppNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  onNotificationsChange,
  clearNotifications,
  notify
} from './services/notification-service.js';
import { startTaskReminders, stopTaskReminders, localDateString } from './services/reminder-service.js';
import { parseMoney, findDuplicate } from './services/import-service.js';
import { setupImportDialog } from './ui/import-dialog.js';
import {
  setupCustomizeDialog,
  renderCustomFieldInputs,
  collectCustomFieldValues
} from './ui/customize-dialog.js';
import {
  currentPlan,
  leadsRoom,
  seatsRoom,
  describeLimit
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
  const host = window.location.hostname;
  // Served by the Node server itself (local development or Render): same origin
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) return '';
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
    setupActions();
    registerActions({
      openNewOpportunity: () => document.getElementById('btn-new-lead')?.click(),
      openImport: () => document.getElementById('btn-menu-import')?.click(),
      openGeminiKey: () => {
        document.getElementById('gemini-dialog')?.close();
        document.getElementById('sidebar-gemini-btn')?.click();
      },
      handleCustomersStage: (stage) => window.handleCustomersView({ stage }),
      handleCustomersSort: (sort) => window.handleCustomersView({ sort })
    });
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
    setupImportDialog();
    setupCustomizeDialog();
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
      if (!isSessionActive() || !isAdmin() || isReadOnly() || document.hidden) return;
      try {
        const res = await pollWebhookInbox();
        if (res && res.count > 0) {
          crmStore.emitChange();
          showToast(res.count === 1 ? '1 novo contato chegou por formulário.' : `${res.count} novos contatos chegaram por formulário.`, 'success');
        }
      } catch (err) {
        // a full plan or a lost connection: the contacts stay in the inbox for the next round
        console.warn('Webhook inbox:', err.message);
      }
    }, 15000);

    // The company's own stage names and extra fields: redraw whenever the company record changes
    applyStageNames(getSavedOrganization().stageNames);
    window.addEventListener('edx-organization-changed', (event) => {
      applyStageNames(event.detail && event.detail.stageNames);
      crmStore.emitChange();
    });

    // A click on a browser notification asks for a screen
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'OPEN_VIEW' && event.data.view && isSessionActive()) {
          window.navigateToView(event.data.view);
        }
      });
    }

    // Subscribe state store changes to DOM rendering
    crmStore.subscribe((state) => {
      renderKPIs(state.metrics, state.permissions);
      renderKanban(state.filteredCustomers, state.metrics, state.permissions, state.visibleCustomers.length);
      renderFocusPills(state.focus, state.attention);
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
    console.error("Erro crítico na inicialização do EDX Digital:", err);
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
    stopTaskReminders();
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
  if (typeof window.refreshPlanPill === 'function') window.refreshPlanPill();
  if (typeof window.navigateToView === 'function') window.navigateToView('pipeline');
  crmStore.emitChange();

  if (isCloudSession() && !result.success) {
    showToast("Não foi possível carregar os dados da empresa. Verifique a conexão e recarregue a página.", "error");
  }

  if (!resumed) logAudit(AUDIT_ACTIONS.USER_LOGIN, { method: isCloudSession() ? 'email_password' : 'demo' });

  startTaskReminders({
    getContext: () => (isSessionActive() ? { customers: storage.getCustomers(), user: getCurrentUser(), isAdmin: isAdmin() } : null),
    notify
  });

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
    show('account-profile-block', cloud);
    const nameInput = document.getElementById('account-name');
    if (nameInput) nameInput.value = user ? user.name : '';
    document.getElementById('form-account-password')?.reset();
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

  document.getElementById('form-account-name')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = await updateOwnName(document.getElementById('account-name').value);
      const user = getCurrentUser();
      const summary = document.getElementById('account-summary');
      if (summary && user) summary.textContent = `${name}, ${user.email}. ${isAdmin() ? 'Administrador' : 'Vendedor'} em ${getSavedOrganization().name}.`;
      showToast('Nome atualizado.', 'success');
    } catch (err) {
      showToast(err.code ? describeAuthError(err) : err.message, 'error');
    }
  });

  document.getElementById('form-account-password')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordForm = e.currentTarget;
    const current = document.getElementById('account-current-password').value;
    const next = document.getElementById('account-new-password').value;
    const weak = passwordProblem(next, { email: getCurrentUser()?.email, name: getCurrentUser()?.name });
    if (weak) {
      showToast(weak, 'error');
      return;
    }
    if (next === current) {
      showToast('A nova senha é igual à atual.', 'error');
      return;
    }
    try {
      await changePassword(current, next);
      passwordForm.reset();
      showToast('Senha trocada.', 'success');
    } catch (err) {
      const wrong = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code);
      showToast(wrong ? 'A senha atual não confere.' : describeAuthError(err), 'error');
    }
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
  setInterval(refreshPlanPill, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    check();
    refreshPlanPill();
  });
}

// Nothing that belongs to a company stays in this browser after its session ends.
// Kept on purpose: theme, the Gemini key and the webhook token (device settings),
// and the demo's sample data.
function clearCompanyDataFromBrowser() {
  ['edx_audit_logs', 'edx_last_activity', 'edx_reminder_rung'].forEach(key => localStorage.removeItem(key));
  clearNotifications();
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

  const btnMenuCustomize = document.getElementById('btn-menu-customize');
  if (btnMenuCustomize) btnMenuCustomize.style.display = isAdmin ? 'flex' : 'none';

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
    // the signed-in administrator is not in the list
    teamCount.textContent = getEmployees().length + 1;
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

// A copy of the opportunity taken before a change, so the change can be undone
function snapshotOf(customerId) {
  const customer = storage.getCustomer(customerId);
  return customer ? JSON.parse(JSON.stringify(customer)) : null;
}

function undoAction(snapshot, doneMessage) {
  if (!snapshot) return null;
  return {
    label: 'Desfazer',
    onClick: async () => {
      await storage.restoreCustomer(snapshot);
      showToast(doneMessage, 'info');
    }
  };
}

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
      showToast('Este contato não tem telefone cadastrado.', 'error');
      return;
    }

    activeWhatsAppCustomerId = customerId;
    const org = getSavedOrganization();
    const user = getCurrentUser();

    if (leadNameEl) leadNameEl.textContent = customer.name;
    if (leadMetaEl) leadMetaEl.textContent = customer.company ? `, ${customer.company}` : '';
    if (leadPhoneEl) leadPhoneEl.textContent = phone;

    // The model that fits the stage the opportunity is in comes first
    const models = [
      { key: 'first_contact', tone: 'Primeiro contato', stages: ['lead', 'contact'] },
      { key: 'proposal_followup', tone: 'Retorno da proposta', stages: ['proposal'] },
      { key: 'negotiation', tone: 'Negociação', stages: ['negotiation'] },
      { key: 'cold_lead', tone: 'Retomar contato', stages: ['lost'] }
    ];
    models.sort((x, y) => Number(y.stages.includes(customer.stage)) - Number(x.stages.includes(customer.stage)));
    renderTemplatesList(models.map(m => ({
      tone: m.tone,
      text: OUTREACH_TEMPLATES[m.key].template(customer, user, org.name)
    })), customer);

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
// Security & Input Sanitization Engine (Tríade CID: Integridade)
// ==========================================================================
function sanitizeInput(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[<>]/g, '') // Strip angle brackets to eliminate stored HTML/XSS injection at ingress
    .trim();
}

const parseSafeDealValue = parseMoney;

function formatMoneyField(amount) {
  return (Number(amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        custom: collectCustomFieldValues(),
        assignedTo: {
          id: assignedMember.id,
          name: assignedMember.name,
          email: assignedMember.email
        }
      };

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

// The stage list of the form follows the names the company chose
function fillStageSelect() {
  const select = document.getElementById('input-deal-stage');
  if (select) select.innerHTML = STAGES.map(stage => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`).join('');
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
    if (previewName) previewName.textContent = name || 'EDX Digital';
    if (previewIcon) {
      if (color) previewIcon.style.background = color;
      const safeLogo = safeImageUrl(logo);
      if (safeLogo) {
        previewIcon.innerHTML = `<img src="${escapeHtml(safeLogo)}" alt="" style="width: 100%; height: 100%; object-fit: contain;">`;
      } else {
        previewIcon.textContent = (name || 'E').charAt(0).toUpperCase();
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
      if (!file) return;
      if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
        showToast('Escolha uma imagem de até 5 MB.', 'error');
        return;
      }
      // Drawn at 256 px at most: sharp in the sidebar and on the proposal, small in the database
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 256 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const reduced = canvas.toDataURL('image/png');
        URL.revokeObjectURL(image.src);
        if (inputLogo) inputLogo.value = reduced;
        updatePreview(inputName?.value, reduced, inputColor?.value);
      };
      image.onerror = () => showToast('Não foi possível ler essa imagem.', 'error');
      image.src = URL.createObjectURL(file);
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
        legalName: 'EDX Digital',
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
        name: inputName?.value.trim() || 'EDX Digital',
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
      downloadAnchor.setAttribute("download", `edx_digital_backup_${timestamp}.json`);
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

// ==========================================================================
// Lead Import Modal Events (Excel / CSV / Paste)
// ==========================================================================
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
      const weak = passwordProblem(password, { email, name });
      if (weak) {
        showToast(weak, "error");
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
      const weak = passwordProblem(password, { email, name });
      if (weak) {
        showToast(weak, "error");
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
    const customers = state.visibleCustomers || [];

    const isUserAdmin = !!state.permissions?.isAdmin;

    const go = (view) => () => { window.closeCommandPalette(); window.navigateToView(view); };
    const click = (id) => () => { window.closeCommandPalette(); document.getElementById(id)?.click(); };
    const allActions = [
      { id: 'action-new-lead', title: 'Nova oportunidade', hint: 'N', category: 'Ações', run: click('btn-new-lead') },
      { id: 'action-import-csv', title: 'Importar contatos de uma planilha', hint: 'I', category: 'Ações', run: click('btn-open-import-modal') },
      { id: 'action-export-csv', title: 'Exportar clientes para planilha', hint: '', category: 'Ações', run: click('btn-export-csv') },
      { id: 'action-export-audit', title: 'Exportar o histórico de atividade', hint: '', adminOnly: true, category: 'Ações', run: () => { window.closeCommandPalette(); window.handleExportAudit(); } },
      { id: 'action-toggle-theme', title: 'Trocar entre tema claro e escuro', hint: '', category: 'Ações', run: () => { window.closeCommandPalette(); toggleTheme(); } },
      { id: 'action-toggle-role', title: 'Ver a demonstração com o outro perfil', hint: '', demoOnly: true, category: 'Ações', run: () => { window.closeCommandPalette(); window.handleToggleRole(); } },
      { id: 'action-shortcuts', title: 'Atalhos de teclado', hint: '?', category: 'Ações', run: () => { window.closeCommandPalette(); document.getElementById('shortcuts-dialog')?.showModal(); } },
      { id: 'nav-pipeline', title: 'Funil de vendas', hint: '1', category: 'Ir para', run: go('pipeline') },
      { id: 'nav-customers', title: 'Clientes', hint: '2', category: 'Ir para', run: go('customers') },
      { id: 'nav-tasks', title: 'Tarefas', hint: '3', category: 'Ir para', run: go('tasks') },
      { id: 'nav-metrics', title: 'Relatórios', hint: '4', category: 'Ir para', run: go('metrics') },
      { id: 'nav-team', title: 'Equipe', hint: '', adminOnly: true, category: 'Ir para', run: go('team') },
      { id: 'nav-audit', title: 'Auditoria', hint: '', adminOnly: true, category: 'Ir para', run: go('audit') },
      { id: 'nav-security', title: 'Segurança', hint: '5', adminOnly: true, category: 'Ir para', run: go('security') }
    ].map(action => ({ icon: '', ...action }));

        const defaultActions = allActions.filter(a => (!a.adminOnly || isUserAdmin) && (!a.demoOnly || isDemoSession()));

    let html = '';

    if (!q) {
      const categories = ['Ações', 'Ir para'];
      categories.forEach(cat => {
        const items = defaultActions.filter(a => a.category === cat);
        html += `<div class="command-group-title">${cat}</div>`;
        items.forEach((item, idx) => {
          const isFirst = cat === 'Ações' && idx === 0;
          html += `
            <div class="command-item ${isFirst ? 'active' : ''}" data-action-id="${escapeHtml(item.id)}">
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
        html += `<div class="command-group-title">Ações</div>`;
        matchedActions.forEach((item, idx) => {
          html += `
            <div class="command-item ${idx === 0 ? 'active' : ''}" data-action-id="${escapeHtml(item.id)}">
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
        html += `<div class="command-group-title">Oportunidades</div>`;
        matchedCustomers.forEach((c, idx) => {
          const isAct = matchedActions.length === 0 && idx === 0;
          html += `
            <div class="command-item ${isAct ? 'active' : ''}" data-customer-id="${escapeHtml(c.id)}">
              <div class="command-item-left">
                <span class="command-item-icon"></span>
                <div>
                  <div style="font-weight: 600; font-size: 0.82rem;">${escapeHtml(c.name)}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml([c.company, formatBRL(c.dealValue)].filter(Boolean).join(', '))}</div>
                </div>
              </div>
              <span class="command-item-hint">Abrir</span>
            </div>
          `;
        });
      }

      if (matchedActions.length === 0 && matchedCustomers.length === 0) {
        html = `
          <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            Nada encontrado para "<strong>${escapeHtml(q)}</strong>".
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

    // Single keys only act inside the app, with no window open and no modifier held:
    // otherwise "n" on the sign-in screen opened a form, and Alt+N or Ctrl+I were swallowed
    const activeEl = document.activeElement;
    const isTyping = activeEl && (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable);
    if (isTyping) {
      if (e.key === 'Escape') activeEl.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !isSessionActive() || document.querySelector('dialog[open]')) return;

    const key = e.key.toLowerCase();
    const views = { '1': 'pipeline', '2': 'customers', '3': 'tasks', '4': 'metrics', '5': 'security' };
    if (e.key === '?') {
      e.preventDefault();
      if (shortcutsDialog) shortcutsDialog.showModal();
    } else if (key === 'n') {
      // the same path as the button: plan limit, read-only mode and a clean form
      e.preventDefault();
      document.getElementById('btn-new-lead')?.click();
    } else if (key === 'i') {
      e.preventDefault();
      document.getElementById('btn-open-import-modal')?.click();
    } else if (views[e.key]) {
      window.navigateToView(views[e.key]);
    }
  });
}

// ==========================================================================
// Progressive Web App (PWA) & Service Worker Registration
// ==========================================================================
function setupPWA() {
  if ('serviceWorker' in navigator) {
    // When a new version takes over, the page reloads once so nobody keeps running the old code.
    // Not on the very first visit (there was no version before), and never while a window is open
    // or a field has unsaved text: then the new version simply applies on the next visit.
    const hadVersion = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadVersion || reloaded) return;
      const busy = document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (busy) return;
      reloaded = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker não registrado:', err);
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
        showToast("EDX Digital instalado com sucesso no seu sistema!", "success");
      }
      deferredPrompt = null;
      btnInstall.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    if (btnInstall) btnInstall.style.display = 'none';
    showToast("EDX Digital configurado como aplicativo nativo!", "success");
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
      window.handleExportAudit();
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

      const weak = passwordProblem(newPass, { email: getCurrentUser()?.email, name: getCurrentUser()?.name });
      if (weak) {
        showToast(weak, 'error');
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
    const rotated = res.status === 'blocked' && await retireInviteCode();
    showToast(res.status === 'active'
      ? `Acesso de ${emp.name} liberado.`
      : `Acesso de ${emp.name} bloqueado.${rotated ? ' O código de convite foi trocado, porque essa pessoa conhecia o antigo.' : ''}`, 'info');
    renderSecurityView(crmStore.getState());
  };

  // Whoever leaves knew the invite code and could come back with it: a new one is issued
  async function retireInviteCode() {
    if (!isCloudSession()) return false;
    const result = await replaceCompanyTeamInviteCode();
    if (!result.success) return false;
    recheckInviteWithSeats();
    logAudit(AUDIT_ACTIONS.TEAM_INVITE_REPLACED, { reason: 'saída de pessoa da equipe' });
    if (typeof window.refreshTeamInviteCard === 'function') window.refreshTeamInviteCard();
    return true;
  }

  const myself = () => {
    const me = getCurrentUser();
    return { id: me.uid || 'admin-user-01', name: me.name, email: me.email };
  };
  const openLeadsOf = (personId) => storage.getCustomers().filter(c => c.assignedTo?.id === personId && c.stage !== 'won' && c.stage !== 'lost').length;

  const reassignDialog = document.getElementById('reassign-dialog');
  let reassignFrom = null;
  window.handleReassignLeads = function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    const count = openLeadsOf(empId);
    if (!emp || !reassignDialog || count === 0) return;
    reassignFrom = emp;
    document.getElementById('reassign-text').textContent = `${emp.name} tem ${count === 1 ? '1 oportunidade em aberto' : `${count} oportunidades em aberto`}. As ganhas e as perdidas continuam no nome dessa pessoa, para o histórico.`;
    const targets = [myself(), ...getEmployees().filter(e => e.id !== empId && e.status !== 'blocked')];
    document.getElementById('reassign-target').innerHTML = targets.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    reassignDialog.showModal();
  };
  const closeReassign = () => reassignDialog?.close();
  document.getElementById('btn-close-reassign-dialog')?.addEventListener('click', closeReassign);
  document.getElementById('btn-cancel-reassign')?.addEventListener('click', closeReassign);
  document.getElementById('reassign-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!reassignFrom) return;
    const targetId = document.getElementById('reassign-target').value;
    const target = [myself(), ...getEmployees()].find(t => t.id === targetId);
    if (!target) return;
    try {
      const moved = await storage.reassignCustomers(reassignFrom.id, { id: target.id, name: target.name, email: target.email });
      logAudit(AUDIT_ACTIONS.LEADS_REASSIGNED, { de: reassignFrom.name, para: target.name, quantidade: moved }, AUDIT_SEVERITY.WARNING);
      closeReassign();
      showToast(`${moved === 1 ? '1 oportunidade transferida' : `${moved} oportunidades transferidas`} para ${target.name}.`, 'success');
    } catch (err) {
      reportError('Não foi possível transferir', err);
    }
  });

  window.handleDeleteEmployee = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    const open = openLeadsOf(empId);
    const portfolio = open === 0 ? '' : ` ${open === 1 ? 'A oportunidade em aberto dela passa' : `As ${open} oportunidades em aberto dela passam`} para você.`;
    if (!confirm(`Excluir o cadastro de ${emp.name}? A pessoa perde o acesso aos dados da empresa.${portfolio}`)) {
      return;
    }

    // The portfolio is handed over first: once the person is gone nobody would be looking after it
    if (open > 0 && !isReadOnly()) {
      try {
        await storage.reassignCustomers(empId, myself());
        logAudit(AUDIT_ACTIONS.LEADS_REASSIGNED, { de: emp.name, para: getCurrentUser().name, quantidade: open }, AUDIT_SEVERITY.WARNING);
      } catch (err) {
        reportError('Não foi possível transferir a carteira', err);
        return;
      }
    }

    const res = await deleteEmployee(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_DELETED, { empId, name: emp.name }, AUDIT_SEVERITY.CRITICAL);
    const rotated = await retireInviteCode();
    showToast(`Cadastro de ${emp.name} excluído.${rotated ? ' O código de convite foi trocado, porque essa pessoa conhecia o antigo.' : ''}`, 'info');
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
    const planNames = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
    const plan = currentPlan(org);
    const planState = getPlanState(org);
    const onTrial = planState.status === 'trial' || planState.status === 'trial_ended';
    const limit = describeLimit;
    const leads = leadsRoom(storage.getCustomers(), org);
    const seats = seatsRoom(getEmployees(), org);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('billing-plan-name', planNames[org.plan] || 'Professional');
    set('billing-plan-badge', describePlanState(planState));

    set('billing-leads-count', `${leads.used.toLocaleString('pt-BR')} de ${limit(leads.limit)}`);
    set('billing-users-count', `${seats.used} de ${limit(seats.limit)}`);

    // During the trial every plan can still be subscribed to, including the current one
    document.querySelectorAll('.btn-plan-select').forEach(btn => {
      const isCurrent = btn.dataset.plan === org.plan;
      const renew = isCurrent && !onTrial;
      btn.disabled = false;
      btn.textContent = renew ? `Renovar ${planNames[btn.dataset.plan]}` : `Assinar ${planNames[btn.dataset.plan] || btn.dataset.plan}`;
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

    const seats = seatsRoom(employees);
    const full = isCloudSession() && seats.left <= 0;
    const seatsNote = document.getElementById('team-seats-note');
    if (seatsNote) {
      seatsNote.hidden = !isCloudSession() || seats.unlimited;
      seatsNote.textContent = full
        ? `A equipe está completa: o plano ${currentPlan().name} comporta ${seats.limit} pessoas com acesso. O convite fica pausado até abrir uma vaga ou você mudar de plano.`
        : `${seats.used} de ${seats.limit} pessoas com acesso no plano ${currentPlan().name}.`;
      seatsNote.classList.toggle('is-warning', full);
    }
    if (displayTeamCode) displayTeamCode.textContent = full ? 'pausado' : (getCompanyTeamInviteCode() || 'sem código');
    if (btnCopyTeamCode) btnCopyTeamCode.disabled = full;
    // the same invite, already written in the person's e-mail program or WhatsApp
    const code = getCompanyTeamInviteCode();
    const canShare = !!code && !full && !isDemoSession();
    const links = canShare ? inviteShareLinks(code) : null;
    for (const [id, href] of [['link-invite-email', links && links.email], ['link-invite-whatsapp', links && links.whatsapp]]) {
      const link = document.getElementById(id);
      if (!link) continue;
      link.hidden = !canShare;
      link.href = href || '#';
    }
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
      recheckInviteWithSeats();
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
// Who did it comes from the team list (by account id); the name stored with the record is only a fallback,
// because that one is written by whoever made the record
function auditAuthor(log) {
  const me = getCurrentUser();
  if (me && log.userId === me.uid) return me.name;
  const colleague = getEmployees().find(e => e.id === log.userId);
  return colleague ? colleague.name : (log.userName || 'Pessoa removida');
}

function setupAuditTrailView() {
  function renderAuditView() {
    const stats = getAuditStats();
    const logs = getAuditLogs(150);

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
    const valueLabels = {
      blocked: 'bloqueado', active: 'liberado', admin: 'administrador', employee: 'vendedor',
      lead: 'novo lead', contact: 'primeiro contato', proposal: 'proposta', negotiation: 'negociação', won: 'ganho', lost: 'perdido',
      customers_csv: 'planilha de clientes', audit_csv: 'planilha do histórico', starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise'
    };
    // ids mean nothing to the reader; the names next to them already say which record it was
    const hiddenDetails = ['userAgent', 'screenSize', 'method', 'action', 'customerId', 'leadId', 'empId'];
    const methodLabels = {
      session_resume: 'sessão retomada', email_password: 'e-mail e senha', demo: 'demonstração',
      invite_code: 'código de convite', webhook_api: 'recebido por webhook'
    };

    tbody.innerHTML = logs.map(log => {
      const date = new Date(log.timestamp);
      const when = isNaN(date) ? 'sem data' : `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const details = log.details && typeof log.details === 'object' ? log.details : {};
      const parts = Object.entries(details)
        .filter(([k, v]) => !hiddenDetails.includes(k) && v !== undefined && v !== null && v !== '' && v !== 'user_action' && typeof v !== 'object')
        .map(([k, v]) => `${detailLabels[k] || k}: ${valueLabels[v] || v}`);
      if (details.method && methodLabels[details.method]) parts.unshift(methodLabels[details.method]);
      const needsAttention = log.severity === 'warning' || log.severity === 'critical';

      return `<tr>
        <td class="nowrap muted">${when}</td>
        <td>${escapeHtml(formatAuditAction(log.action).slice(0, 60))}${needsAttention ? ' <span class="status-text blocked">(atenção)</span>' : ''}</td>
        <td>${escapeHtml(auditAuthor(log))}<div class="cell-sub">${log.userRole === 'admin' ? 'Administrador' : 'Vendedor'}</div></td>
        <td class="muted">${escapeHtml(parts.join(', ').substring(0, 120))}</td>
      </tr>`;
    }).join('');
  }

  // Export audit CSV
  const btnExport = document.getElementById('btn-export-audit-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => window.handleExportAudit());
  }

  window.handleExportAudit = function() {
    if (!isAdmin()) return;
    if (getAuditLogs(1).length === 0) {
      showToast('Ainda não há nada no histórico para exportar.', 'info');
      return;
    }
    const blob = new Blob(['\ufeff' + exportAuditToCSV(auditAuthor)], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `edx-digital-historico-${localDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Histórico exportado.', 'success');
    logAudit(AUDIT_ACTIONS.DATA_EXPORTED, { type: 'audit_csv' });
  };

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
      listEl.innerHTML = '<p class="notification-empty">Nada por aqui. Os lembretes de tarefa e os contatos que chegam por formulário aparecem nesta lista.</p>';
      return;
    }

    listEl.innerHTML = notifications.map(n => {
      const date = new Date(n.timestamp);
      const minutes = Math.floor((Date.now() - date) / 60000);
      const when = minutes < 1 ? 'agora'
        : minutes < 60 ? `há ${minutes} min`
        : minutes < 1440 ? `há ${Math.floor(minutes / 60)} h`
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<button type="button" class="notification-item ${n.read ? '' : 'unread'}" data-click="handleNotificationClick" data-a="${escapeHtml(n.id)}">
        <span class="notification-item-title">${escapeHtml(n.title)}</span>
        <span class="notification-item-body">${escapeHtml(n.body)}</span>
        <span class="notification-item-time">${when}</span>
      </button>`;
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
    });
  }

  // Browser notifications: asked for only when the person clicks
  if (enablePushBtn) {
    const reflect = () => {
      const permission = getNotificationPermission();
      enablePushBtn.hidden = permission === 'unsupported';
      enablePushBtn.disabled = permission === 'granted' || permission === 'denied';
      enablePushBtn.textContent = permission === 'granted' ? 'Avisos do navegador ativados'
        : permission === 'denied' ? 'Avisos bloqueados nas configurações do navegador'
        : 'Avisar também pelo navegador';
    };
    enablePushBtn.addEventListener('click', async () => {
      const permission = await requestNotificationPermission();
      reflect();
      if (permission === 'granted') showToast('Pronto. Os lembretes de tarefa também vão aparecer como aviso do navegador.', 'success');
    });
    reflect();
  }

  // Notification click handler
  window.handleNotificationClick = function(notifId) {
    const notification = markAsRead(notifId);
    updateBadge();
    if (dropdown) dropdown.style.display = 'none';
    const target = (notification && notification.data) || {};
    if (target.view) window.navigateToView(target.view);
    if (target.customerId && storage.getCustomer(target.customerId)) window.handleOpenLeadDetails(target.customerId);
  };

  // Subscribe to changes
  onNotificationsChange(() => {
    updateBadge();
    if (dropdown && dropdown.style.display !== 'none') renderNotificationList();
  });

  // Initial state
  updateBadge();
}

// ==========================================================================
// Commercial Subscription & 1-Click PIX Checkout Engine
// ==========================================================================
// Plain words for where the plan stands
function describePlanState(state) {
  const days = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
  const date = (iso) => new Date(iso).toLocaleDateString('pt-BR');
  if (state.status === 'trial') return `Período de teste: ${days(state.daysLeft)} restantes`;
  if (state.status === 'trial_ended') return 'Período de teste encerrado';
  if (state.status === 'active') return `Ativo até ${date(state.until)}`;
  if (state.status === 'grace') return `Vencido em ${date(state.until)}`;
  return `Vencido em ${date(state.until)}, em modo de leitura`;
}

/**
 * Everything on screen that depends on where the plan stands: the pill in the header,
 * the notice above the content and the read-only mode.
 */
function refreshPlanPill() {
  const state = getPlanState();
  const cloud = isCloudSession();
  const admin = isAdmin();
  const days = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

  // Read-only mode: creating and changing are switched off across the app
  document.body.classList.toggle('is-read-only', cloud && state.readOnly);

  const pill = document.getElementById('trial-header-pill');
  const pillText = document.getElementById('trial-pill-text');
  if (pill && pillText) {
    let label = '';
    if (state.status === 'trial') label = `Teste: ${days(state.daysLeft)} restantes`;
    else if (state.status === 'active' && state.daysLeft <= 5) label = `Plano vence em ${days(state.daysLeft)}`;
    pillText.textContent = label;
    pill.style.display = label && admin ? '' : 'none';
  }

  const banner = document.getElementById('plan-banner');
  const bannerText = document.getElementById('plan-banner-text');
  const bannerAction = document.getElementById('plan-banner-action');
  if (!banner || !bannerText || !bannerAction) return;

  let text = '';
  let action = '';
  if (cloud && state.status === 'trial_ended') {
    text = 'O período de teste terminou. Você continua vendo e exportando seus dados, mas não é possível criar nem alterar nada.';
    action = 'Assinar um plano';
  } else if (cloud && state.status === 'expired') {
    text = `O plano venceu em ${new Date(state.until).toLocaleDateString('pt-BR')}. Você continua vendo e exportando seus dados, mas não é possível criar nem alterar nada.`;
    action = 'Renovar o plano';
  } else if (cloud && state.status === 'grace') {
    text = `O plano venceu em ${new Date(state.until).toLocaleDateString('pt-BR')}. Renove em até ${days(state.daysLeft)} para o CRM não entrar em modo de leitura.`;
    action = 'Renovar o plano';
  }

  banner.hidden = !text;
  banner.classList.toggle('is-blocking', state.readOnly === true);
  bannerText.textContent = text && !admin ? `${text} Fale com quem administra o CRM da sua empresa.` : text;
  bannerAction.textContent = action;
  bannerAction.style.display = admin ? '' : 'none';
}
window.refreshPlanPill = refreshPlanPill;

// Called by the storage layer when something tries to change data in read-only mode
let lastReadOnlyNotice = 0;
window.handleReadOnlyAttempt = function() {
  refreshPlanPill();
  const banner = document.getElementById('plan-banner');
  if (banner && !banner.hidden) banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (Date.now() - lastReadOnlyNotice < 4000) return;
  lastReadOnlyNotice = Date.now();
  showToast(
    isAdmin() ? 'O CRM está em modo de leitura. Assine um plano para voltar a criar e alterar.' : 'O CRM está em modo de leitura. Fale com quem administra o CRM da sua empresa.',
    'warning',
    isAdmin() ? { label: 'Ver planos', onClick: () => window.openCheckoutModal() } : null
  );
};

// An error from a blocked change was already explained by the notice above
function reportError(prefix, err) {
  if (err && err.code === 'read-only') return;
  if (err && err.code === 'plan-limit') {
    showToast(err.message, 'warning', isAdmin() ? { label: 'Ver planos', onClick: () => window.openCheckoutModal() } : null);
    return;
  }
  showToast(`${prefix}: ${err.message}`, 'error');
}

// ==========================================================================
// Subscribing: a PIX charge is created on the billing server, and this window
// watches until the payment is confirmed. The plan is released by the server.
// ==========================================================================
function setupCheckoutModalEvents() {
  const modal = document.getElementById('modal-checkout');
  if (!modal) return;

  const el = (id) => document.getElementById(id);
  const planNames = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
  let activePlan = 'pro';
  let activePaymentId = null;
  let pollTimer = null;
  let requestSeq = 0;

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  // One of: a message (loading, demo, error), the PIX code, or the confirmation
  const show = (state, text = '', canRetry = false) => {
    el('chk-state-message').hidden = state !== 'message';
    el('chk-state-ready').hidden = state !== 'ready';
    el('chk-state-approved').hidden = state !== 'approved';
    if (state === 'message') {
      el('chk-state-text').textContent = text;
      el('chk-retry').hidden = !canRetry;
    }
  };

  const renderCurrentPlan = () => {
    const org = getSavedOrganization();
    el('chk-current-plan-badge').textContent = planNames[org.plan] || 'Professional';
    el('chk-trial-days-badge').textContent = describePlanState(getPlanState(org));
  };

  const api = async (path, options = {}) => {
    const token = await getIdToken();
    const res = await fetch(`${window.getApiBaseUrl()}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Não foi possível concluir.');
      err.code = data.error;
      throw err;
    }
    return data;
  };

  const onApproved = async (result) => {
    stopPolling();
    activePaymentId = null;
    await refreshOrganization().catch(() => {});
    renderCurrentPlan();
    refreshPlanPill();
    const until = result.paidUntil ? new Date(result.paidUntil).toLocaleDateString('pt-BR') : '';
    el('chk-approved-text').textContent = `O plano ${planNames[result.plan] || ''} está ativo${until ? ` até ${until}` : ''}.`;
    show('approved');
    logAudit(AUDIT_ACTIONS.PLAN_CHANGED, { plan: result.plan });
    showToast('Pagamento confirmado. Plano liberado.', 'success');
    if (crmStore) crmStore.emitChange();
  };

  const checkPayment = async () => {
    if (!activePaymentId) return;
    try {
      const result = await api(`/api/billing/pix/${activePaymentId}`);
      if (result.status === 'approved') {
        await onApproved(result);
      } else if (result.status !== 'pending') {
        stopPolling();
        show('message', 'Esta cobrança foi cancelada ou venceu. Gere outra para pagar.', true);
      }
    } catch {
      // A failed check is not a failed payment: keep waiting
    }
  };

  const loadCharge = async (plan) => {
    activePlan = plan;
    stopPolling();
    activePaymentId = null;
    const seq = ++requestSeq;

    if (!isCloudSession()) {
      show('message', 'Na demonstração não há cobrança. Crie uma conta para assinar um plano.');
      return;
    }
    if (!isAdmin()) {
      show('message', 'Só quem administra a empresa pode assinar um plano.');
      return;
    }

    // The billing server may be asleep; the first answer can take a while
    show('message', 'Gerando o PIX. Isso pode levar até um minuto.');
    try {
      const charge = await api('/api/billing/pix', { method: 'POST', body: JSON.stringify({ plan }) });
      if (seq !== requestSeq) return; // another plan was chosen meanwhile
      activePaymentId = charge.paymentId;
      el('chk-pix-copypaste-input').value = charge.copyPaste;
      el('chk-pix-qrcode-img').src = charge.qrCodeBase64 ? `data:image/png;base64,${charge.qrCodeBase64}` : '';
      el('chk-pix-qrcode-img').closest('.pix-qr').style.display = charge.qrCodeBase64 ? '' : 'none';
      el('chk-pix-amount').textContent = formatBRL(charge.amount);
      show('ready');
      pollTimer = setInterval(checkPayment, 5000);
    } catch (err) {
      if (seq !== requestSeq) return;
      if (err.code === 'billing_not_configured') {
        show('message', 'A cobrança automática ainda não está disponível. Fale com o suporte para assinar.');
      } else {
        show('message', err.message || 'Não foi possível gerar o PIX. Tente de novo.', true);
      }
    }
  };

  window.selectCheckoutPlan = function(plan) {
    document.querySelectorAll('.checkout-plan-card').forEach(card => {
      card.classList.toggle('active', card.dataset.plan === plan);
    });
    loadCharge(plan);
  };

  window.openCheckoutModal = function(plan) {
    if (!isSessionActive()) return;
    const org = getSavedOrganization();
    renderCurrentPlan();
    if (!modal.open) modal.showModal();
    window.selectCheckoutPlan(planNames[plan] ? plan : (planNames[org.plan] ? org.plan : 'pro'));
  };

  // One way to subscribe: plan buttons and links from the plans page all land here
  window.openCheckout = function(plan = 'pro') {
    const billingDialog = document.getElementById('billing-dialog');
    if (billingDialog && billingDialog.open) billingDialog.close();
    window.openCheckoutModal(plan);
  };

  const close = () => {
    stopPolling();
    requestSeq += 1;
    if (modal.open) modal.close();
  };
  el('btn-close-checkout-modal')?.addEventListener('click', close);
  el('btn-close-checkout-footer')?.addEventListener('click', close);
  modal.addEventListener('close', stopPolling);
  el('chk-retry')?.addEventListener('click', () => loadCharge(activePlan));

  el('btn-copy-pix-code')?.addEventListener('click', async () => {
    const input = el('chk-pix-copypaste-input');
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('Código PIX copiado. Cole no aplicativo do seu banco.', 'success');
    } catch {
      input.select();
      showToast('Selecione o código e copie com Ctrl+C.', 'info');
    }
  });

  // Coming back to the tab after paying in the bank app: check right away
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activePaymentId) checkPayment();
  });

  refreshPlanPill();
}
