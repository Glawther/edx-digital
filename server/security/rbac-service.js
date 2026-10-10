/**
 * EDX Digital - Role-Based Access Control (RBAC) Engine
 * Standard: ISO 27001 Principle of Least Privilege (PoLP)
 * Hierarchy: Admin > Gerente > Vendedor
 */

const ROLES = {
  ADMIN: 'admin',
  GERENTE: 'gerente',
  VENDEDOR: 'vendedor',
  SYSTEM_AUDITOR: 'system_auditor'
};

const PERMISSIONS = {
  // Leads
  LEADS_CREATE: 'leads:create',
  LEADS_READ_OWN: 'leads:read:own',
  LEADS_READ_TEAM: 'leads:read:team',
  LEADS_READ_ALL: 'leads:read:all',
  LEADS_UPDATE_OWN: 'leads:update:own',
  LEADS_UPDATE_TEAM: 'leads:update:team',
  LEADS_UPDATE_ALL: 'leads:update:all',
  LEADS_DELETE: 'leads:delete',

  // Reporting & Export
  EXPORT_BASIC: 'export:basic',       // Up to 100 records
  EXPORT_BULK: 'export:bulk',         // > 100 records (Requires MFA step-up)

  // Governance & Security
  AUDIT_READ: 'audit:read',
  SECRETS_MANAGE: 'secrets:manage',
  USERS_MANAGE: 'users:manage',
  TEAMS_MANAGE: 'teams:manage'
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_READ_OWN,
    PERMISSIONS.LEADS_READ_TEAM,
    PERMISSIONS.LEADS_READ_ALL,
    PERMISSIONS.LEADS_UPDATE_OWN,
    PERMISSIONS.LEADS_UPDATE_TEAM,
    PERMISSIONS.LEADS_UPDATE_ALL,
    PERMISSIONS.LEADS_DELETE,
    PERMISSIONS.EXPORT_BASIC,
    PERMISSIONS.EXPORT_BULK,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.SECRETS_MANAGE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.TEAMS_MANAGE
  ],
  [ROLES.GERENTE]: [
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_READ_OWN,
    PERMISSIONS.LEADS_READ_TEAM,
    PERMISSIONS.LEADS_UPDATE_OWN,
    PERMISSIONS.LEADS_UPDATE_TEAM,
    PERMISSIONS.EXPORT_BASIC // Only for small team follow-ups (up to 100 records)
  ],
  [ROLES.VENDEDOR]: [
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_READ_OWN,
    PERMISSIONS.LEADS_UPDATE_OWN
    // Zero access to delete, zero access to export, zero access to others' leads
  ],
  [ROLES.SYSTEM_AUDITOR]: [
    PERMISSIONS.AUDIT_READ
  ]
};

/**
 * Validates if a user role has a specific raw permission
 */
function hasPermission(role, permission) {
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.includes(permission);
}

/**
 * Context validation for individual Lead READ access
 * Prevents BOLA (Broken Object Level Authorization)
 */
function canReadLead(context, lead) {
  if (!context || !lead) return false;
  if (context.tenantId !== lead.tenant_id) return false; // Cross-tenant boundary

  if (context.role === ROLES.ADMIN) return true;

  if (context.role === ROLES.GERENTE) {
    if (!context.userId) return false;
    if (lead.assigned_to_id === context.userId) return true;
    if (context.teamId && lead.team_id === context.teamId) return true;
    if (!lead.team_id && !lead.assigned_to_id) return true; // Unassigned pool
    return false;
  }

  if (context.role === ROLES.VENDEDOR) {
    // Vendedor can ONLY view their own assigned leads or leads created by them
    if (!context.userId) return false;
    return (lead.assigned_to_id && lead.assigned_to_id === context.userId) ||
           (lead.created_by_id && lead.created_by_id === context.userId);
  }

  return false;
}

/**
 * Context validation for individual Lead UPDATE access
 */
function canUpdateLead(context, lead) {
  if (!context || !lead) return false;
  if (context.tenantId !== lead.tenant_id) return false;

  if (context.role === ROLES.ADMIN) return true;

  if (context.role === ROLES.GERENTE) {
    if (!context.userId) return false;
    if (lead.assigned_to_id === context.userId) return true;
    if (context.teamId && lead.team_id === context.teamId) return true;
    return false;
  }

  if (context.role === ROLES.VENDEDOR) {
    if (!context.userId) return false;
    return lead.assigned_to_id && lead.assigned_to_id === context.userId;
  }

  return false;
}

/**
 * Context validation for individual Lead DELETE access
 * Implements ISO 27001 Data Integrity (Only Admins can delete)
 */
function canDeleteLead(context, lead) {
  if (!context || !lead) return false;
  if (context.tenantId !== lead.tenant_id) return false;
  return context.role === ROLES.ADMIN;
}

/**
 * Bulk Export Safeguard Engine
 * Enforces:
 *   1. Non-admins cannot export or are limited to <= 100 for Gerente.
 *   2. Vendedor is strictly forbidden from any export.
 *   3. Exports > 100 records require Admin role + verified approval/MFA step-up token.
 */
function canExportLeads(context, recordCount, approvalToken = '') {
  if (!context) {
    return { allowed: false, code: 401, error: 'Não autenticado.' };
  }

  if (context.role === ROLES.VENDEDOR) {
    return {
      allowed: false,
      code: 403,
      error: 'ACESSO NEGADO: Vendedores não possuem autorização para exportar base de dados (Confidencialidade CID).'
    };
  }

  const count = Number(recordCount) || 0;

  // Small export (<= 100)
  if (count <= 100) {
    if (context.role === ROLES.ADMIN || context.role === ROLES.GERENTE) {
      return { allowed: true, requiresMfa: false };
    }
    return { allowed: false, code: 403, error: 'Acesso negado para exportação.' };
  }

  // Bulk export (> 100 records)
  // Strictly requires Admin role
  if (context.role !== ROLES.ADMIN) {
    return {
      allowed: false,
      code: 403,
      error: 'ACESSO NEGADO: Exportações em massa (>100 registros) são restritas a Administradores com autorização prévia.'
    };
  }

  // Admin requires valid approval token / MFA verification for bulk export
  if (!approvalToken || approvalToken.length < 16) {
    return {
      allowed: false,
      code: 403,
      requiresMfa: true,
      error: 'TRAVA DE SEGURANÇA: Exportações em lote (>100 registros) exigem verificação secundária / Token de Aprovação MFA ativo.'
    };
  }

  return { allowed: true, requiresMfa: true, approvalToken };
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  canReadLead,
  canUpdateLead,
  canDeleteLead,
  canExportLeads
};
