/**
 * Nexus CRM - The few Firestore reads and writes the billing server needs, over REST.
 * It acts as the project (service account), so the security rules do not apply here:
 * this is the only place allowed to change a company's plan.
 */

const { projectId, firestoreEmulatorHost, getAccessToken } = require('./google-auth');

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

/**
 * The storage interface the billing service depends on
 */
const firestoreStore = {
  getUserProfile: (uid) => getDoc(`users/${uid}`),
  getOrganization: (orgId) => getDoc(`organizations/${orgId}`),
  updateOrganization: (orgId, data) => updateDoc(`organizations/${orgId}`, data),
  getPayment: (paymentId) => getDoc(`payments/${paymentId}`),
  savePayment: (paymentId, data) => setDoc(`payments/${paymentId}`, data),
  updatePayment: (paymentId, data) => updateDoc(`payments/${paymentId}`, data)
};

module.exports = { firestoreStore, toFields, fromFields };
