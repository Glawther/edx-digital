/**
 * EDX Digital - Files left behind by opportunities that no longer exist
 *
 * When an opportunity (or a whole company) is deleted, its attached files stay in Firebase
 * Storage for a while: deleting can be undone on screen. Once a day this removes every file
 * whose opportunity is gone, so nothing of a deleted record is kept. It also removes files
 * that no opportunity lists: the limit of files per opportunity is kept in the opportunity's
 * own record, and a file sent around the app (straight to storage) would escape it.
 *
 * Runs as the project itself (the function's identity), through the Storage JSON API.
 */

const { getAccessToken, projectId } = require('../billing/google-auth');
const { getDoc } = require('../billing/firestore-store');

const API = 'https://storage.googleapis.com/storage/v1';
const FILE = /^orgs\/([^/]+)\/customers\/([^/]+)\/([^/.]+)\.[^/]+$/;
// a file just sent may not be in the opportunity's record yet
const UNLISTED_AFTER_MS = 60 * 60 * 1000;
const MAX_PAGES = 50;

function bucketName() {
  return process.env.STORAGE_BUCKET || `${projectId()}.firebasestorage.app`;
}

/**
 * @returns {Promise<{skipped?: string, files: number, removed: number}>}
 */
async function cleanOrphanAttachments({
  bucket = bucketName(),
  fetchImpl = fetch,
  token = getAccessToken,
  getCustomer = (id) => getDoc(`customers/${id}`),
  now = Date.now()
} = {}) {
  const headers = { Authorization: `Bearer ${await token()}` };
  const names = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ prefix: 'orgs/', fields: 'items(name,timeCreated),nextPageToken', maxResults: '1000', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${API}/b/${encodeURIComponent(bucket)}/o?${query}`, { headers });
    // no bucket: file storage was never turned on in this project
    if (res.status === 404) return { skipped: 'no_bucket', files: 0, removed: 0 };
    if (!res.ok) throw new Error(`Storage list: ${res.status}`);
    const body = await res.json();
    for (const item of body.items || []) names.push({ name: item.name, createdMs: Date.parse(item.timeCreated) || 0 });
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }

  const listed = new Map(); // "org/customer" -> the ids its record lists, or null when the opportunity is gone
  let removed = 0;
  for (const { name, createdMs } of names) {
    const match = FILE.exec(name);
    if (!match) continue;
    const [, orgId, customerId, fileId] = match;
    const key = `${orgId}/${customerId}`;
    if (!listed.has(key)) {
      const customer = await getCustomer(customerId);
      const exists = customer && customer.orgId === orgId;
      listed.set(key, exists ? new Set((Array.isArray(customer.attachments) ? customer.attachments : []).map(item => item && item.id)) : null);
    }
    const ids = listed.get(key);
    if (ids && (ids.has(fileId) || now - createdMs < UNLISTED_AFTER_MS)) continue;
    const res = await fetchImpl(`${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`, { method: 'DELETE', headers });
    if (res.ok || res.status === 404) removed += 1;
  }
  return { files: names.length, removed };
}

module.exports = { cleanOrphanAttachments };
