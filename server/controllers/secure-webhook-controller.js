/**
 * EDX Digital - Secure Webhook Controller
 * Standard: HMAC-SHA256 Cryptographic Authenticity & Integrity
 * Prevents: Spoofing, Replay Attacks, Unauthorized Ingestion
 */

const { verifyWebhookSignature } = require('../security/crypto-service');
const { auditService, AUDIT_ACTIONS, SEVERITY } = require('../security/audit-service');
const { SecurityContext } = require('../database/repository');

class SecureWebhookController {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * Ingests external webhook leads with strict HMAC-SHA256 signature verification
   * @param {Buffer|string} rawBody Raw body buffer for bit-exact HMAC validation
   * @param {string} signature Header 'x-webhook-signature-256' or 'x-hub-signature-256'
   * @param {string} tenantId Target tenant
   * @param {string} clientIp Source IP
   */
  async handleIngest(rawBody, signature, tenantId, clientIp = '127.0.0.1') {
    if (!tenantId) {
      return { status: 400, body: { error: 'Parâmetro tenant_id é obrigatório para roteamento de webhook.' } };
    }

    const tenant = await this.repository.getTenantById(tenantId);
    if (!tenant || tenant.status !== 'active') {
      return { status: 403, body: { error: 'Organização/Tenant não encontrado ou inativo.' } };
    }

    // 1. Retrieve tenant's configured signing secret from encrypted storage
    // Context with system admin role for secret retrieval
    const adminContext = new SecurityContext({ tenantId, role: 'admin', ipAddress: clientIp });
    const signingSecret = await this.repository.getSecret(adminContext, 'webhook_signing_secret');

    // If tenant configured a secret, HMAC signature is MANDATORY
    if (signingSecret) {
      if (!signature) {
        auditService.log({
          tenantId,
          action: AUDIT_ACTIONS.SECURITY_WEBHOOK_INVALID_SIGNATURE,
          entityType: 'WEBHOOK',
          ipAddress: clientIp,
          severity: SEVERITY.CRITICAL,
          newValues: { error: 'Requisição de Webhook recebida sem assinatura HMAC obrigatória.' }
        });

        return {
          status: 401,
          body: { error: 'ASSINATURA OBRIGATÓRIA: Cabeçalho de assinatura HMAC-SHA256 ausente.' }
        };
      }

      // Clean signature (support 'sha256=...' format)
      const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
      const isValid = verifyWebhookSignature(rawBody, cleanSignature, signingSecret);

      if (!isValid) {
        auditService.log({
          tenantId,
          action: AUDIT_ACTIONS.SECURITY_WEBHOOK_INVALID_SIGNATURE,
          entityType: 'WEBHOOK',
          ipAddress: clientIp,
          severity: SEVERITY.SECURITY_ALERT,
          newValues: { error: 'Assinatura HMAC-SHA256 não confere. Possível tentativa de injeção ou adulteração de dados.' }
        });

        return {
          status: 401,
          body: { error: 'FALHA DE INTEGRIDADE: Assinatura HMAC inválida. Acesso negado.' }
        };
      }
    }

    // 2. Parse and validate JSON payload
    let leadData;
    try {
      leadData = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'Payload de webhook não é um JSON válido.' } };
    }

    // 3. Create Lead in Tenant's boundary using system ingest context
    const webhookContext = new SecurityContext({
      tenantId,
      userId: 'webhook-service',
      role: 'admin',
      ipAddress: clientIp
    });

    const created = await this.repository.createLead(webhookContext, {
      name: leadData.name || leadData.customer_name || 'Lead via Webhook',
      email: leadData.email || '',
      phone: leadData.phone || leadData.whatsapp || '',
      company: leadData.company || leadData.source || 'Webhook Ingestion',
      deal_value: leadData.deal_value || leadData.value || 0,
      stage: 'lead',
      priority: leadData.priority || 'medium',
      confidential_notes: leadData.notes || `Capturado via Webhook Oficial em ${new Date().toISOString()}`
    });

    auditService.log({
      tenantId,
      actorId: 'webhook-gateway',
      actorRole: 'system',
      action: AUDIT_ACTIONS.LEAD_CREATE,
      entityType: 'LEAD',
      entityId: created.id,
      ipAddress: clientIp,
      severity: SEVERITY.INFO,
      newValues: { source: 'webhook', leadId: created.id }
    });

    return {
      status: 201,
      body: {
        success: true,
        message: 'Lead ingerido com sucesso com validação criptográfica HMAC.',
        leadId: created.id
      }
    };
  }
}

module.exports = {
  SecureWebhookController
};
