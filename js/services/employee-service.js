/**
 * EDX Digital - Employee & Credential Management Service
 * Governança, RBAC e Tríade CID (Confidencialidade, Integridade, Disponibilidade)
 */

import { crmStore } from '../core/crm-store.js';
import { getCurrentUser, getCurrentRole, isCloudSession, USER_ROLES } from './auth-service.js';
import { getFirebase, createAccountForSomeoneElse, describeAuthError } from './firebase-app.js';

const EMPLOYEES_STORAGE_KEY = 'edx_employees_db';

// Listeners for reactive updates
const employeeListeners = [];

/**
 * Validador Oficial de CPF Brasileiro (Módulo 11)
 * @param {string} cpf 
 * @returns {boolean}
 */
export function validateCPF(cpf) {
  if (!cpf) return false;
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;

  // Rejeita padrões conhecidos com todos os dígitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Validação do 1º dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9), 10)) return false;

  // Validação do 2º dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

/**
 * Formata CPF para o padrão 000.000.000-00
 * @param {string} value 
 * @returns {string}
 */
export function formatCPF(value) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

/**
 * Mascara CPF para conformidade com a LGPD e privacidade visual (123.***.***-01)
 * @param {string} cpf 
 * @returns {string}
 */
export function maskCPF(cpf) {
  if (!cpf) return '';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return cpf;
  return `${clean.slice(0, 3)}.***.***-${clean.slice(9, 11)}`;
}

/**
 * Gera uma senha temporária aleatória de 12 caracteres (sem letras e números que se confundem)
 */
export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

/**
 * Colaboradores de exemplo (só aparecem na demonstração)
 */
const DEMO_EMPLOYEES = [
  {
    id: 'employee-user-02',
    name: 'Lucas Mendes',
    cpf: '123.456.789-01',
    email: 'lucas.vendas@example.com',
    phone: '(11) 98765-4321',
    role: USER_ROLES.EMPLOYEE,
    jobTitle: 'Consultor comercial',
    department: 'Comercial B2B',
    requirePasswordChange: false,
    status: 'active',
    createdAt: '2026-01-15T09:00:00.000Z'
  },
  {
    id: 'employee-user-03',
    name: 'Mariana Costa',
    cpf: '987.654.321-09',
    email: 'mariana.vendas@example.com',
    phone: '(21) 99887-1122',
    role: USER_ROLES.EMPLOYEE,
    jobTitle: 'Gerente de contas',
    department: 'Key Accounts (Grandes Contas)',
    requirePasswordChange: true,
    status: 'active',
    createdAt: '2026-02-10T11:20:00.000Z'
  }
];

// In-memory list. In a real account it mirrors the company's people in the cloud;
// in the demo it mirrors localStorage.
let employeesCache = [];
let cacheSource = null; // 'cloud' | 'demo' | null
let cloudProfiles = [];
let cloudPrivate = {};
let unsubscribeProfiles = null;
let unsubscribePrivate = null;

/**
 * Starts (or restarts) the team list for the current session
 */
export async function startEmployeeSync() {
  stopEmployeeSync();

  if (!isCloudSession()) {
    cacheSource = null;
    employeesCache = [];
    notifyEmployeeListeners();
    return;
  }

  const user = getCurrentUser();
  const { db, fsMod } = await getFirebase();
  cacheSource = 'cloud';
  cloudProfiles = [];
  cloudPrivate = {};

  const rebuild = () => {
    employeesCache = cloudProfiles
      .filter(p => p.id !== user.uid)
      .map(p => ({
        ...p,
        cpf: cloudPrivate[p.id]?.cpf || '',
        phone: cloudPrivate[p.id]?.phone || '',
        requirePasswordChange: !!p.mustChangePassword
      }))
      .sort((x, y) => (x.name || '').localeCompare(y.name || ''));
    notifyEmployeeListeners();
  };

  unsubscribeProfiles = fsMod.onSnapshot(
    fsMod.query(fsMod.collection(db, 'users'), fsMod.where('orgId', '==', user.orgId)),
    (snap) => {
      cloudProfiles = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      rebuild();
    },
    (err) => console.warn('Team list error:', err)
  );

  // CPF and phone are kept apart from the profile and only administrators can read them
  if (getCurrentRole() === USER_ROLES.ADMIN) {
    unsubscribePrivate = fsMod.onSnapshot(
      fsMod.query(fsMod.collection(db, 'user_private'), fsMod.where('orgId', '==', user.orgId)),
      (snap) => {
        cloudPrivate = {};
        snap.docs.forEach(d => { cloudPrivate[d.id] = d.data(); });
        rebuild();
      },
      (err) => console.warn('Team private data error:', err)
    );
  }
}

export function stopEmployeeSync() {
  if (unsubscribeProfiles) unsubscribeProfiles();
  if (unsubscribePrivate) unsubscribePrivate();
  unsubscribeProfiles = null;
  unsubscribePrivate = null;
  cloudProfiles = [];
  cloudPrivate = {};
  if (cacheSource === 'cloud') {
    employeesCache = [];
    cacheSource = null;
  }
}

/**
 * Lista de colaboradores da sessão atual
 */
export function getEmployees() {
  if (isCloudSession()) {
    return [...employeesCache];
  }
  if (cacheSource !== 'demo') {
    cacheSource = 'demo';
    try {
      const saved = localStorage.getItem(EMPLOYEES_STORAGE_KEY);
      employeesCache = saved ? JSON.parse(saved) : [...DEMO_EMPLOYEES];
    } catch (e) {
      console.warn("Erro ao carregar colaboradores do storage:", e);
      employeesCache = [...DEMO_EMPLOYEES];
    }
    // Senhas nunca ficam guardadas no navegador (versões antigas guardavam)
    employeesCache.forEach(e => { delete e.tempPassword; delete e.permanentPassword; });
    saveEmployeesToLocal();
  }
  return [...employeesCache];
}

function saveEmployeesToLocal() {
  if (cacheSource !== 'demo') return;
  try {
    localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employeesCache));
  } catch (e) {
    console.error("Falha ao salvar colaboradores localmente:", e);
  }
}

function requireAdmin(action) {
  if (getCurrentRole() !== USER_ROLES.ADMIN) {
    return { success: false, error: `Apenas administradores podem ${action}.` };
  }
  return null;
}

/**
 * Cadastra um novo colaborador ou atualiza um existente.
 * Numa conta real, o cadastro cria o login da pessoa com a senha temporária informada.
 * @returns {Promise<Object>} { success, employee?, tempPassword?, error? }
 */
export async function saveEmployee(data) {
  const denied = requireAdmin('criar ou editar colaboradores');
  if (denied) return denied;

  const name = (data.name || '').trim();
  const rawCpf = (data.cpf || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  const role = data.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.EMPLOYEE;
  const jobTitle = (data.jobTitle || 'Consultor de vendas').trim();
  const department = (data.department || 'Comercial').trim();
  const phone = (data.phone || '').trim();
  const existingId = data.id || null;

  if (!name || name.length < 3) {
    return { success: false, error: 'O nome completo deve ter no mínimo 3 caracteres.' };
  }

  // O CPF é opcional; quando informado, precisa ser válido
  const cleanCpf = rawCpf.replace(/\D/g, '');
  if (cleanCpf && !validateCPF(cleanCpf)) {
    return { success: false, error: 'O CPF informado é inválido. Verifique os dígitos.' };
  }
  const formattedCpf = cleanCpf ? formatCPF(cleanCpf) : '';

  if (!email || !email.includes('@') || !email.includes('.')) {
    return { success: false, error: 'E-mail inválido.' };
  }

  const employees = getEmployees();
  const cpfConflict = cleanCpf && employees.find(e => e.id !== existingId && (e.cpf || '').replace(/\D/g, '') === cleanCpf);
  if (cpfConflict) {
    return { success: false, error: `Já existe um colaborador com o CPF ${formattedCpf} (${cpfConflict.name}).` };
  }
  const emailConflict = employees.find(e => e.id !== existingId && (e.email || '').toLowerCase() === email);
  if (emailConflict) {
    return { success: false, error: `Já existe um colaborador com o e-mail ${email} (${emailConflict.name}).` };
  }

  const requirePasswordChange = data.requirePasswordChange !== undefined ? !!data.requirePasswordChange : true;
  const now = new Date().toISOString();

  if (isCloudSession()) {
    return saveEmployeeToCloud({
      existingId, name, formattedCpf, email, phone, role, jobTitle, department,
      tempPassword: (data.tempPassword || '').trim(), requirePasswordChange, now
    });
  }

  // Demonstração: a lista fica só neste navegador e nenhum login é criado
  let employee;
  if (existingId) {
    const index = employees.findIndex(e => e.id === existingId);
    if (index === -1) return { success: false, error: 'Colaborador não encontrado.' };
    employee = { ...employees[index], name, cpf: formattedCpf, email, phone, role, jobTitle, department, updatedAt: now };
    employees[index] = employee;
    crmStore.addAuditLog('Colaborador atualizado', `Dados de "${name}" atualizados.`);
  } else {
    employee = {
      id: 'emp-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 4),
      name, cpf: formattedCpf, email, phone, role, jobTitle, department,
      requirePasswordChange, status: 'active', createdAt: now
    };
    employees.unshift(employee);
    crmStore.addAuditLog('Colaborador cadastrado', `Colaborador "${name}" (CPF ${maskCPF(formattedCpf)}) cadastrado.`);
  }

  employeesCache = employees;
  saveEmployeesToLocal();
  notifyEmployeeListeners();
  return { success: true, employee, demo: true };
}

async function saveEmployeeToCloud(input) {
  const { existingId, name, formattedCpf, email, phone, role, jobTitle, department, tempPassword, requirePasswordChange, now } = input;
  const admin = getCurrentUser();

  try {
    const { db, fsMod } = await getFirebase();

    if (existingId) {
      const current = employeesCache.find(e => e.id === existingId);
      if (!current) return { success: false, error: 'Colaborador não encontrado.' };
      if ((current.email || '').toLowerCase() !== email) {
        return { success: false, error: 'O e-mail é o login da pessoa e não pode ser trocado aqui. Exclua o cadastro e crie outro.' };
      }
      await fsMod.updateDoc(fsMod.doc(db, 'users', existingId), { name, role, jobTitle, department, updatedAt: now });
      await fsMod.setDoc(fsMod.doc(db, 'user_private', existingId), { orgId: admin.orgId, cpf: formattedCpf, phone, updatedAt: now });
      crmStore.addAuditLog('Colaborador atualizado', `Dados de "${name}" atualizados.`);
      return { success: true, employee: { ...current, name, role, jobTitle, department, cpf: formattedCpf, phone } };
    }

    if (!tempPassword || tempPassword.length < 8) {
      return { success: false, error: 'A senha temporária precisa ter pelo menos 8 caracteres.' };
    }

    const uid = await createAccountForSomeoneElse(email, tempPassword);
    const profile = {
      orgId: admin.orgId,
      role,
      name,
      email,
      jobTitle,
      department,
      status: 'active',
      mustChangePassword: requirePasswordChange,
      createdBy: admin.uid,
      createdAt: now
    };
    await fsMod.setDoc(fsMod.doc(db, 'users', uid), profile);
    await fsMod.setDoc(fsMod.doc(db, 'user_private', uid), { orgId: admin.orgId, cpf: formattedCpf, phone, updatedAt: now });

    crmStore.addAuditLog('Colaborador cadastrado', `Colaborador "${name}" (CPF ${maskCPF(formattedCpf)}) cadastrado com senha temporária.`);
    return {
      success: true,
      tempPassword,
      employee: { ...profile, id: uid, cpf: formattedCpf, phone, requirePasswordChange }
    };
  } catch (err) {
    return { success: false, error: describeAuthError(err) };
  }
}

/**
 * Redefinição de senha: numa conta real, a pessoa recebe um e-mail para escolher a nova senha.
 * Quem administra nunca vê nem define a senha de outra pessoa depois do cadastro.
 */
export async function resetEmployeePassword(employeeId) {
  const denied = requireAdmin('redefinir senhas');
  if (denied) return denied;

  const emp = getEmployees().find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  if (!isCloudSession()) {
    return { success: false, error: 'Na demonstração não há logins reais para redefinir.' };
  }

  try {
    const { auth, authMod } = await getFirebase();
    await authMod.sendPasswordResetEmail(auth, emp.email);
    crmStore.addAuditLog('Redefinição de senha enviada', `E-mail de nova senha enviado para "${emp.name}".`);
    return { success: true, employee: emp };
  } catch (err) {
    return { success: false, error: describeAuthError(err) };
  }
}

/**
 * Bloqueia ou libera o acesso de um colaborador
 */
export async function toggleEmployeeStatus(employeeId) {
  const denied = requireAdmin('bloquear ou liberar colaboradores');
  if (denied) return denied;

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  const status = emp.status === 'blocked' ? 'active' : 'blocked';
  const now = new Date().toISOString();

  if (isCloudSession()) {
    try {
      const { db, fsMod } = await getFirebase();
      await fsMod.updateDoc(fsMod.doc(db, 'users', employeeId), { status, updatedAt: now });
    } catch (err) {
      return { success: false, error: describeAuthError(err) };
    }
  } else {
    emp.status = status;
    emp.updatedAt = now;
    employeesCache = employees;
    saveEmployeesToLocal();
    notifyEmployeeListeners();
  }

  crmStore.addAuditLog(status === 'active' ? 'Acesso liberado' : 'Acesso bloqueado', `Acesso de "${emp.name}": ${status === 'active' ? 'liberado' : 'bloqueado'}.`);
  return { success: true, status, employee: { ...emp, status } };
}

/**
 * Remove um colaborador da empresa. A pessoa perde o acesso aos dados na hora.
 */
export async function deleteEmployee(employeeId) {
  const denied = requireAdmin('excluir colaboradores');
  if (denied) return denied;

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  if (isCloudSession()) {
    try {
      const { db, fsMod } = await getFirebase();
      await fsMod.deleteDoc(fsMod.doc(db, 'user_private', employeeId)).catch(() => {});
      await fsMod.deleteDoc(fsMod.doc(db, 'users', employeeId));
    } catch (err) {
      return { success: false, error: describeAuthError(err) };
    }
  } else {
    employeesCache = employees.filter(e => e.id !== employeeId);
    saveEmployeesToLocal();
    notifyEmployeeListeners();
  }

  crmStore.addAuditLog('Colaborador removido', `O cadastro de "${emp.name}" foi excluído.`);
  return { success: true };
}

/**
 * Mensagem com os dados de acesso, para enviar ao colaborador.
 * A senha temporária só existe no momento do cadastro; depois disso não é guardada em lugar nenhum.
 * @param {Object} employee
 * @param {string} [tempPassword]
 */
export function generateCredentialsShareText(employee, tempPassword = '') {
  const url = window.location.origin + window.location.pathname;
  const lines = [
    `Olá, ${employee.name}!`,
    '',
    'Seu acesso ao CRM da empresa foi criado.',
    '',
    `Endereço: ${url}`,
    `Login: ${employee.email}`
  ];
  if (tempPassword) {
    lines.push(`Senha temporária: ${tempPassword}`);
    lines.push('');
    lines.push('No primeiro acesso o sistema pede para você criar a sua senha pessoal.');
  } else {
    lines.push('');
    lines.push('Se não lembrar a senha, use "Esqueci minha senha" na tela de entrada.');
  }
  return lines.join('\n');
}

/**
 * Subscreve para atualizações na lista de funcionários
 */
export function onEmployeesChange(callback) {
  employeeListeners.push(callback);
  callback(getEmployees());
  return () => {
    const idx = employeeListeners.indexOf(callback);
    if (idx !== -1) employeeListeners.splice(idx, 1);
  };
}

function notifyEmployeeListeners() {
  const list = getEmployees();
  employeeListeners.forEach(cb => {
    try {
      cb(list);
    } catch (e) {
      console.error("Erro no listener de colaboradores:", e);
    }
  });
}
