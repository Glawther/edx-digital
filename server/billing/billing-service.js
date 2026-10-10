/**
 * EDX Digital - Subscription billing by PIX.
 *
 * The rule that matters: a plan is only ever released from what the payment provider itself
 * reports about a charge this server created. Nothing sent by a browser or in a webhook body
 * is trusted: the webhook only tells us which payment to go and look at.
 */

const crypto = require('crypto');

// Keep in step with js/services/billing-service.js and the plans on landing.html
const PLAN_PRICES = { starter: 97, pro: 197, enterprise: 497 };
const PLAN_NAMES = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
const PERIOD_DAYS = 30;
const CHARGE_VALID_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// What Mercado Pago reports when the whole amount went back to the payer
const REVERSED = ['refunded', 'charged_back'];

class BillingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {Object} deps
 * @param {Object} deps.store    - getUserProfile, getOrganization, updateOrganization, getPayment, savePayment, updatePayment
 * @param {Object} deps.gateway  - createPixPayment, getPayment
 * @param {Function} [deps.now]  - clock, for tests
 * @param {string} [deps.notificationUrl] - public address of the webhook
 */
function createBillingService({ store, gateway, now = () => Date.now(), notificationUrl = '' }) {

  async function requireCompanyAdmin(uid) {
    const profile = await store.getUserProfile(uid);
    if (!profile || profile.status !== 'active') {
      throw new BillingError('no_profile', 'Conta sem empresa vinculada.', 403);
    }
    if (profile.role !== 'admin') {
      throw new BillingError('not_admin', 'Só administradores podem assinar um plano.', 403);
    }
    return profile;
  }

  /**
   * Creates the PIX charge for a plan. A charge still valid for the same plan is handed back
   * instead of creating another one.
   */
  async function createCharge(user, plan) {
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, plan)) {
      throw new BillingError('invalid_plan', 'Plano inválido.');
    }
    const profile = await requireCompanyAdmin(user.uid);
    const org = await store.getOrganization(profile.orgId);
    if (!org) throw new BillingError('no_company', 'Empresa não encontrada.', 404);

    const current = now();
    if (org.pendingPaymentId) {
      const pending = await store.getPayment(org.pendingPaymentId);
      if (pending && pending.status === 'pending' && pending.plan === plan && Date.parse(pending.expiresAt) > current + 60000) {
        return publicCharge(org.pendingPaymentId, pending);
      }
    }

    const amount = PLAN_PRICES[plan];
    const expiresAt = new Date(current + CHARGE_VALID_MINUTES * 60000).toISOString();
    const reference = crypto.randomBytes(8).toString('hex');

    const charge = await gateway.createPixPayment({
      amount,
      description: `EDX Digital, plano ${PLAN_NAMES[plan]}, ${PERIOD_DAYS} dias`,
      payerEmail: user.email || profile.email,
      payerName: profile.name || user.name,
      externalReference: `${profile.orgId}|${plan}|${reference}`,
      idempotencyKey: `${profile.orgId}-${plan}-${reference}`,
      notificationUrl,
      expiresAt
    });

    const record = {
      orgId: profile.orgId,
      plan,
      amount,
      status: 'pending',
      copyPaste: charge.copyPaste,
      qrCodeBase64: charge.qrCodeBase64,
      createdBy: user.uid,
      createdAt: new Date(current).toISOString(),
      expiresAt
    };
    await store.savePayment(charge.id, record);
    await store.updateOrganization(profile.orgId, { pendingPaymentId: charge.id });
    return publicCharge(charge.id, record);
  }

  function publicCharge(paymentId, record) {
    return {
      paymentId,
      plan: record.plan,
      amount: record.amount,
      status: record.status,
      copyPaste: record.copyPaste,
      qrCodeBase64: record.qrCodeBase64,
      expiresAt: record.expiresAt
    };
  }

  /**
   * Looks the payment up at the provider and, if it was really paid, releases the plan.
   * Safe to call any number of times, from the webhook or from the browser's status check.
   */
  const inFlight = new Map();

  // The webhook and the browser's status check can arrive together for the same payment.
  // They share one run, so a period is never added twice.
  function syncPayment(paymentId) {
    if (!inFlight.has(paymentId)) {
      inFlight.set(paymentId, applyPayment(paymentId).finally(() => inFlight.delete(paymentId)));
    }
    return inFlight.get(paymentId);
  }

  async function applyPayment(paymentId) {
    const record = await store.getPayment(paymentId);
    if (!record) {
      // Not a charge this server created: nothing to release
      throw new BillingError('unknown_payment', 'Cobrança desconhecida.', 404);
    }
    if (record.status === 'refunded') {
      return { status: 'refunded', plan: record.plan, alreadyApplied: true };
    }

    const payment = await gateway.getPayment(paymentId);

    if (record.status === 'approved') {
      // A payment that had released a period and was later given back takes that period away
      if (REVERSED.includes(payment.status)) return revokePayment(paymentId, record, payment.status);
      return { status: 'approved', plan: record.plan, paidUntil: record.paidUntil || null, alreadyApplied: true };
    }

    if (payment.status !== 'approved') {
      const closed = ['cancelled', 'rejected', 'refunded', 'charged_back', 'expired'].includes(payment.status);
      if (closed && record.status === 'pending') {
        await store.updatePayment(paymentId, { status: payment.status });
      }
      return { status: closed ? payment.status : 'pending', plan: record.plan };
    }

    // Everything the provider reports has to match the charge we created
    const [orgId, plan] = String(payment.externalReference).split('|');
    if (orgId !== record.orgId || plan !== record.plan) {
      throw new BillingError('reference_mismatch', 'A cobrança não corresponde ao registro.', 409);
    }
    if (payment.currency !== 'BRL' || !(payment.amount >= PLAN_PRICES[record.plan])) {
      throw new BillingError('amount_mismatch', 'O valor pago não corresponde ao plano.', 409);
    }

    const org = await store.getOrganization(record.orgId);
    if (!org) throw new BillingError('no_company', 'Empresa não encontrada.', 404);

    // Paying early extends from the end of what is already paid, not from today
    const current = now();
    const paidUntilNow = org.planStatus === 'active' && org.paidUntil ? Date.parse(org.paidUntil) : 0;
    const start = Math.max(current, paidUntilNow || 0);
    const paidUntilMs = start + PERIOD_DAYS * DAY_MS;
    const paidUntil = new Date(paidUntilMs).toISOString();
    const approvedAt = payment.approvedAt || new Date(current).toISOString();

    // The payment is marked first: if anything fails after this, a retry cannot add a second period
    await store.updatePayment(paymentId, { status: 'approved', approvedAt, paidUntil });
    await store.updateOrganization(record.orgId, {
      plan: record.plan,
      planStatus: 'active',
      paidUntil,
      // the number is what the database rules compare with the clock
      paidUntilMs,
      lastPaymentId: paymentId,
      pendingPaymentId: null,
      updatedAt: new Date(current).toISOString()
    });

    return { status: 'approved', plan: record.plan, paidUntil };
  }

  /**
   * Takes back the period a refunded (or charged back) payment had released.
   * Other periods paid for stay; with none left, the company goes back to where the
   * free trial stands, which usually means read-only mode.
   */
  async function revokePayment(paymentId, record, providerStatus) {
    const current = now();
    // Marked first, so a repeated notice cannot take a second period away
    await store.updatePayment(paymentId, { status: 'refunded', providerStatus, refundedAt: new Date(current).toISOString() });

    const org = await store.getOrganization(record.orgId);
    if (!org) return { status: 'refunded', plan: record.plan };

    const paidUntilNow = Number(org.paidUntilMs) || (org.paidUntil ? Date.parse(org.paidUntil) : 0);
    const remainingMs = paidUntilNow - PERIOD_DAYS * DAY_MS;
    const updatedAt = new Date(current).toISOString();

    if (org.planStatus === 'active' && remainingMs > current) {
      await store.updateOrganization(record.orgId, { paidUntilMs: remainingMs, paidUntil: new Date(remainingMs).toISOString(), updatedAt });
    } else if (org.planStatus === 'active') {
      await store.updateOrganization(record.orgId, {
        planStatus: 'trial',
        paidUntil: null,
        paidUntilMs: null,
        // a company from before the trial end was recorded would otherwise be free for good
        trialEndsAtMs: typeof org.trialEndsAtMs === 'number' ? org.trialEndsAtMs : current,
        updatedAt
      });
    }
    return { status: 'refunded', plan: record.plan };
  }

  /**
   * Status check asked for by the browser: only for a charge of the caller's own company
   */
  async function checkCharge(user, paymentId) {
    const profile = await requireCompanyAdmin(user.uid);
    const record = await store.getPayment(paymentId);
    if (!record || record.orgId !== profile.orgId) {
      throw new BillingError('unknown_payment', 'Cobrança desconhecida.', 404);
    }
    return syncPayment(paymentId);
  }

  return { createCharge, syncPayment, checkCharge };
}

module.exports = { createBillingService, BillingError, PLAN_PRICES, PERIOD_DAYS };
