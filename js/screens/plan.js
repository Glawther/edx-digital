/**
 * EDX Digital - The plan: its state in the header, read-only mode, plans dialog and Pix checkout
 */

import { getPlanState, getSavedOrganization } from '../core/config.js';
import { crmStore } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, logAudit } from '../services/audit-service.js';
import { getIdToken, isAdmin, isCloudSession, isSessionActive, refreshOrganization } from '../services/auth-service.js';
import { currentPlan, describeLimit, leadsRoom, seatsRoom } from '../services/billing-service.js';
import { getEmployees } from '../services/employee-service.js';
import { formatBRL, showToast } from '../ui/ui-renderer.js';

// ==========================================================================
// Billing & Subscription Events
// ==========================================================================
export function setupBillingEvents() {
  const dialog = document.getElementById('billing-dialog');
  const btnOpen = document.getElementById('btn-menu-billing');
  const btnClose = document.getElementById('btn-close-billing-dialog');
  const btnCloseFooter = document.getElementById('btn-close-billing-dialog-footer');

  function refreshBillingData() {
    const org = getSavedOrganization();
    const planNames = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
    const plan = currentPlan(org);
    const planState = getPlanState(org);
    const onTrial = planState.status === 'trial' || planState.status === 'trial_ended';
    const limit = describeLimit;
    const leads = leadsRoom(storage.getCustomers(), org);
    const seats = seatsRoom(getEmployees(), org);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('billing-plan-name', planNames[org.plan] || 'Professional');
    set('billing-plan-badge', describePlanState(planState));

    set('billing-leads-count', `${leads.used.toLocaleString('pt-BR')} de ${limit(leads.limit)}`);
    set('billing-users-count', `${seats.used} de ${limit(seats.limit)}`);

    // During the trial every plan can still be subscribed to, including the current one
    document.querySelectorAll('.btn-plan-select').forEach(btn => {
      const isCurrent = btn.dataset.plan === org.plan;
      const renew = isCurrent && !onTrial;
      btn.disabled = false;
      btn.textContent = renew ? `Renovar ${planNames[btn.dataset.plan]}` : `Assinar ${planNames[btn.dataset.plan] || btn.dataset.plan}`;
    });
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';
      refreshBillingData();
      dialog.showModal();
    });
  }

  if (btnClose) btnClose.addEventListener('click', () => dialog?.close());
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => dialog?.close());

  // Plan selection buttons -> opens checkout modal
  document.querySelectorAll('.btn-plan-select').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan;
      if (!plan) return;
      if (window.openCheckout) {
        window.openCheckout(plan);
      }
    });
  });
}

// ==========================================================================
// Commercial Subscription & 1-Click PIX Checkout Engine
// ==========================================================================
// Plain words for where the plan stands
function describePlanState(state) {
  const days = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
  const date = (iso) => new Date(iso).toLocaleDateString('pt-BR');
  if (state.status === 'trial') return `Período de teste: ${days(state.daysLeft)} restantes`;
  if (state.status === 'trial_ended') return 'Período de teste encerrado';
  if (state.status === 'active') return `Ativo até ${date(state.until)}`;
  if (state.status === 'grace') return `Vencido em ${date(state.until)}`;
  return `Vencido em ${date(state.until)}, em modo de leitura`;
}

/**
 * Everything on screen that depends on where the plan stands: the pill in the header,
 * the notice above the content and the read-only mode.
 */
export function refreshPlanPill() {
  const state = getPlanState();
  const cloud = isCloudSession();
  const admin = isAdmin();
  const days = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

  // Read-only mode: creating and changing are switched off across the app
  document.body.classList.toggle('is-read-only', cloud && state.readOnly);

  const pill = document.getElementById('trial-header-pill');
  const pillText = document.getElementById('trial-pill-text');
  if (pill && pillText) {
    let label = '';
    if (state.status === 'trial') label = `Teste: ${days(state.daysLeft)} restantes`;
    else if (state.status === 'active' && state.daysLeft <= 5) label = `Plano vence em ${days(state.daysLeft)}`;
    pillText.textContent = label;
    pill.style.display = label && admin ? '' : 'none';
  }

  const banner = document.getElementById('plan-banner');
  const bannerText = document.getElementById('plan-banner-text');
  const bannerAction = document.getElementById('plan-banner-action');
  if (!banner || !bannerText || !bannerAction) return;

  let text = '';
  let action = '';
  if (cloud && state.status === 'trial_ended') {
    text = 'O período de teste terminou. Você continua vendo e exportando seus dados, mas não é possível criar nem alterar nada.';
    action = 'Assinar um plano';
  } else if (cloud && state.status === 'expired') {
    text = `O plano venceu em ${new Date(state.until).toLocaleDateString('pt-BR')}. Você continua vendo e exportando seus dados, mas não é possível criar nem alterar nada.`;
    action = 'Renovar o plano';
  } else if (cloud && state.status === 'grace') {
    text = `O plano venceu em ${new Date(state.until).toLocaleDateString('pt-BR')}. Renove em até ${days(state.daysLeft)} para o CRM não entrar em modo de leitura.`;
    action = 'Renovar o plano';
  }

  banner.hidden = !text;
  banner.classList.toggle('is-blocking', state.readOnly === true);
  bannerText.textContent = text && !admin ? `${text} Fale com quem administra o CRM da sua empresa.` : text;
  bannerAction.textContent = action;
  bannerAction.style.display = admin ? '' : 'none';
}

window.refreshPlanPill = refreshPlanPill;

// Called by the storage layer when something tries to change data in read-only mode
let lastReadOnlyNotice = 0;

window.handleReadOnlyAttempt = function() {
  refreshPlanPill();
  const banner = document.getElementById('plan-banner');
  if (banner && !banner.hidden) banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (Date.now() - lastReadOnlyNotice < 4000) return;
  lastReadOnlyNotice = Date.now();
  showToast(
    isAdmin() ? 'O CRM está em modo de leitura. Assine um plano para voltar a criar e alterar.' : 'O CRM está em modo de leitura. Fale com quem administra o CRM da sua empresa.',
    'warning',
    isAdmin() ? { label: 'Ver planos', onClick: () => window.openCheckoutModal() } : null
  );
};

// ==========================================================================
// Subscribing: a PIX charge is created on the billing server, and this window
// watches until the payment is confirmed. The plan is released by the server.
// ==========================================================================
export function setupCheckoutModalEvents() {
  const modal = document.getElementById('modal-checkout');
  if (!modal) return;

  const el = (id) => document.getElementById(id);
  const planNames = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };
  let activePlan = 'pro';
  let activePaymentId = null;
  let pollTimer = null;
  let requestSeq = 0;

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  // One of: a message (loading, demo, error), the PIX code, or the confirmation
  const show = (state, text = '', canRetry = false) => {
    el('chk-state-message').hidden = state !== 'message';
    el('chk-state-ready').hidden = state !== 'ready';
    el('chk-state-approved').hidden = state !== 'approved';
    if (state === 'message') {
      el('chk-state-text').textContent = text;
      el('chk-retry').hidden = !canRetry;
    }
  };

  const renderCurrentPlan = () => {
    const org = getSavedOrganization();
    el('chk-current-plan-badge').textContent = planNames[org.plan] || 'Professional';
    el('chk-trial-days-badge').textContent = describePlanState(getPlanState(org));
  };

  const api = async (path, options = {}) => {
    const token = await getIdToken();
    const res = await fetch(`${window.getApiBaseUrl()}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Não foi possível concluir.');
      err.code = data.error;
      throw err;
    }
    return data;
  };

  const onApproved = async (result) => {
    stopPolling();
    activePaymentId = null;
    await refreshOrganization().catch(() => {});
    renderCurrentPlan();
    refreshPlanPill();
    const until = result.paidUntil ? new Date(result.paidUntil).toLocaleDateString('pt-BR') : '';
    el('chk-approved-text').textContent = `O plano ${planNames[result.plan] || ''} está ativo${until ? ` até ${until}` : ''}.`;
    show('approved');
    logAudit(AUDIT_ACTIONS.PLAN_CHANGED, { plan: result.plan });
    showToast('Pagamento confirmado. Plano liberado.', 'success');
    if (crmStore) crmStore.emitChange();
  };

  const checkPayment = async () => {
    if (!activePaymentId) return;
    try {
      const result = await api(`/api/billing/pix/${activePaymentId}`);
      if (result.status === 'approved') {
        await onApproved(result);
      } else if (result.status !== 'pending') {
        stopPolling();
        show('message', 'Esta cobrança foi cancelada ou venceu. Gere outra para pagar.', true);
      }
    } catch {
      // A failed check is not a failed payment: keep waiting
    }
  };

  const loadCharge = async (plan) => {
    activePlan = plan;
    stopPolling();
    activePaymentId = null;
    const seq = ++requestSeq;

    if (!isCloudSession()) {
      show('message', 'Na demonstração não há cobrança. Crie uma conta para assinar um plano.');
      return;
    }
    if (!isAdmin()) {
      show('message', 'Só quem administra a empresa pode assinar um plano.');
      return;
    }

    // The billing server may be asleep; the first answer can take a while
    show('message', 'Gerando o PIX. Isso pode levar até um minuto.');
    try {
      const charge = await api('/api/billing/pix', { method: 'POST', body: JSON.stringify({ plan }) });
      if (seq !== requestSeq) return; // another plan was chosen meanwhile
      activePaymentId = charge.paymentId;
      el('chk-pix-copypaste-input').value = charge.copyPaste;
      el('chk-pix-qrcode-img').src = charge.qrCodeBase64 ? `data:image/png;base64,${charge.qrCodeBase64}` : '';
      el('chk-pix-qrcode-img').closest('.pix-qr').style.display = charge.qrCodeBase64 ? '' : 'none';
      el('chk-pix-amount').textContent = formatBRL(charge.amount);
      show('ready');
      pollTimer = setInterval(checkPayment, 5000);
    } catch (err) {
      if (seq !== requestSeq) return;
      if (err.code === 'billing_not_configured') {
        show('message', 'A cobrança automática ainda não está disponível. Fale com o suporte para assinar.');
      } else {
        show('message', err.message || 'Não foi possível gerar o PIX. Tente de novo.', true);
      }
    }
  };

  window.selectCheckoutPlan = function(plan) {
    document.querySelectorAll('.checkout-plan-card').forEach(card => {
      card.classList.toggle('active', card.dataset.plan === plan);
    });
    loadCharge(plan);
  };

  window.openCheckoutModal = function(plan) {
    if (!isSessionActive()) return;
    const org = getSavedOrganization();
    renderCurrentPlan();
    if (!modal.open) modal.showModal();
    window.selectCheckoutPlan(planNames[plan] ? plan : (planNames[org.plan] ? org.plan : 'pro'));
  };

  // One way to subscribe: plan buttons and links from the plans page all land here
  window.openCheckout = function(plan = 'pro') {
    const billingDialog = document.getElementById('billing-dialog');
    if (billingDialog && billingDialog.open) billingDialog.close();
    window.openCheckoutModal(plan);
  };

  const close = () => {
    stopPolling();
    requestSeq += 1;
    if (modal.open) modal.close();
  };
  el('btn-close-checkout-modal')?.addEventListener('click', close);
  el('btn-close-checkout-footer')?.addEventListener('click', close);
  modal.addEventListener('close', stopPolling);
  el('chk-retry')?.addEventListener('click', () => loadCharge(activePlan));

  el('btn-copy-pix-code')?.addEventListener('click', async () => {
    const input = el('chk-pix-copypaste-input');
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('Código PIX copiado. Cole no aplicativo do seu banco.', 'success');
    } catch {
      input.select();
      showToast('Selecione o código e copie com Ctrl+C.', 'info');
    }
  });

  // Coming back to the tab after paying in the bank app: check right away
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activePaymentId) checkPayment();
  });

  refreshPlanPill();
}
