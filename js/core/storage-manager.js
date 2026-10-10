/**
 * EDX Digital - Hybrid Storage Manager
 * Seamlessly manages Google Cloud Firestore with zero-friction local fallback.
 * Rich Activity Timeline, Tasks & Loss Reasons Support.
 */

import { isManual } from './history.js';
import { STORAGE_KEYS, getSavedOrganization } from './config.js';
import * as firestoreService from '../services/firebase-service.js';
import { getCurrentUser, isAdmin, isCloudSession, isDemoSession, isReadOnly } from '../services/auth-service.js';
import { crmStore, getLossReasonLabel, getStageName } from './crm-store.js';
import { normalizeCustomer } from './normalize.js';
import { leadsRoom, isOpenOpportunity, currentPlan, PlanLimitError } from '../services/billing-service.js';

let lastCloudWarningAt = 0;

/**
 * Tells the user when the cloud refused or missed a write.
 * Without this notice a card would silently jump back on the next sync.
 */
function warnCloudWriteFailed(err) {
  console.warn("Firestore write failed (the change was kept locally):", err);
  const now = Date.now();
  if (now - lastCloudWarningAt < 8000) return;
  lastCloudWarningAt = now;
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    const denied = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
    window.showToast(
      denied
        ? 'Esta alteração não foi salva: seu perfil não tem permissão para ela.'
        : 'Esta alteração não foi salva: sem conexão com o servidor. Tente de novo em instantes.',
      'warning'
    );
  }
}

function warnCloudReadFailed(err) {
  if (typeof window === 'undefined' || typeof window.showToast !== 'function') return;
  const denied = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
  window.showToast(
    denied
      ? 'Não foi possível carregar os clientes: seu acesso a esta empresa foi negado.'
      : 'Não foi possível carregar os clientes. Verifique a conexão e recarregue a página.',
    'error'
  );
}

export class ReadOnlyError extends Error {
  constructor() {
    super('O plano da empresa venceu. O CRM está em modo de leitura.');
    this.code = 'read-only';
  }
}

/**
 * Stops a change before it is shown on screen when the plan has lapsed.
 * (The database would refuse it anyway; this avoids a card that moves and jumps back.)
 */
function assertCanWrite() {
  if (!isReadOnly()) return;
  if (typeof window !== 'undefined' && typeof window.handleReadOnlyAttempt === 'function') {
    window.handleReadOnlyAttempt();
  }
  throw new ReadOnlyError();
}

// Realistic seed dataset with rich timeline activities, tasks and expected closing dates
const INITIAL_DEMO_LEADS = [
  {
    id: 'demo-lead-1',
    name: 'Ana Beatriz Lima',
    email: 'ana.lima@nubankcorp.com.br',
    phone: '+55 11 98123-4567',
    company: 'NuScale Payments',
    role: 'Head de Novos Negócios',
    stage: 'lead',
    dealValue: 65000,
    priority: 'high',
    tags: ['Fintech', 'Inbound'],
    notes: 'Interesse em integração de API para pagamento em lote.',
    assignedTo: { id: 'employee-user-02', name: 'Lucas Mendes (Consultor)', email: 'lucas.vendas@example.com' },
    expectedCloseDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-1-1',
        type: 'note',
        title: 'Lead Recebido via Inbound',
        text: 'Preencheu formulário no site solicitando orçamento para volumetria alta.',
        author: 'Sistema',
        timestamp: new Date(Date.now() - 4 * 86400000).toISOString()
      },
      {
        id: 'act-1-2',
        type: 'whatsapp',
        title: 'Mensagem de Apresentação Enviada',
        text: 'Enviada apresentação institucional via WhatsApp. Aguardando retorno.',
        author: 'Lucas Mendes',
        timestamp: new Date(Date.now() - 1 * 86400000).toISOString()
      }
    ],
    tasks: [
      {
        id: 'task-1-1',
        title: 'Follow-up de Apresentação via WhatsApp',
        type: 'whatsapp',
        dueDate: new Date().toISOString().split('T')[0], // Today
        completed: false
      }
    ]
  },
  {
    id: 'demo-lead-2',
    name: 'Rodrigo Alcantara',
    email: 'rodrigo@vanguardlog.com',
    phone: '+55 41 99876-5432',
    company: 'Vanguard Logística',
    role: 'Diretor de Operações',
    stage: 'contact',
    dealValue: 120000,
    priority: 'high',
    tags: ['Logística', 'SLA Alto'],
    notes: 'Primeira reunião agendada para alinhamento de requisitos técnicos.',
    assignedTo: { id: 'employee-user-02', name: 'Lucas Mendes (Consultor)', email: 'lucas.vendas@example.com' },
    expectedCloseDate: new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    // 4 days idle to demonstrate Deal Rotting alert
    updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-2-1',
        type: 'call',
        title: 'Ligação de Qualificação',
        text: 'Conversamos por 20 minutos. Rodrigo tem autonomia de compra para Q4.',
        author: 'Lucas Mendes',
        timestamp: new Date(Date.now() - 4 * 86400000).toISOString()
      }
    ],
    tasks: [
      {
        id: 'task-2-1',
        title: 'Ligar para reagendar reunião técnica',
        type: 'call',
        dueDate: new Date(Date.now() + 1 * 86400000).toISOString().split('T')[0],
        completed: false
      }
    ]
  },
  {
    id: 'demo-lead-3',
    name: 'Camila Drummond',
    email: 'camila@orionhealth.med.br',
    phone: '+55 21 97654-3210',
    company: 'Orion Health Tech',
    role: 'CTO',
    stage: 'proposal',
    dealValue: 88000,
    priority: 'medium',
    tags: ['Saúde', 'Segurança LGPD'],
    notes: 'Proposta comercial de 12 meses enviada. Em análise pelo comitê executivo.',
    assignedTo: { id: 'employee-user-03', name: 'Mariana Costa (Consultora)', email: 'mariana.vendas@example.com' },
    expectedCloseDate: new Date(Date.now() + 8 * 86400000).toISOString().split('T')[0],
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-3-1',
        type: 'meeting',
        title: 'Demonstração da Solução',
        text: 'Apresentação remota de 45 minutos. Comitê de TI participou e validou conformidade com LGPD.',
        author: 'Mariana Costa',
        timestamp: new Date(Date.now() - 3 * 86400000).toISOString()
      },
      {
        id: 'act-3-2',
        type: 'note',
        title: 'Proposta Enviada',
        text: 'Minuta comercial enviada com opção de pagamento semestral.',
        author: 'Mariana Costa',
        timestamp: new Date(Date.now() - 1 * 86400000).toISOString()
      }
    ],
    tasks: [
      {
        id: 'task-3-1',
        title: 'Cobrança do retorno da proposta com Camila',
        type: 'meeting',
        dueDate: new Date().toISOString().split('T')[0],
        completed: false
      }
    ]
  },
  {
    id: 'demo-lead-4',
    name: 'Eduardo Martins',
    email: 'eduardo@agrotechbrasil.agr.br',
    phone: '+55 19 98988-1234',
    company: 'AgroTech Brasil',
    role: 'Gerente de TI',
    stage: 'negotiation',
    dealValue: 155000,
    priority: 'high',
    tags: ['Agro', 'Cloud', 'Piloto'],
    notes: 'Negociando cláusulas de suporte 24/7 e SLA de 99.9%. Decisão nesta semana.',
    assignedTo: { id: 'employee-user-02', name: 'Lucas Mendes (Consultor)', email: 'lucas.vendas@example.com' },
    expectedCloseDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-4-1',
        type: 'meeting',
        title: 'Reunião de Negociação Contratual',
        text: 'Jurídico da AgroTech solicitou adequação de cláusula de rescisão sem multa em 60 dias.',
        author: 'Lucas Mendes',
        timestamp: new Date(Date.now() - 1 * 86400000).toISOString()
      }
    ],
    tasks: [
      {
        id: 'task-4-1',
        title: 'Enviar minuta revisada com cláusula jurídica',
        type: 'followup',
        dueDate: new Date().toISOString().split('T')[0],
        completed: true
      }
    ]
  },
  {
    id: 'demo-lead-5',
    name: 'Juliana Fernandes',
    email: 'juliana@solarsul.com.br',
    phone: '+55 51 99111-2233',
    company: 'SolarSul Energia',
    role: 'CEO',
    stage: 'won',
    dealValue: 95000,
    priority: 'medium',
    tags: ['Energia', 'Contrato Assinado'],
    notes: 'Contrato anual assinado! Onboarding agendado para a próxima segunda-feira.',
    assignedTo: { id: 'employee-user-03', name: 'Mariana Costa (Consultora)', email: 'mariana.vendas@example.com' },
    expectedCloseDate: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-5-1',
        type: 'stage_change',
        title: 'Contrato Fechado Ganho ',
        text: 'Negócio fechado e assinado via DocuSign no valor de R$ 95.000.',
        author: 'Mariana Costa',
        timestamp: new Date(Date.now() - 2 * 86400000).toISOString()
      }
    ],
    tasks: []
  },
  {
    id: 'demo-lead-6',
    name: 'Felipe Queiroz',
    email: 'felipe@retailsmart.com',
    phone: '+55 31 98456-7890',
    company: 'Retail Smart Varejo',
    role: 'Coordenador Comercial',
    stage: 'lost',
    dealValue: 35000,
    priority: 'low',
    tags: ['Varejo', 'Preço'],
    lossReason: 'price',
    lossDetails: 'Optaram por adiar o projeto para o próximo ano devido ao corte de CAPEX no varejo.',
    lostAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    notes: 'Optaram por adiar o projeto para o próximo trimestre por restrição orçamentária.',
    assignedTo: { id: 'employee-user-02', name: 'Lucas Mendes (Consultor)', email: 'lucas.vendas@example.com' },
    createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    activities: [
      {
        id: 'act-6-1',
        type: 'loss',
        title: 'Oportunidade Perdida',
        text: 'Motivo: Preço / Orçamento insuficiente. Recontatar em Janeiro.',
        author: 'Lucas Mendes',
        timestamp: new Date(Date.now() - 5 * 86400000).toISOString()
      }
    ],
    tasks: []
  }
];

class StorageManager {
  constructor() {
    this.mode = 'local'; // 'firestore' | 'local'
    this.listeners = [];
    this.currentData = [];
    this.isInitialized = false;
  }

  /**
   * Starts (or restarts) the storage for the current session:
   * a signed-in account reads its company from the cloud, the demo reads the sample data
   * kept in this browser.
   */
  async init() {
    firestoreService.stopFirestoreSync();
    const user = getCurrentUser();

    if (isCloudSession() && user) {
      this.mode = 'firestore';
      this.currentData = [];
      try {
        await firestoreService.initializeFirestore();
        await firestoreService.subscribeToFirestoreCustomers(
          (customers) => {
            this.currentData = customers;
            this.notifyListeners();
          },
          (err) => {
            // Never fall back to the sample data here: a real account must not see fake leads
            console.warn("Firestore listener error:", err);
            warnCloudReadFailed(err);
          },
          { orgId: user.orgId, uid: user.uid, isAdmin: isAdmin() }
        );
        this.isInitialized = true;
        this.notifyListeners();
        return { mode: 'firestore', success: true };
      } catch (err) {
        console.warn("Failed to connect to Firestore:", err);
        this.isInitialized = true;
        this.notifyListeners();
        return { mode: 'firestore', success: false, error: err };
      }
    }

    this.mode = 'local';
    if (isDemoSession()) {
      this.loadLocalData();
    } else {
      this.currentData = [];
    }
    this.isInitialized = true;
    this.notifyListeners();
    return { mode: 'local', success: true };
  }

  /**
   * Drops everything held in memory (used on sign-out)
   */
  reset() {
    firestoreService.stopFirestoreSync();
    this.mode = 'local';
    this.currentData = [];
    this.notifyListeners();
  }

  /**
   * Loads or seeds local data in localStorage
   */
  loadLocalData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_DATA);
      if (raw) {
        const stored = JSON.parse(raw);
        this.currentData = (Array.isArray(stored) ? stored : []).map(normalizeCustomer);
      } else {
        this.currentData = JSON.parse(JSON.stringify(INITIAL_DEMO_LEADS));
        this.saveLocalData();
      }
    } catch (e) {
      this.currentData = JSON.parse(JSON.stringify(INITIAL_DEMO_LEADS));
    }
  }

  saveLocalData() {
    // Only the sample data lives in this browser; a real account's data stays in the cloud
    if (this.mode !== 'local') return;
    try {
      localStorage.setItem(STORAGE_KEYS.LOCAL_DATA, JSON.stringify(this.currentData));
    } catch (e) {
      console.error("Error saving local data:", e);
    }
  }

  subscribe(callback) {
    this.listeners.push(callback);
    if (this.currentData.length > 0) {
      callback(this.currentData, this.mode);
    }
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.currentData, this.mode);
      } catch (err) {
        console.error("Error in storage listener:", err);
      }
    });
  }

  getCustomers() {
    return [...this.currentData];
  }

  getCustomer(id) {
    if (!id) return null;
    return this.currentData.find(c => 
      c.id === id || 
      c.firestoreId === id || 
      c.clientLeadId === id ||
      (c.id && c.id.toString() === id.toString())
    ) || null;
  }

  /**
   * Creates or updates a customer
   */
  async saveCustomer(customerData) {
    assertCanWrite();
    const user = getCurrentUser() || { name: 'Operador', email: 'user@example.com', role: 'admin' };
    const defaultAssignedTo = customerData.assignedTo || {
      id: user.uid || 'employee-user-02',
      name: user.name,
      email: user.email
    };

    const existing = customerData.id && !customerData.id.startsWith('temp-') ? this.getCustomer(customerData.id) : null;

    if (existing) {
      const docId = existing.firestoreId || existing.id || customerData.id;
      const merged = {
        ...existing,
        ...customerData,
        id: existing.id || customerData.id,
        firestoreId: docId,
        assignedTo: customerData.assignedTo || existing?.assignedTo || defaultAssignedTo,
        activities: customerData.activities || (existing ? existing.activities : []) || [],
        tasks: customerData.tasks || (existing ? existing.tasks : []) || [],
        updatedAt: new Date().toISOString(),
        updatedBy: user.name
      };
      if (merged.stage === 'won' && existing.stage !== 'won') merged.wonAt = merged.updatedAt;
      if (merged.stage !== 'won') merged.wonAt = null;

      crmStore.addAuditLog('Edição de Oportunidade', `Lead "${merged.name}" (${merged.company}) atualizado por ${user.name} [${user.role}].`, merged);

      // Optimistic update
      const index = this.currentData.findIndex(c => c.id === customerData.id || c.firestoreId === docId);
      if (index !== -1) {
        this.currentData[index] = merged;
      } else {
        this.currentData.unshift(merged);
      }
      this.saveLocalData();
      this.notifyListeners();

      if (this.mode === 'firestore') {
        try {
          await firestoreService.updateFirestoreCustomer(docId, merged);
        } catch (fsErr) {
          warnCloudWriteFailed(fsErr);
        }
      }
      return merged;
    } else {
      // The plan says how many opportunities can be in play at once
      if (this.mode === 'firestore' && isOpenOpportunity(customerData)) {
        const room = leadsRoom(this.currentData);
        if (room.left <= 0) {
          throw new PlanLimitError(`O plano ${currentPlan().name} comporta ${room.limit.toLocaleString('pt-BR')} oportunidades em aberto, e esse limite foi atingido. Feche ou exclua oportunidades, ou mude de plano.`);
        }
      }

      const org = getSavedOrganization();
      const newLead = {
        orgId: user.orgId || customerData.orgId || org?.id || 'org_edx_default',
        activities: [],
        tasks: [],
        assignedTo: defaultAssignedTo,
        ...customerData,
        createdAt: new Date().toISOString(),
        createdBy: user.name,
        updatedAt: new Date().toISOString(),
        updatedBy: user.name
      };
      if (newLead.stage === 'won') newLead.wonAt = newLead.createdAt;

      // Add creation activity
      newLead.activities.push({
        id: 'act-' + Date.now(),
        type: 'note',
        title: 'Oportunidade criada',
        text: `Valor de R$ ${Number(newLead.dealValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
        author: user.name,
        timestamp: new Date().toISOString()
      });

      crmStore.addAuditLog('Criação de Oportunidade', `Novo lead "${newLead.name}" (${newLead.company}) cadastrado por ${user.name} [${user.role}].`, newLead);

      // The lead gets its id here and shows up right away; the cloud write follows.
      // (Before, a refused cloud write threw and the lead never appeared at all.)
      newLead.id = 'lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      this.currentData.unshift(newLead);
      this.saveLocalData();
      this.notifyListeners();

      if (this.mode === 'firestore') {
        try {
          const result = await firestoreService.addFirestoreCustomer(newLead);
          // Match by id only: matching by name used to overwrite another lead with the same name
          const index = this.currentData.findIndex(c => c.id === result.id);
          if (index !== -1) {
            this.currentData[index] = result;
            this.saveLocalData();
            this.notifyListeners();
          }
          return result;
        } catch (fsErr) {
          warnCloudWriteFailed(fsErr);
        }
      }
      return newLead;
    }
  }

  /**
   * Saves many opportunities at once (spreadsheet import), a few at a time so a long list
   * does not take minutes. The plan limit was already applied by whoever prepared the list.
   * @returns {Promise<{imported:number, failed:Array}>}
   */
  async importCustomers(leads, onProgress = () => {}) {
    assertCanWrite();
    const user = getCurrentUser() || { name: 'Operador', email: 'user@example.com' };
    const org = getSavedOrganization();
    const now = new Date().toISOString();
    const prepared = leads.map((lead, index) => ({
      orgId: user.orgId || org?.id || 'org_edx_default',
      tasks: [],
      assignedTo: { id: user.uid || 'employee-user-02', name: user.name, email: user.email },
      ...lead,
      tags: [...new Set([...(lead.tags || []), 'Importado'])],
      id: 'lead-' + Date.now() + '-' + index + '-' + Math.random().toString(36).slice(2, 7),
      activities: [{ id: 'act-' + Date.now() + '-' + index, type: 'note', title: 'Importada de planilha', text: '', author: user.name, timestamp: now }],
      createdAt: now,
      createdBy: user.name,
      updatedAt: now,
      updatedBy: user.name,
      ...(lead.stage === 'won' ? { wonAt: now } : {})
    }));

    const failed = [];
    let done = 0;
    if (this.mode === 'firestore') {
      const BATCH = 8;
      for (let i = 0; i < prepared.length; i += BATCH) {
        const slice = prepared.slice(i, i + BATCH);
        const results = await Promise.allSettled(slice.map(lead => firestoreService.addFirestoreCustomer(lead)));
        results.forEach((result, index) => { if (result.status === 'rejected') failed.push(slice[index]); });
        done += slice.length;
        onProgress(done, prepared.length);
      }
    } else {
      this.currentData.unshift(...prepared);
      this.saveLocalData();
      this.notifyListeners();
      onProgress(prepared.length, prepared.length);
    }

    const imported = prepared.length - failed.length;
    crmStore.addAuditLog('Importação de planilha', `${imported} oportunidades importadas por ${user.name}.`);
    return { imported, failed };
  }

  /**
   * Updates only the stage of a customer
   */
  async updateStage(customerId, newStage) {
    assertCanWrite();
    const user = getCurrentUser() || { name: 'Operador', role: 'admin' };
    const customer = this.getCustomer(customerId);
    const oldStage = customer ? customer.stage : 'lead';
    const updatedAt = new Date().toISOString();

    const activity = {
      id: 'act-' + Date.now(),
      type: 'stage_change',
      title: 'Mudança de etapa',
      text: `De "${getStageName(oldStage)}" para "${getStageName(newStage)}".`,
      author: user.name,
      timestamp: updatedAt
    };

    crmStore.addAuditLog('Avanço de Funil', `Lead "${customer?.name || customerId}" movido de "${getStageName(oldStage)}" para "${getStageName(newStage)}" por ${user.name}.`, customer);

    // 1. Optimistic update (instant visual response on Kanban)
    // The closing date is what the reports by period count
    const wonAt = newStage === 'won' ? updatedAt : null;

    if (customer) {
      customer.stage = newStage;
      customer.wonAt = wonAt;
      customer.updatedAt = updatedAt;
      customer.updatedBy = user.name;
      if (!Array.isArray(customer.activities)) customer.activities = [];
      customer.activities.push(activity);
      this.saveLocalData();
      this.notifyListeners();
    }

    // 2. Cloud Firestore Persist
    if (this.mode === 'firestore') {
      try {
        const docId = customer?.firestoreId || customer?.id || customerId;
        const updatedActivities = customer && customer.activities ? [...customer.activities] : [activity];
        await firestoreService.updateFirestoreCustomer(docId, { 
          stage: newStage, 
          wonAt,
          updatedAt,
          updatedBy: user.name,
          activities: updatedActivities 
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Saves loss reason when moving to lost
   */
  async setLossReason(customerId, lossReason, lossDetails) {
    assertCanWrite();
    const user = getCurrentUser() || { name: 'Operador', role: 'admin' };
    const customer = this.getCustomer(customerId);
    const updatedAt = new Date().toISOString();
    const lossLabel = getLossReasonLabel(lossReason);
    const activity = {
      id: 'act-' + Date.now(),
      type: 'loss',
      title: 'Oportunidade Marcada como Perdida',
      text: `Motivo: ${lossLabel}. ${lossDetails ? 'Detalhes: ' + lossDetails : ''}`,
      author: user.name,
      timestamp: updatedAt
    };

    crmStore.addAuditLog('Perda de Oportunidade', `Lead "${customer?.name || customerId}" marcado como perdido. Motivo: ${lossLabel}.`, customer);

    // 1. Optimistic update
    if (customer) {
      customer.stage = 'lost';
      customer.wonAt = null;
      customer.lossReason = lossReason;
      customer.lossDetails = lossDetails || '';
      customer.lostAt = updatedAt;
      customer.updatedAt = updatedAt;
      customer.updatedBy = user.name;
      if (!Array.isArray(customer.activities)) customer.activities = [];
      customer.activities.push(activity);
      this.saveLocalData();
      this.notifyListeners();
    }

    // 2. Cloud Firestore Persist
    if (this.mode === 'firestore') {
      try {
        const docId = customer?.firestoreId || customer?.id || customerId;
        const updatedActivities = customer && customer.activities ? [...customer.activities] : [activity];
        await firestoreService.updateFirestoreCustomer(docId, {
          stage: 'lost',
          wonAt: null,
          lossReason,
          lossDetails: lossDetails || '',
          lostAt: updatedAt,
          updatedAt,
          updatedBy: user.name,
          activities: updatedActivities
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Adds an activity to a customer's timeline
   */
  async addActivity(customerId, activityData) {
    assertCanWrite();
    const customer = this.getCustomer(customerId);
    if (!customer) return;

    const activity = {
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      author: getCurrentUser()?.name || 'Você',
      ...activityData
    };

    const updatedAt = new Date().toISOString();

    if (!Array.isArray(customer.activities)) customer.activities = [];
    customer.activities.push(activity);
    customer.updatedAt = updatedAt;
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      const docId = customer.firestoreId || customer.id || customerId;
      try {
        await firestoreService.updateFirestoreCustomer(docId, {
          activities: customer.activities,
          updatedAt
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Removes one record a person wrote in the history (a call, a meeting, a note)
   */
  async deleteActivity(customerId, activityId) {
    assertCanWrite();
    const customer = this.getCustomer(customerId);
    if (!customer || !Array.isArray(customer.activities)) return;
    const target = customer.activities.find(activity => activity.id === activityId);
    // what the system recorded by itself (stage changes, tasks) is not removable
    if (!target || !isManual(target)) return;

    customer.activities = customer.activities.filter(activity => activity.id !== activityId);
    customer.updatedAt = new Date().toISOString();
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      try {
        await firestoreService.updateFirestoreCustomer(customer.firestoreId || customer.id || customerId, {
          activities: customer.activities,
          updatedAt: customer.updatedAt
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Adds a task to a customer
   */
  async addTask(customerId, taskData) {
    assertCanWrite();
    const customer = this.getCustomer(customerId);
    if (!customer) return;

    const task = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      completed: false,
      createdAt: new Date().toISOString(),
      ...taskData
    };

    const activity = {
      id: 'act-' + Date.now(),
      type: 'task',
      title: 'Tarefa agendada',
      text: `${task.title}, para ${task.dueDate ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR') : 'hoje'}${task.dueTime ? ' às ' + task.dueTime : ''}.`,
      author: getCurrentUser()?.name || 'Você',
      timestamp: new Date().toISOString()
    };

    const updatedAt = new Date().toISOString();

    if (!Array.isArray(customer.tasks)) customer.tasks = [];
    if (!Array.isArray(customer.activities)) customer.activities = [];
    customer.tasks.push(task);
    customer.activities.push(activity);
    customer.updatedAt = updatedAt;
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      const docId = customer.firestoreId || customer.id || customerId;
      try {
        await firestoreService.updateFirestoreCustomer(docId, {
          tasks: customer.tasks,
          activities: customer.activities,
          updatedAt
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Toggles task completion status
   */
  async toggleTask(customerId, taskId) {
    assertCanWrite();
    const customer = this.getCustomer(customerId);
    if (!customer || !Array.isArray(customer.tasks)) return;

    const task = customer.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    const updatedAt = new Date().toISOString();
    customer.updatedAt = updatedAt;
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      const docId = customer.firestoreId || customer.id || customerId;
      try {
        await firestoreService.updateFirestoreCustomer(docId, {
          tasks: customer.tasks,
          updatedAt
        });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Removes a task from an opportunity
   */
  async deleteTask(customerId, taskId) {
    assertCanWrite();
    const customer = this.getCustomer(customerId);
    if (!customer || !Array.isArray(customer.tasks)) return;
    const remaining = customer.tasks.filter(task => task.id !== taskId);
    if (remaining.length === customer.tasks.length) return;

    customer.tasks = remaining;
    customer.updatedAt = new Date().toISOString();
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      try {
        await firestoreService.updateFirestoreCustomer(customer.firestoreId || customer.id, { tasks: customer.tasks, updatedAt: customer.updatedAt });
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Hands the open opportunities of one person over to another (administrators only)
   * @param {string} fromId - id of the person who had them
   * @param {{id:string, name:string, email:string}} to
   * @returns {Promise<number>} how many were transferred
   */
  async reassignCustomers(fromId, to) {
    assertCanWrite();
    if (!isAdmin()) throw new Error('Só administradores podem transferir oportunidades.');
    const user = getCurrentUser() || { name: 'Administrador' };
    const now = new Date().toISOString();
    const moving = this.currentData.filter(c => c.assignedTo && c.assignedTo.id === fromId && c.stage !== 'won' && c.stage !== 'lost');

    for (const customer of moving) {
      const previous = customer.assignedTo.name || '';
      customer.assignedTo = { id: to.id, name: to.name, email: to.email };
      customer.updatedAt = now;
      customer.updatedBy = user.name;
      if (!Array.isArray(customer.activities)) customer.activities = [];
      customer.activities.push({
        id: 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'note',
        title: 'Responsável alterado',
        text: `De ${previous || 'sem responsável'} para ${to.name}.`,
        author: user.name,
        timestamp: now
      });
    }
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      const results = await Promise.allSettled(moving.map(customer => firestoreService.updateFirestoreCustomer(
        customer.firestoreId || customer.id,
        { assignedTo: customer.assignedTo, activities: customer.activities, updatedAt: now, updatedBy: user.name }
      )));
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) warnCloudWriteFailed(failed[0].reason);
    }
    return moving.length;
  }

  /**
   * Puts an opportunity back exactly as it was (used by "Desfazer" after a move or a deletion)
   */
  async restoreCustomer(snapshot) {
    assertCanWrite();
    if (!snapshot || !snapshot.id) return;
    const restored = {
      ...snapshot,
      // A move to "lost" adds these; clearing them here undoes it fully
      lossReason: snapshot.lossReason ?? null,
      lossDetails: snapshot.lossDetails ?? '',
      lostAt: snapshot.lostAt ?? null
    };

    const index = this.currentData.findIndex(c => c.id === snapshot.id);
    if (index !== -1) this.currentData[index] = restored;
    else this.currentData.unshift(restored);
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      try {
        const { firestoreId, clientLeadId, ...clean } = restored;
        await firestoreService.addFirestoreCustomer(clean);
      } catch (fsErr) {
        warnCloudWriteFailed(fsErr);
      }
    }
  }

  /**
   * Deletes a customer by ID
   * ENFORCES INTEGRIDADE (I): Somente o perfil Administrador pode excluir permanentemente.
   */
  async deleteCustomer(customerId) {
    if (!isAdmin()) {
      crmStore.addAuditLog('Exclusão negada', `Tentativa de excluir o lead ${customerId} por alguém que não é administrador.`);
      throw new Error("Só administradores podem excluir oportunidades.");
    }

    const customer = this.getCustomer(customerId);
    const user = getCurrentUser() || { name: 'Administrador' };
    crmStore.addAuditLog('Exclusão de Oportunidade', `Oportunidade "${customer?.name || customerId}" excluída definitivamente por ${user.name}.`, customer);

    const docId = customer?.firestoreId || customer?.id || customerId;
    this.currentData = this.currentData.filter(c => c.id !== customerId && c.firestoreId !== docId);
    this.saveLocalData();
    this.notifyListeners();

    if (this.mode === 'firestore') {
      try {
        await firestoreService.deleteFirestoreCustomer(docId);
      } catch (err) {
        warnCloudWriteFailed(err);
      }
    }
  }

  /**
   * DISPONIBILIDADE (D): Central de Contingência & Disaster Recovery
   * Gera snapshot JSON completo para backup de emergência
   */
  createBackupSnapshot() {
    if (!isAdmin()) {
      throw new Error("Apenas o perfil Administrador pode gerar snapshots de contingência (Disponibilidade).");
    }
    const user = getCurrentUser();
    const snapshot = {
      system: 'EDX Digital',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy: user ? user.name : 'Administrador',
      storageMode: this.mode,
      totalRecords: this.currentData.length,
      customers: this.currentData,
      auditLogs: crmStore.getState().auditLogs
    };

    crmStore.addAuditLog('Backup Snapshot Gerado', `Snapshot de contingência com ${this.currentData.length} registros exportado com sucesso.`);
    return snapshot;
  }

  /**
   * DISPONIBILIDADE (D): Restauração de Snapshot de Backup
   */
  async restoreBackupSnapshot(snapshotData) {
    assertCanWrite();
    if (!isAdmin()) {
      throw new Error("Apenas o perfil Administrador pode restaurar backups de contingência.");
    }
    if (!snapshotData || !Array.isArray(snapshotData.customers)) {
      throw new Error("Arquivo de backup inválido ou corrompido.");
    }

    if (this.mode === 'firestore') {
      // Each record is written to this company's database; the live listener brings them back
      for (const customer of snapshotData.customers) {
        if (!customer || !customer.name) continue;
        const { firestoreId, clientLeadId, orgId, ...rest } = customer;
        await firestoreService.addFirestoreCustomer(rest);
      }
    } else {
      this.currentData = snapshotData.customers;
      this.saveLocalData();
    }
    crmStore.addAuditLog('Restauração de Banco Realizada', `Banco restaurado com sucesso a partir de snapshot (${snapshotData.customers.length} registros recuperados).`);
    this.notifyListeners();
    return true;
  }
}

export const storage = new StorageManager();
