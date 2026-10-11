/**
 * EDX Digital - The team: people and their access, the invite code, the activity history
 */

import { requestTourForNewAccount, startTourIfPending } from '../ui/tour.js';
import { passwordProblem } from '../core/attention.js';
import { crmStore } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import {
  AUDIT_ACTIONS,
  AUDIT_SEVERITY,
  exportAuditToCSV,
  formatAuditAction,
  getAuditLogs,
  getAuditStats,
  logAudit,
  onAuditLog
} from '../services/audit-service.js';
import {
  changeOwnPassword,
  getCurrentUser,
  isAdmin,
  isCloudSession,
  isDemoSession,
  isReadOnly,
  USER_ROLES
} from '../services/auth-service.js';
import { currentPlan, seatsRoom } from '../services/billing-service.js';
import {
  deleteEmployee,
  formatCPF,
  generateCredentialsShareText,
  generateTemporaryPassword,
  getEmployees,
  maskCPF,
  onEmployeesChange,
  recheckInviteWithSeats,
  resetEmployeePassword,
  saveEmployee,
  toggleEmployeeStatus,
  validateCPF
} from '../services/employee-service.js';
import { describeAuthError } from '../services/firebase-app.js';
import { localDateString } from '../services/reminder-service.js';
import {
  generateInviteShareText,
  getCompanyTeamInviteCode,
  inviteShareLinks,
  replaceCompanyTeamInviteCode
} from '../services/team-invite-service.js';
import { escapeHtml, renderSecurityView, showToast } from '../ui/ui-renderer.js';
import { reportError } from './shared.js';

// ==========================================================================
// Employee Management Events (Tríade CID / RBAC)
// ==========================================================================
export function setupEmployeeManagementEvents() {
  const dialog = document.getElementById('employee-dialog');
  const form = document.getElementById('employee-form');
  const inputName = document.getElementById('emp-input-name');
  const inputCpf = document.getElementById('emp-input-cpf');
  const inputEmail = document.getElementById('emp-input-email');
  const inputPhone = document.getElementById('emp-input-phone');
  const inputJob = document.getElementById('emp-input-job');
  const inputDept = document.getElementById('emp-input-department');
  const selectRole = document.getElementById('emp-select-role');
  const inputPassword = document.getElementById('emp-input-password');
  const checkRequire = document.getElementById('emp-check-require-change');
  const feedbackCpf = document.getElementById('cpf-validation-feedback');

  const btnClose = document.getElementById('btn-close-employee-dialog');
  const btnCancel = document.getElementById('btn-cancel-employee');
  const btnGenerate = document.getElementById('btn-generate-temp-password');
  const btnCopyField = document.getElementById('btn-copy-temp-password-field');

  // First Access Password Modal
  const firstAccessDialog = document.getElementById('first-access-password-dialog');
  const formFirstAccess = document.getElementById('form-first-access-password');
  const inputFirstAccessEmpId = document.getElementById('first-access-employee-id');
  const inputFirstAccessNew = document.getElementById('first-access-new-password');
  const inputFirstAccessConfirm = document.getElementById('first-access-confirm-password');

  // Open modal
  window.openEmployeeModal = function(empToEdit = null) {
    if (!dialog) return;
    form.reset();
    document.getElementById('employee-id').value = '';
    if (feedbackCpf) {
      feedbackCpf.textContent = '';
      feedbackCpf.className = 'field-feedback-badge';
    }

    if (empToEdit) {
      document.getElementById('employee-dialog-title').textContent = 'Editar Colaborador';
      document.getElementById('employee-id').value = empToEdit.id;
      inputName.value = empToEdit.name;
      inputCpf.value = empToEdit.cpf;
      inputEmail.value = empToEdit.email;
      inputPhone.value = empToEdit.phone || '';
      inputJob.value = empToEdit.jobTitle || '';
      inputDept.value = empToEdit.department || 'Comercial B2B';
      selectRole.value = empToEdit.role || USER_ROLES.EMPLOYEE;
      inputPassword.value = '';
      checkRequire.checked = !!empToEdit.requirePasswordChange;
    } else {
      document.getElementById('employee-dialog-title').textContent = 'Cadastrar Novo Colaborador';
      inputPassword.value = generateTemporaryPassword();
      checkRequire.checked = true;
    }

    // The temporary password only exists while a new account is being created
    const passwordBox = document.getElementById('emp-password-box');
    if (passwordBox) passwordBox.style.display = empToEdit ? 'none' : '';
    inputPassword.required = !empToEdit;
    inputEmail.readOnly = !!empToEdit && isCloudSession();

    dialog.showModal();
    setTimeout(() => inputName.focus(), 50);
  };

  if (dialog) {
    document.addEventListener('click', (e) => {
      if (e.target && (e.target.id === 'btn-open-employee-modal' || e.target.closest('#btn-open-employee-modal'))) {
        window.openEmployeeModal();
      }
    });

    if (btnClose) btnClose.addEventListener('click', () => dialog.close());
    if (btnCancel) btnCancel.addEventListener('click', () => dialog.close());

    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => {
        inputPassword.value = generateTemporaryPassword();
      });
    }

    if (btnCopyField) {
      btnCopyField.addEventListener('click', () => {
        if (!inputPassword.value) return;
        navigator.clipboard.writeText(inputPassword.value);
        showToast('Senha temporária copiada!', 'success');
      });
    }

    // Live CPF formatting and validation
    if (inputCpf) {
      inputCpf.addEventListener('input', () => {
        const raw = inputCpf.value;
        const formatted = formatCPF(raw);
        inputCpf.value = formatted;

        const clean = raw.replace(/\D/g, '');
        if (clean.length === 11) {
          const isValid = validateCPF(clean);
          if (isValid) {
            feedbackCpf.textContent = 'CPF válido';
            feedbackCpf.className = 'field-feedback-badge valid';
          } else {
            feedbackCpf.textContent = 'CPF inválido';
            feedbackCpf.className = 'field-feedback-badge invalid';
          }
        } else {
          feedbackCpf.textContent = '';
          feedbackCpf.className = 'field-feedback-badge';
        }
      });
    }

    // Submit form
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isEdit = !!document.getElementById('employee-id').value;
      const empData = {
        id: document.getElementById('employee-id').value || null,
        name: inputName.value.trim(),
        cpf: inputCpf.value.trim(),
        email: inputEmail.value.trim(),
        phone: inputPhone.value.trim(),
        jobTitle: inputJob.value.trim(),
        department: inputDept.value,
        role: selectRole.value,
        tempPassword: inputPassword.value.trim(),
        requirePasswordChange: checkRequire.checked
      };

      const btnSave = document.getElementById('btn-save-employee');
      const originalLabel = btnSave ? btnSave.textContent : '';
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.textContent = 'Salvando…';
      }

      const result = await saveEmployee(empData);

      if (btnSave) {
        btnSave.disabled = false;
        btnSave.textContent = originalLabel;
      }

      if (!result.success) {
        showToast(result.error, 'error');
        return;
      }

      dialog.close();
      logAudit(AUDIT_ACTIONS.EMPLOYEE_CREATED, {
        empId: result.employee.id,
        name: result.employee.name,
        role: result.employee.role,
        cpf: maskCPF(result.employee.cpf)
      });

      if (isEdit) {
        showToast(`Dados de ${result.employee.name} atualizados.`, 'success');
      } else if (result.demo) {
        showToast(`${result.employee.name} entrou na lista. Na demonstração nenhum login é criado.`, 'info');
      } else {
        // The only moment the temporary password is available: hand it over now
        showCredentialsDialog(result.employee, generateCredentialsShareText(result.employee, result.tempPassword));
      }
      renderSecurityView(crmStore.getState());
    });
  }

  // Shows the access details once, with a copy button
  function showCredentialsDialog(employee, shareText) {
    const credDialog = document.getElementById('credentials-dialog');
    const credText = document.getElementById('credentials-text');
    const credTitle = document.getElementById('credentials-title');
    if (!credDialog || !credText) {
      showToast(`Acesso de ${employee.name} criado.`, 'success');
      return;
    }
    if (credTitle) credTitle.textContent = `Acesso de ${employee.name} criado`;
    credText.value = shareText;
    credDialog.showModal();
  }

  const btnCopyCredentials = document.getElementById('btn-copy-credentials');
  if (btnCopyCredentials) {
    btnCopyCredentials.addEventListener('click', async () => {
      const credText = document.getElementById('credentials-text');
      try {
        await navigator.clipboard.writeText(credText.value);
        showToast('Copiado. Envie para a pessoa.', 'success');
      } catch {
        credText.select();
        showToast('Selecione o texto e copie com Ctrl+C.', 'info');
      }
    });
  }
  const btnCloseCredentials = document.getElementById('btn-close-credentials');
  if (btnCloseCredentials) {
    btnCloseCredentials.addEventListener('click', () => {
      document.getElementById('credentials-text').value = '';
      document.getElementById('credentials-dialog').close();
    });
  }

  // First access: the person replaces the temporary password with their own
  if (formFirstAccess) {
    formFirstAccess.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = inputFirstAccessNew.value;
      const confirmPass = inputFirstAccessConfirm.value;

      const weak = passwordProblem(newPass, { email: getCurrentUser()?.email, name: getCurrentUser()?.name });
      if (weak) {
        showToast(weak, 'error');
        return;
      }
      if (newPass !== confirmPass) {
        showToast('As duas senhas não são iguais.', 'error');
        return;
      }

      try {
        await changeOwnPassword(newPass);
        formFirstAccess.reset();
        if (firstAccessDialog) firstAccessDialog.close();
        showToast('Senha pessoal criada.', 'success');
        // it is this person's first time in the system
        requestTourForNewAccount();
        startTourIfPending();
      } catch (err) {
        showToast(describeAuthError(err), 'error');
      }
    });

    // The dialog cannot be dismissed with Esc: the temporary password must be replaced
    if (firstAccessDialog) {
      firstAccessDialog.addEventListener('cancel', (e) => e.preventDefault());
    }
  }

  // Reactive updates on employee list
  onEmployeesChange(() => {
    if (crmStore) {
      renderSecurityView(crmStore.getState());
      crmStore.emitChange();
    }
  });

  // Global Handlers for table buttons
  window.handleToggleCPFVisibility = function(empId) {
    const textSpan = document.getElementById(`cpf-text-${empId}`);
    if (!textSpan) return;
    const isMasked = textSpan.textContent.includes('*');
    textSpan.textContent = isMasked ? textSpan.dataset.raw : textSpan.dataset.masked;
  };

  window.handleEditEmployee = function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (emp) window.openEmployeeModal(emp);
  };

  window.handleResetEmployeePassword = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    if (!confirm(`Enviar para ${emp.email} um e-mail para criar uma nova senha?`)) {
      return;
    }

    const res = await resetEmployeePassword(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_PASSWORD_RESET, { empId, name: emp.name }, AUDIT_SEVERITY.WARNING);
    showToast(`E-mail de nova senha enviado para ${emp.email}.`, 'success');
  };

  window.handleToggleEmployeeStatus = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    const action = emp.status === 'active' ? 'bloquear' : 'liberar';
    if (!confirm(`Deseja ${action} o acesso de ${emp.name}?`)) {
      return;
    }

    const res = await toggleEmployeeStatus(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_STATUS_CHANGED, { empId, name: emp.name, status: res.status }, AUDIT_SEVERITY.WARNING);
    const rotated = res.status === 'blocked' && await retireInviteCode();
    showToast(res.status === 'active'
      ? `Acesso de ${emp.name} liberado.`
      : `Acesso de ${emp.name} bloqueado.${rotated ? ' O código de convite foi trocado, porque essa pessoa conhecia o antigo.' : ''}`, 'info');
    renderSecurityView(crmStore.getState());
  };

  // Whoever leaves knew the invite code and could come back with it: a new one is issued
  async function retireInviteCode() {
    if (!isCloudSession()) return false;
    const result = await replaceCompanyTeamInviteCode();
    if (!result.success) return false;
    recheckInviteWithSeats();
    logAudit(AUDIT_ACTIONS.TEAM_INVITE_REPLACED, { reason: 'saída de pessoa da equipe' });
    if (typeof window.refreshTeamInviteCard === 'function') window.refreshTeamInviteCard();
    return true;
  }

  const myself = () => {
    const me = getCurrentUser();
    return { id: me.uid || 'admin-user-01', name: me.name, email: me.email };
  };
  const openLeadsOf = (personId) => storage.getCustomers().filter(c => c.assignedTo?.id === personId && c.stage !== 'won' && c.stage !== 'lost').length;

  const reassignDialog = document.getElementById('reassign-dialog');
  let reassignFrom = null;
  window.handleReassignLeads = function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    const count = openLeadsOf(empId);
    if (!emp || !reassignDialog || count === 0) return;
    reassignFrom = emp;
    document.getElementById('reassign-text').textContent = `${emp.name} tem ${count === 1 ? '1 oportunidade em aberto' : `${count} oportunidades em aberto`}. As ganhas e as perdidas continuam no nome dessa pessoa, para o histórico.`;
    const targets = [myself(), ...getEmployees().filter(e => e.id !== empId && e.status !== 'blocked')];
    document.getElementById('reassign-target').innerHTML = targets.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    reassignDialog.showModal();
  };
  const closeReassign = () => reassignDialog?.close();
  document.getElementById('btn-close-reassign-dialog')?.addEventListener('click', closeReassign);
  document.getElementById('btn-cancel-reassign')?.addEventListener('click', closeReassign);
  document.getElementById('reassign-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!reassignFrom) return;
    const targetId = document.getElementById('reassign-target').value;
    const target = [myself(), ...getEmployees()].find(t => t.id === targetId);
    if (!target) return;
    try {
      const moved = await storage.reassignCustomers(reassignFrom.id, { id: target.id, name: target.name, email: target.email });
      logAudit(AUDIT_ACTIONS.LEADS_REASSIGNED, { de: reassignFrom.name, para: target.name, quantidade: moved }, AUDIT_SEVERITY.WARNING);
      closeReassign();
      showToast(`${moved === 1 ? '1 oportunidade transferida' : `${moved} oportunidades transferidas`} para ${target.name}.`, 'success');
    } catch (err) {
      reportError('Não foi possível transferir', err);
    }
  });

  window.handleDeleteEmployee = async function(empId) {
    const emp = getEmployees().find(e => e.id === empId);
    if (!emp) return;

    const open = openLeadsOf(empId);
    const portfolio = open === 0 ? '' : ` ${open === 1 ? 'A oportunidade em aberto dela passa' : `As ${open} oportunidades em aberto dela passam`} para você.`;
    if (!confirm(`Excluir o cadastro de ${emp.name}? A pessoa perde o acesso aos dados da empresa.${portfolio}`)) {
      return;
    }

    // The portfolio is handed over first: once the person is gone nobody would be looking after it
    if (open > 0 && !isReadOnly()) {
      try {
        await storage.reassignCustomers(empId, myself());
        logAudit(AUDIT_ACTIONS.LEADS_REASSIGNED, { de: emp.name, para: getCurrentUser().name, quantidade: open }, AUDIT_SEVERITY.WARNING);
      } catch (err) {
        reportError('Não foi possível transferir a carteira', err);
        return;
      }
    }

    const res = await deleteEmployee(empId);
    if (!res.success) {
      showToast(res.error, 'error');
      return;
    }

    logAudit(AUDIT_ACTIONS.EMPLOYEE_DELETED, { empId, name: emp.name }, AUDIT_SEVERITY.CRITICAL);
    const rotated = await retireInviteCode();
    showToast(`Cadastro de ${emp.name} excluído.${rotated ? ' O código de convite foi trocado, porque essa pessoa conhecia o antigo.' : ''}`, 'info');
    renderSecurityView(crmStore.getState());
  };
}

// ==========================================================================
// Checkout & Payment Gateway Events (PIX Instantâneo & Cartão de Crédito)
// ==========================================================================
// ==========================================================================
// Team Invite System Events
// ==========================================================================
export function setupTeamInviteEvents() {
  const displayTeamCode = document.getElementById('display-team-invite-code');
  const btnCopyTeamCode = document.getElementById('btn-copy-team-code');
  const btnNewTeamCode = document.getElementById('btn-new-team-code');

  function renderTeamView() {
    const employees = getEmployees();
    const statMembers = document.getElementById('stat-total-members');
    const statAdmin = document.getElementById('stat-admin-count');
    const statBlocked = document.getElementById('stat-blocked-members');

    // +1: the signed-in administrator is not in the list
    if (statMembers) statMembers.textContent = employees.filter(e => e.status !== 'blocked').length + 1;
    if (statAdmin) statAdmin.textContent = employees.filter(e => e.role === 'admin').length + 1;
    if (statBlocked) statBlocked.textContent = employees.filter(e => e.status === 'blocked').length;

    const seats = seatsRoom(employees);
    const full = isCloudSession() && seats.left <= 0;
    const seatsNote = document.getElementById('team-seats-note');
    if (seatsNote) {
      seatsNote.hidden = !isCloudSession() || seats.unlimited;
      seatsNote.textContent = full
        ? `A equipe está completa: o plano ${currentPlan().name} comporta ${seats.limit} pessoas com acesso. O convite fica pausado até abrir uma vaga ou você mudar de plano.`
        : `${seats.used} de ${seats.limit} pessoas com acesso no plano ${currentPlan().name}.`;
      seatsNote.classList.toggle('is-warning', full);
    }
    if (displayTeamCode) displayTeamCode.textContent = full ? 'pausado' : (getCompanyTeamInviteCode() || 'sem código');
    if (btnCopyTeamCode) btnCopyTeamCode.disabled = full;
    // the same invite, already written in the person's e-mail program or WhatsApp
    const code = getCompanyTeamInviteCode();
    const canShare = !!code && !full && !isDemoSession();
    const links = canShare ? inviteShareLinks(code) : null;
    for (const [id, href] of [['link-invite-email', links && links.email], ['link-invite-whatsapp', links && links.whatsapp]]) {
      const link = document.getElementById(id);
      if (!link) continue;
      link.hidden = !canShare;
      link.href = href || '#';
    }
    if (btnNewTeamCode) btnNewTeamCode.style.display = isCloudSession() ? '' : 'none';
  }
  window.refreshTeamInviteCard = renderTeamView;

  if (btnCopyTeamCode) {
    btnCopyTeamCode.addEventListener('click', () => {
      const code = getCompanyTeamInviteCode();
      if (!code) return;
      if (isDemoSession()) {
        showToast('Na demonstração o código é só um exemplo. Numa conta real, ele deixa sua equipe criar o próprio acesso.', 'info');
        return;
      }
      navigator.clipboard.writeText(generateInviteShareText(code)).then(() => {
        showToast('Convite copiado. Envie para quem deve entrar na equipe.', 'success');
      }).catch(() => {
        showToast(`Código da equipe: ${code}`, 'info');
      });
    });
  }

  if (btnNewTeamCode) {
    btnNewTeamCode.addEventListener('click', async () => {
      if (!confirm('Gerar um novo código? O código atual para de funcionar na hora. Quem já entrou na equipe não é afetado.')) return;
      const result = await replaceCompanyTeamInviteCode();
      if (!result.success) {
        showToast(result.error, 'error');
        return;
      }
      recheckInviteWithSeats();
      renderTeamView();
      showToast('Novo código gerado. O anterior não vale mais.', 'success');
    });
  }

  renderTeamView();
  onEmployeesChange(renderTeamView);
}

// ==========================================================================
// Audit Trail View & Rendering
// ==========================================================================
// Who did it comes from the team list (by account id); the name stored with the record is only a fallback,
// because that one is written by whoever made the record
function auditAuthor(log) {
  const me = getCurrentUser();
  if (me && log.userId === me.uid) return me.name;
  const colleague = getEmployees().find(e => e.id === log.userId);
  return colleague ? colleague.name : (log.userName || 'Pessoa removida');
}

export function setupAuditTrailView() {
  function renderAuditView() {
    const stats = getAuditStats();
    const logs = getAuditLogs(150);

    const statTotal = document.getElementById('audit-stat-total');
    const statToday = document.getElementById('audit-stat-today');
    const statWarnings = document.getElementById('audit-stat-warnings');

    if (statTotal) statTotal.textContent = stats.totalLogs;
    if (statToday) statToday.textContent = stats.todayLogs;
    if (statWarnings) statWarnings.textContent = (stats.warningCount || 0) + (stats.criticalCount || 0);

    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Nada registrado ainda.</td></tr>`;
      return;
    }

    // Internal field names are turned into words; technical fields are left out
    const detailLabels = {
      name: 'nome', company: 'empresa', dealValue: 'valor', stage: 'etapa', customerId: 'oportunidade',
      fromRole: 'de', toRole: 'para', role: 'perfil', status: 'situação', plan: 'plano', type: 'tipo',
      leadName: 'lead', source: 'origem', value: 'valor', empId: 'colaborador', cpf: 'CPF', reason: 'motivo'
    };
    const valueLabels = {
      blocked: 'bloqueado', active: 'liberado', admin: 'administrador', employee: 'vendedor',
      lead: 'novo lead', contact: 'primeiro contato', proposal: 'proposta', negotiation: 'negociação', won: 'ganho', lost: 'perdido',
      customers_csv: 'planilha de clientes', audit_csv: 'planilha do histórico', starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise'
    };
    // ids mean nothing to the reader; the names next to them already say which record it was
    const hiddenDetails = ['userAgent', 'screenSize', 'method', 'action', 'customerId', 'leadId', 'empId'];
    const methodLabels = {
      session_resume: 'sessão retomada', email_password: 'e-mail e senha', demo: 'demonstração',
      invite_code: 'código de convite', webhook_api: 'recebido por webhook'
    };

    tbody.innerHTML = logs.map(log => {
      const date = new Date(log.timestamp);
      const when = isNaN(date) ? 'sem data' : `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const details = log.details && typeof log.details === 'object' ? log.details : {};
      const parts = Object.entries(details)
        .filter(([k, v]) => !hiddenDetails.includes(k) && v !== undefined && v !== null && v !== '' && v !== 'user_action' && typeof v !== 'object')
        .map(([k, v]) => `${detailLabels[k] || k}: ${valueLabels[v] || v}`);
      if (details.method && methodLabels[details.method]) parts.unshift(methodLabels[details.method]);
      const needsAttention = log.severity === 'warning' || log.severity === 'critical';

      return `<tr>
        <td class="nowrap muted">${when}</td>
        <td>${escapeHtml(formatAuditAction(log.action).slice(0, 60))}${needsAttention ? ' <span class="status-text blocked">(atenção)</span>' : ''}</td>
        <td>${escapeHtml(auditAuthor(log))}<div class="cell-sub">${log.userRole === 'admin' ? 'Administrador' : 'Vendedor'}</div></td>
        <td class="muted">${escapeHtml(parts.join(', ').substring(0, 120))}</td>
      </tr>`;
    }).join('');
  }

  // Export audit CSV
  const btnExport = document.getElementById('btn-export-audit-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => window.handleExportAudit());
  }

  window.handleExportAudit = function() {
    if (!isAdmin()) return;
    if (getAuditLogs(1).length === 0) {
      showToast('Ainda não há nada no histórico para exportar.', 'info');
      return;
    }
    const blob = new Blob(['\ufeff' + exportAuditToCSV(auditAuthor)], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `edx-digital-historico-${localDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Histórico exportado.', 'success');
    logAudit(AUDIT_ACTIONS.DATA_EXPORTED, { type: 'audit_csv' });
  };

  // Subscribe to audit events for live rendering
  onAuditLog(() => renderAuditView());

  // Initial render
  renderAuditView();
}
