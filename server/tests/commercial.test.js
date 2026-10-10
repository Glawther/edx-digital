/**
 * EDX Digital - Automated Commercial & Monetization Tests
 * Tests: Plans Catalog, Self-Service Onboarding, Plan Quotas, HMAC Billing Webhooks & Idempotency
 * Framework: Node.js Native Test Runner (node:test & node:assert)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { MultiTenantRepository } = require('../database/repository');
const { CommercialService, COMMERCIAL_PLANS } = require('../services/commercial-service');
const { generateWebhookSignature, verifyPassword } = require('../security/crypto-service');
const { auditService } = require('../security/audit-service');
const { verifySessionToken } = require('../middleware/auth-context');

test('💼 [COMMERCIAL SAAS] Plans, Self-Service Onboarding & Automated Billing Webhook', async (t) => {
  let repo;
  let commercialService;
  const webhookSecret = 'test_webhook_signing_secret_2026';

  t.beforeEach(() => {
    repo = new MultiTenantRepository();
    auditService.setDbAdapter(repo);
    commercialService = new CommercialService(repo);
  });

  await t.test('1. Deve listar os planos comerciais com precificação e limites corretos', () => {
    const plans = commercialService.listPlans();
    assert.ok(plans.starter, 'Plano starter deve existir');
    assert.ok(plans.pro, 'Plano pro deve existir');
    assert.ok(plans.enterprise, 'Plano enterprise deve existir');

    assert.equal(plans.starter.priceMonthly, 97);
    assert.equal(plans.starter.maxUsers, 3);
    assert.equal(plans.pro.maxUsers, 15);
    assert.equal(plans.enterprise.maxUsers, 999);
  });

  await t.test('2. Deve rejeitar cadastro com dados inválidos ou incompletos', async () => {
    // Falta empresa
    await assert.rejects(
      () => commercialService.registerTenant({ adminName: 'Admin', email: 'adm@test.com', password: 'password123' }),
      /nome da empresa é obrigatório/
    );

    // E-mail inválido
    await assert.rejects(
      () => commercialService.registerTenant({ companyName: 'Corp', adminName: 'Admin', email: 'invalid-email', password: 'password123' }),
      /E-mail corporativo inválido/
    );

    // Senha muito curta (< 6 caracteres)
    await assert.rejects(
      () => commercialService.registerTenant({ companyName: 'Corp', adminName: 'Admin', email: 'adm@corp.com', password: '123' }),
      /mínimo 6 caracteres/
    );
  });

  await t.test('3. Deve cadastrar novo tenant com sucesso, aplicar cotas do plano e emitir JWT imediato', async () => {
    const result = await commercialService.registerTenant({
      companyName: 'Acme High Tech Ltda',
      adminName: 'Carlos Silva',
      email: 'carlos@acmetech.com.br',
      password: 'SuperSecurePassword2026!',
      plan: 'pro'
    }, '187.32.10.5');

    assert.equal(result.success, true);
    assert.ok(result.tenant.id, 'Tenant deve ter ID UUID');
    assert.equal(result.tenant.plan, 'pro');
    assert.equal(result.tenant.maxUsers, 15);
    assert.equal(result.tenant.maxLeads, 25000);
    assert.equal(result.user.role, 'admin');
    assert.ok(result.token, 'Token JWT deve ser gerado');

    // Validação da senha criptografada com Scrypt
    const savedUser = Array.from(repo.users.values()).find(u => u.email === 'carlos@acmetech.com.br');
    assert.ok(savedUser, 'Usuário admin deve estar persistido no repositório');
    assert.ok(savedUser.password_hash.startsWith('$scrypt$'), 'Senha deve ser armazenada com hash Scrypt');
    const isPasswordValid = await verifyPassword('SuperSecurePassword2026!', savedUser.password_hash);
    assert.equal(isPasswordValid, true, 'Senha original deve ser autenticável');

    // Validação do Token JWT
    const decoded = verifySessionToken(result.token);
    assert.equal(decoded.tenantId, result.tenant.id);
    assert.equal(decoded.userId, result.user.id);
    assert.equal(decoded.role, 'admin');

    // Validação de Seed Lead no Pipeline Kanban
    const leads = Array.from(repo.leads.values()).filter(l => l.tenant_id === result.tenant.id);
    assert.equal(leads.length, 1, 'Deve criar lead de exemplo inicial para o novo tenant');
    assert.equal(leads[0].stage, 'contact');

    // Validação de Audit Log encadeado
    const auditLogs = Array.from(repo.auditLogs.values()).filter(a => a.tenant_id === result.tenant.id);
    assert.ok(auditLogs.some(a => a.action === 'TENANT:REGISTERED'), 'Log de auditoria para TENANT:REGISTERED deve existir');
  });

  await t.test('4. Não deve permitir slug corporativo duplicado', async () => {
    await commercialService.registerTenant({
      companyName: 'Vortex Solucoes',
      slug: 'vortex-solucoes',
      adminName: 'Maria',
      email: 'maria@vortex.com',
      password: 'Password123!'
    });

    await assert.rejects(
      () => commercialService.registerTenant({
        companyName: 'Vortex Solucoes',
        slug: 'vortex-solucoes',
        adminName: 'Outro Usuario',
        email: 'outro@vortex.com',
        password: 'Password123!'
      }),
      /já está em uso/
    );
  });

  await t.test('5. Billing Webhook: deve rejeitar requisição com assinatura HMAC ausente ou inválida', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_test_01',
      type: 'subscription.created',
      data: { tenant_id: 'any-id', plan: 'enterprise' }
    });

    // Assinatura inválida
    const response = await commercialService.processBillingWebhook(
      rawPayload,
      'invalid_signature_hash',
      webhookSecret,
      '192.168.1.100'
    );

    assert.equal(response.status, 401);
    assert.match(response.error, /Assinatura de faturamento inválida/);
  });

  await t.test('6. Billing Webhook: deve atualizar cota do plano via assinatura HMAC válida', async () => {
    // 1. Cadastrar tenant inicial no plano starter
    const tenantReg = await commercialService.registerTenant({
      companyName: 'Start Soluções',
      adminName: 'Ana Souza',
      email: 'ana@startsolucoes.com',
      password: 'Password123!',
      plan: 'starter'
    });

    assert.equal(tenantReg.tenant.plan, 'starter');
    assert.equal(tenantReg.tenant.maxUsers, 3);

    // 2. Simular evento de upgrade para Enterprise pelo gateway de pagamento
    const payloadObj = {
      id: 'evt_upgrade_' + crypto.randomUUID(),
      type: 'subscription.upgraded',
      data: {
        tenant_id: tenantReg.tenant.id,
        plan: 'enterprise',
        amount: 497.00,
        currency: 'BRL',
        timestamp: new Date().toISOString()
      }
    };
    const rawPayload = JSON.stringify(payloadObj);
    const validSignature = generateWebhookSignature(rawPayload, webhookSecret);

    const webhookResponse = await commercialService.processBillingWebhook(
      rawPayload,
      `sha256=${validSignature}`,
      webhookSecret,
      '54.233.10.15'
    );

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookResponse.success, true);
    assert.equal(webhookResponse.plan, 'enterprise');

    // Verificar se o banco atualizou as cotas do tenant
    const updatedTenant = repo.tenants.get(tenantReg.tenant.id);
    assert.equal(updatedTenant.plan, 'enterprise');
    assert.equal(updatedTenant.max_users, 999);
    assert.equal(updatedTenant.max_leads, 999999);

    // 3. Teste de Idempotência: reenviar o mesmo evento
    const duplicateResponse = await commercialService.processBillingWebhook(
      rawPayload,
      `sha256=${validSignature}`,
      webhookSecret,
      '54.233.10.15'
    );

    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicateResponse.success, true);
    assert.match(duplicateResponse.message, /Idempotente/);
  });

  await t.test('7. Billing Webhook: deve suspender locatário em caso de cancelamento de assinatura', async () => {
    const tenantReg = await commercialService.registerTenant({
      companyName: 'Cancel Test Corp',
      adminName: 'Bruno Dias',
      email: 'bruno@canceltest.com',
      password: 'Password123!',
      plan: 'pro'
    });

    const payloadObj = {
      id: 'evt_cancel_' + crypto.randomUUID(),
      type: 'subscription.canceled',
      data: {
        tenant_id: tenantReg.tenant.id,
        reason: 'customer_request'
      }
    };
    const rawPayload = JSON.stringify(payloadObj);
    const validSignature = generateWebhookSignature(rawPayload, webhookSecret);

    const webhookResponse = await commercialService.processBillingWebhook(
      rawPayload,
      validSignature,
      webhookSecret,
      '54.233.10.15'
    );

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookResponse.success, true);
    assert.equal(webhookResponse.subscriptionStatus, 'canceled');

    const updatedTenant = repo.tenants.get(tenantReg.tenant.id);
    assert.equal(updatedTenant.status, 'canceled');
  });

  await t.test('8. Equipe: Deve permitir que um funcionário entre na empresa via código de convite válido', async () => {
    // 1. Cadastrar empresa do Dono
    const ownerReg = await commercialService.registerTenant({
      companyName: 'Alfa Tech Enterprise',
      adminName: 'Roberto Dono',
      email: 'roberto@alfatech.com',
      password: 'SenhaDono#2026',
      plan: 'pro'
    });

    const inviteCode = ownerReg.tenant.teamInviteCode;
    assert.ok(inviteCode.startsWith('NX-'), 'Deve gerar código de convite corporativo iniciado por NX-');

    // 2. Colaborador ingressa via código de convite
    const employeeJoin = await commercialService.joinTeam({
      inviteCode,
      name: 'Marcos Vendedor',
      email: 'marcos@alfatech.com',
      password: 'SenhaVendedor#123'
    });

    assert.equal(employeeJoin.success, true);
    assert.equal(employeeJoin.user.role, 'employee');
    assert.equal(employeeJoin.tenant.id, ownerReg.tenant.id);
    assert.ok(employeeJoin.token);
  });

  await t.test('9. Equipe: Deve rejeitar cadastro de funcionário com código de convite inexistente ou inválido', async () => {
    await assert.rejects(
      () => commercialService.joinTeam({
        inviteCode: 'NX-INVALIDO-999',
        name: 'Tentativa Invasor',
        email: 'invasor@hacker.com',
        password: 'SenhaHacker123'
      }),
      /Código de convite inválido ou não autorizado/
    );

    // Sem código de convite
    await assert.rejects(
      () => commercialService.joinTeam({
        inviteCode: '',
        name: 'Tentativa Sem Codigo',
        email: 'semcodigo@hacker.com',
        password: 'SenhaHacker123'
      }),
      /Código de convite obrigatório/
    );
  });
});
