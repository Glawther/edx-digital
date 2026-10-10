/**
 * Nexus CRM - Team Invite & User Management Service
 * Enables admins to invite team members via email/link, 
 * manage roles and track invitation status.
 */

import { getSavedOrganization, saveOrganization } from '../core/config.js';
import { getCurrentUser, isAdmin, USER_ROLES } from './auth-service.js';
import { logAudit, AUDIT_ACTIONS, AUDIT_SEVERITY } from './audit-service.js';
import { generateTemporaryPassword, saveEmployee, getEmployees } from './employee-service.js';

const INVITES_STORAGE_KEY = 'nexus_crm_team_invites';

/**
 * Invite status constants
 */
export const INVITE_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
};

/**
 * Team role options for invitations
 */
export const TEAM_ROLES = {
  ADMIN: { id: 'admin', label: 'Administrador', description: 'Acesso total ao sistema' },
  MANAGER: { id: 'manager', label: 'Gerente de Vendas', description: 'Visão da equipe e relatórios' },
  SELLER: { id: 'employee', label: 'Vendedor / Consultor', description: 'Carteira individual de leads' },
  VIEWER: { id: 'viewer', label: 'Visualizador', description: 'Apenas leitura (auditor, diretoria)' }
};

/**
 * Creates a new team invitation
 * @param {Object} inviteData - { name, email, role, message }
 * @returns {Object} Created invite with access code
 */
export function createInvite(inviteData) {
  if (!isAdmin()) {
    return { success: false, error: 'Apenas administradores podem enviar convites.' };
  }

  if (!inviteData.email || !inviteData.name) {
    return { success: false, error: 'Nome e e-mail são obrigatórios.' };
  }

  // Check for duplicate email invites
  const existingInvites = getInvites();
  const duplicate = existingInvites.find(
    i => i.email.toLowerCase() === inviteData.email.toLowerCase() && i.status === INVITE_STATUS.PENDING
  );
  if (duplicate) {
    return { success: false, error: 'Já existe um convite pendente para este e-mail.' };
  }

  // Check existing employees
  const employees = getEmployees();
  const existingEmployee = employees.find(
    e => e.email?.toLowerCase() === inviteData.email.toLowerCase()
  );
  if (existingEmployee) {
    return { success: false, error: 'Este e-mail já está cadastrado como colaborador.' };
  }

  const org = getSavedOrganization();
  const user = getCurrentUser();
  const tempPassword = generateTemporaryPassword();
  const accessCode = generateAccessCode();

  const invite = {
    id: 'inv-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    name: inviteData.name.trim(),
    email: inviteData.email.trim().toLowerCase(),
    role: inviteData.role || USER_ROLES.EMPLOYEE,
    message: inviteData.message || '',
    status: INVITE_STATUS.PENDING,
    accessCode,
    tempPassword,
    orgId: org.id,
    orgName: org.name,
    invitedBy: {
      uid: user?.uid || 'admin',
      name: user?.name || 'Administrador',
      email: user?.email || ''
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), // 7 days
    acceptedAt: null
  };

  // Save invite
  const invites = getInvites();
  invites.unshift(invite);
  saveInvites(invites);

  // Log audit
  logAudit(AUDIT_ACTIONS.TEAM_INVITE_SENT, {
    inviteId: invite.id,
    invitedEmail: invite.email,
    invitedRole: invite.role
  }, AUDIT_SEVERITY.INFO);

  return { success: true, invite };
}

/**
 * Accepts an invitation and creates the employee account
 */
export function acceptInvite(inviteId) {
  const invites = getInvites();
  const invite = invites.find(i => i.id === inviteId);
  
  if (!invite) {
    return { success: false, error: 'Convite não encontrado.' };
  }

  if (invite.status !== INVITE_STATUS.PENDING) {
    return { success: false, error: 'Este convite não está mais pendente.' };
  }

  if (new Date(invite.expiresAt) < new Date()) {
    invite.status = INVITE_STATUS.EXPIRED;
    saveInvites(invites);
    return { success: false, error: 'Este convite expirou. Solicite um novo ao administrador.' };
  }

  // Create employee from invite
  const newEmployee = {
    name: invite.name,
    email: invite.email,
    cpf: '', // To be filled by the employee
    role: invite.role,
    department: 'Vendas',
    status: 'active',
    tempPassword: invite.tempPassword,
    isFirstAccess: true,
    orgId: invite.orgId
  };

  const result = saveEmployee(newEmployee);
  if (!result.success) {
    return { success: false, error: result.error || 'Erro ao criar conta do colaborador.' };
  }

  // Update invite status
  invite.status = INVITE_STATUS.ACCEPTED;
  invite.acceptedAt = new Date().toISOString();
  saveInvites(invites);

  logAudit(AUDIT_ACTIONS.EMPLOYEE_CREATED, {
    employeeEmail: invite.email,
    viaInvite: true,
    inviteId: invite.id
  });

  return { success: true, employee: result.employee };
}

/**
 * Revokes a pending invitation
 */
export function revokeInvite(inviteId) {
  if (!isAdmin()) {
    return { success: false, error: 'Apenas administradores podem revogar convites.' };
  }

  const invites = getInvites();
  const invite = invites.find(i => i.id === inviteId);
  
  if (!invite) {
    return { success: false, error: 'Convite não encontrado.' };
  }

  invite.status = INVITE_STATUS.REVOKED;
  saveInvites(invites);

  return { success: true };
}

/**
 * Resends an invite by refreshing the expiry and generating new credentials
 */
export function resendInvite(inviteId) {
  const invites = getInvites();
  const invite = invites.find(i => i.id === inviteId);
  
  if (!invite) {
    return { success: false, error: 'Convite não encontrado.' };
  }

  invite.tempPassword = generateTemporaryPassword();
  invite.accessCode = generateAccessCode();
  invite.status = INVITE_STATUS.PENDING;
  invite.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  saveInvites(invites);

  return { success: true, invite };
}

/**
 * Retrieves all invites for the organization
 */
export function getInvites() {
  try {
    const raw = localStorage.getItem(INVITES_STORAGE_KEY);
    if (raw) {
      const invites = JSON.parse(raw);
      return Array.isArray(invites) ? invites : [];
    }
  } catch (e) {
    console.warn('[Invites] Error loading invites:', e);
  }
  return [];
}

/**
 * Gets invite stats for dashboard
 */
export function getInviteStats() {
  const invites = getInvites();
  return {
    total: invites.length,
    pending: invites.filter(i => i.status === INVITE_STATUS.PENDING).length,
    accepted: invites.filter(i => i.status === INVITE_STATUS.ACCEPTED).length,
    expired: invites.filter(i => i.status === INVITE_STATUS.EXPIRED).length,
    revoked: invites.filter(i => i.status === INVITE_STATUS.REVOKED).length
  };
}

/**
 * Generates the invitation share text (WhatsApp / email)
 */
export function generateInviteShareText(invite) {
  const org = getSavedOrganization();
  const appUrl = window.location.origin || 'https://nexuscrm-d8e13.web.app';
  
  return `*Convite para ${org.name || 'Nexus CRM'}*\n\n` +
    `Olá, ${invite.name}! Você foi convidado(a) para acessar o CRM da nossa equipe.\n\n` +
    `Seu e-mail de acesso: ${invite.email}\n` +
    `Senha temporária: ${invite.tempPassword}\n` +
    `Código de acesso: ${invite.accessCode}\n\n` +
    `Acesse agora: ${appUrl}\n\n` +
    `Você será solicitado(a) a trocar a senha no primeiro acesso.\n` +
    `Este convite expira em ${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}.`;
}

/**
 * Private helpers
 */
function saveInvites(invites) {
  localStorage.setItem(INVITES_STORAGE_KEY, JSON.stringify(invites));
}

function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Returns or generates the active organization's master team invite code
 */
export function getCompanyTeamInviteCode() {
  const org = getSavedOrganization();
  if (org && org.teamInviteCode) {
    return org.teamInviteCode;
  }
  const code = 'NX-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  if (org) {
    org.teamInviteCode = code;
    saveOrganization(org);
  }
  return code;
}

/**
 * Validates a team invitation code locally and against active organization
 */
export function validateTeamInviteCode(code) {
  if (!code) return { valid: false, error: 'Código de convite obrigatório.' };
  const cleanCode = code.trim().toUpperCase();

  // 1. Check active organization master invite code
  const org = getSavedOrganization();
  const orgCode = org?.teamInviteCode || getCompanyTeamInviteCode();
  if (orgCode && orgCode.toUpperCase() === cleanCode) {
    return { valid: true, type: 'org_code', org };
  }

  // 2. Check individual invitations
  const invites = getInvites();
  const invite = invites.find(i => (i.accessCode && i.accessCode.toUpperCase() === cleanCode) || i.id === cleanCode);
  if (invite) {
    if (invite.status !== INVITE_STATUS.PENDING) {
      return { valid: false, error: 'Este convite já foi utilizado ou não está mais ativo.' };
    }
    if (new Date(invite.expiresAt) < new Date()) {
      return { valid: false, error: 'Este convite expirou. Solicite um novo ao administrador da empresa.' };
    }
    return { valid: true, type: 'invite', invite, org };
  }

  // 3. Fallback candidate for cloud validation
  if (cleanCode.startsWith('NX-') && cleanCode.length >= 6) {
    return { valid: true, type: 'cloud_candidate', code: cleanCode, org };
  }

  return { valid: false, error: 'Código de convite não encontrado ou inválido. Solicite o código ao dono da sua empresa.' };
}

/**
 * Joins an employee to a company team using their invitation code
 */
export async function joinTeamWithInviteCode({ inviteCode, name, email, password }) {
  const check = validateTeamInviteCode(inviteCode);
  const baseUrl = typeof window.getApiBaseUrl === 'function' ? window.getApiBaseUrl() : '';

  // 1. Attempt backend join
  let cloudSuccess = false;
  let cloudError = null;
  let serverData = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/api/v1/commercial/join-team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteCode: inviteCode.trim().toUpperCase(),
        name,
        email,
        password
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      cloudSuccess = true;
      serverData = payload;
      if (payload.token) localStorage.setItem('nexus_jwt_token', payload.token);
      if (payload.tenant?.id) localStorage.setItem('nexus_tenant_id', payload.tenant.id);
    } else {
      cloudError = payload.error || 'Código de convite inválido no servidor.';
    }
  } catch (err) {
    console.warn('[Join Team] Backend offline ou indisponível, validando localmente:', err);
  }

  // Se o servidor respondeu com erro explícito de código inválido
  if (cloudError && !cloudSuccess) {
    return { success: false, error: cloudError };
  }

  // 2. Validação local caso o backend não esteja disponível
  if (!check.valid && !cloudSuccess) {
    return { success: false, error: check.error || 'Código de convite inválido.' };
  }

  const org = check.org || getSavedOrganization();

  // Create or accept employee
  if (check.type === 'invite' && check.invite) {
    acceptInvite(check.invite.id);
  } else {
    saveEmployee({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      cpf: '',
      role: USER_ROLES.EMPLOYEE,
      department: 'Vendas',
      status: 'active',
      isFirstAccess: false,
      orgId: org.id
    });
  }

  return { success: true, org, role: USER_ROLES.EMPLOYEE, serverData };
}

