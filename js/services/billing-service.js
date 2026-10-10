/**
 * EDX Digital - Plans and their limits
 * The single source for plan names, prices and limits in the app.
 * Keep it in step with the plans section of landing.html and with server/billing/billing-service.js.
 *
 * The plans differ only in how much they hold: every feature is in every plan.
 */

import { getSavedOrganization } from '../core/config.js';

const NO_LIMIT = Infinity;

export const PLANS = {
  starter: { id: 'starter', name: 'Starter', priceMonthly: 97, maxLeads: 500, maxUsers: 2 },
  pro: { id: 'pro', name: 'Professional', priceMonthly: 197, maxLeads: 5000, maxUsers: 10 },
  enterprise: { id: 'enterprise', name: 'Enterprise', priceMonthly: 497, maxLeads: NO_LIMIT, maxUsers: NO_LIMIT }
};

export class PlanLimitError extends Error {
  constructor(message) {
    super(message);
    this.code = 'plan-limit';
  }
}

export function currentPlan(org = getSavedOrganization()) {
  return PLANS[org.plan] || PLANS.pro;
}

function room(used, limit) {
  return { used, limit, unlimited: limit === NO_LIMIT, left: limit === NO_LIMIT ? Infinity : Math.max(0, limit - used) };
}

export function isOpenOpportunity(customer) {
  return customer.stage !== 'won' && customer.stage !== 'lost';
}

/**
 * Opportunities still in play count toward the plan; won and lost ones do not.
 * @param {Array} customers - the opportunities this person can see
 */
export function leadsRoom(customers, org) {
  return room(customers.filter(isOpenOpportunity).length, currentPlan(org).maxLeads);
}

/**
 * People with access: the signed-in administrator plus everyone who is not blocked.
 * @param {Array} employees - the team list, which leaves the signed-in person out
 */
export function seatsRoom(employees, org) {
  return room(employees.filter(e => e.status !== 'blocked').length + 1, currentPlan(org).maxUsers);
}

export function describeLimit(n) {
  return n === NO_LIMIT ? 'sem limite' : n.toLocaleString('pt-BR');
}
