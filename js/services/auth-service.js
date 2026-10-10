/**
 * Nexus CRM - Google Authentication & RBAC Service (Tríade CID)
 * Role-Based Access Control: Administrador (Admin) vs Funcionário (Employee)
 * Uses Firebase Modular SDK v11 (firebase-auth)
 */

import { getSavedFirebaseConfig, saveOrganization, getSavedOrganization } from '../core/config.js';

export const USER_ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee'
};

const ROLE_STORAGE_KEY = 'nexus_crm_user_role';

let auth = null;
let currentUser = null;
let currentRole = localStorage.getItem(ROLE_STORAGE_KEY) || USER_ROLES.ADMIN;
const listeners = [];
const roleListeners = [];

const FIREBASE_AUTH_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";

async function loadAuthModules() {
  const firebaseApp = await import(FIREBASE_APP_URL);
  const firebaseAuth = await import(FIREBASE_AUTH_URL);
  return { firebaseApp, firebaseAuth };
}

/**
 * Initializes Firebase Auth with current project
 */
export async function initAuth() {
  const config = getSavedFirebaseConfig();
  if (!config) {
    // Demo user fallback with active role
    setupDefaultDemoUser();
    return null;
  }

  try {
    const { firebaseApp, firebaseAuth } = await loadAuthModules();
    
    // Get existing default app or initialize
    let app;
    try {
      app = firebaseApp.getApp();
    } catch {
      app = firebaseApp.initializeApp(config);
    }

    auth = firebaseAuth.getAuth(app);

    firebaseAuth.onAuthStateChanged(auth, (user) => {
      if (user) {
        currentUser = {
          uid: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Usuário',
          email: user.email,
          photoURL: user.photoURL || null,
          role: currentRole
        };
      } else {
        setupDefaultDemoUser();
      }

      notifyListeners();
    });

    return auth;
  } catch (err) {
    console.warn("Could not initialize Firebase Auth:", err);
    setupDefaultDemoUser();
    return null;
  }
}

function setupDefaultDemoUser() {
  currentUser = {
    uid: currentRole === USER_ROLES.ADMIN ? 'admin-user-01' : 'employee-user-02',
    name: currentRole === USER_ROLES.ADMIN ? 'Administrador do Sistema' : 'Lucas Mendes (Consultor)',
    email: currentRole === USER_ROLES.ADMIN ? 'admin@nexuscrm.com' : 'lucas.vendas@nexuscrm.com',
    photoURL: null,
    role: currentRole
  };
  notifyListeners();
}

/**
 * Sets and switches active user role (Admin vs Employee)
 * Enables live simulation and testing of CID Triad security policies
 */
export function setUserRole(newRole) {
  if (newRole !== USER_ROLES.ADMIN && newRole !== USER_ROLES.EMPLOYEE) return;
  currentRole = newRole;
  localStorage.setItem(ROLE_STORAGE_KEY, newRole);

  if (currentUser) {
    currentUser.role = newRole;
    if (newRole === USER_ROLES.ADMIN) {
      currentUser.name = currentUser.name.includes('(Consultor)') ? 'Administrador do Sistema' : currentUser.name;
    } else {
      currentUser.name = currentUser.name.includes('Administrador') ? 'Lucas Mendes (Consultor)' : currentUser.name;
    }
  }

  notifyRoleListeners();
  notifyListeners();
}

const SESSION_STORAGE_KEY = 'nexus_crm_session_active';

export function isSessionActive() {
  // No session until someone signs in: the first visit lands on the login portal
  return localStorage.getItem(SESSION_STORAGE_KEY) === 'true';
}

export function setSessionActive(active) {
  if (active) {
    localStorage.setItem(SESSION_STORAGE_KEY, 'true');
  } else {
    localStorage.setItem(SESSION_STORAGE_KEY, 'false');
  }
}

export function loginAsDemoRole(role) {
  setUserRole(role);
  setSessionActive(true);
  notifyListeners();
  return currentUser;
}

export function loginWithEmail(email, password, role = USER_ROLES.EMPLOYEE) {
  setUserRole(role);
  const formattedName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  currentUser = {
    uid: role === USER_ROLES.ADMIN ? 'admin-user-01' : 'employee-user-' + Date.now().toString(36),
    name: role === USER_ROLES.ADMIN ? 'Administrador (' + formattedName + ')' : formattedName + ' (Consultor)',
    email: email,
    role: role,
    photoURL: null
  };
  setSessionActive(true);
  notifyListeners();
  return currentUser;
}

export function registerUser(name, email, password, role = USER_ROLES.EMPLOYEE, company = '') {
  setUserRole(role);
  const companyClean = company && company.trim() ? company.trim() : 'Minha Empresa';
  const orgSlug = 'org_' + companyClean.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20) + '_' + Math.random().toString(36).substring(2, 6);
  
  const org = {
    id: orgSlug,
    name: companyClean,
    plan: 'pro',
    planName: 'Nexus Pro',
    planStatus: 'trial',
    trialDaysLeft: 14,
    aiQuotaMonth: 150,
    aiUsedThisMonth: 0,
    createdAt: new Date().toISOString()
  };
  saveOrganization(org);

  currentUser = {
    uid: 'user-' + Date.now().toString(36),
    name: role === USER_ROLES.ADMIN ? name + ' (Administrador)' : name + ' (Consultor)',
    email: email,
    company: companyClean,
    orgId: org.id,
    role: role,
    photoURL: null
  };
  setSessionActive(true);
  notifyListeners();
  return currentUser;
}

export function logoutToPortal() {
  setSessionActive(false);
  notifyListeners();
}

export function getCurrentRole() {
  return currentRole;
}

export function isAdmin() {
  return currentRole === USER_ROLES.ADMIN;
}

export function isEmployee() {
  return currentRole === USER_ROLES.EMPLOYEE;
}

/**
 * Triggers Google Sign-In via Popup
 */
export async function signInWithGoogle() {
  const config = getSavedFirebaseConfig();
  if (!config) {
    throw new Error("Conecte primeiro suas credenciais do Firebase no menu de configurações.");
  }

  const { firebaseAuth } = await loadAuthModules();
  if (!auth) await initAuth();

  const provider = new firebaseAuth.GoogleAuthProvider();
  const result = await firebaseAuth.signInWithPopup(auth, provider);
  return result.user;
}

/**
 * Signs out current user
 */
export async function signOutUser() {
  if (auth) {
    const { firebaseAuth } = await loadAuthModules();
    await firebaseAuth.signOut(auth);
  }
  setupDefaultDemoUser();
}

/**
 * Subscribes to user authentication state
 */
export function onAuthChange(callback) {
  listeners.push(callback);
  callback(currentUser);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function onRoleChange(callback) {
  roleListeners.push(callback);
  callback(currentRole);
  return () => {
    const idx = roleListeners.indexOf(callback);
    if (idx !== -1) roleListeners.splice(idx, 1);
  };
}

function notifyListeners() {
  listeners.forEach(cb => {
    try {
      cb(currentUser);
    } catch (e) {
      console.error("Error in auth listener:", e);
    }
  });
}

function notifyRoleListeners() {
  roleListeners.forEach(cb => {
    try {
      cb(currentRole);
    } catch (e) {
      console.error("Error in role listener:", e);
    }
  });
}

export function getCurrentUser() {
  return currentUser;
}

