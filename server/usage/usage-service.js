/**
 * EDX Digital - Plan limits, counted by the server
 *
 * The app checks the limits before creating something, but an app can be bypassed. Here the
 * server counts what the company really has and records whether the plan is full. The
 * database rules read that record (organizations/{id}.usage) and refuse new opportunities or
 * new people while it says full. The app cannot write that field.
 *
 * It runs after each change, so a burst of writes can pass the limit by a little before the
 * door closes. What it guarantees is that the door does close.
 *
 * A burst sent straight to the database (not through the app) can pass it by a lot. The rules
 * cannot count a batch, so instead, when the count goes well past the limit (OVER_MARGIN), the
 * company is marked with usage.overLimit and a line is logged: the owner's panel shows it, and
 * nothing is deleted. A plan moved down to a smaller one shows up the same way.
 */

// Keep in step with js/services/billing-service.js
const PLAN_LIMITS = {
  starter: { maxLeads: 500, maxUsers: 2 },
  pro: { maxLeads: 5000, maxUsers: 10 },
  enterprise: { maxLeads: Infinity, maxUsers: Infinity }
};

// 'contacted' is the older name of 'contact'
const OPEN_STAGES = ['lead', 'contact', 'contacted', 'proposal', 'negotiation'];

// How far past the limit counts as "well past": 10% of it, and at least one. Below this, the
// difference is what the ordinary delay between a write and the recount can leave.
function overMargin(limit) {
  return Math.max(1, Math.floor(limit * 0.1));
}

const isWellPast = (count, limit) => limit !== Infinity && count > limit + overMargin(limit);


// Keep in step with planAllowsWrites in firestore.rules
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Until when the company may write, as one number the file rules can compare with the clock.
 * The file rules may read only two documents (the profile and the opportunity), not the company,
 * so this deadline is copied onto each profile (users/{uid}.planWritableUntilMs).
 * @returns {number|null} null when there is no deadline (companies from before the trial rule)
 */
function writableUntilMs(org) {
  if (org.planStatus === 'active') return typeof org.paidUntilMs === 'number' ? org.paidUntilMs + GRACE_MS : 0;
  if (!('trialEndsAtMs' in org)) return null;
  return typeof org.trialEndsAtMs === 'number' ? org.trialEndsAtMs : 0;
}

function limitsOf(org) {
  // The free trial never has unlimited room: an Enterprise trial holds what Professional does
  // (without this, a free account had no ceiling on what it stored, at the owner's cost)
  if (org && org.plan === 'enterprise' && org.planStatus === 'trial') return PLAN_LIMITS.pro;
  return PLAN_LIMITS[org && org.plan] || PLAN_LIMITS.pro;
}

/**
 * @param {Object} deps.store - getOrganization, updateOrganization, countDocs(collection, filters),
 *   listUsers(orgId), updateUserProfile(uid, data)
 */
function createUsageService({ store, log = console, now = Date.now }) {
  /**
   * Counts and, only when the answer changed, records it on the company
   * @returns {Promise<{leadsFull: boolean, seatsFull: boolean, changed: boolean, overLimit?: Object}|null>} null when the company is gone
   */
  async function refreshUsage(orgId) {
    if (!orgId || typeof orgId !== 'string') return null;
    const org = await store.getOrganization(orgId);
    if (!org) return null;

    const limits = limitsOf(org);
    // a plan without limit needs no counting
    const openLeads = limits.maxLeads === Infinity ? 0 : await store.countDocs('customers', [['orgId', orgId], ['stage', 'IN', OPEN_STAGES]]);
    const seats = limits.maxUsers === Infinity ? 0 : await store.countDocs('users', [['orgId', orgId], ['status', 'active']]);

    const usage = { leadsFull: openLeads >= limits.maxLeads, seatsFull: seats >= limits.maxUsers };
    const before = org.usage || {};
    const wasOver = before.overLimit || {};

    const leadsOver = isWellPast(openLeads, limits.maxLeads);
    const seatsOver = isWellPast(seats, limits.maxUsers);
    if (leadsOver || seatsOver) {
      usage.overLimit = {
        ...(leadsOver ? { leads: openLeads, maxLeads: limits.maxLeads } : {}),
        ...(seatsOver ? { seats, maxUsers: limits.maxUsers } : {}),
        // when it first went well past; kept while it stays there
        sinceMs: typeof wasOver.sinceMs === 'number' ? wasOver.sinceMs : now()
      };
    }
    // the counts inside overLimit are not compared: rewriting the company at every change of a
    // burst would cost a write each; only going past or coming back is recorded
    const overChanged = Boolean(wasOver.leads) !== leadsOver || Boolean(wasOver.seats) !== seatsOver;
    const changed = Boolean(before.leadsFull) !== usage.leadsFull || Boolean(before.seatsFull) !== usage.seatsFull || overChanged;
    if (changed) await store.updateOrganization(orgId, { usage });
    if (overChanged && usage.overLimit) {
      log.warn(`[Limites] empresa ${orgId} passou muito do limite do plano: ${openLeads}/${limits.maxLeads} oportunidades em aberto, ${seats}/${limits.maxUsers} pessoas`);
    }
    await syncPlanMarks(orgId, org);
    return { ...usage, changed };
  }

  /** Copies the company's deadline onto each profile whose copy is missing or out of date */
  async function syncPlanMarks(orgId, org) {
    const until = writableUntilMs(org);
    const people = await store.listUsers(orgId);
    for (const { id, data } of people) {
      if (data.planWritableUntilMs === until) continue;
      // a profile removed meanwhile must not stop the others
      await store.updateUserProfile(id, { planWritableUntilMs: until }).catch(err => console.error('[Plano] marca no perfil:', err.message));
    }
  }

  return { refreshUsage };
}

const isOpen = (data) => Boolean(data) && OPEN_STAGES.includes(data.stage);

/** Does this change to an opportunity move the count of open ones? */
function customerChangeMatters(before, after) {
  if (!before || !after) return isOpen(before) || isOpen(after);
  return isOpen(before) !== isOpen(after) || before.orgId !== after.orgId;
}

/** Does this change to a profile move the count of people with access? */
function userChangeMatters(before, after) {
  const counts = (data) => Boolean(data) && data.status === 'active';
  if (!before || !after) return counts(before) || counts(after);
  return counts(before) !== counts(after) || before.orgId !== after.orgId;
}

/** Does this change to a company move its deadline? (the owner may edit it in the console) */
function organizationChangeMatters(before, after) {
  if (!before || !after) return Boolean(after);
  return ['planStatus', 'paidUntilMs', 'trialEndsAtMs'].some(key => before[key] !== after[key]);
}

module.exports = { createUsageService, customerChangeMatters, userChangeMatters, organizationChangeMatters, writableUntilMs, limitsOf, overMargin, PLAN_LIMITS, OPEN_STAGES };
