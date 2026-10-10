/**
 * EDX Digital - SaaS Commercialization & Subscription Service
 * Standards: Multi-Tenant Self-Service Onboarding, Plan Quotas, Automated Billing Webhooks
 * Security: Scrypt Password Hashing, Idempotent Processing, HMAC Verification
 */

const crypto = require('crypto');
const { defaultRepository, SecurityContext } = require('../database/repository');
const { hashPassword, verifyWebhookSignature } = require('../security/crypto-service');
const { auditService, AUDIT_ACTIONS, SEVERITY } = require('../security/audit-service');
const { generateSessionToken } = require('../middleware/auth-context');
const { defaultBillingAdapter } = require('./billing-gateway-adapter');

// Plan specifications & quotas with 7-day trial and checkout URLs
const COMMERCIAL_PLANS = {
  starter: {
    id: 'starter',
    name: 'EDX Digital Starter',
    priceMonthly: 97.00,
    priceAnnual: 77.00,
    trialDays: 7,
    maxUsers: 3,
    maxLeads: 5000,
    checkoutUrl: process.env.CHECKOUT_STARTER_URL || '/checkout?plan=starter',
    features: ['Kanban Drag & Drop', 'WhatsApp 1-Clique', 'Backup CSV', 'Até 3 usuários']
  },
  pro: {
    id: 'pro',
    name: 'EDX Digital Professional',
    priceMonthly: 197.00,
    priceAnnual: 157.00,
    trialDays: 7,
    maxUsers: 15,
    maxLeads: 25000,
    checkoutUrl: process.env.CHECKOUT_PRO_URL || '/checkout?plan=pro',
    features: ['IA Gemini Flash Ilimitada', 'Webhooks Meta Ads', 'Customização Whitelabel', 'Até 15 usuários']
  },
  enterprise: {
    id: 'enterprise',
    name: 'EDX Digital Enterprise',
    priceMonthly: 497.00,
    priceAnnual: 397.00,
    trialDays: 7,
    maxUsers: 999,
    maxLeads: 999999,
    checkoutUrl: process.env.CHECKOUT_ENTERPRISE_URL || '/checkout?plan=enterprise',
    features: ['Isolamento RLS Dedicado', 'Trilha Auditoria ISO 27001', 'Usuários Ilimitados', 'SLA 99.9%', 'Suporte VIP']
  }
};

class CommercialService {
  constructor(repository = defaultRepository, billingAdapter = defaultBillingAdapter) {
    this.repository = repository;
    this.billingAdapter = billingAdapter;
    this.processedWebhookEvents = new Set(); // In-memory idempotency cache
  }

  /**
   * Self-Service Onboarding: Creates Tenant, Root Admin User, Initial Pipeline, and Session Token
   */
  async registerTenant(params, clientIp = '127.0.0.1') {
    const {
      companyName,
      slug,
      adminName: rawAdminName,
      name,
      email,
      password,
      plan = 'pro'
    } = params;

    const adminName = rawAdminName || name;

    // 1. Input Validation
    if (!companyName || typeof companyName !== 'string' || companyName.trim().length < 2) {
      throw new Error('O nome da empresa é obrigatório (mínimo 2 caracteres).');
    }
    if (!adminName || typeof adminName !== 'string' || adminName.trim().length < 2) {
      throw new Error('O nome do administrador responsável é obrigatório.');
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      throw new Error('E-mail corporativo inválido.');
    }
    if (!password || password.length < 6) {
      throw new Error('A senha deve possuir no mínimo 6 caracteres.');
    }

    const selectedPlan = COMMERCIAL_PLANS[plan] || COMMERCIAL_PLANS.pro;

    // Normalize slug (e.g. "Acme Corp" -> "acme-corp")
    const cleanSlug = (slug || companyName)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `tenant-${Date.now().toString(36)}`;

    // Check slug uniqueness
    for (const t of this.repository.tenants.values()) {
      if (t.slug === cleanSlug) {
        throw new Error(`O identificador corporativo "${cleanSlug}" já está em uso. Escolha outro nome.`);
      }
    }

    // 2. Provision Tenant with Plan Quotas & 7-Day Trial
    const tenantId = crypto.randomUUID();
    const trialDays = selectedPlan.trialDays || 7;
    const trialEndsAt = new Date(Date.now() + (trialDays * 24 * 60 * 60 * 1000)).toISOString();
    const teamInviteCode = 'NX-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const tenant = {
      id: tenantId,
      name: companyName.trim(),
      slug: cleanSlug,
      plan: selectedPlan.id,
      status: 'active',
      subscription_status: 'trialing',
      trial_ends_at: trialEndsAt,
      max_users: selectedPlan.maxUsers,
      max_leads: selectedPlan.maxLeads,
      team_invite_code: teamInviteCode,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.repository.tenants.set(tenantId, tenant);

    // 3. Hash Password using Scrypt with 32-byte dynamic salt
    const passwordHash = await hashPassword(password);

    // 4. Create Root Admin User
    const adminContext = new SecurityContext({
      tenantId,
      userId: 'provisioning-system',
      role: 'admin',
      ipAddress: clientIp
    });

    const adminUser = await this.repository.createUser(adminContext, {
      name: adminName.trim(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      role: 'admin'
    });

    // 5. Seed Welcome Lead in Pipeline so user immediately experiences the system
    const userContext = new SecurityContext({
      tenantId,
      userId: adminUser.id,
      role: 'admin',
      ipAddress: clientIp
    });

    await this.repository.createLead(userContext, {
      name: 'Oportunidade Demonstração (Exemplo)',
      company: 'Cliente Exemplo B2B',
      email: 'contato@exemplo.com.br',
      phone: '11999998888',
      deal_value: 12500.00,
      stage: 'contact',
      priority: 'high',
      confidential_notes: `Lead inicial gerado na ativação do plano ${selectedPlan.name}. Aproveite para disparar WhatsApp ou testar a IA Gemini!`
    });

    // 6. Immutable Audit Log
    auditService.log({
      tenantId,
      actorId: adminUser.id,
      actorRole: 'admin',
      action: 'TENANT:REGISTERED',
      entityType: 'TENANT',
      entityId: tenantId,
      ipAddress: clientIp,
      severity: SEVERITY.INFO,
      newValues: { companyName, slug: cleanSlug, plan: selectedPlan.id, adminEmail: email }
    });

    // 7. Generate Session Token for Immediate Seamless Login
    const sessionToken = generateSessionToken({
      tenant_id: tenantId,
      tenantId: tenantId,
      user_id: adminUser.id,
      userId: adminUser.id,
      role: 'admin',
      name: adminUser.name,
      email: adminUser.email
    });

    return {
      success: true,
      message: `Empresa "${companyName}" cadastrada com sucesso no plano ${selectedPlan.name}!`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        maxUsers: tenant.max_users,
        maxLeads: tenant.max_leads,
        teamInviteCode: tenant.team_invite_code
      },
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role
      },
      token: sessionToken,
      tokenType: 'Bearer'
    };
  }

  /**
   * Allows an invited employee to join an existing company team via a verified invitation code
   */
  async joinTeam({ inviteCode, name, email, password }, clientIp = '127.0.0.1') {
    if (!inviteCode || typeof inviteCode !== 'string' || inviteCode.trim().length < 4) {
      throw new Error('Código de convite obrigatório. Solicite o código ao dono da sua empresa.');
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw new Error('O nome do colaborador é obrigatório.');
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      throw new Error('E-mail corporativo inválido.');
    }
    if (!password || password.length < 6) {
      throw new Error('A senha deve possuir no mínimo 6 caracteres.');
    }

    const cleanCode = inviteCode.trim().toUpperCase();

    // Find tenant by team_invite_code
    let targetTenant = null;
    for (const t of this.repository.tenants.values()) {
      if (t.team_invite_code && t.team_invite_code.toUpperCase() === cleanCode) {
        targetTenant = t;
        break;
      }
    }

    if (!targetTenant) {
      throw new Error('Código de convite inválido ou não autorizado. Solicite o código de acesso ao dono da sua empresa.');
    }

    // Check user limit quota for this tenant
    const existingUsers = Array.from(this.repository.users.values()).filter(u => u.tenant_id === targetTenant.id);
    if (existingUsers.length >= (targetTenant.max_users || 10)) {
      throw new Error(`O limite de usuários (${targetTenant.max_users}) do plano da empresa foi atingido. O administrador deve fazer upgrade do plano.`);
    }

    // Check if email is already in use in this tenant
    const emailLower = email.toLowerCase().trim();
    const duplicateUser = Array.from(this.repository.users.values()).find(
      u => u.tenant_id === targetTenant.id && u.email === emailLower
    );
    if (duplicateUser) {
      throw new Error('Este e-mail já está cadastrado nesta empresa.');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create Employee User in Target Tenant
    const sysContext = new SecurityContext({
      tenantId: targetTenant.id,
      userId: 'invite-system',
      role: 'admin',
      ipAddress: clientIp
    });

    const employeeUser = await this.repository.createUser(sysContext, {
      name: name.trim(),
      email: emailLower,
      password_hash: passwordHash,
      role: 'employee'
    });

    auditService.log({
      tenantId: targetTenant.id,
      actorId: employeeUser.id,
      actorRole: 'employee',
      action: 'TEAM:MEMBER_JOINED',
      entityType: 'USER',
      entityId: employeeUser.id,
      ipAddress: clientIp,
      severity: SEVERITY.INFO,
      newValues: { name: employeeUser.name, email: employeeUser.email, role: 'employee', viaInviteCode: cleanCode }
    });

    const sessionToken = generateSessionToken({
      tenant_id: targetTenant.id,
      tenantId: targetTenant.id,
      user_id: employeeUser.id,
      userId: employeeUser.id,
      role: 'employee',
      name: employeeUser.name,
      email: employeeUser.email
    });

    return {
      success: true,
      message: `Bem-vindo(a) à equipe da empresa "${targetTenant.name}"!`,
      tenant: {
        id: targetTenant.id,
        name: targetTenant.name,
        slug: targetTenant.slug,
        plan: targetTenant.plan
      },
      user: {
        id: employeeUser.id,
        name: employeeUser.name,
        email: employeeUser.email,
        role: employeeUser.role
      },
      token: sessionToken,
      tokenType: 'Bearer'
    };
  }

  /**
   * Processes Automated Billing Webhook (Stripe / Asaas / Hotmart / Kiwify)
   */
  async processBillingWebhook(rawBody, signature, signingSecret, clientIp = '127.0.0.1') {
    // 1. Signature Verification
    if (signingSecret) {
      const cleanSig = signature?.startsWith('sha256=') ? signature.slice(7) : signature;
      const isValid = verifyWebhookSignature(rawBody, cleanSig, signingSecret);
      if (!isValid) {
        auditService.log({
          tenantId: 'billing-gateway',
          action: 'BILLING:SIGNATURE_FAILED',
          entityType: 'BILLING_WEBHOOK',
          ipAddress: clientIp,
          severity: SEVERITY.SECURITY_ALERT,
          newValues: { error: 'Assinatura inválida no webhook de faturamento.' }
        });
        return { status: 401, error: 'Assinatura de faturamento inválida.' };
      }
    }

    // 2. Parse Payload
    let event;
    try {
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, error: 'Payload de faturamento inválido (JSON esperado).' };
    }

    // 3. Idempotency Check
    const eventId = event.id || event.event_id || `${event.type}:${event.data?.tenant_id}:${event.data?.timestamp}`;
    if (this.processedWebhookEvents.has(eventId)) {
      return { status: 200, success: true, message: 'Evento já processado anteriormente (Idempotente).' };
    }
    this.processedWebhookEvents.add(eventId);

    const { type, data } = event;
    const tenantId = data?.tenant_id;
    const targetPlan = data?.plan;

    if (!tenantId) {
      return { status: 400, error: 'tenant_id ausente nos dados do evento de faturamento.' };
    }

    const tenant = await this.repository.getTenantById(tenantId);
    if (!tenant) {
      return { status: 404, error: 'Tenant especificado não foi encontrado.' };
    }

    // 4. Handle Subscription Lifecycle Events
    switch (type) {
      case 'subscription.created':
      case 'payment.approved': {
        const planInfo = COMMERCIAL_PLANS[targetPlan] || COMMERCIAL_PLANS.pro;
        tenant.status = 'active';
        tenant.plan = planInfo.id;
        tenant.max_users = planInfo.maxUsers;
        tenant.max_leads = planInfo.maxLeads;
        tenant.updated_at = new Date().toISOString();

        auditService.log({
          tenantId,
          action: 'SUBSCRIPTION:ACTIVATED',
          entityType: 'SUBSCRIPTION',
          entityId: eventId,
          ipAddress: clientIp,
          severity: SEVERITY.INFO,
          newValues: { plan: planInfo.id, status: 'active', eventId }
        });

        return { status: 200, success: true, message: `Assinatura ativada no plano ${planInfo.name}.` };
      }

      case 'subscription.upgraded': {
        const planInfo = COMMERCIAL_PLANS[targetPlan] || COMMERCIAL_PLANS.enterprise;
        const oldPlan = tenant.plan;
        tenant.plan = planInfo.id;
        tenant.max_users = planInfo.maxUsers;
        tenant.max_leads = planInfo.maxLeads;
        tenant.updated_at = new Date().toISOString();

        auditService.log({
          tenantId,
          action: 'SUBSCRIPTION:UPGRADED',
          entityType: 'SUBSCRIPTION',
          entityId: eventId,
          ipAddress: clientIp,
          severity: SEVERITY.INFO,
          oldValues: { plan: oldPlan },
          newValues: { plan: planInfo.id, maxUsers: planInfo.maxUsers }
        });

        return { status: 200, success: true, plan: planInfo.id, maxUsers: planInfo.maxUsers, message: `Upgrade de plano realizado para ${planInfo.name} com sucesso.` };
      }

      case 'subscription.canceled':
      case 'payment.failed': {
        const nextStatus = data?.status || (type === 'subscription.canceled' ? 'canceled' : 'suspended');
        tenant.status = nextStatus;
        tenant.updated_at = new Date().toISOString();

        auditService.log({
          tenantId,
          action: 'SUBSCRIPTION:STATUS_CHANGED',
          entityType: 'SUBSCRIPTION',
          entityId: eventId,
          ipAddress: clientIp,
          severity: SEVERITY.WARNING,
          newValues: { status: nextStatus, reason: type }
        });

        return { status: 200, success: true, subscriptionStatus: nextStatus, message: `Assinatura atualizada para status ${nextStatus}.` };
      }

      default:
        return { status: 200, success: true, message: `Evento "${type}" recebido e registrado.` };
    }
  }

  getPlans() {
    return COMMERCIAL_PLANS;
  }

  listPlans() {
    return COMMERCIAL_PLANS;
  }

  /**
   * Retrieves subscription status, quotas usage and trial information
   */
  async getSubscription(tenantId) {
    const tenant = await this.repository.getTenantById(tenantId);
    if (!tenant) return null;

    const plan = COMMERCIAL_PLANS[tenant.plan] || COMMERCIAL_PLANS.pro;
    const usersCount = Array.from(this.repository.users.values()).filter(u => u.tenant_id === tenantId).length;
    const leadsCount = Array.from(this.repository.leads.values()).filter(l => l.tenant_id === tenantId).length;

    const trialEnds = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
    const now = new Date();
    const daysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24))) : 0;

    return {
      tenantId: tenant.id,
      companyName: tenant.name,
      teamInviteCode: tenant.team_invite_code,
      plan: plan.id,
      planName: plan.name,
      status: tenant.status,
      subscriptionStatus: tenant.subscription_status || 'active',
      isTrial: tenant.subscription_status === 'trialing' && daysLeft > 0,
      trialDaysRemaining: daysLeft,
      trialEndsAt: tenant.trial_ends_at,
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      checkoutUrl: plan.checkoutUrl,
      quotas: {
        users: { used: usersCount, limit: tenant.max_users || plan.maxUsers },
        leads: { used: leadsCount, limit: tenant.max_leads || plan.maxLeads }
      },
      features: plan.features
    };
  }

  /**
   * Creates an online checkout session with PIX QR Code & Link
   */
  async createCheckout(params) {
    return this.billingAdapter.createCheckoutSession(params);
  }

  /**
   * Retrieves active payment receiving settings (PIX key, WhatsApp, gateways)
   */
  getPaymentSettings() {
    return {
      provider: this.billingAdapter.provider,
      pixKey: this.billingAdapter.pixKey,
      pixName: this.billingAdapter.pixName,
      pixCity: this.billingAdapter.pixCity,
      supportWhatsapp: this.billingAdapter.supportWhatsapp,
      hasMercadoPago: !!this.billingAdapter.mercadoPagoToken,
      hasAsaas: !!this.billingAdapter.asaasApiKey,
      checkoutUrls: this.billingAdapter.checkoutUrls
    };
  }

  /**
   * Updates commercial payment settings (Admin only)
   */
  updatePaymentSettings(settings = {}) {
    if (settings.pixKey !== undefined) this.billingAdapter.pixKey = settings.pixKey;
    if (settings.pixName !== undefined) this.billingAdapter.pixName = settings.pixName;
    if (settings.pixCity !== undefined) this.billingAdapter.pixCity = settings.pixCity;
    if (settings.supportWhatsapp !== undefined) this.billingAdapter.supportWhatsapp = settings.supportWhatsapp;
    if (settings.mercadoPagoToken !== undefined) this.billingAdapter.mercadoPagoToken = settings.mercadoPagoToken;
    if (settings.asaasApiKey !== undefined) this.billingAdapter.asaasApiKey = settings.asaasApiKey;
    if (settings.checkoutUrls) {
      this.billingAdapter.checkoutUrls = {
        ...this.billingAdapter.checkoutUrls,
        ...settings.checkoutUrls
      };
    }
    return this.getPaymentSettings();
  }
}

const commercialService = new CommercialService();

module.exports = {
  CommercialService,
  commercialService,
  COMMERCIAL_PLANS
};
