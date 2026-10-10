/**
 * EDX Digital - Signing in, registering, the person's own account, signing out after a long idle time
 */

import { requestTourForNewAccount } from '../ui/tour.js';
import { passwordProblem } from '../core/attention.js';
import { getSavedOrganization } from '../core/config.js';
import { AUDIT_ACTIONS, logAudit } from '../services/audit-service.js';
import {
  changePassword,
  deleteCompany,
  deleteOwnAccount,
  getCurrentUser,
  isAdmin,
  isCloudSession,
  isCompanyOwner,
  isIdleTooLong,
  isSessionActive,
  joinCompany,
  loginAsDemoRole,
  logoutToPortal,
  markActivity,
  registerCompany,
  setEmailDigest,
  resendEmailVerification,
  sendPasswordReset,
  signIn,
  updateOwnName,
  USER_ROLES
} from '../services/auth-service.js';
import { describeAuthError } from '../services/firebase-app.js';
import { showToast } from '../ui/ui-renderer.js';
import { refreshPlanPill } from './plan.js';
import { clearCompanyDataFromBrowser, enterSession } from './session.js';

// ==========================================================================
// Account, data export and deletion
// ==========================================================================
export function setupAccountDialog() {
  const dialog = document.getElementById('account-dialog');
  const form = document.getElementById('form-account-delete');
  if (!dialog || !form) return;

  const close = () => { form.reset(); dialog.close(); };
  document.getElementById('btn-close-account-dialog')?.addEventListener('click', close);
  document.getElementById('btn-close-account-footer')?.addEventListener('click', close);

  // What has to be typed to confirm: the company name for the owner, the word EXCLUIR otherwise
  const confirmationPhrase = () => (isCompanyOwner() ? (getSavedOrganization().name || '').trim() : 'EXCLUIR');

  document.getElementById('btn-menu-account')?.addEventListener('click', () => {
    const toolsMenu = document.getElementById('header-tools-menu');
    if (toolsMenu) toolsMenu.style.display = 'none';

    const user = getCurrentUser();
    const org = getSavedOrganization();
    const cloud = isCloudSession();
    const owner = isCompanyOwner();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };

    set('account-summary', user ? `${user.name}, ${user.email}. ${isAdmin() ? 'Administrador' : 'Vendedor'} em ${org.name}.` : '');
    show('account-terms', cloud);
    show('account-profile-block', cloud);
    const digestBox = document.getElementById('account-email-digest');
    if (digestBox) digestBox.checked = !user || user.emailDigest !== false;
    const nameInput = document.getElementById('account-name');
    if (nameInput) nameInput.value = user ? user.name : '';
    document.getElementById('form-account-password')?.reset();
    show('account-export-block', isAdmin());
    show('account-delete-block', cloud);
    show('account-demo-note', !cloud);

    if (cloud) {
      set('account-delete-title', owner ? 'Excluir a empresa e todos os dados' : 'Excluir a minha conta');
      set('account-delete-text', owner
        ? 'Apaga para sempre todos os clientes, oportunidades, históricos, a equipe e a sua conta. Não dá para desfazer. Baixe os dados antes, se precisar deles.'
        : 'Apaga o seu acesso e os seus dados de cadastro. As oportunidades que você atendia continuam com a empresa. Não dá para desfazer.');
      set('account-delete-phrase-label', owner ? `Digite o nome da empresa: ${confirmationPhrase()}` : 'Digite EXCLUIR');
    }
    dialog.showModal();
  });

  document.getElementById('form-account-name')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = await updateOwnName(document.getElementById('account-name').value);
      const user = getCurrentUser();
      const summary = document.getElementById('account-summary');
      if (summary && user) summary.textContent = `${name}, ${user.email}. ${isAdmin() ? 'Administrador' : 'Vendedor'} em ${getSavedOrganization().name}.`;
      showToast('Nome atualizado.', 'success');
    } catch (err) {
      showToast(err.code ? describeAuthError(err) : err.message, 'error');
    }
  });

  document.getElementById('account-email-digest')?.addEventListener('change', async (e) => {
    const box = e.currentTarget;
    try {
      await setEmailDigest(box.checked);
      showToast(box.checked ? 'Você vai receber o resumo do dia por e-mail.' : 'Você não vai mais receber o resumo por e-mail.', 'success');
    } catch (err) {
      box.checked = !box.checked;
      showToast(err.code ? describeAuthError(err) : err.message, 'error');
    }
  });

  document.getElementById('form-account-password')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordForm = e.currentTarget;
    const current = document.getElementById('account-current-password').value;
    const next = document.getElementById('account-new-password').value;
    const weak = passwordProblem(next, { email: getCurrentUser()?.email, name: getCurrentUser()?.name });
    if (weak) {
      showToast(weak, 'error');
      return;
    }
    if (next === current) {
      showToast('A nova senha é igual à atual.', 'error');
      return;
    }
    try {
      await changePassword(current, next);
      passwordForm.reset();
      showToast('Senha trocada.', 'success');
    } catch (err) {
      const wrong = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code);
      showToast(wrong ? 'A senha atual não confere.' : describeAuthError(err), 'error');
    }
  });

  document.getElementById('btn-account-export')?.addEventListener('click', () => {
    if (typeof window.handleDownloadBackup === 'function') window.handleDownloadBackup();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('account-delete-password').value;
    const typed = document.getElementById('account-delete-phrase').value.trim();
    if (typed !== confirmationPhrase()) {
      showToast('O texto de confirmação não confere.', 'error');
      return;
    }

    const button = document.getElementById('btn-account-delete');
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      if (isCompanyOwner()) {
        await deleteCompany(password);
      } else {
        await deleteOwnAccount(password);
      }
      clearCompanyDataFromBrowser();
      close();
      await enterSession();
      showToast('Conta excluída. Os dados foram apagados.', 'info');
    } catch (err) {
      showToast(describeAuthError(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Excluir definitivamente';
    }
  });
}

// A signed-in account left untouched for hours is signed out, so an unattended
// computer does not keep the company's data open.
export function setupIdleSignOut() {
  let lastMark = 0;
  const onActivity = () => {
    const now = Date.now();
    if (now - lastMark > 60000) {
      lastMark = now;
      markActivity();
    }
  };
  ['click', 'keydown', 'pointerdown'].forEach(evt => document.addEventListener(evt, onActivity, { passive: true }));

  const check = async () => {
    if (!isCloudSession() || !isIdleTooLong()) return;
    await logoutToPortal();
    clearCompanyDataFromBrowser();
    await enterSession();
    showToast('Você ficou muito tempo sem usar o CRM e a sessão foi encerrada. Entre de novo.', 'info');
  };
  setInterval(check, 60000);
  setInterval(refreshPlanPill, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    check();
    refreshPlanPill();
  });
}

// ==========================================================================
// Lead Import Modal Events (Excel / CSV / Paste)
// ==========================================================================
// ==========================================================================
// Authentication & Registration Portal Events (Tríade CID & RBAC)
// ==========================================================================
export function setupAuthPortalEvents() {
  const portalScreen = document.getElementById('auth-portal-screen');
  const appContainer = document.getElementById('app-container');
  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const panelLogin = document.getElementById('auth-panel-login');
  const panelRegister = document.getElementById('auth-panel-register');
  const btnQuickAdmin = document.getElementById('btn-quick-login-admin');
  const btnQuickEmployee = document.getElementById('btn-quick-login-employee');
  const formLogin = document.getElementById('form-auth-login');
  const formRegister = document.getElementById('form-auth-register');

  window.showAuthPortal = function() {
    if (portalScreen) portalScreen.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
  };

  window.hideAuthPortal = function() {
    if (portalScreen) portalScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = '';
  };

  window.handleLogoutToPortal = async function() {
    const wasCloud = isCloudSession();
    await logAudit(AUDIT_ACTIONS.USER_LOGOUT, { reason: 'user_action' });
    await logoutToPortal();
    if (wasCloud) clearCompanyDataFromBrowser();
    await enterSession();
    showToast("Você saiu.", "info");
  };

  // Shows a busy label on a submit button and gives back a function that restores it
  const setBusy = (button, label) => {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
    return () => {
      button.disabled = false;
      button.innerHTML = original;
    };
  };

  const clearRegisterHash = () => {
    if (window.location.hash && (window.location.hash.includes('register') || window.location.hash.includes('checkout'))) {
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch {
        window.location.hash = '#pipeline';
      }
    }
  };

  // Tab switching
  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      if (panelLogin) panelLogin.style.display = 'block';
      if (panelRegister) panelRegister.style.display = 'none';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      if (panelLogin) panelLogin.style.display = 'none';
      if (panelRegister) panelRegister.style.display = 'block';
    });
  }

  // Sample data: nothing typed here reaches the cloud
  if (btnQuickAdmin) {
    btnQuickAdmin.addEventListener('click', async () => {
      loginAsDemoRole(USER_ROLES.ADMIN);
      await enterSession();
      showToast("Demonstração aberta como administrador. Os dados são de exemplo e ficam só neste navegador.", "info");
    });
  }

  if (btnQuickEmployee) {
    btnQuickEmployee.addEventListener('click', async () => {
      loginAsDemoRole(USER_ROLES.EMPLOYEE);
      await enterSession();
      showToast("Demonstração aberta como vendedor. Os dados são de exemplo e ficam só neste navegador.", "info");
    });
  }

  // Sign in
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-input-email').value.trim();
      const password = document.getElementById('login-input-password').value;

      if (!email || !password) {
        showToast("Informe o e-mail e a senha.", "error");
        return;
      }

      const restore = setBusy(formLogin.querySelector('button[type="submit"]'), 'Entrando...');
      try {
        const user = await signIn(email, password);
        formLogin.reset();
        await enterSession();
        showToast(`Olá, ${user.name}.`, "success");
      } catch (err) {
        showToast(describeAuthError(err), "error");
      } finally {
        restore();
      }
    });
  }

  // Forgotten password: the person gets an e-mail to choose a new one
  const btnForgot = document.getElementById('btn-forgot-password');
  if (btnForgot) {
    btnForgot.addEventListener('click', async () => {
      const email = document.getElementById('login-input-email').value.trim();
      if (!email || !email.includes('@')) {
        showToast("Digite o seu e-mail no campo acima e clique de novo.", "info");
        document.getElementById('login-input-email').focus();
        return;
      }
      try {
        await sendPasswordReset(email);
      } catch (err) {
        // Same answer whether or not the address has an account, so it cannot be used to probe for accounts
        if (err.code === 'auth/network-request-failed' || err.code === 'auth/too-many-requests') {
          showToast(describeAuthError(err), "error");
          return;
        }
      }
      showToast("Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.", "info");
    });
  }

  // Registration: own company vs joining with an invite
  const tabRegOwner = document.getElementById('tab-reg-type-owner');
  const tabRegEmployee = document.getElementById('tab-reg-type-employee');
  const regContainerOwner = document.getElementById('reg-container-owner');
  const regContainerEmployee = document.getElementById('reg-container-employee');

  if (tabRegOwner && tabRegEmployee) {
    tabRegOwner.addEventListener('click', () => {
      tabRegOwner.classList.add('active');
      tabRegEmployee.classList.remove('active');
      if (regContainerOwner) regContainerOwner.style.display = 'block';
      if (regContainerEmployee) regContainerEmployee.style.display = 'none';
    });

    tabRegEmployee.addEventListener('click', () => {
      tabRegEmployee.classList.add('active');
      tabRegOwner.classList.remove('active');
      if (regContainerOwner) regContainerOwner.style.display = 'none';
      if (regContainerEmployee) regContainerEmployee.style.display = 'block';
    });
  }

  // New company: whoever registers it is its first administrator
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-input-name').value.trim();
      const email = document.getElementById('reg-input-email').value.trim();
      const company = document.getElementById('reg-input-company').value.trim();
      const password = document.getElementById('reg-input-password').value;
      const plan = document.getElementById('reg-input-plan')?.value || 'pro';

      if (!name || !email || !company || !password) {
        showToast("Preencha todos os campos.", "error");
        return;
      }
      const weak = passwordProblem(password, { email, name });
      if (weak) {
        showToast(weak, "error");
        return;
      }

      const submitButton = document.getElementById('btn-submit-register');
      const verifyNote = document.getElementById('reg-verify-note');
      const restore = setBusy(submitButton, 'Criando a empresa...');
      let waitingForEmail = false;
      try {
        await registerCompany({ name, email, company, password, plan });
        if (verifyNote) verifyNote.hidden = true;
        // a new account is shown around on its first screen
        requestTourForNewAccount();
        formRegister.reset();
        clearRegisterHash();
        await enterSession();
        logAudit(AUDIT_ACTIONS.USER_REGISTERED, { role: 'admin', company, plan });
        showToast(`Empresa "${company}" criada. Você é o administrador.`, "success");
      } catch (err) {
        if (err.code === 'edx/verify-email') {
          // The form stays as it is: after confirming, the same button finishes the registration
          waitingForEmail = true;
          const alreadyAsked = verifyNote && !verifyNote.hidden;
          if (verifyNote) {
            document.getElementById('reg-verify-email').textContent = email;
            verifyNote.hidden = false;
          }
          showToast(alreadyAsked ? 'O e-mail ainda não foi confirmado. Clique no link da mensagem e tente de novo.' : 'Enviamos um e-mail de confirmação. Clique no link dele para continuar.', alreadyAsked ? 'warning' : 'info');
        } else {
          showToast(describeAuthError(err), "error");
        }
      } finally {
        restore();
        if (waitingForEmail && submitButton) submitButton.textContent = 'Já confirmei, criar empresa';
      }
    });

    document.getElementById('btn-resend-verification')?.addEventListener('click', async (e) => {
      const email = document.getElementById('reg-input-email').value.trim();
      const password = document.getElementById('reg-input-password').value;
      if (!email || !password) return;
      e.currentTarget.disabled = true;
      try {
        await resendEmailVerification(email, password);
        showToast('Mensagem enviada de novo. Confira também a caixa de spam.', 'success');
      } catch (err) {
        showToast(describeAuthError(err), 'error');
      } finally {
        const button = document.getElementById('btn-resend-verification');
        // the e-mail service refuses requests that come too close together
        setTimeout(() => { if (button) button.disabled = false; }, 30000);
      }
    });
  }

  // Joining a company with its invite code
  const formJoinTeam = document.getElementById('form-auth-join-team');
  if (formJoinTeam) {
    formJoinTeam.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inviteCode = document.getElementById('join-input-code')?.value?.trim().toUpperCase();
      const name = document.getElementById('join-input-name')?.value?.trim();
      const email = document.getElementById('join-input-email')?.value?.trim();
      const password = document.getElementById('join-input-password')?.value;

      if (!inviteCode || !name || !email || !password) {
        showToast("Preencha todos os campos.", "error");
        return;
      }
      const weak = passwordProblem(password, { email, name });
      if (weak) {
        showToast(weak, "error");
        return;
      }

      const restore = setBusy(document.getElementById('btn-submit-join-team'), 'Conferindo o convite...');
      try {
        await joinCompany({ inviteCode, name, email, password });
        requestTourForNewAccount();
        formJoinTeam.reset();
        clearRegisterHash();
        await enterSession();
        logAudit(AUDIT_ACTIONS.USER_REGISTERED, { role: 'employee', method: 'invite_code' });
        showToast(`Bem-vindo(a) à equipe, ${name}.`, "success");
      } catch (err) {
        showToast(describeAuthError(err), "error");
      } finally {
        restore();
      }
    });
  }

  // Deep link from the plans page (#register?plan=...)
  const handleAuthHashRouting = () => {
    const rawHash = window.location.hash || '';
    if (!(rawHash.includes('register') || rawHash.includes('checkout'))) return;
    if (isSessionActive()) return;

    window.showAuthPortal();
    if (tabRegister) tabRegister.click();

    const planMatch = rawHash.match(/plan=([a-zA-Z0-9_-]+)/);
    const planBadge = document.getElementById('auth-selected-plan-badge');
    const planLabel = document.getElementById('auth-plan-name-label');
    const planInput = document.getElementById('reg-input-plan');

    if (planMatch && planBadge && planLabel) {
      const planKey = planMatch[1].toLowerCase();
      const planNames = {
        starter: 'Starter (R$ 97/mês)',
        pro: 'Professional (R$ 197/mês)',
        enterprise: 'Enterprise (R$ 497/mês)'
      };
      planLabel.textContent = planNames[planKey] || planKey.toUpperCase();
      planBadge.style.display = 'block';
      if (planInput) planInput.value = planKey;
    }
  };
  window.handleAuthHashRouting = handleAuthHashRouting;
  window.addEventListener('hashchange', handleAuthHashRouting);
}
