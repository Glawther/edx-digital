/**
 * Nexus CRM - Sign-in and roles
 *
 * Two kinds of session:
 *  - "cloud": a real account (Firebase Authentication). The role and the company come from the
 *    person's profile in the database, never from the sign-in screen.
 *  - "demo": sample data kept only in this browser, for getting to know the product.
 */

import {
  getSavedOrganization,
  saveOrganization,
  clearSavedOrganization,
  setLocalOnlyMode,
  setOrganizationSyncHook
} from '../core/config.js';
import { getFirebase } from './firebase-app.js';

export const USER_ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee'
};

export const SESSION_KINDS = {
  NONE: 'none',
  DEMO: 'demo',
  CLOUD: 'cloud'
};

const ROLE_STORAGE_KEY = 'nexus_crm_user_role';
const SESSION_STORAGE_KEY = 'nexus_crm_session_active';
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Fields of the company record an administrator may change from the app.
// The plan and its status are not here: those only change through billing.
const ORG_EDITABLE_FIELDS = ['name', 'legalName', 'cnpj', 'logoUrl', 'brandColor'];

let currentUser = null;
let currentRole = USER_ROLES.EMPLOYEE;
let sessionKind = SESSION_KINDS.NONE;
const listeners = [];
const roleListeners = [];

function authError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// ==========================================================================
// Session start-up
// ==========================================================================

/**
 * Restores whatever session this browser had: the demo, a signed-in account, or none.
 * Resolves with the current user (or null when the sign-in screen should be shown).
 */
export async function initAuth() {
  if (localStorage.getItem(SESSION_STORAGE_KEY) === 'demo') {
    const savedRole = localStorage.getItem(ROLE_STORAGE_KEY);
    startDemoSession(savedRole === USER_ROLES.EMPLOYEE ? USER_ROLES.EMPLOYEE : USER_ROLES.ADMIN);
    return currentUser;
  }

  try {
    const { auth } = await withTimeout(getFirebase(), 8000);
    await withTimeout(auth.authStateReady(), 8000);
    if (auth.currentUser) {
      await applyFirebaseUser(auth.currentUser);
    }
  } catch (err) {
    console.warn('Could not restore the session:', err);
    clearSession();
  }
  return currentUser;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/**
 * Loads the profile and the company of a signed-in account and makes it the current user.
 * Throws nexus/no-profile when the account exists but was never linked to a company.
 */
async function applyFirebaseUser(fbUser) {
  const { auth, db, authMod, fsMod } = await getFirebase();

  const profileSnap = await fsMod.getDoc(fsMod.doc(db, 'users', fbUser.uid));
  if (!profileSnap.exists()) {
    throw authError('nexus/no-profile');
  }
  const profile = profileSnap.data();

  if (profile.status === 'blocked') {
    await authMod.signOut(auth);
    clearSession();
    throw authError('nexus/blocked');
  }

  const orgSnap = await fsMod.getDoc(fsMod.doc(db, 'organizations', profile.orgId));
  const org = orgSnap.exists() ? orgSnap.data() : {};

  setLocalOnlyMode(false);
  saveOrganization({ ...org, id: profile.orgId, name: org.name || 'Minha empresa' }, { skipSync: true });

  currentRole = profile.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.EMPLOYEE;
  currentUser = {
    uid: fbUser.uid,
    name: profile.name || fbUser.displayName || (fbUser.email || '').split('@')[0],
    email: fbUser.email,
    role: currentRole,
    orgId: profile.orgId,
    mustChangePassword: !!profile.mustChangePassword,
    photoURL: null
  };
  sessionKind = SESSION_KINDS.CLOUD;
  localStorage.setItem(SESSION_STORAGE_KEY, 'cloud');

  notifyRoleListeners();
  notifyListeners();
  return currentUser;
}

function clearSession() {
  currentUser = null;
  currentRole = USER_ROLES.EMPLOYEE;
  sessionKind = SESSION_KINDS.NONE;
  localStorage.setItem(SESSION_STORAGE_KEY, 'false');
}

// ==========================================================================
// Real accounts
// ==========================================================================

/**
 * Signs in with e-mail and password
 */
export async function signIn(email, password) {
  const { auth, authMod } = await getFirebase();
  const cred = await authMod.signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    return await applyFirebaseUser(cred.user);
  } catch (err) {
    // An account without a company cannot use the CRM: do not leave it half signed in
    if (err.code === 'nexus/no-profile') await authMod.signOut(auth).catch(() => {});
    throw err;
  }
}

/**
 * Creates the account, or reuses one whose sign-up stopped before it was linked to a company
 */
async function createOrResumeAccount(email, password) {
  const { auth, db, authMod, fsMod } = await getFirebase();
  try {
    return await authMod.createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    if (err.code !== 'auth/email-already-in-use') throw err;
    let cred;
    try {
      cred = await authMod.signInWithEmailAndPassword(auth, email, password);
    } catch {
      throw err;
    }
    const existing = await fsMod.getDoc(fsMod.doc(db, 'users', cred.user.uid));
    if (existing.exists()) {
      await authMod.signOut(auth).catch(() => {});
      throw authError('nexus/account-exists');
    }
    return cred;
  }
}

/**
 * Registers a new company. Whoever registers it is its first administrator.
 */
export async function registerCompany({ name, email, company, password, plan = 'pro' }) {
  const { db, authMod, fsMod } = await getFirebase();
  const cleanEmail = email.trim().toLowerCase();
  const companyName = company.trim();

  const cred = await createOrResumeAccount(cleanEmail, password);
  const uid = cred.user.uid;
  const now = new Date().toISOString();

  const slug = companyName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 20);
  const orgId = `org_${slug || 'empresa'}_${randomCode(8).toLowerCase()}`;
  const inviteCode = 'NX-' + randomCode(8);

  // Order matters: the security rules only accept an administrator profile for a company
  // this same account owns, so the company record has to exist first.
  await fsMod.setDoc(fsMod.doc(db, 'organizations', orgId), {
    name: companyName,
    ownerUid: uid,
    plan: ['starter', 'pro', 'enterprise'].includes(plan) ? plan : 'pro',
    planStatus: 'trial',
    trialDaysLeft: 14,
    createdAt: now
  });
  await fsMod.setDoc(fsMod.doc(db, 'users', uid), {
    orgId,
    role: USER_ROLES.ADMIN,
    name: name.trim(),
    email: cleanEmail,
    status: 'active',
    createdAt: now
  });
  await fsMod.setDoc(fsMod.doc(db, 'invites', inviteCode), {
    orgId,
    role: USER_ROLES.EMPLOYEE,
    active: true,
    createdBy: uid,
    createdAt: now
  });
  await fsMod.updateDoc(fsMod.doc(db, 'organizations', orgId), { teamInviteCode: inviteCode, updatedAt: now });
  await authMod.updateProfile(cred.user, { displayName: name.trim() }).catch(() => {});

  return applyFirebaseUser(cred.user);
}

/**
 * Joins an existing company with the invite code its administrator handed out
 */
export async function joinCompany({ inviteCode, name, email, password }) {
  const { db, authMod, fsMod } = await getFirebase();
  const code = inviteCode.trim().toUpperCase();
  const cleanEmail = email.trim().toLowerCase();

  // Checked before creating the account, so a wrong code leaves nothing behind
  const inviteSnap = await fsMod.getDoc(fsMod.doc(db, 'invites', code)).catch(() => null);
  if (!inviteSnap || !inviteSnap.exists() || inviteSnap.data().active !== true) {
    throw authError('nexus/invalid-invite');
  }
  const orgId = inviteSnap.data().orgId;

  const cred = await createOrResumeAccount(cleanEmail, password);
  await fsMod.setDoc(fsMod.doc(db, 'users', cred.user.uid), {
    orgId,
    role: USER_ROLES.EMPLOYEE,
    name: name.trim(),
    email: cleanEmail,
    status: 'active',
    inviteCode: code,
    createdAt: new Date().toISOString()
  });
  await authMod.updateProfile(cred.user, { displayName: name.trim() }).catch(() => {});

  return applyFirebaseUser(cred.user);
}

/**
 * Sends the "choose a new password" e-mail
 */
export async function sendPasswordReset(email) {
  const { auth, authMod } = await getFirebase();
  await authMod.sendPasswordResetEmail(auth, email.trim());
}

/**
 * Replaces the temporary password handed out by the administrator with a personal one
 */
export async function changeOwnPassword(newPassword) {
  const { auth, db, authMod, fsMod } = await getFirebase();
  if (!auth.currentUser) throw authError('auth/requires-recent-login');
  await authMod.updatePassword(auth.currentUser, newPassword);
  await fsMod.updateDoc(fsMod.doc(db, 'users', auth.currentUser.uid), {
    mustChangePassword: false,
    updatedAt: new Date().toISOString()
  });
  if (currentUser) currentUser.mustChangePassword = false;
  notifyListeners();
}

/**
 * Replaces the company's invite code. The old code stops working at once.
 */
export async function regenerateTeamInviteCode() {
  if (sessionKind !== SESSION_KINDS.CLOUD || !isAdmin()) {
    throw authError('permission-denied');
  }
  const { db, fsMod } = await getFirebase();
  const org = getSavedOrganization();
  const now = new Date().toISOString();
  const newCode = 'NX-' + randomCode(8);

  await fsMod.setDoc(fsMod.doc(db, 'invites', newCode), {
    orgId: org.id,
    role: USER_ROLES.EMPLOYEE,
    active: true,
    createdBy: currentUser.uid,
    createdAt: now
  });
  if (org.teamInviteCode) {
    await fsMod.deleteDoc(fsMod.doc(db, 'invites', org.teamInviteCode)).catch(() => {});
  }
  await fsMod.updateDoc(fsMod.doc(db, 'organizations', org.id), { teamInviteCode: newCode, updatedAt: now });
  saveOrganization({ ...org, teamInviteCode: newCode }, { skipSync: true });
  return newCode;
}

function randomCode(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}

// Company details edited in the app (name, logo, colour) are saved for the whole team
setOrganizationSyncHook(async (org) => {
  if (sessionKind !== SESSION_KINDS.CLOUD || !isAdmin() || !org || !org.id) return;
  const changes = { updatedAt: new Date().toISOString() };
  ORG_EDITABLE_FIELDS.forEach((field) => {
    if (org[field] !== undefined) changes[field] = org[field];
  });
  try {
    const { db, fsMod } = await getFirebase();
    await fsMod.updateDoc(fsMod.doc(db, 'organizations', org.id), changes);
  } catch (err) {
    console.warn('Could not save the company details to the cloud:', err);
  }
});

// ==========================================================================
// Demo (sample data, this browser only)
// ==========================================================================

function startDemoSession(role) {
  currentRole = role;
  sessionKind = SESSION_KINDS.DEMO;
  setLocalOnlyMode(true);
  localStorage.setItem(SESSION_STORAGE_KEY, 'demo');
  localStorage.setItem(ROLE_STORAGE_KEY, role);
  currentUser = demoUserFor(role);
  notifyRoleListeners();
  notifyListeners();
}

function demoUserFor(role) {
  return role === USER_ROLES.ADMIN
    ? { uid: 'admin-user-01', name: 'Paula Andrade', email: 'admin@nexuscrm.com', role, photoURL: null }
    : { uid: 'employee-user-02', name: 'Lucas Mendes', email: 'lucas.vendas@nexuscrm.com', role, photoURL: null };
}

export function loginAsDemoRole(role) {
  startDemoSession(role === USER_ROLES.EMPLOYEE ? USER_ROLES.EMPLOYEE : USER_ROLES.ADMIN);
  return currentUser;
}

/**
 * Switches between the two sample profiles. Real accounts cannot change their own role.
 */
export function setUserRole(newRole) {
  if (sessionKind !== SESSION_KINDS.DEMO) return false;
  if (newRole !== USER_ROLES.ADMIN && newRole !== USER_ROLES.EMPLOYEE) return false;
  startDemoSession(newRole);
  return true;
}

// ==========================================================================
// Session state
// ==========================================================================

export async function logoutToPortal() {
  const wasCloud = sessionKind === SESSION_KINDS.CLOUD;
  clearSession();
  if (wasCloud) {
    clearSavedOrganization();
    try {
      const { auth, authMod } = await getFirebase();
      await authMod.signOut(auth);
    } catch (err) {
      console.warn('Sign-out notice:', err);
    }
  }
  notifyRoleListeners();
  notifyListeners();
}

export function isSessionActive() {
  return sessionKind !== SESSION_KINDS.NONE;
}

export function getSessionKind() {
  return sessionKind;
}

export function isDemoSession() {
  return sessionKind === SESSION_KINDS.DEMO;
}

export function isCloudSession() {
  return sessionKind === SESSION_KINDS.CLOUD;
}

export function getCurrentRole() {
  return currentRole;
}

export function isAdmin() {
  return sessionKind !== SESSION_KINDS.NONE && currentRole === USER_ROLES.ADMIN;
}

export function isEmployee() {
  return currentRole === USER_ROLES.EMPLOYEE;
}

export function getCurrentUser() {
  return currentUser;
}

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
