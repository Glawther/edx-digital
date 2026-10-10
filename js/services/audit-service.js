/**
 * Nexus CRM - Audit Trail Service (Tríade CID: Integridade)
 * Logs all sensitive operations to Firestore's immutable audit_logs collection.
 * Local fallback with localStorage when Firestore is unavailable.
 */

import { getSavedOrganization } from '../core/config.js';
import { getCurrentUser } from './auth-service.js';

const AUDIT_STORAGE_KEY = 'nexus_crm_audit_logs';
const MAX_LOCAL_LOGS = 500;

// Firestore SDK lazy-loaded
const FIREBASE_SDK_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
const FIRESTORE_SDK_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

let firestoreDb = null;
let firestoreModules = null;

/**
 * Action type constants for audit trail
 */
export const AUDIT_ACTIONS = {
  // Lead lifecycle
  LEAD_CREATED: 'lead_created',
  LEAD_UPDATED: 'lead_updated',
  LEAD_DELETED: 'lead_deleted',
  LEAD_STAGE_CHANGED: 'lead_stage_changed',
  LEAD_WON: 'lead_won',
  LEAD_LOST: 'lead_lost',

  // User management
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_REGISTERED: 'user_registered',
  EMPLOYEE_CREATED: 'employee_created',
  EMPLOYEE_DELETED: 'employee_deleted',
  EMPLOYEE_PASSWORD_RESET: 'employee_password_reset',
  EMPLOYEE_STATUS_CHANGED: 'employee_status_changed',
  TEAM_INVITE_SENT: 'team_invite_sent',

  // Data operations
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  BACKUP_CREATED: 'backup_created',
  BACKUP_RESTORED: 'backup_restored',

  // Config changes
  CONFIG_FIREBASE_CHANGED: 'config_firebase_changed',
  CONFIG_GEMINI_CHANGED: 'config_gemini_changed',
  CONFIG_WHITELABEL_CHANGED: 'config_whitelabel_changed',
  PLAN_CHANGED: 'plan_changed',

  // Security
  ROLE_SWITCHED: 'role_switched',
  PERMISSION_DENIED: 'permission_denied'
};

/**
 * Severity levels for audit entries
 */
export const AUDIT_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

/**
 * Initializes the Firestore connection for audit logging
 */
export async function initAuditFirestore(db) {
  firestoreDb = db;
  try {
    firestoreModules = await import(FIRESTORE_SDK_URL);
  } catch (e) {
    console.warn('[Audit] Could not load Firestore modules:', e);
  }
}

/**
 * Logs an audit event to Firestore and local storage
 * @param {string} action - Action type from AUDIT_ACTIONS
 * @param {Object} details - Additional context about the action
 * @param {string} severity - Severity level from AUDIT_SEVERITY
 */
export async function logAudit(action, details = {}, severity = AUDIT_SEVERITY.INFO) {
  const user = getCurrentUser();
  const org = getSavedOrganization();

  const entry = {
    id: 'audit-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    action,
    severity,
    timestamp: new Date().toISOString(),
    userId: user?.uid || 'anonymous',
    userName: user?.name || 'Desconhecido',
    userEmail: user?.email || '',
    userRole: user?.role || 'unknown',
    orgId: org?.id || 'org_nexus_default',
    orgName: org?.name || 'Nexus CRM',
    details: {
      ...details,
      userAgent: navigator.userAgent?.substring(0, 120) || '',
      screenSize: `${window.innerWidth}x${window.innerHeight}`
    }
  };

  // 1. Always save locally first (immediate persistence)
  saveLocalAudit(entry);

  // 2. Attempt Firestore write (non-blocking, fire-and-forget)
  if (firestoreDb && firestoreModules) {
    try {
      const docRef = firestoreModules.doc(firestoreDb, 'audit_logs', entry.id);
      await firestoreModules.setDoc(docRef, entry);
    } catch (err) {
      console.warn('[Audit] Firestore write failed (local copy preserved):', err.message);
    }
  }

  // 3. Notify subscribers
  notifySubscribers(entry);
  return entry;
}

/**
 * Saves audit entry to localStorage
 */
function saveLocalAudit(entry) {
  try {
    const logs = getLocalAuditLogs();
    logs.unshift(entry); // Most recent first
    
    // Trim to max size
    if (logs.length > MAX_LOCAL_LOGS) {
      logs.length = MAX_LOCAL_LOGS;
    }

    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn('[Audit] localStorage write error:', e);
  }
}

/**
 * Retrieves all local audit logs
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} Audit log entries sorted by most recent first
 */
export function getLocalAuditLogs(limit = MAX_LOCAL_LOGS) {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (raw) {
      const logs = JSON.parse(raw);
      return Array.isArray(logs) ? logs.slice(0, limit) : [];
    }
  } catch (e) {
    console.warn('[Audit] Could not parse local audit logs:', e);
  }
  return [];
}

/**
 * Gets audit log statistics
 */
export function getAuditStats() {
  const logs = getLocalAuditLogs();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const todayLogs = logs.filter(l => new Date(l.timestamp) >= today);
  const weekLogs = logs.filter(l => new Date(l.timestamp) >= weekAgo);
  
  // Count by severity
  const criticalCount = logs.filter(l => l.severity === AUDIT_SEVERITY.CRITICAL).length;
  const warningCount = logs.filter(l => l.severity === AUDIT_SEVERITY.WARNING).length;
  
  // Count by action type
  const actionCounts = {};
  logs.forEach(l => {
    actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
  });

  // Unique users
  const uniqueUsers = new Set(logs.map(l => l.userId)).size;

  return {
    totalLogs: logs.length,
    todayLogs: todayLogs.length,
    weekLogs: weekLogs.length,
    criticalCount,
    warningCount,
    actionCounts,
    uniqueUsers,
    lastActivity: logs[0]?.timestamp || null
  };
}

/**
 * Formats an audit action into a human-readable label
 */
export function formatAuditAction(action) {
  const labels = {
    [AUDIT_ACTIONS.LEAD_CREATED]: 'Lead Criado',
    [AUDIT_ACTIONS.LEAD_UPDATED]: 'Lead Atualizado',
    [AUDIT_ACTIONS.LEAD_DELETED]: 'Lead Excluído',
    [AUDIT_ACTIONS.LEAD_STAGE_CHANGED]: 'Estágio Alterado',
    [AUDIT_ACTIONS.LEAD_WON]: 'Negócio Fechado (Ganho)',
    [AUDIT_ACTIONS.LEAD_LOST]: 'Negócio Perdido',
    [AUDIT_ACTIONS.USER_LOGIN]: 'Login Realizado',
    [AUDIT_ACTIONS.USER_LOGOUT]: 'Logout',
    [AUDIT_ACTIONS.USER_REGISTERED]: 'Conta Criada',
    [AUDIT_ACTIONS.EMPLOYEE_CREATED]: 'Colaborador Cadastrado',
    [AUDIT_ACTIONS.EMPLOYEE_DELETED]: 'Colaborador Excluído',
    [AUDIT_ACTIONS.EMPLOYEE_PASSWORD_RESET]: 'Senha Reset',
    [AUDIT_ACTIONS.EMPLOYEE_STATUS_CHANGED]: 'Status Alterado',
    [AUDIT_ACTIONS.TEAM_INVITE_SENT]: 'Convite Enviado',
    [AUDIT_ACTIONS.DATA_EXPORTED]: 'Dados Exportados',
    [AUDIT_ACTIONS.DATA_IMPORTED]: 'Dados Importados',
    [AUDIT_ACTIONS.BACKUP_CREATED]: 'Backup Criado',
    [AUDIT_ACTIONS.BACKUP_RESTORED]: 'Backup Restaurado',
    [AUDIT_ACTIONS.CONFIG_FIREBASE_CHANGED]: 'Firebase Config Alterado',
    [AUDIT_ACTIONS.CONFIG_GEMINI_CHANGED]: 'Gemini Config Alterado',
    [AUDIT_ACTIONS.CONFIG_WHITELABEL_CHANGED]: 'Whitelabel Alterado',
    [AUDIT_ACTIONS.PLAN_CHANGED]: 'Plano Alterado',
    [AUDIT_ACTIONS.ROLE_SWITCHED]: 'Papel Alternado',
    [AUDIT_ACTIONS.PERMISSION_DENIED]: 'Acesso Negado'
  };
  return labels[action] || `${action}`;
}

// Subscriber pattern for real-time UI updates
const subscribers = [];

export function onAuditLog(callback) {
  subscribers.push(callback);
  return () => {
    const idx = subscribers.indexOf(callback);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

function notifySubscribers(entry) {
  subscribers.forEach(cb => {
    try { cb(entry); } catch (e) { console.error('[Audit] Subscriber error:', e); }
  });
}

/**
 * Exports audit logs as a CSV string
 */
export function exportAuditToCSV() {
  const logs = getLocalAuditLogs();
  const headers = ['Data/Hora', 'Ação', 'Severidade', 'Usuário', 'E-mail', 'Papel', 'Organização', 'Detalhes'];
  
  const rows = logs.map(l => [
    l.timestamp,
    formatAuditAction(l.action).replace(/[^\w\s]/g, ''),
    l.severity?.toUpperCase() || 'INFO',
    l.userName || '',
    l.userEmail || '',
    l.userRole || '',
    l.orgName || '',
    JSON.stringify(l.details || {}).substring(0, 200)
  ]);

  const csv = [
    headers.join(';'),
    ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
  ].join('\n');

  return csv;
}
