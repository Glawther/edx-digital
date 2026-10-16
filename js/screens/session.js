/**
 * EDX Digital - Entering a session: loads what belongs to the signed-in person, or shows the sign-in screen
 */

import { refreshOwnerEntry } from '../ui/owner-panel.js';
import { startTourIfPending } from '../ui/tour.js';
import { crmStore } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, initAuditFirestore, logAudit } from '../services/audit-service.js';
import { getCurrentUser, isAdmin, isCloudSession, isSessionActive, markActivity, needsReloadToRetry, retrySessionRestore } from '../services/auth-service.js';
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

/**
 * A real account was signed in here but the server could not confirm it in time (slow network).
 * Shows the waiting screen and resolves once the session is settled, either way; the caller then
 * enters the session or shows the sign-in screen as usual.
 */
export function waitForSessionRestore() {
  const screen = document.getElementById('auth-offline-screen');
  const button = document.getElementById('btn-auth-offline-retry');
  const status = document.getElementById('auth-offline-status');
  if (screen) screen.style.display = '';

  return new Promise((resolve) => {
    let done = false;
    let timer = null;

    const finish = () => {
      done = true;
      clearInterval(timer);
      window.removeEventListener('online', attempt);
      if (screen) screen.style.display = 'none';
      resolve();
    };

    async function attempt(fromButton = false) {
      if (done) return;
      if (fromButton === true && button) {
        button.disabled = true;
        if (status) status.textContent = 'Tentando conectar...';
      }
      // the SDK download failed outright: only a fresh page fetches it again. Done when the person
      // asks or the network comes back, never from the timer, so an offline page does not keep reloading
      if (needsReloadToRetry()) {
        if (fromButton === true || (fromButton && fromButton.type === 'online')) window.location.reload();
        return;
      }
      const settled = await retrySessionRestore();
      if (done) return;
      if (settled) {
        finish();
        return;
      }
      if (fromButton === true) {
        if (button) button.disabled = false;
        if (status) status.textContent = 'Ainda sem conexão. O CRM continua tentando sozinho.';
      }
    }

    if (button) button.addEventListener('click', () => attempt(true));
    window.addEventListener('online', attempt);
    // a slow network may answer later on its own
    timer = setInterval(attempt, 15000);
  });
}

// Nothing that belongs to a company stays in this browser after its session ends.
// Kept on purpose: theme and the Gemini key (device settings),
// and the demo's sample data.
export function clearCompanyDataFromBrowser() {
  ['edx_audit_logs', 'edx_last_activity', 'edx_reminder_rung'].forEach(key => localStorage.removeItem(key));
  clearNotifications();
}
