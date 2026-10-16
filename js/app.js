/**
 * EDX Digital - Application Orchestrator
 * Wires the screens to the store, the storage and the services
 */

import { tasksToIcs } from './core/agenda.js';
import { setupOwnerPanel } from './ui/owner-panel.js';
import { setupErrorReporting } from './services/error-report.js';
import { applyWhitelabelStyles, getSavedOrganization } from './core/config.js';
import { crmStore } from './core/crm-store.js';
import { storage } from './core/storage-manager.js';
import { initTheme } from './core/theme-manager.js';
import {
  initAuth,
  isIdleTooLong,
  isSessionActive,
  isSessionRestorePending,
  logoutToPortal,
  onAuthChange
} from './services/auth-service.js';
import { forgetOldWebhookToken } from './services/webhook-service.js';
import { onAuditLog } from './services/audit-service.js';
import { pendingWriteCount } from './services/firebase-service.js';
import { notify } from './services/notification-service.js';
import { registerActions, setupActions } from './ui/actions.js';
import { setupCustomizeDialog } from './ui/customize-dialog.js';
import { setupImportDialog } from './ui/import-dialog.js';
import {
  renderAuthBadge,
  renderConnectionStatus,
  setSyncState,
  renderDetailedMetrics,
  renderToday,
  renderPipelineSwitch,
  moveWeek,
  setTodayOwner,
  exportSellerReport,
  renderFocusPills,
  renderKanban,
  renderKPIs,
  renderSecurityView,
  renderTable,
  renderTasksView,
  showToast
} from './ui/ui-renderer.js';
import { setupAccountDialog, setupAuthPortalEvents, setupIdleSignOut } from './screens/account.js';
import {
  setupBackupEvents,
  setupExportEvents,
  setupWebhookModalEvents,
  setupWhitelabelEvents
} from './screens/company.js';
import { setupGeminiModals, setupProposalModalEvents, setupWhatsAppModalEvents } from './screens/messages.js';
import {
  refreshOpenOpportunity,
  setupDialogEvents,
  setupLeadDetailsEvents,
  setupTasksEvents
} from './screens/opportunity.js';
import { setupFilterEvents, setupLossReasonEvents } from './screens/pipeline.js';
import { setupBillingEvents, setupCheckoutModalEvents } from './screens/plan.js';
import { enterSession, waitForSessionRestore } from './screens/session.js';
import {
  applyRoleUIRestrictions,
  setupCommandPalette,
  setupHeaderToolsMenu,
  setupKeyboardShortcuts,
  setupNavigation,
  setupNotificationCenter,
  setupPWA,
  updateNavCounters
} from './screens/shell.js';
import { setupAuditTrailView, setupEmployeeManagementEvents, setupTeamInviteEvents } from './screens/team.js';

// ==========================================================================
// Initialization
// ==========================================================================
async function initApp() {
  try {
    initTheme();
    setupErrorReporting();
    setupActions();
    registerActions({
      openNewOpportunity: () => document.getElementById('btn-new-lead')?.click(),
      openImport: () => document.getElementById('btn-menu-import')?.click(),
      openGeminiKey: () => {
        document.getElementById('gemini-dialog')?.close();
        document.getElementById('sidebar-gemini-btn')?.click();
      },
      handleCustomersStage: (stage) => window.handleCustomersView({ stage }),
      handleCustomersSort: (sort) => window.handleCustomersView({ sort }),
      // from the "Hoje" screen: the funnel showing only what one of its lists holds
      openFunnelFocus: (focus) => { window.handleFocus(focus); window.navigateToView('pipeline'); },
      openView: (view) => window.navigateToView(view),
      handlePipeline: (pipelineId) => crmStore.setActivePipeline(pipelineId),
      handleWeek: (step) => { moveWeek(Number(step) || 0); crmStore.emitChange(); },
      handleExportAgenda: () => {
        const text = tasksToIcs(crmStore.getState().tasks);
        const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'edx-digital-agenda.ics';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast('Agenda baixada. Abra o arquivo, ou importe-o no seu calendário.', 'success');
      },
      handleTodayOwner: (ownerId) => { setTodayOwner(ownerId || ''); crmStore.emitChange(); },
      handleExportSellerReport: () => {
        try {
          exportSellerReport(crmStore.getState().pipelineCustomers);
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
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
    setupOwnerPanel();
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

    // the audit counter follows each new record, not only changes to the opportunities
    onAuditLog(() => updateNavCounters(crmStore.getState()));

    // What the header says about saving follows the writes and the connection; closing the tab
    // with changes not yet confirmed by the server asks first (they would be lost)
    window.addEventListener('edx-sync', (event) => setSyncState({ pending: event.detail.pending }));
    window.addEventListener('online', () => setSyncState({ online: true }));
    window.addEventListener('offline', () => setSyncState({ online: false }));
    window.addEventListener('beforeunload', (event) => {
      if (pendingWriteCount() > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    // Leads from forms are written by the server straight into the company: a word when one arrives
    forgetOldWebhookToken();
    window.addEventListener('edx-form-lead', (event) => {
      const names = event.detail.names || [];
      if (names.length === 0) return;
      showToast(names.length === 1 ? `Novo contato pelo formulário: ${names[0]}.` : `${names.length} novos contatos chegaram pelo formulário.`, 'success');
      notify('Novo contato pelo formulário', names.length === 1 ? `${names[0]} entrou no funil.` : `${names.length} contatos entraram no funil.`, { view: 'pipeline' });
    });

    // The company's own stage names and extra fields: redraw whenever the company record changes
    crmStore.setPipelines(getSavedOrganization());
    window.addEventListener('edx-organization-changed', (event) => {
      crmStore.setPipelines(event.detail || getSavedOrganization());
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
      renderPipelineSwitch(state.pipelines, state.activePipelineId, state.visibleCustomers);
      // the first-run invitation is for whoever has no opportunity at all, not for an empty funnel
      renderKanban(state.filteredCustomers, state.metrics, state.permissions, state.visibleCustomers.length);
      renderFocusPills(state.focus, state.attention);
      renderTable(state.filteredCustomers, state.permissions);
      renderTasksView(state.tasks, state.taskFilter, state.allCustomers);
      renderDetailedMetrics(state.metrics, state.pipelineCustomers, state.permissions, state.visibleCustomers);
      renderToday(state.visibleCustomers, state.permissions);
      renderSecurityView(state);
      renderConnectionStatus(state.storageMode);
      updateNavCounters(state);
      applyRoleUIRestrictions(state.permissions);

      refreshOpenOpportunity(state);
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
    // a saved account the server could not confirm yet: wait for it instead of the sign-in form
    if (isSessionRestorePending()) await waitForSessionRestore();
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

// Inicialização imediata se o DOM já estiver pronto, ou no evento DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
