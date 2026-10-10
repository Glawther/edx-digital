/**
 * EDX Digital - Activity history
 *
 * Every relevant action is recorded in the company's history in the cloud (audit_logs), where
 * records can be created but never changed. Administrators see the whole team's history;
 * the demo keeps its own in this browser.
 */

import { getSavedOrganization } from '../core/config.js';
import { getCurrentUser, isAdmin, isCloudSession } from './auth-service.js';
import { getFirebase } from './firebase-app.js';
import { csvSafe } from './import-service.js';

const AUDIT_STORAGE_KEY = 'edx_audit_logs';
const MAX_LOCAL_LOGS = 300;
const CLOUD_FEED_SIZE = 300;

export const AUDIT_ACTIONS = {
  LEAD_CREATED: 'lead_created',
  LEAD_UPDATED: 'lead_updated',
  LEAD_DELETED: 'lead_deleted',
  LEAD_STAGE_CHANGED: 'lead_stage_changed',
  LEAD_WON: 'lead_won',
  LEAD_LOST: 'lead_lost',
  LEADS_REASSIGNED: 'leads_reassigned',

  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_REGISTERED: 'user_registered',
  EMPLOYEE_CREATED: 'employee_created',
  EMPLOYEE_DELETED: 'employee_deleted',
  EMPLOYEE_PASSWORD_RESET: 'employee_password_reset',
  EMPLOYEE_STATUS_CHANGED: 'employee_status_changed',
  TEAM_INVITE_SENT: 'team_invite_sent',
  TEAM_INVITE_REPLACED: 'team_invite_replaced',

  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  BACKUP_CREATED: 'backup_created',
  BACKUP_RESTORED: 'backup_restored',

  CONFIG_GEMINI_CHANGED: 'config_gemini_changed',
  CONFIG_WHITELABEL_CHANGED: 'config_whitelabel_changed',
  PLAN_CHANGED: 'plan_changed',

  ROLE_SWITCHED: 'role_switched',
  PERMISSION_DENIED: 'permission_denied'
};

export const AUDIT_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

const ACTION_LABELS = {
  lead_created: 'Oportunidade criada',
  lead_updated: 'Oportunidade alterada',
  lead_deleted: 'Oportunidade excluída',
  lead_stage_changed: 'Mudança de etapa',
  lead_won: 'Venda fechada',
  lead_lost: 'Oportunidade perdida',
  leads_reassigned: 'Carteira transferida',
  user_login: 'Entrada no sistema',
  user_logout: 'Saída do sistema',
  user_registered: 'Conta criada',
  employee_created: 'Colaborador cadastrado',
  employee_deleted: 'Colaborador excluído',
  employee_password_reset: 'Nova senha enviada',
  employee_status_changed: 'Acesso bloqueado ou liberado',
  team_invite_sent: 'Convite copiado',
  team_invite_replaced: 'Código de convite trocado',
  data_exported: 'Dados exportados',
  data_imported: 'Dados importados',
  backup_created: 'Cópia de segurança baixada',
  backup_restored: 'Cópia de segurança restaurada',
  config_gemini_changed: 'Chave do Gemini alterada',
  config_whitelabel_changed: 'Dados da empresa alterados',
  plan_changed: 'Plano alterado',
  role_switched: 'Perfil da demonstração trocado',
  permission_denied: 'Tentativa sem permissão'
};

export function formatAuditAction(action) {
  return ACTION_LABELS[action] || String(action || '');
}

let cloudLogs = null;       // the team's history, for administrators of a real account
let unsubscribe = null;
let writer = null;          // { db, fsMod } while a real account is signed in

/**
 * Starts (or stops, with null) recording to the cloud for the current session
 * @param {Object|null} db - kept for the callers that already pass it; any truthy value means "cloud"
 */
export async function initAuditFirestore(db) {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  cloudLogs = null;
  writer = null;
  if (!db || !isCloudSession()) {
    notifySubscribers();
    return;
  }

  try {
    const { db: database, fsMod } = await getFirebase();
    writer = { db: database, fsMod };
    const user = getCurrentUser();
    if (!user || !isAdmin()) return;

    unsubscribe = fsMod.onSnapshot(
      fsMod.query(
        fsMod.collection(database, 'audit_logs'),
        fsMod.where('orgId', '==', user.orgId),
        fsMod.orderBy('timestamp', 'desc'),
        fsMod.limit(CLOUD_FEED_SIZE)
      ),
      (snapshot) => {
        cloudLogs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        notifySubscribers();
      },
      (err) => console.warn('[Audit] History could not be read:', err.code || err.message)
    );
  } catch (err) {
    console.warn('[Audit] Cloud history unavailable:', err);
  }
}

/**
 * Records an action
 * @param {string} action - one of AUDIT_ACTIONS
 * @param {Object} details - plain facts about it (ids, names, values)
 * @param {string} severity - one of AUDIT_SEVERITY
 */
export async function logAudit(action, details = {}, severity = AUDIT_SEVERITY.INFO) {
  const user = getCurrentUser();
  const org = getSavedOrganization();
  const entry = {
    id: 'audit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    action: String(action).slice(0, 80),
    severity,
    timestamp: new Date().toISOString(),
    userId: user?.uid || 'anonymous',
    userName: (user?.name || 'Desconhecido').slice(0, 200),
    userEmail: (user?.email || '').slice(0, 320),
    userRole: user?.role || 'unknown',
    orgId: org?.id || 'org_edx_default',
    orgName: (org?.name || '').slice(0, 200),
    details: plainDetails(details)
  };

  if (writer) {
    try {
      await writer.fsMod.setDoc(writer.fsMod.doc(writer.db, 'audit_logs', entry.id), entry);
    } catch (err) {
      console.warn('[Audit] Not recorded in the cloud:', err.code || err.message);
    }
  } else {
    saveLocal(entry);
  }
  notifySubscribers(entry);
  return entry;
}

// Short, flat values only: the history describes what happened, it is not a copy of the data
function plainDetails(details) {
  const out = {};
  Object.entries(details || {}).slice(0, 12).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    out[String(key).slice(0, 40)] = typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 200);
  });
  return out;
}

function saveLocal(entry) {
  try {
    const logs = readLocal();
    logs.unshift(entry);
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOCAL_LOGS)));
  } catch (err) {
    console.warn('[Audit] localStorage write error:', err);
  }
}

function readLocal() {
  try {
    const logs = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY));
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

/**
 * The history to show: the team's, from the cloud, for an administrator of a real account;
 * what this browser recorded, in the demo. Most recent first.
 */
export function getAuditLogs(limit = CLOUD_FEED_SIZE) {
  return (cloudLogs || (isCloudSession() ? [] : readLocal())).slice(0, limit);
}

export function getAuditStats() {
  const logs = getAuditLogs();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    totalLogs: logs.length,
    todayLogs: logs.filter(log => new Date(log.timestamp) >= today).length,
    criticalCount: logs.filter(log => log.severity === AUDIT_SEVERITY.CRITICAL).length,
    warningCount: logs.filter(log => log.severity === AUDIT_SEVERITY.WARNING).length
  };
}

const subscribers = [];

export function onAuditLog(callback) {
  subscribers.push(callback);
  return () => {
    const index = subscribers.indexOf(callback);
    if (index !== -1) subscribers.splice(index, 1);
  };
}

function notifySubscribers(entry) {
  subscribers.forEach(callback => {
    try { callback(entry); } catch (err) { console.error('[Audit] Subscriber error:', err); }
  });
}

/**
 * The history as a spreadsheet
 * @param {(log: Object) => string} [nameOf] - resolves who did it (the stored name is only a fallback)
 */
export function exportAuditToCSV(nameOf = (log) => log.userName || '') {
  const cell = (value) => `"${csvSafe(value).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const rows = getAuditLogs().map(log => [
    new Date(log.timestamp).toLocaleString('pt-BR'),
    formatAuditAction(log.action),
    log.severity === 'critical' ? 'crítico' : log.severity === 'warning' ? 'atenção' : '',
    nameOf(log),
    log.userEmail || '',
    log.userRole === 'admin' ? 'Administrador' : 'Vendedor',
    Object.entries(log.details || {}).map(([key, value]) => `${key}: ${value}`).join(', ')
  ].map(cell).join(';'));
  return [['Quando', 'O quê', 'Gravidade', 'Quem', 'E-mail', 'Perfil', 'Detalhes'].map(cell).join(';'), ...rows].join('\r\n');
}
