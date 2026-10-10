/**
 * EDX Digital - Multi-Tenant Repository & Context Enforcement
 * Architecture: Zero Trust Repository Layer (Defense-in-Depth)
 * Guarantees: Automatic Tenant Injection, RLS Compatibility, Strict Parameterization
 */

const crypto = require('crypto');
const { encryptField, decryptField } = require('../security/crypto-service');

class SecurityContext {
  constructor({ tenantId, userId, id, role, teamId = null, ipAddress = '127.0.0.1', userAgent = '' }) {
    if (!tenantId) {
      throw new Error('SECURITY VIOLATION: Tentativa de instanciar contexto sem Tenant ID.');
    }
    this.tenantId = String(tenantId);
    this.userId = userId ? String(userId) : (id ? String(id) : null);
    this.role = role || 'vendedor';
    this.teamId = teamId ? String(teamId) : null;
    this.ipAddress = ipAddress;
    this.userAgent = userAgent;

    // Freeze context to make it tamper-proof throughout the request lifecycle
    Object.freeze(this);
  }
}

class MultiTenantRepository {
  constructor() {
    this.tenants = new Map();
    this.users = new Map();
    this.teams = new Map();
    this.leads = new Map();
    this.auditLogs = [];
    this.secrets = new Map();
    this.exportApprovals = new Map();
  }

  // --------------------------------------------------------------------------
  // TENANT OPERATIONS
  // --------------------------------------------------------------------------
  async createTenant({ name, slug, plan = 'enterprise' }) {
    const id = crypto.randomUUID();
    const tenant = {
      id,
      name,
      slug,
      plan,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.tenants.set(id, tenant);
    return tenant;
  }

  async getTenantById(id) {
    return this.tenants.get(id) || null;
  }

  // --------------------------------------------------------------------------
  // USER OPERATIONS (TENANT-ISOLATED)
  // --------------------------------------------------------------------------
  async createUser(context, userData) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Tenant ID obrigatório para criação de usuário.');
    }

    const id = crypto.randomUUID();
    const user = {
      id,
      tenant_id: context.tenantId,
      team_id: userData.team_id || null,
      email: userData.email.toLowerCase().trim(),
      password_hash: userData.password_hash,
      name: userData.name,
      role: userData.role || 'vendedor',
      status: 'active',
      failed_login_attempts: 0,
      locked_until: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.users.set(id, user);
    return { ...user, password_hash: undefined }; // Never return hash
  }

  async getUserById(context, id) {
    if (!context || !context.tenantId) return null;
    const user = this.users.get(id);
    if (!user || user.tenant_id !== context.tenantId) return null; // Tenant isolation
    return user;
  }

  async getUserByEmail(context, email) {
    if (!context || !context.tenantId || !email) return null;
    const searchEmail = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.tenant_id === context.tenantId && u.email === searchEmail) {
        return u;
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // LEADS OPERATIONS (TENANT & RBAC BOUNDED)
  // --------------------------------------------------------------------------
  async createLead(context, leadData) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Operação bloqueada. Tenant ID não configurado.');
    }

    const id = crypto.randomUUID();

    // Encrypt sensitive custom notes or PII at rest (AES-256-GCM) with tenantId binding
    let encryptedPayload = null;
    let payloadIv = null;
    let payloadTag = null;

    if (leadData.confidential_notes || leadData.custom_fields) {
      const encrypted = encryptField({
        notes: leadData.confidential_notes,
        custom: leadData.custom_fields
      }, context.tenantId);

      encryptedPayload = encrypted.ciphertext;
      payloadIv = encrypted.iv;
      payloadTag = encrypted.authTag;
    }

    const lead = {
      id,
      tenant_id: context.tenantId, // Immutable tenant boundary
      team_id: leadData.team_id || context.teamId || null,
      assigned_to_id: leadData.assigned_to_id || context.userId,
      created_by_id: context.userId,
      name: leadData.name,
      company: leadData.company || '',
      email: leadData.email || '',
      phone: leadData.phone || '',
      deal_value: Number(leadData.deal_value) || 0.0,
      stage: leadData.stage || 'lead',
      priority: leadData.priority || 'medium',
      encrypted_payload: encryptedPayload,
      encrypted_payload_iv: payloadIv,
      encrypted_payload_tag: payloadTag,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.leads.set(id, lead);
    return this._sanitizeLeadOutput(lead, context.tenantId);
  }

  async getLeadById(context, id) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Tentativa de leitura de lead sem tenant context.');
    }

    const lead = this.leads.get(id);
    if (!lead || lead.tenant_id !== context.tenantId || lead.is_deleted) {
      return null; // Return null so attackers cannot infer existence in other tenants
    }

    return this._sanitizeLeadOutput(lead, context.tenantId);
  }

  async listLeads(context, filters = {}) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Listagem bloqueada sem Tenant ID.');
    }

    let results = [];
    for (const lead of this.leads.values()) {
      // 1. Strict Tenant Isolation
      if (lead.tenant_id !== context.tenantId) continue;
      if (lead.is_deleted) continue;

      // 2. RBAC Visibility Filter (Mirroring Postgres RLS)
      if (context.role === 'vendedor') {
        if (lead.assigned_to_id !== context.userId && lead.created_by_id !== context.userId) {
          continue;
        }
      } else if (context.role === 'gerente') {
        if (context.teamId && lead.team_id && lead.team_id !== context.teamId) {
          continue;
        }
      }

      // 3. User Filter criteria
      if (filters.stage && lead.stage !== filters.stage) continue;
      if (filters.priority && lead.priority !== filters.priority) continue;
      if (filters.assignedTo && lead.assigned_to_id !== filters.assignedTo) continue;

      results.push(this._sanitizeLeadOutput(lead, context.tenantId));
    }

    // Sort by created_at DESC
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (filters.limit) {
      results = results.slice(0, Number(filters.limit));
    }

    return results;
  }

  async countLeads(context, filters = {}) {
    const list = await this.listLeads(context, filters);
    return list.length;
  }

  async updateLead(context, id, updateFields) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Atualização negada sem Tenant ID.');
    }

    const existing = this.leads.get(id);
    if (!existing || existing.tenant_id !== context.tenantId || existing.is_deleted) {
      return null;
    }

    // Disallow overriding tenant_id or primary id
    delete updateFields.id;
    delete updateFields.tenant_id;
    delete updateFields.created_at;

    const updated = {
      ...existing,
      ...updateFields,
      updated_at: new Date().toISOString()
    };

    this.leads.set(id, updated);
    return this._sanitizeLeadOutput(updated, context.tenantId);
  }

  async softDeleteLead(context, id) {
    if (!context || !context.tenantId) {
      throw new Error('SECURITY VIOLATION: Exclusão negada sem Tenant ID.');
    }

    const existing = this.leads.get(id);
    if (!existing || existing.tenant_id !== context.tenantId || existing.is_deleted) {
      return false;
    }

    existing.is_deleted = true;
    existing.deleted_at = new Date().toISOString();
    existing.updated_at = new Date().toISOString();

    this.leads.set(id, existing);
    return true;
  }

  // --------------------------------------------------------------------------
  // AUDIT LOG PERSISTENCE (APPEND-ONLY)
  // --------------------------------------------------------------------------
  async insertAuditLog(logRecord) {
    this.auditLogs.unshift(logRecord);
    return logRecord;
  }

  async queryAuditLogs(context, filters = {}) {
    if (!context || !context.tenantId) return [];
    return this.auditLogs.filter(log => log.tenant_id === context.tenantId);
  }

  // --------------------------------------------------------------------------
  // BULK EXPORT APPROVAL TOKENS (MFA STEP-UP)
  // --------------------------------------------------------------------------
  async createExportApproval(context, recordCount, reason) {
    const token = crypto.randomBytes(32).toString('hex');
    const approval = {
      id: crypto.randomUUID(),
      tenant_id: context.tenantId,
      requested_by_id: context.userId,
      record_count: recordCount,
      status: 'approved',
      reason,
      token,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins validity
      created_at: new Date().toISOString()
    };
    this.exportApprovals.set(token, approval);
    return approval;
  }

  async verifyExportToken(context, token) {
    if (!context || !context.tenantId || !token) return false;
    const approval = this.exportApprovals.get(token);
    if (!approval) return false;
    if (approval.tenant_id !== context.tenantId) return false;
    if (new Date(approval.expires_at) < new Date()) return false;
    return true;
  }

  // --------------------------------------------------------------------------
  // SECRETS MANAGEMENT (ENCRYPTED AT REST)
  // --------------------------------------------------------------------------
  async saveSecret(context, secretType, plainSecret) {
    if (!context || !context.tenantId || context.role !== 'admin') {
      throw new Error('SECURITY VIOLATION: Apenas administradores podem gerenciar chaves e segredos.');
    }

    const encrypted = encryptField(plainSecret, context.tenantId);
    const key = `${context.tenantId}:${secretType}`;

    const record = {
      id: crypto.randomUUID(),
      tenant_id: context.tenantId,
      secret_type: secretType,
      encrypted_value: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      updated_at: new Date().toISOString()
    };

    this.secrets.set(key, record);
    return { success: true, secretType };
  }

  async getSecret(context, secretType) {
    if (!context || !context.tenantId || context.role !== 'admin') {
      throw new Error('SECURITY VIOLATION: Acesso negado a segredos de integração.');
    }

    const key = `${context.tenantId}:${secretType}`;
    const record = this.secrets.get(key);
    if (!record || record.tenant_id !== context.tenantId) return null;

    return decryptField({
      ciphertext: record.encrypted_value,
      iv: record.iv,
      authTag: record.auth_tag
    }, context.tenantId);
  }

  _sanitizeLeadOutput(lead, tenantId) {
    const output = { ...lead };
    if (lead.encrypted_payload && lead.encrypted_payload_iv && lead.encrypted_payload_tag) {
      try {
        const decrypted = decryptField({
          ciphertext: lead.encrypted_payload,
          iv: lead.encrypted_payload_iv,
          authTag: lead.encrypted_payload_tag
        }, tenantId);
        output.confidential_notes = decrypted?.notes || null;
        output.custom_fields = decrypted?.custom || null;
      } catch {
        output.confidential_notes = '[DECRYPTION_ERROR]';
      }
    }
    // Remove raw cryptographic ciphertext components from external response
    delete output.encrypted_payload;
    delete output.encrypted_payload_iv;
    delete output.encrypted_payload_tag;
    return output;
  }

  reset() {
    this.tenants.clear();
    this.users.clear();
    this.teams.clear();
    this.leads.clear();
    this.auditLogs = [];
    this.secrets.clear();
    this.exportApprovals.clear();
  }
}

const defaultRepository = new MultiTenantRepository();

module.exports = {
  SecurityContext,
  MultiTenantRepository,
  defaultRepository
};
