/**
 * EDX Digital - Shared Firebase app
 * One app instance for Authentication and Firestore, so the database always
 * knows who is signed in. (Before, each service created its own app and the
 * database was reached anonymously.)
 */

import { defaultFirebaseConfig } from '../core/config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/11.4.0/';
const EMULATOR_FLAG = 'edx_use_emulator';
const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR_PORT = 8080;

let firebasePromise = null;

/**
 * The local emulator is only ever used from a development host, and only when asked for
 * (localStorage edx_use_emulator = "1"). Production never takes this path.
 */
export function isUsingEmulator() {
  try {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    return isLocalHost && localStorage.getItem(EMULATOR_FLAG) === '1';
  } catch {
    return false;
  }
}

async function loadModules() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK_BASE + 'firebase-app.js'),
    import(SDK_BASE + 'firebase-auth.js'),
    import(SDK_BASE + 'firebase-firestore.js')
  ]);
  return { appMod, authMod, fsMod };
}

/**
 * Returns the shared Firebase handles, creating them on first use
 */
export function getFirebase() {
  if (!firebasePromise) {
    firebasePromise = (async () => {
      const { appMod, authMod, fsMod } = await loadModules();
      const emulator = isUsingEmulator();
      const config = emulator
        ? { ...defaultFirebaseConfig, projectId: 'demo-edx-digital', apiKey: 'demo-key' }
        : defaultFirebaseConfig;

      const app = appMod.initializeApp(config);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);

      if (emulator) {
        authMod.connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
        fsMod.connectFirestoreEmulator(db, '127.0.0.1', FIRESTORE_EMULATOR_PORT);
      }

      return { app, auth, db, appMod, authMod, fsMod, config };
    })().catch((err) => {
      firebasePromise = null;
      throw err;
    });
  }
  return firebasePromise;
}

/**
 * Creates a sign-in account for someone else without replacing the administrator's own session.
 * A second, short-lived app instance does the account creation and is thrown away afterwards.
 */
export async function createAccountForSomeoneElse(email, password) {
  const { appMod, authMod, config } = await getFirebase();
  const secondary = appMod.initializeApp(config, 'edx-provisioning-' + Date.now());
  try {
    const secondaryAuth = authMod.initializeAuth(secondary, { persistence: authMod.inMemoryPersistence });
    if (isUsingEmulator()) {
      authMod.connectAuthEmulator(secondaryAuth, AUTH_EMULATOR_URL, { disableWarnings: true });
    }
    const cred = await authMod.createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await authMod.signOut(secondaryAuth);
    return uid;
  } finally {
    await appMod.deleteApp(secondary).catch(() => {});
  }
}

/**
 * Turns a Firebase error into a sentence the person can act on
 */
export function describeAuthError(err) {
  const code = (err && err.code) || '';
  const messages = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Este e-mail não é válido.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Use a aba Entrar.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet. Verifique a rede e tente de novo.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de trocar a senha.',
    'auth/operation-not-allowed': 'O login por e-mail e senha ainda não foi ativado no Firebase deste projeto.',
    'permission-denied': 'Você não tem permissão para fazer isso.',
    'edx/no-profile': 'Esta conta ainda não está ligada a uma empresa. Use Criar conta para cadastrar a empresa ou entrar com um convite.',
    'edx/blocked': 'Seu acesso foi bloqueado por quem administra o CRM da sua empresa.',
    'edx/invalid-invite': 'Código de convite inválido ou desativado. Confira com quem administra o CRM da sua empresa.',
    'edx/team-full': 'A equipe desta empresa já está completa no plano atual. Fale com quem administra o CRM da sua empresa.',
    'edx/account-exists': 'Este e-mail já tem uma conta ligada a uma empresa. Use a aba Entrar.',
    'edx/not-owner': 'Só quem criou a empresa pode excluí-la.'
  };
  return messages[code] || (err && err.message) || 'Não foi possível concluir. Tente de novo.';
}
