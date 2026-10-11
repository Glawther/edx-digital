/**
 * EDX Digital - Files left behind by opportunities that no longer exist
 *
 * When an opportunity (or a whole company) is deleted, its attached files stay in Firebase
 * Storage for a while: deleting can be undone on screen. Once a day this removes every file
 * whose opportunity is gone, so nothing of a deleted record is kept.
 *
 * Runs as the project itself (the function's identity), through the Storage JSON API.
 */

const { getAccessToken, projectId } = require('../billing/google-auth');
const { getDoc } = require('../billing/firestore-store');

const API = 'https://storage.googleapis.com/storage/v1';
const FILE = /^orgs\/([^/]+)\/customers\/([^/]+)\/[^/]+$/;
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
  getCustomer = (id) => getDoc(`customers/${id}`)
} = {}) {
  const headers = { Authorization: `Bearer ${await token()}` };
  const names = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ prefix: 'orgs/', fields: 'items(name),nextPageToken', maxResults: '1000', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${API}/b/${encodeURIComponent(bucket)}/o?${query}`, { headers });
    // no bucket: file storage was never turned on in this project
    if (res.status === 404) return { skipped: 'no_bucket', files: 0, removed: 0 };
    if (!res.ok) throw new Error(`Storage list: ${res.status}`);
    const body = await res.json();
    for (const item of body.items || []) names.push(item.name);
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }

  const gone = new Map(); // "org/customer" -> is the opportunity gone?
  let removed = 0;
  for (const name of names) {
    const match = FILE.exec(name);
    if (!match) continue;
    const [, orgId, customerId] = match;
    const key = `${orgId}/${customerId}`;
    if (!gone.has(key)) {
      const customer = await getCustomer(customerId);
      gone.set(key, !customer || customer.orgId !== orgId);
    }
    if (!gone.get(key)) continue;
    const res = await fetchImpl(`${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`, { method: 'DELETE', headers });
    if (res.ok || res.status === 404) removed += 1;
  }
  return { files: names.length, removed };
}

module.exports = { cleanOrphanAttachments };
