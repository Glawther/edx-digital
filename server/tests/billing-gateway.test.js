/**
 * EDX Digital - Multi-Gateway & 7-Day Trial Billing Tests
 * Tests: PIX EMVCo Generation, Asaas/Stripe/Kiwify Normalization & Subscription Quota Query
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { MultiTenantRepository } = require('../database/repository');
const { CommercialService } = require('../services/commercial-service');
const { BillingGatewayAdapter, defaultBillingAdapter } = require('../services/billing-gateway-adapter');

test('💳 [BILLING GATEWAY] Unified Multi-Gateway & Subscription Quotas', async (t) => {
  const gateway = new BillingGatewayAdapter();
  let repo;
  let commercialService;

  t.beforeEach(() => {
    repo = new MultiTenantRepository();
    commercialService = new CommercialService(repo, gateway);
  });

  await t.test('1. Deve gerar payload PIX padrão BR Code (EMVCo) válido com CRC16', () => {
    const pixPayload = gateway.generatePixPayload({
      pixKey: 'pix@example.com',
      recipientName: 'EDX DIGITAL SAAS',
      recipientCity: 'SAO PAULO',
      amount: 197.00,
      txId: 'TEST-TXID-1234'
    });

    assert.ok(pixPayload.startsWith('000201'), 'PIX deve iniciar com Payload Format Indicator 000201');
    assert.match(pixPayload, /br\.gov\.bcb\.pix/, 'PIX deve conter domínio oficial do Banco Central');
    assert.match(pixPayload, /197\.00/, 'PIX deve conter o valor exato formatado');
    assert.match(pixPayload, /6304[A-F0-9]{4}$/, 'PIX deve encerrar com CRC16 de 4 caracteres hexadecimais');
  });

  await t.test('2. Deve criar sessão de checkout com PIX Copia e Cola e QR Code', async () => {
    const checkout = await gateway.createCheckoutSession({
      tenantId: 'tenant-demo-123',
      plan: 'pro',
      billingCycle: 'monthly',
      customer: { name: 'João Silva', email: 'joao@empresa.com' }
    });

    assert.equal(checkout.success, true);
    assert.equal(checkout.plan, 'pro');
    assert.equal(checkout.amount, 197.00);
    assert.ok(checkout.pix.copyPaste, 'Deve incluir chave PIX copia e cola');
    assert.ok(checkout.pix.qrCodeUrl, 'Deve incluir URL do QR Code');
    assert.ok(checkout.orderId.startsWith('ord_'), 'Deve gerar identificador único de ordem');
  });

  await t.test('3. Deve normalizar webhooks do Asaas para o padrão do CRM', () => {
    const asaasPayload = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_987654321',
        customer: 'cus_123',
        externalReference: 'tenant-asaas-01',
        value: 497.00,
        description: 'Assinatura Plano Enterprise EDX Digital'
      }
    };

    const normalized = gateway.normalizeWebhookPayload(asaasPayload);
    assert.equal(normalized.type, 'payment.approved');
    assert.equal(normalized.data.tenant_id, 'tenant-asaas-01');
    assert.equal(normalized.data.plan, 'enterprise');
    assert.equal(normalized.data.amount, 497.00);
    assert.equal(normalized.data.gateway, 'asaas');
  });

  await t.test('4. Deve normalizar webhooks do Stripe para o padrão do CRM', () => {
    const stripePayload = {
      id: 'evt_stripe_12345',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          client_reference_id: 'tenant-stripe-02',
          amount_paid: 19700,
          currency: 'brl',
          metadata: { plan: 'pro' }
        }
      }
    };

    const normalized = gateway.normalizeWebhookPayload(stripePayload);
    assert.equal(normalized.type, 'payment.approved');
    assert.equal(normalized.data.tenant_id, 'tenant-stripe-02');
    assert.equal(normalized.data.plan, 'pro');
  });

  await t.test('5. Deve normalizar webhooks do Kiwify para o padrão do CRM', () => {
    const kiwifyPayload = {
      order_id: 'kiwify_order_999',
      order_status: 'paid',
      order_amount: 9700,
      custom_fields: { tenant_id: 'tenant-kiwify-03' },
      Product: { name: 'EDX Digital Plano Starter Mensal' }
    };

    const normalized = gateway.normalizeWebhookPayload(kiwifyPayload);
    assert.equal(normalized.type, 'payment.approved');
    assert.equal(normalized.data.tenant_id, 'tenant-kiwify-03');
    assert.equal(normalized.data.plan, 'starter');
  });

  await t.test('6. Deve consultar detalhes da assinatura e contagem de trial de 7 dias', async () => {
    const registration = await commercialService.registerTenant({
      companyName: 'Trial Soluções Tech',
      adminName: 'Renato Porto',
      email: 'renato@trialsolucoes.com',
      password: 'StrongPassword2026!',
      plan: 'pro'
    });

    const sub = await commercialService.getSubscription(registration.tenant.id);
    assert.equal(sub.plan, 'pro');
    assert.equal(sub.isTrial, true);
    assert.equal(sub.trialDaysRemaining, 7);
    assert.ok(sub.trialEndsAt, 'Deve conter data de expiração do trial');
    assert.equal(sub.quotas.users.limit, 15);
    assert.equal(sub.quotas.leads.limit, 25000);
    assert.equal(sub.quotas.leads.used, 1); // 1 welcome lead
  });

  await t.test('7. Deve normalizar webhooks do Mercado Pago para o padrão do CRM', () => {
    const mpPayload = {
      action: 'payment.created',
      type: 'payment',
      data: {
        id: '1234567890',
        external_reference: 'tenant-mp-01',
        transaction_amount: 197.00,
        status: 'approved'
      }
    };

    const normalized = gateway.normalizeWebhookPayload(mpPayload);
    assert.equal(normalized.type, 'payment.approved');
    assert.equal(normalized.data.tenant_id, 'tenant-mp-01');
    assert.equal(normalized.data.amount, 197.00);
    assert.equal(normalized.data.gateway, 'mercadopago');
  });

  await t.test('8. Deve gerar link de confirmação do WhatsApp com dados do PIX e tenant', () => {
    const waUrl = gateway.generateWhatsAppConfirmationUrl({
      tenantId: 'tenant-wa-99',
      plan: 'starter',
      amount: 97.00,
      txId: 'NX-TX-5544'
    });

    assert.ok(waUrl.startsWith('https://wa.me/'), 'Deve ser uma URL oficial do WhatsApp');
    assert.match(waUrl, /STARTER/, 'Mensagem deve conter o plano em destaque');
    assert.match(waUrl, /97/, 'Mensagem deve conter o valor');
    assert.match(waUrl, /NX-TX-5544/, 'Mensagem deve conter o ID da transação');
  });

  await t.test('9. Deve atualizar configurações comerciais de recebimento com sucesso', () => {
    const updated = commercialService.updatePaymentSettings({
      pixKey: 'minha-chave-real@empresa.com.br',
      pixName: 'MINHA EMPRESA SAAS',
      supportWhatsapp: '5511988887777'
    });

    assert.equal(updated.pixKey, 'minha-chave-real@empresa.com.br');
    assert.equal(updated.pixName, 'MINHA EMPRESA SAAS');
    assert.equal(updated.supportWhatsapp, '5511988887777');
  });
});
