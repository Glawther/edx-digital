/**
 * EDX Digital - Small helpers every screen uses
 */

import { SALES_TEAM, STAGES } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { getCurrentUser, isAdmin, isCloudSession } from '../services/auth-service.js';
import { getEmployees } from '../services/employee-service.js';
import { parseMoney } from '../services/import-service.js';
import { escapeHtml, showToast } from '../ui/ui-renderer.js';

// ==========================================================================
// Dynamic Cloud Backend API Base URL Resolver
// ==========================================================================
window.getApiBaseUrl = function() {
  const host = window.location.hostname;
  // Served by the Node server itself (local development or Render): same origin
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) return '';
  return 'https://nexus-crm-yfof.onrender.com';
};

/**
 * People a lead can be assigned to in the current session
 */
export function getAssignableMembers() {
  const active = getEmployees().filter(e => e.status !== 'blocked');
  if (isCloudSession()) {
    const me = getCurrentUser();
    const self = { id: me.uid, name: me.name, email: me.email, jobTitle: isAdmin() ? 'Administrador' : 'Vendedor' };
    return isAdmin() ? [self, ...active] : [self];
  }
  const demoAdmin = SALES_TEAM.find(m => m.role === 'admin');
  return [...active, { ...demoAdmin, jobTitle: 'Administrador' }];
}

export function fillAssigneeSelect(select, selectedEmail) {
  const members = getAssignableMembers();
  select.innerHTML = members.map(m => `
    <option value="${escapeHtml(m.email)}">${escapeHtml(m.name)} (${escapeHtml(m.jobTitle || 'Vendedor')})</option>
  `).join('');
  const wanted = members.find(m => m.email === selectedEmail);
  select.value = wanted ? wanted.email : (members[0] ? members[0].email : '');
}

// A copy of the opportunity taken before a change, so the change can be undone
export function snapshotOf(customerId) {
  const customer = storage.getCustomer(customerId);
  return customer ? JSON.parse(JSON.stringify(customer)) : null;
}

export function undoAction(snapshot, doneMessage) {
  if (!snapshot) return null;
  return {
    label: 'Desfazer',
    onClick: async () => {
      await storage.restoreCustomer(snapshot);
      showToast(doneMessage, 'info');
    }
  };
}

// ==========================================================================
// Security & Input Sanitization Engine (Tríade CID: Integridade)
// ==========================================================================
export function sanitizeInput(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[<>]/g, '') // Strip angle brackets to eliminate stored HTML/XSS injection at ingress
    .trim();
}

export const parseSafeDealValue = parseMoney;

export function formatMoneyField(amount) {
  return (Number(amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The stage list of the form follows the names the company chose
export function fillStageSelect() {
  const select = document.getElementById('input-deal-stage');
  if (select) select.innerHTML = STAGES.map(stage => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`).join('');
}

// An error from a blocked change was already explained by the notice above
export function reportError(prefix, err) {
  if (err && err.code === 'read-only') return;
  if (err && err.code === 'plan-limit') {
    showToast(err.message, 'warning', isAdmin() ? { label: 'Ver planos', onClick: () => window.openCheckoutModal() } : null);
    return;
  }
  showToast(`${prefix}: ${err.message}`, 'error');
}
