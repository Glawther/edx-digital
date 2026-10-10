/**
 * EDX Digital - Bulk Export Controller
 * Security Standard: DLP (Data Loss Prevention), ISO 27001, Anti-Exfiltration
 * Safeguard: Trava de Segurança para Exportação em Massa (> 100 contatos)
 */

const { canExportLeads } = require('../security/rbac-service');
const { auditService, AUDIT_ACTIONS, SEVERITY } = require('../security/audit-service');
const { globalRateLimiter } = require('../security/rate-limiter');

class ExportController {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * POST /api/export/request - Request approval token for bulk export (>100 records)
   */
  async requestBulkExportApproval(context, body) {
    if (context.role !== 'admin') {
      return {
        status: 403,
        body: { error: 'ACESSO NEGADO: Apenas Administradores podem solicitar exportação em massa.' }
      };
    }

    const recordCount = Number(body.record_count) || 0;
    const reason = body.reason || 'Auditoria Comercial Periódica';

    const approval = await this.repository.createExportApproval(context, recordCount, reason);

    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.EXPORT_REQUESTED,
      entityType: 'EXPORT_REQUEST',
      entityId: approval.id,
      ipAddress: context.ipAddress,
      severity: SEVERITY.WARNING,
      newValues: { recordCount, reason, expiresAt: approval.expires_at }
    });

    return {
      status: 200,
      body: {
        success: true,
        message: 'Aprovação de exportação gerada com sucesso. Utilize o token de verificação para autorizar o download.',
        approvalToken: approval.token,
        expiresAt: approval.expires_at
      }
    };
  }

  /**
   * POST /api/export/leads - Export leads with mandatory volume safeguard
   */
  async exportLeads(context, body = {}) {
    // 1. Tenant-Level Export Rate Limiter (Anti-Scraping / Exfiltration Guard)
    const exportRate = globalRateLimiter.checkExportRateLimit(context.tenantId);
    if (!exportRate.allowed) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.EXPORT_BLOCKED,
        entityType: 'EXPORT',
        ipAddress: context.ipAddress,
        severity: SEVERITY.CRITICAL,
        newValues: { reason: 'Exceeded export rate limit (max 5 per hour per tenant).' }
      });

      return {
        status: 429,
        body: { error: 'LIMITE DE EXPORTAÇÃO EXCEDIDO: Máximo de 5 exportações por hora por organização.' }
      };
    }

    // 2. Count total eligible records for export
    const totalCount = await this.repository.countLeads(context, body.filters || {});

    // 3. Verify approval token if bulk export
    const approvalToken = body.approval_token || '';
    const hasValidToken = approvalToken ? await this.repository.verifyExportToken(context, approvalToken) : false;

    // 4. Validate RBAC & Bulk Export Rules
    const policyResult = canExportLeads(context, totalCount, hasValidToken ? approvalToken : '');
    if (!policyResult.allowed) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: AUDIT_ACTIONS.EXPORT_BLOCKED,
        entityType: 'EXPORT',
        ipAddress: context.ipAddress,
        severity: SEVERITY.SECURITY_ALERT,
        newValues: { recordCount: totalCount, reason: policyResult.error }
      });

      return {
        status: policyResult.code || 403,
        body: {
          error: policyResult.error,
          requiresMfa: !!policyResult.requiresMfa,
          recordCount: totalCount
        }
      };
    }

    // 5. Fetch records
    const leads = await this.repository.listLeads(context, body.filters || {});

    // 6. Log successful audit trail with forensic details
    auditService.log({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorRole: context.role,
      action: AUDIT_ACTIONS.EXPORT_COMPLETED,
      entityType: 'EXPORT',
      ipAddress: context.ipAddress,
      severity: SEVERITY.WARNING,
      newValues: { recordCount: leads.length, format: body.format || 'json' }
    });

    return {
      status: 200,
      body: {
        success: true,
        recordCount: leads.length,
        exportedAt: new Date().toISOString(),
        data: leads
      }
    };
  }
}

module.exports = {
  ExportController
};
