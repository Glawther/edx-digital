/**
 * EDX Digital - Lead Controller
 * Zero Trust Architecture: Dual-layer RBAC, BOLA Defense, Immutable Audit Logging
 */

const { canReadLead, canUpdateLead, canDeleteLead } = require('../security/rbac-service');
const { auditService, AUDIT_ACTIONS, SEVERITY } = require('../security/audit-service');
const { globalRateLimiter } = require('../security/rate-limiter');

class LeadController {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * GET /api/leads - List accessible leads for the current tenant & role
   */
  async list(context, queryParams = {}) {
    // 1. Dual-Scope Rate Limiting (IP + Tenant)
    const rateCheck = globalRateLimiter.checkDual(context.ipAddress, context.tenantId, {
      maxIp: 100,
      maxTenant: 500
    });
    if (!rateCheck.allowed) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.SECURITY_RATE_LIMIT_EXCEEDED,
        entityType: 'LEAD',
        ipAddress: context.ipAddress,
        severity: SEVERITY.WARNING
      });
      return { status: 429, body: { error: rateCheck.error } };
    }

    // 2. Fetch leads with repository-enforced tenant and role boundaries
    const leads = await this.repository.listLeads(context, queryParams);

    // 3. Audit sample access
    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.LEAD_VIEW,
      entityType: 'LEAD',
      ipAddress: context.ipAddress,
      severity: SEVERITY.INFO,
      newValues: { count: leads.length, filter: queryParams }
    });

    return { status: 200, body: { success: true, count: leads.length, data: leads } };
  }

  /**
   * GET /api/leads/:id - Read single lead with strict BOLA protection
   */
  async getById(context, leadId) {
    const rawLead = await this.repository.getLeadById(context, leadId);

    // If not found in this tenant or deleted, return 404 (prevents tenant enumeration)
    if (!rawLead) {
      return { status: 404, body: { error: 'Oportunidade/Lead não encontrado.' } };
    }

    // 2. Granular RBAC Check (Broken Object Level Authorization Guard)
    if (!canReadLead(context, rawLead)) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.SECURITY_BOLA_ATTEMPT,
        entityType: 'LEAD',
        entityId: leadId,
        ipAddress: context.ipAddress,
        severity: SEVERITY.SECURITY_ALERT,
        newValues: { reason: 'Vendedor ou Gerente tentou acessar lead fora de sua jurisdição/carteira.' }
      });

      return {
        status: 403,
        body: { error: 'ACESSO NEGADO (BOLA): Você não tem permissão para visualizar este lead específico.' }
      };
    }

    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.LEAD_VIEW,
      entityType: 'LEAD',
      entityId: leadId,
      ipAddress: context.ipAddress,
      severity: SEVERITY.INFO
    });

    return { status: 200, body: { success: true, data: rawLead } };
  }

  /**
   * POST /api/leads - Create new lead
   */
  async create(context, leadData) {
    if (!leadData.name || typeof leadData.name !== 'string' || leadData.name.trim().length === 0) {
      return { status: 400, body: { error: 'O campo "name" (nome do lead) é obrigatório.' } };
    }

    const created = await this.repository.createLead(context, leadData);

    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.LEAD_CREATE,
      entityType: 'LEAD',
      entityId: created.id,
      ipAddress: context.ipAddress,
      severity: SEVERITY.INFO,
      newValues: created
    });

    return { status: 201, body: { success: true, data: created } };
  }

  /**
   * PUT /api/leads/:id - Update lead with BOLA check and old vs new diff audit
   */
  async update(context, leadId, updateData) {
    const existing = await this.repository.getLeadById(context, leadId);
    if (!existing) {
      return { status: 404, body: { error: 'Lead não encontrado.' } };
    }

    if (!canUpdateLead(context, existing)) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.SECURITY_BOLA_ATTEMPT,
        entityType: 'LEAD',
        entityId: leadId,
        ipAddress: context.ipAddress,
        severity: SEVERITY.SECURITY_ALERT,
        newValues: { attemptedUpdate: updateData }
      });

      return { status: 403, body: { error: 'ACESSO NEGADO: Você não tem permissão para alterar este lead.' } };
    }

    const updated = await this.repository.updateLead(context, leadId, updateData);
    const diff = auditService.calculateDiff(existing, updated);

    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.LEAD_UPDATE,
      entityType: 'LEAD',
      entityId: leadId,
      oldValues: existing,
      newValues: updated,
      ipAddress: context.ipAddress,
      severity: SEVERITY.INFO
    });

    return { status: 200, body: { success: true, diff, data: updated } };
  }

  /**
   * DELETE /api/leads/:id - Soft delete lead (Restricted to Admin)
   */
  async delete(context, leadId) {
    const existing = await this.repository.getLeadById(context, leadId);
    if (!existing) {
      return { status: 404, body: { error: 'Lead não encontrado.' } };
    }

    if (!canDeleteLead(context, existing)) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.SECURITY_UNAUTHORIZED_DELETE,
        entityType: 'LEAD',
        entityId: leadId,
        ipAddress: context.ipAddress,
        severity: SEVERITY.SECURITY_ALERT,
        newValues: { reason: 'Tentativa não autorizada de exclusão de lead por não-administrador.' }
      });

      return {
        status: 403,
        body: { error: 'ACESSO NEGADO: Apenas Administradores podem excluir registros (Integridade ISO 27001).' }
      };
    }

    await this.repository.softDeleteLead(context, leadId);

    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.LEAD_DELETE,
      entityType: 'LEAD',
      entityId: leadId,
      oldValues: existing,
      ipAddress: context.ipAddress,
      severity: SEVERITY.WARNING
    });

    return { status: 200, body: { success: true, message: 'Lead excluído com sucesso (Soft Delete).' } };
  }
}

module.exports = {
  LeadController
};
