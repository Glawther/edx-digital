/**
 * EDX Digital - Google Cloud Firestore Service Layer
 * Uses official Firebase Modular SDK v11
 *
 * Every read and write here is scoped to the signed-in person's company. The security
 * rules enforce the same thing on the server, so the filters below are not optional:
 * a query without them is refused.
 */

import { getFirebase } from './firebase-app.js';

let db = null;
let fs = null;
let activeOrgId = null;
let unsubscribeCustomers = null;

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

  unsubscribeCustomers = fs.onSnapshot(
    customersQuery,
    (snapshot) => {
      const customers = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
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

  await fs.setDoc(fs.doc(db, 'customers', customId), withoutUndefined(payload));
  return { ...payload, id: customId, firestoreId: customId };
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
  await fs.setDoc(fs.doc(db, 'customers', id), withoutUndefined({ ...payload, orgId: activeOrgId }), { merge: true });
  return { id, firestoreId: id, ...payload };
}

// Firestore refuses a write that carries an undefined field
function withoutUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Deletes a customer document
 */
export async function deleteFirestoreCustomer(id) {
  if (!db || !fs) throw new Error("Firestore não inicializado.");
  await fs.deleteDoc(fs.doc(db, 'customers', id));
  return true;
}
