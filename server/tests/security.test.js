/**
 * EDX Digital - Automated Security Unit Tests
 * Standards: OWASP Top 10 API, ISO 27001, BOLA, IDOR, Zero Trust
 * Test Framework: Node.js Native Test Runner (node:test & node:assert)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { MultiTenantRepository, SecurityContext } = require('../database/repository');
const { LeadController } = require('../controllers/lead-controller');
const { ExportController } = require('../controllers/export-controller');
const { SecureWebhookController } = require('../controllers/secure-webhook-controller');
const {
  hashPassword,
  verifyPassword,
  encryptField,
  decryptField,
  generateWebhookSignature
} = require('../security/crypto-service');
const { auditService, AUDIT_ACTIONS } = require('../security/audit-service');
const { RateLimiter } = require('../security/rate-limiter');

test('🔒 [ZERO TRUST] Multi-Tenant Architecture & CyberSecurity Test Suite', async (t) => {
  let repo;
  let leadCtrl;
  let exportCtrl;
  let webhookCtrl;

  let tenantA;
  let tenantB;
  let userAdminA;
  let userVendedorA1;
  let userVendedorA2;
  let userGerenteA;
  let userAdminB;
  let userVendedorB;

  t.beforeEach(async () => {
    repo = new MultiTenantRepository();
    leadCtrl = new LeadController(repo);
    exportCtrl = new ExportController(repo);
    webhookCtrl = new SecureWebhookController(repo);
    auditService.setDbAdapter(repo);

    // Setup Tenant A (Empresa Alpha)
    tenantA = await repo.createTenant({ name: 'Alpha Corporation', slug: 'alpha-corp' });

    // Users in Tenant A
    userAdminA = { id: crypto.randomUUID(), tenantId: tenantA.id, role: 'admin' };
    userGerenteA = { id: crypto.randomUUID(), tenantId: tenantA.id, role: 'gerente', teamId: 'team-enterprise-01' };
    userVendedorA1 = { id: crypto.randomUUID(), tenantId: tenantA.id, role: 'vendedor', teamId: 'team-enterprise-01' };
    userVendedorA2 = { id: crypto.randomUUID(), tenantId: tenantA.id, role: 'vendedor', teamId: 'team-retail-02' };

    // Setup Tenant B (Empresa Beta - Concorrente)
    tenantB = await repo.createTenant({ name: 'Beta Industries', slug: 'beta-ind' });
    userAdminB = { id: crypto.randomUUID(), tenantId: tenantB.id, role: 'admin' };
    userVendedorB = { id: crypto.randomUUID(), tenantId: tenantB.id, role: 'vendedor' };
  });

  // ==========================================================================
  // 1. ISOLAMENTO MULTITENANT ABSOLUTO (ANTI-BOLA / ANTI-IDOR)
  // ==========================================================================
  await t.test('1. Isolamento Multitenant: Tenant B NUNCA acessa dados do Tenant A', async () => {
    const ctxA = new SecurityContext(userAdminA);
    const ctxB = new SecurityContext(userAdminB);

    // Cria lead confidencial no Tenant A
    const leadA = await repo.createLead(ctxA, {
      name: 'Contrato Estratégico Alpha',
      deal_value: 500000.0,
      confidential_notes: 'Dados estritamente confidenciais do Tenant A'
    });

    // Tenant B tenta ler o lead do Tenant A por ID direto (Tentativa de IDOR / BOLA)
    const readAttempt = await leadCtrl.getById(ctxB, leadA.id);
    assert.equal(readAttempt.status, 404, 'Deve retornar 404 para impedir inferência de existência entre tenants.');

    // Tenant B tenta atualizar o lead do Tenant A
    const updateAttempt = await leadCtrl.update(ctxB, leadA.id, { deal_value: 0 });
    assert.equal(updateAttempt.status, 404, 'Tenant B não pode atualizar lead do Tenant A.');

    // Tenant B tenta deletar o lead do Tenant A
    const deleteAttempt = await leadCtrl.delete(ctxB, leadA.id);
    assert.equal(deleteAttempt.status, 404, 'Tenant B não pode deletar lead do Tenant A.');

    // Tenant B lista leads e não deve ver nenhum registro do Tenant A
    const listB = await leadCtrl.list(ctxB);
    assert.equal(listB.body.count, 0, 'Listagem do Tenant B deve vir vazia.');
  });

  // ==========================================================================
  // 2. CONTROLE DE ACESSO GRANULAR (RBAC: VENDEDOR VS GERENTE VS ADMIN)
  // ==========================================================================
  await t.test('2. RBAC: Vendedor só manipula os próprios leads e é impedido de deletar', async () => {
    const ctxAdmin = new SecurityContext(userAdminA);
    const ctxVendedor1 = new SecurityContext(userVendedorA1);
    const ctxVendedor2 = new SecurityContext(userVendedorA2);

    // Cria lead atribuído ao Vendedor 1
    const lead1 = await repo.createLead(ctxVendedor1, {
      name: 'Cliente do Vendedor 1',
      deal_value: 15000.0,
      assigned_to_id: userVendedorA1.id
    });

    // Cria lead atribuído ao Vendedor 2
    const lead2 = await repo.createLead(ctxVendedor2, {
      name: 'Cliente do Vendedor 2',
      deal_value: 25000.0,
      assigned_to_id: userVendedorA2.id
    });

    // Vendedor 1 tenta ler o lead do Vendedor 2
    const bolaReadAttempt = await leadCtrl.getById(ctxVendedor1, lead2.id);
    assert.equal(bolaReadAttempt.status, 403, 'Vendedor 1 deve receber 403 Forbidden ao tentar ler lead de outro vendedor.');

    // Vendedor 1 tenta atualizar o lead do Vendedor 2
    const bolaUpdateAttempt = await leadCtrl.update(ctxVendedor1, lead2.id, { deal_value: 100 });
    assert.equal(bolaUpdateAttempt.status, 403, 'Vendedor 1 deve receber 403 Forbidden ao tentar atualizar lead de outro vendedor.');

    // Vendedor 1 tenta excluir o seu próprio lead (Integridade ISO 27001)
    const deleteAttempt = await leadCtrl.delete(ctxVendedor1, lead1.id);
    assert.equal(deleteAttempt.status, 403, 'Vendedores não possuem permissão de exclusão (Apenas Administradores).');

    // Admin exclui o lead com sucesso
    const adminDelete = await leadCtrl.delete(ctxAdmin, lead1.id);
    assert.equal(adminDelete.status, 200, 'Administrador deve poder realizar soft-delete com sucesso.');
  });

  // ==========================================================================
  // 3. TRAVA DE SEGURANÇA PARA EXPORTAÇÃO EM MASSA (> 100 CONTATOS / MFA)
  // ==========================================================================
  await t.test('3. Trava de Segurança: Exportação bloqueada para não-admins e >100 exige MFA', async () => {
    const ctxAdmin = new SecurityContext(userAdminA);
    const ctxVendedor = new SecurityContext(userVendedorA1);

    // Seed: Cadastra 105 leads no Tenant A
    for (let i = 1; i <= 105; i++) {
      await repo.createLead(ctxAdmin, {
        name: `Lead em Volume #${i}`,
        deal_value: 1000.0 + i,
        assigned_to_id: userVendedorA1.id
      });
    }

    // 1. Vendedor tenta exportar -> Bloqueio Imediato (403)
    const vendedorExport = await exportCtrl.exportLeads(ctxVendedor);
    assert.equal(vendedorExport.status, 403);
    assert.match(vendedorExport.body.error, /Vendedores não possuem autorização/);

    // 2. Admin tenta exportar sem Token de Aprovação MFA -> Bloqueio por Volume (>100)
    const adminBulkBlocked = await exportCtrl.exportLeads(ctxAdmin, { approval_token: '' });
    assert.equal(adminBulkBlocked.status, 403);
    assert.equal(adminBulkBlocked.body.requiresMfa, true, 'Deve exigir aprovação secundária/MFA.');
    assert.match(adminBulkBlocked.body.error, /TRAVA DE SEGURANÇA/);

    // 3. Admin solicita token de aprovação MFA
    const approvalReq = await exportCtrl.requestBulkExportApproval(ctxAdmin, {
      record_count: 105,
      reason: 'Backup e Auditoria Trimestral Autorizada'
    });
    assert.equal(approvalReq.status, 200);
    const validToken = approvalReq.body.approvalToken;

    // 4. Admin reexecuta exportação com o token verificado -> Sucesso (200)
    const adminBulkSuccess = await exportCtrl.exportLeads(ctxAdmin, { approval_token: validToken });
    assert.equal(adminBulkSuccess.status, 200);
    assert.equal(adminBulkSuccess.body.recordCount, 105);
  });

  // ==========================================================================
  // 4. CRIPTOGRAFIA EM REPOUSO (AES-256-GCM COM BINDING DE TENANT - AAD)
  // ==========================================================================
  await t.test('4. Criptografia AES-256-GCM: Proteção contra ataque de transplante entre tenants', async () => {
    const secretNotes = 'Chave Pix Secreta e Dados Bancários do Cliente';

    // Criptografa associado ao Tenant A (AAD = tenantA.id)
    const encrypted = encryptField(secretNotes, tenantA.id);
    assert.ok(encrypted.ciphertext);
    assert.equal(encrypted.iv.length, 24, 'IV deve ter 12 bytes (24 caracteres hex).');
    assert.equal(encrypted.authTag.length, 32, 'Auth Tag deve ter 16 bytes (32 caracteres hex).');

    // Descriptografa com o Tenant A correto -> Sucesso
    const decrypted = decryptField(encrypted, tenantA.id);
    assert.equal(decrypted, secretNotes);

    // Tentativa de transplante de dados: Atacante tenta descriptografar no contexto do Tenant B
    assert.throws(() => {
      decryptField(encrypted, tenantB.id);
    }, /DECRYPTION_FAILED/, 'Deve falhar com erro criptográfico se o Tenant ID for adulterado (Tríade CID: Integridade).');
  });

  // ==========================================================================
  // 5. HASHING SEGURO DE SENHAS (SCRYPT COM SALT DINÂMICO)
  // ==========================================================================
  await t.test('5. Hashing de Senhas: Salt dinâmico e tempo constante', async () => {
    const rawPass = 'MinhaSenhaUltraSegura#2026';
    const hash1 = await hashPassword(rawPass);
    const hash2 = await hashPassword(rawPass);

    assert.notEqual(hash1, hash2, 'Duas senhas iguais devem gerar hashes diferentes devido ao salt dinâmico.');
    assert.ok(hash1.startsWith('$scrypt$N=32768,r=8,p=1$'));

    // Valida senha correta
    const isValid = await verifyPassword(rawPass, hash1);
    assert.equal(isValid, true);

    // Valida senha errada
    const isInvalid = await verifyPassword('SenhaIncorreta!123', hash1);
    assert.equal(isInvalid, false);
  });

  // ==========================================================================
  // 6. VALIDAÇÃO DE WEBHOOKS COM ASSINATURA HMAC-SHA256
  // ==========================================================================
  await t.test('6. Webhook HMAC-SHA256: Rejeição de requisições adulteradas ou não assinadas', async () => {
    const webhookSecret = 'whsec_enterprise_top_secret_key_8849204';
    const ctxAdmin = new SecurityContext(userAdminA);

    // Salva a chave de assinatura nas configurações do Tenant A
    await repo.saveSecret(ctxAdmin, 'webhook_signing_secret', webhookSecret);

    const payload = JSON.stringify({
      name: 'Lead do Meta Ads',
      email: 'lead.meta@empresa.com',
      deal_value: 3500.0
    });

    // 1. Envio sem assinatura -> Rejeitado 401
    const noSigResult = await webhookCtrl.handleIngest(payload, null, tenantA.id);
    assert.equal(noSigResult.status, 401);
    assert.match(noSigResult.body.error, /Assinatura HMAC-SHA256 ausente/i);

    // 2. Envio com assinatura falsa/adulterada -> Rejeitado 401
    const fakeSigResult = await webhookCtrl.handleIngest(payload, 'deadbeef1234567890abcdef', tenantA.id);
    assert.equal(fakeSigResult.status, 401);
    assert.match(fakeSigResult.body.error, /Assinatura HMAC inválida/i);

    // 3. Envio com assinatura HMAC-SHA256 legítima -> Aceito 201
    const validSignature = generateWebhookSignature(Buffer.from(payload, 'utf8'), webhookSecret);
    const validResult = await webhookCtrl.handleIngest(payload, validSignature, tenantA.id);
    assert.equal(validResult.status, 201);
    assert.equal(validResult.body.success, true);
  });

  // ==========================================================================
  // 7. RATE LIMITING (DEFESA CONTRA DDOS & RASPAGEM DE DADOS)
  // ==========================================================================
  await t.test('7. Rate Limiting: Bloqueio por IP e Tenant', async () => {
    const testLimiter = new RateLimiter();
    const testIp = '203.0.113.42';
    const testTenant = crypto.randomUUID();

    // Simula 5 requisições rápidas com limite de 5
    for (let i = 0; i < 5; i++) {
      const res = testLimiter.checkDual(testIp, testTenant, { maxIp: 5, windowIpMs: 60000 });
      assert.equal(res.allowed, true);
    }

    // A 6ª requisição deve ser bloqueada
    const blockedRes = testLimiter.checkDual(testIp, testTenant, { maxIp: 5, windowIpMs: 60000 });
    assert.equal(blockedRes.allowed, false);
    assert.equal(blockedRes.scope, 'ip');
    assert.match(blockedRes.error, /Muitas requisições/);

    testLimiter.destroy();
  });

  // ==========================================================================
  // 8. AUDITORIA IMUTÁVEL COM HASH CHAINING E REDAÇÃO AUTOMÁTICA
  // ==========================================================================
  await t.test('8. Trilha de Auditoria: Sanitização de credenciais e hash chaining imutável', async () => {
    const auditRecord = await auditService.log({
      tenantId: tenantA.id,
      actorId: userAdminA.id,
      actorRole: userAdminA.role,
      action: AUDIT_ACTIONS.LEAD_CREATE,
      entityType: 'LEAD',
      entityId: 'lead-test-01',
      oldValues: null,
      newValues: {
        name: 'Cliente VIP',
        password_hash: 'super_secret_hash_value', // Deve ser redigido
        api_key: 'sk_live_123456789'             // Deve ser redigido
      },
      ipAddress: '198.51.100.12',
      severity: 'info'
    });

    assert.ok(auditRecord.hash_chain, 'Deve conter hash SHA-256 criptográfico para prova de integridade.');
    assert.equal(auditRecord.newValues.password_hash, '[REDACTED_CONFIDENTIAL]', 'Hash de senha deve ser ocultado no log.');
    assert.equal(auditRecord.newValues.api_key, '[REDACTED_CONFIDENTIAL]', 'Chaves de API devem ser ocultadas no log.');
  });

  // ==========================================================================
  // 9. DEFESA CONTRA SQL INJECTION (SQLi) EM FILTROS E IDS
  // ==========================================================================
  await t.test('9. SQL Injection: Payloads maliciosos em parâmetros não vazam dados', async () => {
    const ctxAdmin = new SecurityContext(userAdminA);

    await repo.createLead(ctxAdmin, {
      name: 'Lead Legítimo Alpha',
      deal_value: 10000.0,
      stage: 'won'
    });

    // Injeção SQL clássica tentando quebrar a cláusula WHERE
    const sqliPayloads = [
      "' OR '1'='1",
      "'; DROP TABLE leads; --",
      "admin'--",
      "1' UNION SELECT * FROM users --"
    ];

    for (const payload of sqliPayloads) {
      const result = await leadCtrl.list(ctxAdmin, { stage: payload });
      assert.equal(result.status, 200);
      assert.equal(result.body.count, 0, `Payload SQLi "${payload}" não deve retornar registros.`);
    }
  });

  // ==========================================================================
  // 10. ISOLAMENTO DE EQUIPES (GERENTE TEAM-BOUNDARY)
  // ==========================================================================
  await t.test('10. Isolamento de Equipes: Gerente só acessa leads do seu próprio time', async () => {
    const ctxGerente = new SecurityContext(userGerenteA); // teamId: 'team-enterprise-01'
    const ctxVendedorTeam1 = new SecurityContext(userVendedorA1); // teamId: 'team-enterprise-01'
    const ctxVendedorTeam2 = new SecurityContext(userVendedorA2); // teamId: 'team-retail-02'

    // Lead criado para o time 1 (do Gerente)
    const leadTeam1 = await repo.createLead(ctxVendedorTeam1, {
      name: 'Lead Equipe Enterprise',
      team_id: 'team-enterprise-01',
      assigned_to_id: userVendedorA1.id
    });

    // Lead criado para o time 2 (fora do escopo do Gerente)
    const leadTeam2 = await repo.createLead(ctxVendedorTeam2, {
      name: 'Lead Equipe Varejo',
      team_id: 'team-retail-02',
      assigned_to_id: userVendedorA2.id
    });

    // Gerente acessa lead do seu time -> Permitido (200)
    const accessTeam1 = await leadCtrl.getById(ctxGerente, leadTeam1.id);
    assert.equal(accessTeam1.status, 200);

    // Gerente tenta acessar lead do outro time -> Negado BOLA (403)
    const accessTeam2 = await leadCtrl.getById(ctxGerente, leadTeam2.id);
    assert.equal(accessTeam2.status, 403);
    assert.match(accessTeam2.body.error, /BOLA/);
  });
});

