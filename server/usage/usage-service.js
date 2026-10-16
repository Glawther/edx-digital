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
 */

// Keep in step with js/services/billing-service.js
const PLAN_LIMITS = {
  starter: { maxLeads: 500, maxUsers: 2 },
  pro: { maxLeads: 5000, maxUsers: 10 },
  enterprise: { maxLeads: Infinity, maxUsers: Infinity }
};

// 'contacted' is the older name of 'contact'
const OPEN_STAGES = ['lead', 'contact', 'contacted', 'proposal', 'negotiation'];

function limitsOf(org) {
  // The free trial never has unlimited room: an Enterprise trial holds what Professional does
  // (without this, a free account had no ceiling on what it stored, at the owner's cost)
  if (org && org.plan === 'enterprise' && org.planStatus === 'trial') return PLAN_LIMITS.pro;
  return PLAN_LIMITS[org && org.plan] || PLAN_LIMITS.pro;
}

/**
 * @param {Object} deps.store - getOrganization, updateOrganization, countDocs(collection, filters)
 */
function createUsageService({ store }) {
  /**
   * Counts and, only when the answer changed, records it on the company
   * @returns {Promise<{leadsFull: boolean, seatsFull: boolean, changed: boolean}|null>} null when the company is gone
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
    const changed = Boolean(before.leadsFull) !== usage.leadsFull || Boolean(before.seatsFull) !== usage.seatsFull;
    if (changed) await store.updateOrganization(orgId, { usage });
    return { ...usage, changed };
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

module.exports = { createUsageService, customerChangeMatters, userChangeMatters, limitsOf, PLAN_LIMITS, OPEN_STAGES };
