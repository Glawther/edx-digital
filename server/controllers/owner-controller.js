/**
 * EDX Digital - What the owner of the system sees: every company, its plan and where it stands
 *
 *   GET /api/owner/check      is the signed-in person an owner of the system?   { owner: boolean }
 *   GET /api/owner/overview   the companies, with totals                        [owners only]
 *
 * Owners are the e-mail addresses in OWNER_EMAILS (a secret, separated by commas). The address
 * has to be confirmed: an account created with someone else's address proves nothing.
 * Nothing about a company's customers is read: only how many it has.
 */

const { verifyIdToken } = require('../billing/google-auth');
const { firestoreStore } = require('../billing/firestore-store');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * DAY_MS; // keep in step with graceMs() in firestore.rules
const PLAN_PRICES = { starter: 97, pro: 197, enterprise: 497 };

function ownerEmails() {
  return String(process.env.OWNER_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(item => item && item !== 'pendente');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function ownerFrom(req) {
  const header = req.headers.authorization || '';
  try {
    const user = await verifyIdToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    const email = String(user.email || '').toLowerCase();
    return user.emailVerified && email && ownerEmails().includes(email) ? user : null;
  } catch {
    return null;
  }
}

/**
 * Where a company's plan stands, the same way the database rules decide it
 * @returns {{state: 'paid'|'grace'|'expired'|'trial'|'trial_ended'|'legacy', endsAtMs: number|null}}
 */
function planState(org, now = Date.now()) {
  if (org.planStatus === 'active') {
    const until = Number(org.paidUntilMs) || 0;
    if (now < until) return { state: 'paid', endsAtMs: until };
    if (now < until + GRACE_MS) return { state: 'grace', endsAtMs: until };
    return { state: 'expired', endsAtMs: until || null };
  }
  if (typeof org.trialEndsAtMs !== 'number') return { state: 'legacy', endsAtMs: null };
  return { state: now < org.trialEndsAtMs ? 'trial' : 'trial_ended', endsAtMs: org.trialEndsAtMs };
}

/**
 * @param {Object} store - listOrganizations, listAllUsers, listAllPayments, countDocs
 */
async function buildOverview(store, now = Date.now()) {
  const [organizations, users, payments] = await Promise.all([store.listOrganizations(), store.listAllUsers(), store.listAllPayments()]);

  const people = new Map();
  for (const { id, data } of users) {
    const row = people.get(data.orgId) || { active: 0, emails: new Map() };
    if (data.status === 'active') row.active += 1;
    row.emails.set(id, data.email || '');
    people.set(data.orgId, row);
  }

  const companies = [];
  for (const { id, data: org } of organizations) {
    const team = people.get(id) || { active: 0, emails: new Map() };
    const { state, endsAtMs } = planState(org, now);
    companies.push({
      id,
      name: String(org.name || ''),
      plan: PLAN_PRICES[org.plan] ? org.plan : 'pro',
      state,
      endsAtMs,
      daysLeft: endsAtMs ? Math.ceil((endsAtMs - now) / DAY_MS) : null,
      people: team.active,
      ownerEmail: team.emails.get(org.ownerUid) || '',
      createdAt: typeof org.createdAt === 'string' ? org.createdAt : '',
      opportunities: await store.countDocs('customers', [['orgId', id]]),
      full: Boolean(org.usage && (org.usage.leadsFull || org.usage.seatsFull))
    });
  }
  // what needs attention first: about to end, then the newest
  const order = { grace: 0, trial: 1, paid: 2, trial_ended: 3, expired: 4, legacy: 5 };
  companies.sort((a, b) => order[a.state] - order[b.state] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || b.createdAt.localeCompare(a.createdAt));

  const approved = payments.map(doc => doc.data).filter(payment => payment.status === 'approved');
  const since = now - 30 * DAY_MS;
  const count = (state) => companies.filter(company => company.state === state).length;
  const paying = companies.filter(company => company.state === 'paid' || company.state === 'grace');
  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      companies: companies.length,
      trial: count('trial'),
      paying: paying.length,
      grace: count('grace'),
      ended: count('trial_ended') + count('expired'),
      people: companies.reduce((sum, company) => sum + company.people, 0),
      // what the paying companies add up to per month at today's prices
      monthlyValue: paying.reduce((sum, company) => sum + PLAN_PRICES[company.plan], 0),
      received30d: approved.filter(payment => Date.parse(payment.approvedAt || payment.createdAt || '') >= since).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
      receivedAll: approved.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
    },
    companies
  };
}

async function handleOwner(req, res, pathname, store = firestoreStore) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const owner = await ownerFrom(req);
  if (pathname === '/api/owner/check') return send(res, 200, { owner: Boolean(owner) });
  // the same answer for "not signed in" and "not an owner": nothing to learn from it
  if (!owner) return send(res, 404, { error: 'not_found' });
  if (pathname !== '/api/owner/overview') return send(res, 404, { error: 'not_found' });
  try {
    return send(res, 200, await buildOverview(store));
  } catch (err) {
    console.error('[Dono]', err.message);
    return send(res, 502, { error: 'unavailable', message: 'Não foi possível montar o painel agora.' });
  }
}

module.exports = { handleOwner, buildOverview, planState, ownerEmails };
