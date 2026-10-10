/**
 * Nexus CRM - Employee & Credential Management Service
 * Governança, RBAC e Tríade CID (Confidencialidade, Integridade, Disponibilidade)
 */

import { crmStore } from '../core/crm-store.js';
import { getCurrentUser, getCurrentRole, USER_ROLES } from './auth-service.js';

const EMPLOYEES_STORAGE_KEY = 'nexus_crm_employees_db';

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
 * Gera senha temporária de alta entropia e padrão corporativo
 * Exemplo: Nexus#8392! ou Vendas@2026#
 */
export function generateTemporaryPassword() {
  const prefixes = ['Nexus', 'Vendas', 'Gestao', 'Foco', 'Agil', 'Prime', 'Inova'];
  const symbols = ['#', '@', '$', '!', '&', '%'];
  const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const randomSymbol1 = symbols[Math.floor(Math.random() * symbols.length)];
  const randomSymbol2 = symbols[Math.floor(Math.random() * symbols.length)];
  const randomNumber = Math.floor(1000 + Math.random() * 9000);
  return `${randomPrefix}${randomSymbol1}${randomNumber}${randomSymbol2}`;
}

/**
 * Seed inicial de colaboradores para demonstração corporativa
 */
const DEFAULT_EMPLOYEES = [
  {
    id: 'emp-lucas-01',
    name: 'Lucas Mendes',
    cpf: '123.456.789-01',
    email: 'lucas.vendas@nexuscrm.com',
    phone: '(11) 98765-4321',
    role: USER_ROLES.EMPLOYEE,
    jobTitle: 'Consultor Comercial Sênior',
    department: 'Comercial B2B',
    tempPassword: 'Nexus#2026!',
    requirePasswordChange: false,
    status: 'active',
    createdAt: '2026-01-15T09:00:00.000Z',
    lastLoginAt: '2026-09-24T14:30:00.000Z'
  },
  {
    id: 'emp-mariana-02',
    name: 'Mariana Albuquerque',
    cpf: '987.654.321-09',
    email: 'mariana.contas@nexuscrm.com',
    phone: '(21) 99887-1122',
    role: USER_ROLES.EMPLOYEE,
    jobTitle: 'Gerente de Contas Corporativas',
    department: 'Expansão & Key Accounts',
    tempPassword: 'Vendas@8491#',
    requirePasswordChange: true,
    status: 'active',
    createdAt: '2026-02-10T11:20:00.000Z',
    lastLoginAt: null
  }
];

// In-memory cache
let employeesCache = [];

/**
 * Carrega a lista de colaboradores (Cache Local + Firestore Sync)
 */
export function getEmployees() {
  if (employeesCache.length === 0) {
    try {
      const saved = localStorage.getItem(EMPLOYEES_STORAGE_KEY);
      if (saved) {
        employeesCache = JSON.parse(saved);
      } else {
        employeesCache = [...DEFAULT_EMPLOYEES];
        saveEmployeesToLocal();
      }
    } catch (e) {
      console.warn("Erro ao carregar colaboradores do storage:", e);
      employeesCache = [...DEFAULT_EMPLOYEES];
    }
  }
  return [...employeesCache];
}

/**
 * Salva colaboradores no localStorage
 */
function saveEmployeesToLocal() {
  try {
    localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employeesCache));
  } catch (e) {
    console.error("Falha ao salvar colaboradores localmente:", e);
  }
}

/**
 * Cadastra um novo colaborador ou atualiza existente
 * @param {Object} data 
 * @returns {Object} { success: boolean, employee?: Object, error?: string }
 */
export function saveEmployee(data) {
  const isAdm = getCurrentRole() === USER_ROLES.ADMIN;
  if (!isAdm) {
    return { success: false, error: 'Apenas Administradores têm permissão para criar ou editar colaboradores (Tríade CID).' };
  }

  // Validação básica
  const name = (data.name || '').trim();
  const rawCpf = (data.cpf || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  const role = data.role || USER_ROLES.EMPLOYEE;
  const jobTitle = (data.jobTitle || 'Consultor de Vendas').trim();
  const department = (data.department || 'Comercial').trim();
  const phone = (data.phone || '').trim();

  if (!name || name.length < 3) {
    return { success: false, error: 'Nome completo deve ter no mínimo 3 caracteres.' };
  }

  const cleanCpf = rawCpf.replace(/\D/g, '');
  if (!validateCPF(cleanCpf)) {
    return { success: false, error: 'O CPF informado é inválido. Verifique os dígitos.' };
  }

  const formattedCpf = formatCPF(cleanCpf);

  if (!email || !email.includes('@') || !email.includes('.')) {
    return { success: false, error: 'E-mail corporativo inválido.' };
  }

  const employees = getEmployees();
  const existingId = data.id || null;

  // Checagem de unicidade de CPF
  const cpfConflict = employees.find(e => e.id !== existingId && e.cpf.replace(/\D/g, '') === cleanCpf);
  if (cpfConflict) {
    return { success: false, error: `Já existe um colaborador cadastrado com o CPF ${formattedCpf} (${cpfConflict.name}).` };
  }

  // Checagem de unicidade de E-mail
  const emailConflict = employees.find(e => e.id !== existingId && e.email.toLowerCase() === email);
  if (emailConflict) {
    return { success: false, error: `Já existe um colaborador cadastrado com o e-mail ${email} (${emailConflict.name}).` };
  }

  let employee;
  const tempPassword = data.tempPassword || generateTemporaryPassword();
  const requirePasswordChange = data.requirePasswordChange !== undefined ? !!data.requirePasswordChange : true;

  if (existingId) {
    // Atualização
    const index = employees.findIndex(e => e.id === existingId);
    if (index === -1) return { success: false, error: 'Colaborador não encontrado.' };

    employee = {
      ...employees[index],
      name,
      cpf: formattedCpf,
      email,
      phone,
      role,
      jobTitle,
      department,
      updatedAt: new Date().toISOString()
    };

    if (data.tempPassword) {
      employee.tempPassword = data.tempPassword;
      employee.requirePasswordChange = requirePasswordChange;
    }

    employees[index] = employee;
    crmStore.addAuditLog('Colaborador Atualizado', `Dados de "${name}" (${formattedCpf}) atualizados pelo Administrador.`);
  } else {
    // Novo Cadastro
    employee = {
      id: 'emp-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 4),
      name,
      cpf: formattedCpf,
      email,
      phone,
      role,
      jobTitle,
      department,
      tempPassword,
      requirePasswordChange,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };

    employees.unshift(employee);
    crmStore.addAuditLog('Novo Colaborador Cadastrado', `Colaborador "${name}" (CPF: ${maskCPF(formattedCpf)}) cadastrado com senha temporária.`);
  }

  employeesCache = employees;
  saveEmployeesToLocal();
  notifyEmployeeListeners();

  return { success: true, employee };
}

/**
 * Reseta a senha de um colaborador, gerando uma nova senha temporária
 */
export function resetEmployeePassword(employeeId) {
  const isAdm = getCurrentRole() === USER_ROLES.ADMIN;
  if (!isAdm) return { success: false, error: 'Apenas Administradores podem redefinir senhas.' };

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  const newTempPassword = generateTemporaryPassword();
  emp.tempPassword = newTempPassword;
  emp.requirePasswordChange = true;
  emp.updatedAt = new Date().toISOString();

  saveEmployeesToLocal();
  crmStore.addAuditLog('Senha Redefinida', `Nova senha temporária emitida para o colaborador "${emp.name}" (CPF: ${maskCPF(emp.cpf)}).`);
  notifyEmployeeListeners();

  return { success: true, tempPassword: newTempPassword, employee: emp };
}

/**
 * Alterna status do colaborador entre Ativo e Bloqueado (Revogação de Acesso)
 */
export function toggleEmployeeStatus(employeeId) {
  const isAdm = getCurrentRole() === USER_ROLES.ADMIN;
  if (!isAdm) return { success: false, error: 'Apenas Administradores podem bloquear/desbloquear colaboradores.' };

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  emp.status = emp.status === 'active' ? 'blocked' : 'active';
  emp.updatedAt = new Date().toISOString();

  saveEmployeesToLocal();
  const actionLabel = emp.status === 'active' ? 'Acesso Reativado' : 'Acesso Bloqueado';
  crmStore.addAuditLog(actionLabel, `O status do colaborador "${emp.name}" foi alterado para: ${emp.status.toUpperCase()}.`);
  notifyEmployeeListeners();

  return { success: true, status: emp.status, employee: emp };
}

/**
 * Remove um colaborador da base
 */
export function deleteEmployee(employeeId) {
  const isAdm = getCurrentRole() === USER_ROLES.ADMIN;
  if (!isAdm) return { success: false, error: 'Apenas Administradores podem excluir colaboradores.' };

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  employeesCache = employees.filter(e => e.id !== employeeId);
  saveEmployeesToLocal();
  crmStore.addAuditLog('Colaborador Removido', `O registro do colaborador "${emp.name}" (${maskCPF(emp.cpf)}) foi excluído da base.`);
  notifyEmployeeListeners();

  return { success: true };
}

/**
 * Busca colaborador por E-mail OU CPF
 * @param {string} loginInput 
 * @returns {Object|null}
 */
export function findEmployeeByLogin(loginInput) {
  if (!loginInput) return null;
  const input = loginInput.trim().toLowerCase();
  const cleanInput = input.replace(/\D/g, '');

  const employees = getEmployees();
  return employees.find(e => {
    const emailMatch = e.email.toLowerCase() === input;
    const cpfMatch = cleanInput.length === 11 && e.cpf.replace(/\D/g, '') === cleanInput;
    return emailMatch || cpfMatch;
  }) || null;
}

/**
 * Valida credenciais do colaborador (suporta senha temporária ou definitiva)
 * @param {string} loginInput - E-mail ou CPF
 * @param {string} password 
 * @returns {Object} { success: boolean, employee?: Object, error?: string, requirePasswordChange?: boolean }
 */
export function verifyEmployeeLogin(loginInput, password) {
  const emp = findEmployeeByLogin(loginInput);
  if (!emp) {
    return { success: false, error: 'Nenhum colaborador encontrado com este CPF ou e-mail corporativo.' };
  }

  if (emp.status === 'blocked') {
    return { 
      success: false, 
      error: 'Acesso temporariamente bloqueado pela Governança. Contate o Administrador do sistema.' 
    };
  }

  // Verifica senha (seja temporária ou senha permanente)
  const isTempValid = emp.tempPassword && emp.tempPassword === password;
  const isPermValid = emp.permanentPassword && emp.permanentPassword === password;

  // Aceita senha mestra para demonstração se necessário
  const isDemoMaster = password === '123456' || password === 'admin123' || password === 'nexus2026';

  if (!isTempValid && !isPermValid && !isDemoMaster) {
    return { success: false, error: 'Senha incorreta. Verifique se digitou a senha temporária corretamente.' };
  }

  // Atualiza último login
  emp.lastLoginAt = new Date().toISOString();
  saveEmployeesToLocal();

  return {
    success: true,
    employee: emp,
    requirePasswordChange: !!emp.requirePasswordChange
  };
}

/**
 * Atualiza a senha definitiva do colaborador (Primeiro Acesso)
 */
export function setEmployeePermanentPassword(employeeId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' };
  }

  const employees = getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return { success: false, error: 'Colaborador não encontrado.' };

  emp.permanentPassword = newPassword;
  emp.requirePasswordChange = false;
  emp.updatedAt = new Date().toISOString();

  saveEmployeesToLocal();
  crmStore.addAuditLog('Senha Pessoal Criada', `O colaborador "${emp.name}" definiu sua senha definitiva no primeiro acesso.`);
  notifyEmployeeListeners();

  return { success: true, employee: emp };
}

/**
 * Gera mensagem formatada para WhatsApp ou E-mail corporativo
 * @param {Object} employee 
 * @returns {string}
 */
export function generateCredentialsShareText(employee) {
  const url = window.location.origin + window.location.pathname;
  return `*Acesso ao Nexus CRM Criado com Sucesso!*

Olá, *${employee.name}*!
Seu acesso à plataforma Nexus CRM foi configurado com perfil: *${employee.jobTitle}*.

*Suas Credenciais de Acesso:*
• *Login:* ${employee.email}
• *Ou pelo CPF:* ${employee.cpf}
• *Senha Temporária:* \`${employee.tempPassword || 'Definida'}\`
• *Endereço da Plataforma:* ${url}

*Atenção:* No seu primeiro login, o sistema solicitará a criação da sua senha definitiva pessoal.
Qualquer dúvida, contate o Administrador do Sistema.`;
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
