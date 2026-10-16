/**
 * EDX Digital - The few Firestore reads and writes the billing server needs, over REST.
 * It acts as the project (service account), so the security rules do not apply here:
 * this is the only place allowed to change a company's plan.
 */

const { projectId, firestoreEmulatorHost, getAccessToken, verifiedEmailsOf } = require('./google-auth');

function baseUrl() {
  const emulator = firestoreEmulatorHost();
  const origin = emulator ? `http://${emulator}` : 'https://firestore.googleapis.com';
  return `${origin}/v1/projects/${projectId()}/databases/(default)/documents`;
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  return { mapValue: { fields: toFields(value) } };
}

function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, toValue(value)]));
}

function fromValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));
}

async function request(method, path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Firestore ${method} ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

async function getDoc(path) {
  const doc = await request('GET', path);
  return doc && doc.fields ? fromFields(doc.fields) : null;
}

/** Creates or replaces the whole document */
async function setDoc(path, data) {
  await request('PATCH', path, { fields: toFields(data) });
}

/** Changes only the given fields; fails if the document does not exist */
async function updateDoc(path, data) {
  const mask = Object.keys(data).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  const result = await request('PATCH', `${path}?${mask}&currentDocument.exists=true`, { fields: toFields(data) });
  if (result === null) throw new Error(`Documento não encontrado: ${path}`);
}

async function deleteDoc(path) {
  await request('DELETE', path);
}

/**
 * Documents of a collection whose fields equal the given values
 * @param {Array<[string, any]>} filters
 * @returns {Promise<Array<{id: string, data: object}>>}
 */
// A filter is [field, value] (equal) or [field, 'IN', values]
function whereOf(filters) {
  const clauses = filters.map(([field, second, third]) => ({
    fieldFilter: third === undefined
      ? { field: { fieldPath: field }, op: 'EQUAL', value: toValue(second) }
      : { field: { fieldPath: field }, op: second, value: toValue(third) }
  }));
  return clauses.length === 1 ? clauses[0] : { compositeFilter: { op: 'AND', filters: clauses } };
}

async function post(path, body) {
  const token = await getAccessToken();
  return fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function queryDocs(collection, filters, limit = 500) {
  const res = await post(':runQuery', { structuredQuery: { from: [{ collectionId: collection }], where: whereOf(filters), limit } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Firestore query ${collection}: ${res.status} ${detail.slice(0, 200)}`);
  }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row.document)
    .map(row => ({ id: row.document.name.split('/').pop(), data: fromFields(row.document.fields || {}) }));
}

/**
 * How many documents match, without reading them
 */
async function countDocs(collection, filters) {
  const res = await post(':runAggregationQuery', {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: collection }], where: whereOf(filters) },
      aggregations: [{ alias: 'total', count: {} }]
    }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Firestore count ${collection}: ${res.status} ${detail.slice(0, 200)}`);
  }
  const rows = await res.json();
  const first = (Array.isArray(rows) ? rows : []).find(row => row.result);
  return first ? Number(first.result.aggregateFields.total.integerValue || 0) : 0;
}

/**
 * Every document of a collection, page by page
 */
async function listDocs(collection, pageSize = 300, maxPages = 200) {
  const docs = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const data = await request('GET', `${collection}?pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    for (const doc of (data && data.documents) || []) {
      docs.push({ id: doc.name.split('/').pop(), data: fromFields(doc.fields || {}) });
    }
    pageToken = (data && data.nextPageToken) || '';
    if (!pageToken) break;
  }
  return docs;
}

function documentName(path) {
  return `projects/${projectId()}/databases/(default)/documents/${path}`;
}

/**
 * Reads and writes as one, optimistically: every write is committed together, and only if
 * each document read is still exactly as it was read (its update time). If another writer
 * changed one of them first, nothing is written and the whole thing runs again with fresh reads.
 * (No locks: this works the same on the emulator, where locking transactions can stall.)
 * @param {(tx: {get: Function, update: Function}) => Promise<any>} fn
 */
async function runTransaction(fn, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    const readAt = new Map(); // path -> update time of the version read
    const writes = [];
    const tx = {
      get: async (path) => {
        const doc = await request('GET', path);
        readAt.set(path, doc ? doc.updateTime : null);
        return doc && doc.fields ? fromFields(doc.fields) : null;
      },
      // only the given fields
      update: (path, data) => {
        const seen = readAt.get(path);
        writes.push({
          update: { name: documentName(path), fields: toFields(data) },
          updateMask: { fieldPaths: Object.keys(data) },
          currentDocument: seen ? { updateTime: seen } : { exists: true }
        });
      }
    };
    const result = await fn(tx);
    if (writes.length === 0) return result;
    const commit = await post(':commit', { writes });
    if (commit.ok) return result;
    const detail = await commit.text().catch(() => '');
    // FAILED_PRECONDITION: someone else changed what was read; read again and decide again
    const contended = commit.status === 409 || /FAILED_PRECONDITION|ABORTED/.test(detail);
    if (!contended || attempt >= attempts) throw new Error(`Firestore commit: ${commit.status} ${detail.slice(0, 200)}`);
    await new Promise(resolve => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
  }
}

/**
 * The storage interface the billing service depends on
 */
const firestoreStore = {
  getUserProfile: (uid) => getDoc(`users/${uid}`),
  getOrganization: (orgId) => getDoc(`organizations/${orgId}`),
  updateOrganization: (orgId, data) => updateDoc(`organizations/${orgId}`, data),
  getPayment: (paymentId) => getDoc(`payments/${paymentId}`),
  savePayment: (paymentId, data) => setDoc(`payments/${paymentId}`, data),
  updatePayment: (paymentId, data) => updateDoc(`payments/${paymentId}`, data),
  // a payment and its company, changed together (billing-service.js)
  transaction: (fn) => runTransaction(tx => fn({
    getPayment: (paymentId) => tx.get(`payments/${paymentId}`),
    getOrganization: (orgId) => tx.get(`organizations/${orgId}`),
    updatePayment: (paymentId, data) => tx.update(`payments/${paymentId}`, data),
    updateOrganization: (orgId, data) => tx.update(`organizations/${orgId}`, data)
  })),
  countDocs,
  // for the morning e-mails
  listOrganizations: () => listDocs('organizations'),
  // for the owner's panel
  listAllUsers: () => listDocs('users'),
  listAllPayments: () => listDocs('payments'),
  getState: (name) => getDoc(`system_state/${name}`),
  setState: (name, data) => setDoc(`system_state/${name}`, data),
  listUsers: (orgId) => queryDocs('users', [['orgId', orgId]], 1000),
  // the plan deadline copied onto each profile, for the file rules (usage-service.js)
  updateUserProfile: (uid, data) => updateDoc(`users/${uid}`, data),
  // the morning e-mails go only to confirmed addresses of real sign-in accounts
  verifiedEmails: verifiedEmailsOf,
  listCustomers: (orgId) => queryDocs('customers', [['orgId', orgId]], 10000)
};

module.exports = { firestoreStore, toFields, fromFields, getDoc, setDoc, deleteDoc, queryDocs, countDocs, listDocs, runTransaction };
