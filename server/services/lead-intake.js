/**
 * EDX Digital - Leads sent by forms, written straight into the company's opportunities
 *
 * Each company has one address token, issued here to its administrator. The server keeps
 * only a hash of it pointing to the company, so a lead lands in the company that owns the
 * token, and nowhere else. Nothing passes through anyone's browser: before, the token lived in
 * the browser that created it, and whoever opened the CRM in that browser (another company,
 * or the demonstration) collected and deleted the leads.
 *
 * Collections (closed to the app by the database rules; only this server reads them):
 *   webhook_tokens/{sha256 of the token}   { orgId }
 *   webhook_config/{orgId}                 { token, hash, createdAt, createdBy }
 */

const crypto = require('crypto');
const { getDoc, setDoc, deleteDoc, queryDocs, runTransaction } = require('../billing/firestore-store');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * DAY_MS; // keep in step with graceMs() in firestore.rules
const MAX_ACTIVITIES = 2000;

class IntakeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** The same decision the database rules make (planAllowsWrites) */
function planAllowsWrites(org, now) {
  if (org.planStatus === 'active') return typeof org.paidUntilMs === 'number' && now < org.paidUntilMs + GRACE_MS;
  return typeof org.trialEndsAtMs !== 'number' || now < org.trialEndsAtMs;
}

/**
 * @param {Object} deps.store - see firestoreLeadStore below
 * @param {Function} [deps.now]
 * @param {Function} [deps.randomToken]
 */
function createLeadIntake({ store, now = () => Date.now(), randomToken = () => 'edxwh_' + crypto.randomBytes(24).toString('base64url') }) {

  async function requireAdmin(uid) {
    const profile = await store.getUserProfile(uid);
    if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
      throw new IntakeError(403, 'Só quem administra a empresa configura o recebimento de formulários.');
    }
    return profile;
  }

  /** The company's current token, or null when none was issued yet */
  async function currentToken(user) {
    const profile = await requireAdmin(user.uid);
    const config = await store.getConfig(profile.orgId);
    return config ? config.token : null;
  }

  /** A new token for the company; the previous one stops working at once */
  async function issueToken(user) {
    const profile = await requireAdmin(user.uid);
    const token = randomToken();
    const hash = hashOf(token);
    const previous = await store.getConfig(profile.orgId);
    await store.saveToken(hash, { orgId: profile.orgId });
    await store.saveConfig(profile.orgId, { token, hash, createdAt: new Date(now()).toISOString(), createdBy: user.uid });
    if (previous && previous.hash && previous.hash !== hash) await store.deleteToken(previous.hash);
    return token;
  }

  /**
   * One lead from a form. Returns what was done: a new opportunity, or a note on the one that
   * already had the same e-mail or phone (a form sent twice does not make two opportunities).
   * @param {string} token
   * @param {Object} lead - already cleaned by normalizeLeadPayload
   */
  async function ingest(token, lead) {
    const link = await store.getToken(hashOf(token));
    if (!link || !link.orgId) throw new IntakeError(401, 'Token do webhook inválido');
    const org = await store.getOrganization(link.orgId);
    if (!org) throw new IntakeError(401, 'Token do webhook inválido');
    const current = now();
    if (!planAllowsWrites(org, current)) {
      throw new IntakeError(403, 'O plano desta empresa no EDX Digital está vencido: o contato não foi registrado.');
    }

    const timestamp = new Date(current).toISOString();
    const email = lead.email.toLowerCase();
    const twin = (email && await store.findCustomer(link.orgId, 'email', email))
      || (lead.phone && await store.findCustomer(link.orgId, 'phone', lead.phone));
    const activity = (title) => ({
      id: 'act-wh-' + current.toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      type: 'note',
      title,
      text: [lead.source && `Origem: ${lead.source}.`, lead.notes].filter(Boolean).join(' ').slice(0, 5000),
      author: 'Formulário',
      timestamp
    });

    if (twin) {
      await store.appendActivity(twin.id, activity('Novo contato pelo formulário'), timestamp);
      return { status: 'duplicate', id: twin.id };
    }

    // a full plan is not a reason to lose a contact that already exists, only to create one
    if (org.usage && org.usage.leadsFull === true) {
      throw new IntakeError(403, 'O plano desta empresa está com o limite de oportunidades atingido: o contato não foi registrado.');
    }

    const owner = org.ownerUid ? await store.getUserProfile(org.ownerUid) : null;
    const id = 'lead-wh-' + current.toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    await store.createCustomer(id, {
      id,
      orgId: link.orgId,
      name: lead.name || lead.email || lead.phone || 'Contato sem nome',
      email,
      phone: lead.phone,
      company: lead.company,
      dealValue: lead.value,
      stage: 'lead',
      priority: 'medium',
      pipelineId: 'default',
      tags: ['Formulário'],
      notes: lead.notes,
      source: lead.source,
      fromForm: true,
      assignedTo: owner && org.ownerUid ? { id: org.ownerUid, name: owner.name || '', email: owner.email || '' } : null,
      activities: [activity('Recebido pelo formulário')],
      tasks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: 'Formulário',
      updatedBy: 'Formulário'
    });
    return { status: 'created', id };
  }

  return { currentToken, issueToken, ingest };
}

/** The intake's store, in Firestore (as the project: the database rules do not apply here) */
const firestoreLeadStore = {
  getUserProfile: (uid) => getDoc(`users/${uid}`),
  getOrganization: (orgId) => getDoc(`organizations/${orgId}`),
  getConfig: (orgId) => getDoc(`webhook_config/${orgId}`),
  saveConfig: (orgId, data) => setDoc(`webhook_config/${orgId}`, data),
  getToken: (hash) => getDoc(`webhook_tokens/${hash}`),
  saveToken: (hash, data) => setDoc(`webhook_tokens/${hash}`, data),
  deleteToken: (hash) => deleteDoc(`webhook_tokens/${hash}`),
  async findCustomer(orgId, field, value) {
    const found = await queryDocs('customers', [['orgId', orgId], [field, value]], 1);
    return found[0] || null;
  },
  createCustomer: (id, data) => setDoc(`customers/${id}`, data),
  // read and write together: someone editing the same opportunity meanwhile is not overwritten
  appendActivity: (id, activity, timestamp) => runTransaction(async (tx) => {
    const customer = await tx.get(`customers/${id}`);
    if (!customer) return;
    const activities = (Array.isArray(customer.activities) ? customer.activities : []).concat(activity).slice(-MAX_ACTIVITIES);
    tx.update(`customers/${id}`, { activities, updatedAt: timestamp });
  })
};

module.exports = { createLeadIntake, firestoreLeadStore, IntakeError, planAllowsWrites, hashOf };
