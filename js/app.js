/**
 * EDX Digital - Application Orchestrator
 * Wires the screens to the store, the storage and the services
 */

import { applyWhitelabelStyles, getSavedOrganization } from './core/config.js';
import { applyStageNames, crmStore } from './core/crm-store.js';
import { storage } from './core/storage-manager.js';
import { initTheme } from './core/theme-manager.js';
import {
  initAuth,
  isAdmin,
  isIdleTooLong,
  isReadOnly,
  isSessionActive,
  logoutToPortal,
  onAuthChange
} from './services/auth-service.js';
import { pollWebhookInbox } from './services/webhook-service.js';
import { registerActions, setupActions } from './ui/actions.js';
import { setupCustomizeDialog } from './ui/customize-dialog.js';
import { setupImportDialog } from './ui/import-dialog.js';
import {
  renderAuthBadge,
  renderConnectionStatus,
  renderDetailedMetrics,
  renderToday,
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
import { enterSession } from './screens/session.js';
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
      handleExportSellerReport: () => {
        try {
          exportSellerReport(crmStore.getState().visibleCustomers);
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
