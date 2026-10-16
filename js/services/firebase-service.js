/**
 * EDX Digital - Google Cloud Firestore Service Layer
 * Uses official Firebase Modular SDK v11
 *
 * Every read and write here is scoped to the signed-in person's company. The security
 * rules enforce the same thing on the server, so the filters below are not optional:
 * a query without them is refused.
 */

import { getFirebase } from './firebase-app.js';
import { isSafeId } from '../core/html.js';
import { normalizeCustomer } from '../core/normalize.js';

let db = null;
let fs = null;
let activeOrgId = null;
let unsubscribeCustomers = null;

// Writes sent and not yet confirmed by the server (offline they wait in memory): the header
// shows them, and closing the tab with some still waiting asks first
let pendingWrites = 0;

function announceSync() {
  window.dispatchEvent(new CustomEvent('edx-sync', { detail: { pending: pendingWrites } }));
}

function tracked(promise) {
  pendingWrites += 1;
  announceSync();
  return promise.finally(() => {
    pendingWrites -= 1;
    announceSync();
  });
}

export function pendingWriteCount() {
  return pendingWrites;
}

/**
 * Prepares Firestore for the signed-in session
 */
export async function initializeFirestore() {
  const { db: sharedDb, fsMod } = await getFirebase();
  db = sharedDb;
  fs = fsMod;
  return { db };
}

/**
 * Stops the real-time listener (used on sign-out and when switching to the sample data)
 */
export function stopFirestoreSync() {
  if (unsubscribeCustomers) {
    try {
      unsubscribeCustomers();
    } catch (e) {
      console.warn("Error stopping Firestore listener:", e);
    }
    unsubscribeCustomers = null;
  }
  activeOrgId = null;
}

/**
 * Returns the current active Firestore instance
 */
export function getFirestoreDb() {
  return db;
}

/**
 * Subscribes to the company's customers in real time.
 * A salesperson only receives the leads assigned to them; an administrator receives all.
 * @param {Function} onData - Callback when data changes
 * @param {Function} onError - Callback when error occurs
 * @param {Object} scope - { orgId, uid, isAdmin }
 */
export async function subscribeToFirestoreCustomers(onData, onError, scope) {
  if (!db || !fs) {
    throw new Error("Firestore não inicializado.");
  }
  if (!scope || !scope.orgId || !scope.uid) {
    throw new Error("Sessão sem empresa definida.");
  }

  stopFirestoreSync();
  activeOrgId = scope.orgId;

  const constraints = [fs.where('orgId', '==', scope.orgId)];
  if (!scope.isAdmin) {
    constraints.push(fs.where('assignedTo.id', '==', scope.uid));
  }
  const customersQuery = fs.query(fs.collection(db, 'customers'), ...constraints);

  let firstSnapshot = true;
  unsubscribeCustomers = fs.onSnapshot(
    customersQuery,
    (snapshot) => {
      // contacts the server wrote from a form after the screen opened: the screen tells the person
      if (!firstSnapshot) {
        const fromForm = snapshot.docChanges()
          .filter(change => change.type === 'added' && !change.doc.metadata.hasPendingWrites && change.doc.data().fromForm === true)
          .map(change => String(change.doc.data().name || 'Contato sem nome').slice(0, 80));
        if (fromForm.length > 0) window.dispatchEvent(new CustomEvent('edx-form-lead', { detail: { names: fromForm } }));
      }
      firstSnapshot = false;
      const customers = [];
      snapshot.forEach((doc) => {
        // Ids are used to find and open records on screen. One with characters this app never
        // generates was written by hand, around the app, and is left out.
        if (!isSafeId(doc.id)) return;
        // every field in the type the screens expect, whatever was stored
        const data = normalizeCustomer(doc.data());
        customers.push({
          ...data,
          id: doc.id,
          firestoreId: doc.id,
          clientLeadId: doc.id
        });
      });

      customers.sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tB - tA;
      });

      onData(customers);
    },
    (err) => {
      console.error("Firestore onSnapshot error:", err);
      if (onError) onError(err);
    }
  );

  return unsubscribeCustomers;
}

/**
 * Adds a new customer document. The document id is the lead id.
 */
export async function addFirestoreCustomer(customerData) {
  if (!db || !fs || !activeOrgId) throw new Error("Firestore não inicializado.");

  const cleanData = { ...customerData };
  const customId = cleanData.id || ('lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5));
  delete cleanData.firestoreId;

  const payload = {
    ...cleanData,
    id: customId,
    orgId: activeOrgId,
    clientLeadId: customId,
    createdAt: cleanData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await tracked(fs.setDoc(fs.doc(db, 'customers', customId), withoutUndefined(payload)));
  return { ...payload, id: customId, firestoreId: customId };
}

/**
 * Adds many customers in one write (up to 500): all are saved, or none
 */
export async function addFirestoreCustomers(list) {
  if (!db || !fs || !activeOrgId) throw new Error("Firestore não inicializado.");
  const batch = fs.writeBatch(db);
  const now = new Date().toISOString();
  for (const item of list) {
    const { firestoreId, ...clean } = item;
    batch.set(fs.doc(db, 'customers', clean.id), withoutUndefined({ ...clean, orgId: activeOrgId, clientLeadId: clean.id, createdAt: clean.createdAt || now, updatedAt: now }));
  }
  await tracked(batch.commit());
}

/**
 * Updates an existing customer document
 */
export async function updateFirestoreCustomer(id, partialData) {
  if (!db || !fs || !activeOrgId) throw new Error("Firestore não inicializado.");

  const cleanData = { ...partialData };
  delete cleanData.id;
  delete cleanData.firestoreId;
  delete cleanData.orgId;

  const payload = {
    ...cleanData,
    updatedAt: new Date().toISOString()
  };

  // merge keeps the fields that were not sent; orgId goes along so the rules can check the company
  await tracked(fs.setDoc(fs.doc(db, 'customers', id), withoutUndefined({ ...payload, orgId: activeOrgId }), { merge: true }));
  return { id, firestoreId: id, ...payload };
}

// Firestore refuses a write that carries an undefined field
function withoutUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Adds items to the end of lists of an opportunity (history, tasks) without rewriting them:
 * what someone else added at the same moment stays. Works offline too (sent when back).
 * @param {string} id
 * @param {Object<string, Array>} lists - e.g. { activities: [activity], tasks: [task] }
 * @param {Object} [fields] - other fields to change together (stage, wonAt...)
 */
export async function appendToFirestoreCustomer(id, lists, fields = {}) {
  if (!db || !fs) throw new Error("Firestore não inicializado.");
  const payload = withoutUndefined({ ...fields, updatedAt: fields.updatedAt || new Date().toISOString() });
  for (const [field, items] of Object.entries(lists)) payload[field] = fs.arrayUnion(...items.map(withoutUndefined));
  await tracked(fs.updateDoc(fs.doc(db, 'customers', id), payload));
}

/**
 * Changes items already in a list (marks a task done, removes one) from the list as it is in the
 * database now, not the copy on screen: read and written together, in a transaction.
 * Needs the connection (a transaction cannot wait offline).
 * @param {string} id
 * @param {string} field - 'tasks' or 'activities'
 * @param {(list: Array) => Array} change
 */
export async function changeFirestoreCustomerList(id, field, change) {
  if (!db || !fs) throw new Error("Firestore não inicializado.");
  const ref = fs.doc(db, 'customers', id);
  await tracked(fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const list = Array.isArray(snap.data()[field]) ? snap.data()[field] : [];
    tx.update(ref, { [field]: withoutUndefined(change(list)), updatedAt: new Date().toISOString() });
  }));
}

/**
 * Deletes a customer document
 */
export async function deleteFirestoreCustomer(id) {
  if (!db || !fs) throw new Error("Firestore não inicializado.");
  await tracked(fs.deleteDoc(fs.doc(db, 'customers', id)));
  return true;
}
