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
// A charge of this amount, only for whoever owns the system, to see a real payment go through
const TEST_AMOUNT = 1;
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
 * @param {Function} [deps.onPlanChanged] - called with the company's id after its plan changed
 */
function createBillingService({ store, gateway, now = () => Date.now(), onPlanChanged = null }) {

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
   * With `test`, the charge is of R$ 1 and releases the plan like any other: the caller has
   * already made sure only the owner of the system can ask for it.
   */
  async function createCharge(user, plan, { test = false } = {}) {
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, plan)) {
      throw new BillingError('invalid_plan', 'Plano inválido.');
    }
    const profile = await requireCompanyAdmin(user.uid);
    const org = await store.getOrganization(profile.orgId);
    if (!org) throw new BillingError('no_company', 'Empresa não encontrada.', 404);

    const current = now();
    if (org.pendingPaymentId) {
      const pending = await store.getPayment(org.pendingPaymentId);
      if (pending && pending.status === 'pending' && pending.plan === plan && Boolean(pending.test) === test && Date.parse(pending.expiresAt) > current + 60000) {
        return publicCharge(org.pendingPaymentId, pending);
      }
    }

    const amount = test ? TEST_AMOUNT : PLAN_PRICES[plan];
    const expiresAt = new Date(current + CHARGE_VALID_MINUTES * 60000).toISOString();
    // Letters, numbers, hyphen and underscore only, within the 64 characters Mercado Pago accepts
    const reference = `${profile.orgId}-${plan}-${crypto.randomBytes(8).toString('hex')}`.slice(0, 64);

    const charge = await gateway.createPixPayment({
      amount,
      description: test ? 'EDX Digital, cobrança de teste' : `EDX Digital, plano ${PLAN_NAMES[plan]}, ${PERIOD_DAYS} dias`,
      payerEmail: user.email || profile.email,
      externalReference: reference,
      idempotencyKey: reference,
      expiresAt
    });

    const record = {
      orgId: profile.orgId,
      plan,
      amount,
      ...(test ? { test: true } : {}),
      status: 'pending',
      reference,
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

  // The changes to a payment and to its company are made together, in a database transaction:
  // the webhook and the browser's status check can reach two copies of the server at once,
  // and only one of them may release (or take back) a period. A store without transactions
  // (the tests) runs the same steps one after the other.
  const transact = store.transaction ? (fn) => store.transaction(fn) : (fn) => fn(store);

  // Within one copy of the server, the webhook and the status check share one run
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
      if (REVERSED.includes(payment.status)) return revokePayment(paymentId, payment.status);
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
    if (!referenceMatches(record, payment.externalReference)) {
      throw new BillingError('reference_mismatch', 'A cobrança não corresponde ao registro.', 409);
    }
    // the amount expected comes from the record this server wrote, never from the request
    const expected = record.test === true ? TEST_AMOUNT : PLAN_PRICES[record.plan];
    if (payment.currency !== 'BRL' || !(payment.amount >= expected)) {
      throw new BillingError('amount_mismatch', 'O valor pago não corresponde ao plano.', 409);
    }

    const outcome = await transact(async (tx) => {
      // read again inside the transaction: another copy of the server may have applied it meanwhile
      const fresh = await tx.getPayment(paymentId);
      if (!fresh || fresh.status !== 'pending') {
        return { result: { status: fresh ? fresh.status : 'unknown', plan: record.plan, paidUntil: (fresh && fresh.paidUntil) || null, alreadyApplied: true } };
      }
      const org = await tx.getOrganization(record.orgId);
      if (!org) throw new BillingError('no_company', 'Empresa não encontrada.', 404);

      const current = now();
      const paidUntilMs = periodEnd(org, record.plan, current);
      const paidUntil = new Date(paidUntilMs).toISOString();
      const approvedAt = payment.approvedAt || new Date(current).toISOString();

      await tx.updatePayment(paymentId, {
        status: 'approved', approvedAt, paidUntil,
        // how the company stood before, so a refund of this payment can put it back
        previousPlan: org.plan || null,
        previousPlanStatus: org.planStatus || null,
        previousPaidUntilMs: activeUntil(org) || null
      });
      await tx.updateOrganization(record.orgId, {
        plan: record.plan,
        planStatus: 'active',
        paidUntil,
        // the number is what the database rules compare with the clock
        paidUntilMs,
        lastPaymentId: paymentId,
        // a newer charge still waiting to be paid stays where it is
        ...(org.pendingPaymentId === paymentId || !org.pendingPaymentId ? { pendingPaymentId: null } : {}),
        updatedAt: new Date(current).toISOString()
      });
      return { result: { status: 'approved', plan: record.plan, paidUntil }, planChanged: org.plan !== record.plan };
    });

    // The limits are the new plan's from now on. Whoever upgraded because the plan was full
    // must not stay locked out until the next change to the data; a failure here does not
    // undo the payment (the count is redone on the next change anyway).
    if (onPlanChanged && outcome.planChanged) {
      await Promise.resolve(onPlanChanged(record.orgId)).catch(err => console.error('[Billing] recontagem do plano:', err.message));
    }
    return outcome.result;
  }

  // Until when the company's current plan is paid for (0 when it is not)
  function activeUntil(org) {
    if (org.planStatus !== 'active') return 0;
    return Number(org.paidUntilMs) || (org.paidUntil ? Date.parse(org.paidUntil) : 0) || 0;
  }

  /**
   * Where a new period of `plan` ends. Paying early extends from the end of what is already
   * paid. When the plan changes, the days still paid are converted at the two prices: days of
   * a cheaper plan become fewer days of a dearer one, and the other way round. Without this,
   * months of the cheapest plan followed by one month of the dearest became months of the dearest.
   */
  function periodEnd(org, plan, current) {
    let remaining = Math.max(0, activeUntil(org) - current);
    const oldPrice = PLAN_PRICES[org.plan];
    const newPrice = PLAN_PRICES[plan];
    if (remaining > 0 && org.plan !== plan && oldPrice && newPrice) {
      remaining = Math.floor(remaining * oldPrice / newPrice);
    }
    return current + remaining + PERIOD_DAYS * DAY_MS;
  }

  // The reference was written by this server when it created the charge. Charges from before
  // it was kept with the record carried "company|plan|random" instead.
  function referenceMatches(record, reported) {
    if (record.reference) return reported === record.reference;
    const [orgId, plan] = String(reported).split('|');
    return orgId === record.orgId && plan === record.plan;
  }

  /**
   * Takes back what a refunded (or charged back) payment had released.
   * The company's latest payment puts it back exactly as it was before (plan included).
   * An older one takes away the days it added, converted to the current plan's price.
   * With nothing paid left, the company goes back to where the free trial stands, which
   * usually means read-only mode.
   */
  async function revokePayment(paymentId, providerStatus) {
    const outcome = await transact(async (tx) => {
      const record = await tx.getPayment(paymentId);
      // a repeated notice cannot take a second period away
      if (!record || record.status !== 'approved') return { result: { status: 'refunded', plan: record && record.plan, alreadyApplied: true } };
      const current = now();
      const updatedAt = new Date(current).toISOString();
      await tx.updatePayment(paymentId, { status: 'refunded', providerStatus, refundedAt: updatedAt });

      const org = await tx.getOrganization(record.orgId);
      if (!org || org.planStatus !== 'active') return { result: { status: 'refunded', plan: record.plan } };

      const backToTrial = {
        planStatus: 'trial',
        paidUntil: null,
        paidUntilMs: null,
        // a company from before the trial end was recorded would otherwise be free for good
        trialEndsAtMs: typeof org.trialEndsAtMs === 'number' ? org.trialEndsAtMs : current,
        updatedAt
      };

      if (org.lastPaymentId === paymentId && 'previousPlanStatus' in record) {
        const before = Number(record.previousPaidUntilMs) || 0;
        const plan = record.previousPlan || org.plan;
        const change = record.previousPlanStatus === 'active' && before > current
          ? { plan, paidUntilMs: before, paidUntil: new Date(before).toISOString(), updatedAt }
          : { plan, ...backToTrial };
        await tx.updateOrganization(record.orgId, change);
        return { result: { status: 'refunded', plan: record.plan }, planChanged: plan !== org.plan };
      }

      const priceOfPaid = PLAN_PRICES[record.plan];
      const priceNow = PLAN_PRICES[org.plan];
      const added = priceOfPaid && priceNow ? Math.floor(PERIOD_DAYS * DAY_MS * priceOfPaid / priceNow) : PERIOD_DAYS * DAY_MS;
      const remainingMs = activeUntil(org) - added;
      await tx.updateOrganization(record.orgId, remainingMs > current
        ? { paidUntilMs: remainingMs, paidUntil: new Date(remainingMs).toISOString(), updatedAt }
        : backToTrial);
      return { result: { status: 'refunded', plan: record.plan } };
    });
    if (onPlanChanged && outcome.planChanged) {
      const record = await store.getPayment(paymentId);
      await Promise.resolve(onPlanChanged(record.orgId)).catch(err => console.error('[Billing] recontagem do plano:', err.message));
    }
    return outcome.result;
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

module.exports = { createBillingService, BillingError, PLAN_PRICES, PERIOD_DAYS, TEST_AMOUNT };
