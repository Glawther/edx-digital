/**
 * EDX Digital - Configuration & Firebase Credentials Storage
 */

const STORAGE_KEYS = {
  LOCAL_DATA: 'nexus_crm_local_customers',
  ACTIVITIES_DATA: 'nexus_crm_local_activities',
  APP_PREFS: 'nexus_crm_preferences',
  ORGANIZATION: 'nexus_crm_organization_config',
  AI_METRICS: 'nexus_crm_ai_usage_metrics',
  STORAGE_MODE: 'nexus_crm_storage_mode'
};

/**
 * True when the user chose to keep data only in this browser (no cloud sync).
 * Without this switch the app always fell back to the default Firebase project,
 * so "disconnect" never really disconnected.
 */
export function isLocalOnlyMode() {
  try {
    return localStorage.getItem(STORAGE_KEYS.STORAGE_MODE) === 'local';
  } catch {
    return false;
  }
}

export function setLocalOnlyMode(enabled) {
  if (enabled) {
    localStorage.setItem(STORAGE_KEYS.STORAGE_MODE, 'local');
  } else {
    localStorage.removeItem(STORAGE_KEYS.STORAGE_MODE);
  }
}

// Default commercial organization & whitelabel parameters
export const defaultOrganization = {
  id: 'org_nexus_default',
  name: 'Empresa Exemplo',
  legalName: '',
  cnpj: '',
  logoUrl: '', // Base64 or image URL
  brandColor: '#3b82f6', // Hex color
  plan: 'pro', // 'starter' | 'pro' | 'enterprise'
  planName: 'EDX Digital Pro',
  planStatus: 'trial', // 'active' | 'trial' | 'past_due'
  trialDaysLeft: 14,
  maxLeads: 5000,
  maxUsers: 10,
  aiQuotaMonth: 150,
  aiUsedThisMonth: 14,
  currency: 'BRL',
  createdAt: new Date().toISOString()
};

// Default active credentials for Google Cloud Firestore (nexuscrm-d8e13)
export const defaultFirebaseConfig = {
  projectId: "nexuscrm-d8e13",
  appId: "1:723888013412:web:5197621060dd486fb41f71",
  databaseURL: "https://nexuscrm-d8e13-default-rtdb.firebaseio.com",
  storageBucket: "nexuscrm-d8e13.firebasestorage.app",
  apiKey: "AIzaSyCjJcdEhHZxUGMH2jubCqCxqBAU6kQNZIA",
  authDomain: "nexuscrm-d8e13.firebaseapp.com",
  messagingSenderId: "723888013412",
  measurementId: "G-1W84EPW08S"
};

/**
 * Retrieves active Organization / Multi-tenant profile
 */
export function getSavedOrganization() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ORGANIZATION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        return { ...defaultOrganization, ...parsed };
      }
    }
  } catch (e) {
    console.warn("Could not load organization config:", e);
  }
  return defaultOrganization;
}

let organizationSyncHook = null;

/**
 * Lets the sign-in layer save company details to the cloud whenever they change here
 */
export function setOrganizationSyncHook(hook) {
  organizationSyncHook = hook;
}

/**
 * Saves active Organization / Whitelabel settings
 * @param {Object} options - skipSync: true when the data just came from the cloud
 */
export function saveOrganization(org, options = {}) {
  if (!org || !org.id) throw new Error("Dados de organização inválidos.");
  const updated = { ...defaultOrganization, ...org, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEYS.ORGANIZATION, JSON.stringify(updated));
  applyWhitelabelStyles(updated);
  if (!options.skipSync && organizationSyncHook) {
    Promise.resolve(organizationSyncHook(updated)).catch(() => {});
  }
  return updated;
}

/**
 * Forgets the company kept in this browser (used when a real account signs out)
 */
export function clearSavedOrganization() {
  localStorage.removeItem(STORAGE_KEYS.ORGANIZATION);
  applyWhitelabelStyles(defaultOrganization);
}

/**
 * Dynamically applies Whitelabel Brand Color, Logo and Title to the DOM
 */
export function applyWhitelabelStyles(org = null) {
  const currentOrg = org || getSavedOrganization();
  const root = document.documentElement;

  // 1. Apply primary brand color and derivations
  if (currentOrg.brandColor) {
    const hex = currentOrg.brandColor;
    root.style.setProperty('--color-primary', hex);
    
    // Convert hex to rgb for rgba transparency support
    const r = parseInt(hex.slice(1, 3), 16) || 59;
    const g = parseInt(hex.slice(3, 5), 16) || 130;
    const b = parseInt(hex.slice(5, 7), 16) || 246;
    root.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--color-primary-hover', `rgb(${Math.max(0, r - 25)}, ${Math.max(0, g - 25)}, ${Math.max(0, b - 25)})`);
    root.style.setProperty('--color-primary-light', `rgba(${r}, ${g}, ${b}, 0.12)`);
  }

  // 2. Apply company name to sidebar brand and document title
  const brandNameEls = document.querySelectorAll('.brand-name');
  brandNameEls.forEach(el => {
    el.textContent = currentOrg.name || 'EDX Digital';
  });

  if (currentOrg.name) {
    document.title = `${currentOrg.name} | EDX Digital`;
  }

  // 3. Apply custom logo if set
  const brandIconEl = document.querySelector('.brand-icon');
  if (brandIconEl) {
    if (currentOrg.logoUrl) {
      brandIconEl.innerHTML = `<img src="${currentOrg.logoUrl}" alt="${currentOrg.name}" style="width: 24px; height: 24px; object-fit: contain; border-radius: 4px;">`;
    } else {
      brandIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;

/**
 * Where the company's plan stands today. The same rules are enforced by the database.
 *   trial        inside the free period
 *   trial_ended  free period over, nothing paid          -> read-only
 *   active       paid, with days left
 *   grace        paid period over, within the tolerance  (daysLeft = days until read-only)
 *   expired      paid period and tolerance over          -> read-only
 */
export function getPlanState(org = getSavedOrganization()) {
  const now = Date.now();

  if (org.planStatus === 'active') {
    const paidUntilMs = Number(org.paidUntilMs) || Date.parse(org.paidUntil) || 0;
    const until = new Date(paidUntilMs).toISOString();
    if (now < paidUntilMs) {
      return { status: 'active', daysLeft: Math.ceil((paidUntilMs - now) / DAY_MS), until, readOnly: false };
    }
    const blockAt = paidUntilMs + GRACE_DAYS * DAY_MS;
    return now < blockAt
      ? { status: 'grace', daysLeft: Math.ceil((blockAt - now) / DAY_MS), until, readOnly: false }
      : { status: 'expired', daysLeft: 0, until, readOnly: true };
  }

  // Companies created before the trial end was recorded keep working
  if (org.trialEndsAtMs === undefined || org.trialEndsAtMs === null) {
    const created = Date.parse(org.createdAt) || now;
    const daysLeft = Math.max(0, TRIAL_DAYS - Math.floor((now - created) / DAY_MS));
    return { status: 'trial', daysLeft, readOnly: false, legacy: true };
  }
  const trialEndsAtMs = Number(org.trialEndsAtMs);
  return now < trialEndsAtMs
    ? { status: 'trial', daysLeft: Math.ceil((trialEndsAtMs - now) / DAY_MS), readOnly: false }
    : { status: 'trial_ended', daysLeft: 0, readOnly: true };
}

/**
 * Retrieves AI usage metrics for the active organization
 */
export function getAiUsageMetrics() {
  const org = getSavedOrganization();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_METRICS);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        used: Number(data.used) || 0,
        quota: Number(org.aiQuotaMonth) || 150,
        lastReset: data.lastReset || new Date().toISOString()
      };
    }
  } catch (e) {
    console.warn("Could not load AI metrics:", e);
  }
  return {
    used: Number(org.aiUsedThisMonth) || 14,
    quota: Number(org.aiQuotaMonth) || 150,
    lastReset: new Date().toISOString()
  };
}

/**
 * Records an AI API call usage
 */
export function recordAiUsage() {
  const metrics = getAiUsageMetrics();
  metrics.used += 1;
  localStorage.setItem(STORAGE_KEYS.AI_METRICS, JSON.stringify(metrics));
  
  // Also update organization in memory
  const org = getSavedOrganization();
  org.aiUsedThisMonth = metrics.used;
  localStorage.setItem(STORAGE_KEYS.ORGANIZATION, JSON.stringify(org));
  return metrics;
}

export { STORAGE_KEYS };

