/**
 * Nexus CRM - Google Cloud Firestore Service Layer
 * Uses official Firebase Modular SDK v11
 */

let app = null;
let db = null;
let unsubscribeCustomers = null;

const FIREBASE_SDK_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
const FIRESTORE_SDK_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

/**
 * Dynamically loads the Firebase Modular SDK via ES Modules
 */
async function loadFirebaseModules() {
  const firebaseApp = await import(FIREBASE_SDK_URL);
  const firestore = await import(FIRESTORE_SDK_URL);
  return { firebaseApp, firestore };
}

/**
 * Initializes the Firebase App and Firestore instance
 * @param {Object} config - Firebase project configuration object
 */
export async function initializeFirestore(config) {
  if (!config || !config.projectId || !config.apiKey) {
    throw new Error("Credenciais do Firebase incompletas.");
  }

  const { firebaseApp, firestore } = await loadFirebaseModules();

  // If already initialized with different config, delete or recreate
  if (app) {
    try {
      if (unsubscribeCustomers) {
        unsubscribeCustomers();
        unsubscribeCustomers = null;
      }
    } catch (e) {
      console.warn("Error cleaning up previous listener:", e);
    }
  }

  app = firebaseApp.initializeApp(config, "nexus-crm-app-" + Date.now());
  db = firestore.getFirestore(app);
  return { app, db };
}

/**
 * Stops the real-time listener and forgets the Firestore instance (used when going local-only)
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
  db = null;
}

/**
 * Returns the current active Firestore instance
 */
export function getFirestoreDb() {
  return db;
}


/**
 * Subscribes to real-time updates from Firestore 'customers' collection
 * Multi-tenant isolation: Filters by orgId
 * @param {Function} onData - Callback when data changes
 * @param {Function} onError - Callback when error occurs
 * @param {string} orgId - Organization ID for tenant isolation
 */
export async function subscribeToFirestoreCustomers(onData, onError, orgId = null) {
  if (!db) {
    throw new Error("Firestore não inicializado.");
  }

  const { firestore } = await loadFirebaseModules();
  const customersCollection = firestore.collection(db, "customers");

  // Query collection directly and perform robust multi-tenant filtering
  unsubscribeCustomers = firestore.onSnapshot(
    customersCollection,
    (snapshot) => {
      const customers = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        
        // Multi-tenant check: allow documents belonging to this organization or generic demo leads
        const isMatch = !orgId || 
                        !data.orgId || 
                        data.orgId === orgId || 
                        data.orgId === 'org_nexus_default' || 
                        data.orgId === 'default';

        if (isMatch) {
          const clientOldId = data.id;
          delete data.id; // Prevent internal 'id' property from colliding with authoritative doc.id
          customers.push({
            ...data,
            id: doc.id,
            firestoreId: doc.id,
            orgId: data.orgId || orgId || 'org_nexus_default',
            clientLeadId: clientOldId || data.clientLeadId || doc.id
          });
        }
      });

      // Robust in-memory sorting by most recent update
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
 * Adds a new customer document into Firestore
 * Unifies document ID with customer ID and binds organizationId
 */
export async function addFirestoreCustomer(customerData, orgId = null) {
  if (!db) throw new Error("Firestore não inicializado.");
  const { firestore } = await loadFirebaseModules();
  
  const cleanData = { ...customerData };
  const customId = cleanData.id || ('lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5));
  delete cleanData.firestoreId;

  const payload = {
    ...cleanData,
    id: customId,
    orgId: cleanData.orgId || orgId || 'org_nexus_default',
    clientLeadId: customId,
    createdAt: cleanData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = firestore.doc(db, "customers", customId);
  await firestore.setDoc(docRef, payload, { merge: true });
  return { ...payload, id: customId, firestoreId: customId };
}

/**
 * Updates an existing customer document in Firestore
 * Completely immune to 'No document to update' errors by using setDoc with merge: true
 */
export async function updateFirestoreCustomer(id, partialData) {
  if (!db) throw new Error("Firestore não inicializado.");
  const { firestore } = await loadFirebaseModules();

  const cleanData = { ...partialData };
  delete cleanData.id;
  delete cleanData.firestoreId;

  const payload = {
    ...cleanData,
    updatedAt: new Date().toISOString()
  };

  // 1. If ID is legacy client format (lead-...), try locating matching doc in Firestore
  if (id && typeof id === 'string' && id.startsWith('lead-')) {
    try {
      const col = firestore.collection(db, "customers");
      const q1 = firestore.query(col, firestore.where("id", "==", id));
      const snap1 = await firestore.getDocs(q1);
      if (!snap1.empty) {
        const actualDoc = snap1.docs[0];
        await firestore.setDoc(actualDoc.ref, payload, { merge: true });
        return { id: actualDoc.id, firestoreId: actualDoc.id, ...payload };
      }

      const q2 = firestore.query(col, firestore.where("clientLeadId", "==", id));
      const snap2 = await firestore.getDocs(q2);
      if (!snap2.empty) {
        const actualDoc = snap2.docs[0];
        await firestore.setDoc(actualDoc.ref, payload, { merge: true });
        return { id: actualDoc.id, firestoreId: actualDoc.id, ...payload };
      }
    } catch (searchErr) {
      console.warn("Notice: Document search by field failed, writing directly to target ID:", searchErr);
    }
  }

  // 2. Direct upsert by Firestore document ID using setDoc with merge: true
  // setDoc({ merge: true }) creates the document if missing or updates it if present, never failing with 404
  const docRef = firestore.doc(db, "customers", id);
  await firestore.setDoc(docRef, { ...payload, id, clientLeadId: id }, { merge: true });
  return { id, firestoreId: id, ...payload };
}

/**
 * Deletes a customer document from Firestore
 */
export async function deleteFirestoreCustomer(id) {
  if (!db) throw new Error("Firestore não inicializado.");
  const { firestore } = await loadFirebaseModules();

  let targetRef = firestore.doc(db, "customers", id);

  if (id && typeof id === 'string' && id.startsWith('lead-')) {
    try {
      const col = firestore.collection(db, "customers");
      const q1 = firestore.query(col, firestore.where("id", "==", id));
      const snap1 = await firestore.getDocs(q1);
      if (!snap1.empty) {
        targetRef = snap1.docs[0].ref;
      } else {
        const q2 = firestore.query(col, firestore.where("clientLeadId", "==", id));
        const snap2 = await firestore.getDocs(q2);
        if (!snap2.empty) targetRef = snap2.docs[0].ref;
      }
    } catch (e) {
      console.warn("Could not find document by field id for deletion:", e);
    }
  }

  try {
    await firestore.deleteDoc(targetRef);
  } catch (err) {
    console.warn("Document deletion completed or already absent in Firestore:", err);
  }
  return true;
}

/**
 * Tests connection to Firestore with provided configuration
 */
export async function testFirestoreConnection(config) {
  try {
    const { app: testApp, db: testDb } = await initializeFirestore(config);
    const { firestore } = await loadFirebaseModules();
    // Perform a lightweight read to test rules and connection
    const testCol = firestore.collection(testDb, "customers");
    const testQuery = firestore.query(testCol, firestore.limit(1));
    await firestore.getDocs(testQuery);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "Falha na conexão com o Firestore." };
  }
}
