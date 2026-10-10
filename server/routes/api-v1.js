/**
 * Nexus CRM Enterprise - Zero Trust API v1 Router
 * Standard: RESTful API, Strict HTTP status codes, ISO 27001 Audit
 */

const { defaultRepository } = require('../database/repository');
const { LeadController } = require('../controllers/lead-controller');
const { ExportController } = require('../controllers/export-controller');
const { SecureWebhookController } = require('../controllers/secure-webhook-controller');
const { authenticateContext, extractClientIp } = require('../middleware/auth-context');
const { parseJsonBody } = require('../middleware/body-parser');
const { auditService, SEVERITY } = require('../security/audit-service');
const { globalRateLimiter } = require('../security/rate-limiter');
const { commercialService } = require('../services/commercial-service');
const { BILLING_WEBHOOK_SECRET } = require('../config/secrets');

const leadController = new LeadController(defaultRepository);
const exportController = new ExportController(defaultRepository);
const webhookController = new SecureWebhookController(defaultRepository);

// Initialize a default Enterprise Demo Tenant if empty
(async function initDefaultDemoData() {
  try {
    const existing = await defaultRepository.getTenantById('tenant-enterprise-demo');
    if (!existing) {
      const demoTenant = {
        id: 'tenant-enterprise-demo',
        name: 'Nexus Enterprise Global',
        slug: 'nexus-enterprise',
        plan: 'enterprise',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      defaultRepository.tenants.set(demoTenant.id, demoTenant);
    }
  } catch (err) {
    console.error('Error initializing demo tenant:', err);
  }
})();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

/**
 * Handles all /api/v1/* requests
 */
async function handleApiV1(req, res, parsedUrl) {
  const method = req.method;
  const clientIp = extractClientIp(req);

  // 1. PUBLIC AUTH ROUTE: POST /api/v1/auth/login (e-mail + password)
  // A session token is only ever issued after the password is verified.
  if (parsedUrl === '/api/v1/auth/login' && method === 'POST') {
    const rate = globalRateLimiter.check(`login:ip:${clientIp}`, 10, 300000);
    if (!rate.allowed) {
      return sendJson(res, 429, { error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(rate.resetMs / 1000)}s.` });
    }
    try {
      const { body } = await parseJsonBody(req);
      const result = await commercialService.login(body, clientIp);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 2. SECURE WEBHOOK: POST /api/v1/webhook/secure
  if (parsedUrl === '/api/v1/webhook/secure' && method === 'POST') {
    try {
      const { rawBuffer } = await parseJsonBody(req);
      const signature = req.headers['x-webhook-signature-256'] || req.headers['x-hub-signature-256'] || '';
      const tenantId = req.headers['x-tenant-id'] || 'tenant-enterprise-demo';

      const result = await webhookController.handleIngest(rawBuffer, signature, tenantId, clientIp);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 3. COMMERCIAL ROUTES (PUBLIC SAAS MONETIZATION & ONBOARDING)
  // GET /api/v1/commercial/plans
  if (parsedUrl === '/api/v1/commercial/plans' && method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      plans: commercialService.getPlans()
    });
  }

  // POST /api/v1/commercial/register-tenant (Self-Service Onboarding)
  if (parsedUrl === '/api/v1/commercial/register-tenant' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const result = await commercialService.registerTenant(body, clientIp);
      return sendJson(res, 201, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // POST /api/v1/commercial/join-team (Employee joins via company invite code)
  if (parsedUrl === '/api/v1/commercial/join-team' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const result = await commercialService.joinTeam(body, clientIp);
      return sendJson(res, 201, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // POST /api/v1/commercial/billing-webhook (Automated Recurring Subscriptions)
  if (parsedUrl === '/api/v1/commercial/billing-webhook' && method === 'POST') {
    try {
      const { rawBuffer } = await parseJsonBody(req);
      const signature = req.headers['x-signature-256'] || req.headers['x-hub-signature-256'] || '';

      const result = await commercialService.processBillingWebhook(rawBuffer, signature, BILLING_WEBHOOK_SECRET, clientIp);
      return sendJson(res, result.status, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // POST /api/v1/commercial/checkout (Generates 1-Click PIX & Order)
  if (parsedUrl === '/api/v1/commercial/checkout' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const tenantId = body.tenant_id || body.tenantId || 'tenant-self-service';
      const plan = body.plan || 'pro';
      const billingCycle = body.billing_cycle || body.billingCycle || 'monthly';
      const result = await commercialService.createCheckout({
        tenantId,
        plan,
        billingCycle,
        customer: body.customer || {}
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // GET /api/v1/commercial/payment-settings (Payment methods & public settings)
  if (parsedUrl === '/api/v1/commercial/payment-settings' && method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      settings: commercialService.getPaymentSettings()
    });
  }

  // 3. AUTHENTICATED ZERO TRUST ROUTES (Require valid Bearer token & active Tenant)
  const authResult = await authenticateContext(req, res, defaultRepository);
  if (!authResult.success) {
    return sendJson(res, authResult.status, { error: authResult.error });
  }

  const context = authResult.context;

  // POST /api/v1/commercial/payment-settings (Platform owner only: updates merchant PIX key & gateways)
  // These settings are shared by every tenant (they say where subscription payments go), so a
  // tenant's own admin must not be able to change them. Only the owner tenant's admin can.
  if (parsedUrl === '/api/v1/commercial/payment-settings' && method === 'POST') {
    const ownerTenantId = process.env.PLATFORM_OWNER_TENANT_ID || '';
    if (context.role !== 'admin' || !ownerTenantId || context.tenantId !== ownerTenantId) {
      auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        action: 'BILLING:SETTINGS_CHANGE_DENIED',
        entityType: 'PAYMENT_SETTINGS',
        ipAddress: clientIp,
        severity: SEVERITY.SECURITY_ALERT
      });
      return sendJson(res, 403, { error: 'Apenas o administrador da plataforma pode configurar o recebimento de pagamentos.' });
    }
    try {
      const { body } = await parseJsonBody(req);
      const updated = commercialService.updatePaymentSettings(body);
      return sendJson(res, 200, { success: true, settings: updated });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // ROUTE: GET /api/v1/commercial/subscription (Quotas, Plan, Trial Status)
  if (parsedUrl === '/api/v1/commercial/subscription' && method === 'GET') {
    const sub = await commercialService.getSubscription(context.tenantId);
    if (!sub) {
      return sendJson(res, 404, { error: 'Assinatura não localizada para o locatário.' });
    }
    return sendJson(res, 200, { success: true, data: sub });
  }

  // ROUTE: GET /api/v1/leads
  if (parsedUrl === '/api/v1/leads' && method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryParams = Object.fromEntries(urlObj.searchParams.entries());
    const result = await leadController.list(context, queryParams);
    return sendJson(res, result.status, result.body);
  }

  // ROUTE: POST /api/v1/leads
  if (parsedUrl === '/api/v1/leads' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const result = await leadController.create(context, body);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // ROUTE: GET /api/v1/leads/:id
  const matchLeadId = parsedUrl.match(/^\/api\/v1\/leads\/([a-zA-Z0-9_-]+)$/);
  if (matchLeadId) {
    const leadId = matchLeadId[1];

    if (method === 'GET') {
      const result = await leadController.getById(context, leadId);
      return sendJson(res, result.status, result.body);
    }

    if (method === 'PUT') {
      try {
        const { body } = await parseJsonBody(req);
        const result = await leadController.update(context, leadId, body);
        return sendJson(res, result.status, result.body);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (method === 'DELETE') {
      const result = await leadController.delete(context, leadId);
      return sendJson(res, result.status, result.body);
    }
  }

  // ROUTE: POST /api/v1/export/request
  if (parsedUrl === '/api/v1/export/request' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const result = await exportController.requestBulkExportApproval(context, body);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // ROUTE: POST /api/v1/export/leads
  if (parsedUrl === '/api/v1/export/leads' && method === 'POST') {
    try {
      const { body } = await parseJsonBody(req);
      const result = await exportController.exportLeads(context, body);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // ROUTE: GET /api/v1/audit/logs (Restricted to Admin or Auditor)
  if (parsedUrl === '/api/v1/audit/logs' && method === 'GET') {
    if (context.role !== 'admin' && context.role !== 'system_auditor') {
      return sendJson(res, 403, { error: 'ACESSO NEGADO: Trilha de auditoria restrita a Administradores (ISO 27001).' });
    }
    const logs = await auditService.queryLogs(context.tenantId);
    return sendJson(res, 200, { success: true, count: logs.length, data: logs });
  }

  return sendJson(res, 404, { error: 'Endpoint da API v1 não encontrado.' });
}

module.exports = {
  handleApiV1
};
