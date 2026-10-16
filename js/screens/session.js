/**
 * EDX Digital - Entering a session: loads what belongs to the signed-in person, or shows the sign-in screen
 */

import { refreshOwnerEntry } from '../ui/owner-panel.js';
import { startTourIfPending } from '../ui/tour.js';
import { crmStore } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, initAuditFirestore, logAudit } from '../services/audit-service.js';
import { getCurrentUser, isAdmin, isCloudSession, isSessionActive, markActivity } from '../services/auth-service.js';
import { startEmployeeSync, stopEmployeeSync } from '../services/employee-service.js';
import { getFirestoreDb } from '../services/firebase-service.js';
import { clearNotifications, notify } from '../services/notification-service.js';
import { startTaskReminders, stopTaskReminders } from '../services/reminder-service.js';
import { showToast } from '../ui/ui-renderer.js';

/**
 * Loads everything that belongs to the current session, or shows the sign-in screen when there is none.
 * Called on page load and after every sign-in.
 */
export async function enterSession({ resumed = false } = {}) {
  document.body.classList.remove('auth-pending');

  if (!isSessionActive()) {
    stopEmployeeSync();
    stopTaskReminders();
    storage.reset();
    initAuditFirestore(null);
    refreshOwnerEntry();
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
  if (typeof window.navigateToView === 'function') window.navigateToView('today');
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

  // the entry to the owner's panel shows only to whom the server says owns the system
  refreshOwnerEntry();

  // an account created a moment ago gets the tour (it waits for any window above to be closed)
  startTourIfPending();
}

// Nothing that belongs to a company stays in this browser after its session ends.
// Kept on purpose: theme and the Gemini key (device settings),
// and the demo's sample data.
export function clearCompanyDataFromBrowser() {
  ['edx_audit_logs', 'edx_last_activity', 'edx_reminder_rung'].forEach(key => localStorage.removeItem(key));
  clearNotifications();
}
