-- ============================================================================
-- EDX Digital - Zero Trust Multi-Tenant Database Schema
-- Standard: ISO 27001 / SOC 2 Type II / LGPD / GDPR / OWASP ASVS 4.0
-- Database: PostgreSQL 14+ with Row-Level Security (RLS)
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. CORE TENANT MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'enterprise' CHECK (plan IN ('starter', 'pro', 'enterprise')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    max_users INT DEFAULT 50,
    max_leads INT DEFAULT 100000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ============================================================================
-- 3. TEAMS (ORGANIZATIONAL HIERARCHY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_team_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_tenant ON teams(tenant_id);

-- ============================================================================
-- 4. USERS & RBAC (ROLE-BASED ACCESS CONTROL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('vendedor', 'gerente', 'admin', 'system_auditor')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'pending_mfa')),
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip VARCHAR(45),
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret_encrypted TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_users_tenant_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_tenant_team ON users(tenant_id, team_id);

-- ============================================================================
-- 5. LEADS & OPPORTUNITIES (MULTI-TENANT ISOLATED DATA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    deal_value NUMERIC(15, 2) DEFAULT 0.00 CHECK (deal_value >= 0),
    stage VARCHAR(50) DEFAULT 'lead' CHECK (stage IN ('lead', 'contact', 'proposal', 'negotiation', 'won', 'lost')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    loss_reason VARCHAR(100),
    loss_details TEXT,
    -- Encrypted JSON field for confidential / PII information (AES-256-GCM)
    encrypted_payload TEXT,
    encrypted_payload_iv VARCHAR(32),
    encrypted_payload_tag VARCHAR(32),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_stage ON leads(tenant_id, stage) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_assigned ON leads(tenant_id, assigned_to_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_team ON leads(tenant_id, team_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id, created_at);

-- ============================================================================
-- 6. IMMUTABLE AUDIT TRAIL (COMPLIANCE & FORENSICS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'security_alert')),
    hash_chain VARCHAR(64), -- SHA-256 for cryptographic tamper-evidence
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crucial: Audit logs must be append-only. No updates or deletions allowed.
CREATE INDEX IF NOT EXISTS idx_audit_tenant_action ON audit_logs(tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_actor ON audit_logs(tenant_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_logs(severity) WHERE severity IN ('warning', 'critical', 'security_alert');

-- ============================================================================
-- 7. TENANT SECRETS & INTEGRATION TOKENS (ENCRYPTED AT REST)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    secret_type VARCHAR(50) NOT NULL CHECK (secret_type IN ('gemini_api_key', 'whatsapp_token', 'webhook_signing_secret', 'firebase_sa_key')),
    encrypted_value TEXT NOT NULL,
    iv VARCHAR(32) NOT NULL,
    auth_tag VARCHAR(32) NOT NULL,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_tenant_secret_type UNIQUE (tenant_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_tenant_secrets ON tenant_secrets(tenant_id);

-- ============================================================================
-- 8. BULK EXPORT SAFEGUARDS & AUDITABLE APPROVALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS export_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requested_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    approved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    record_count INT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'expired')),
    reason TEXT NOT NULL,
    verification_code_hash VARCHAR(255),
    export_token VARCHAR(128) UNIQUE,
    ip_address VARCHAR(45) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_requests_tenant ON export_requests(tenant_id, status);

-- ============================================================================
-- 9. ROW-LEVEL SECURITY (RLS) - ZERO DATA LEAKAGE ENFORCEMENT
-- ============================================================================

-- Enable RLS on all tenant data tables
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_requests ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS POLICIES FOR LEADS
-- Context Variables required per transaction:
--   app.current_tenant_id  (UUID)
--   app.current_user_id    (UUID)
--   app.current_user_role  ('admin' | 'gerente' | 'vendedor')
--   app.current_team_id    (UUID optional)
-- ----------------------------------------------------------------------------

-- Admin: Can view and manage all leads within their tenant
CREATE POLICY tenant_admin_leads_all ON leads
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'admin'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'admin'
    );

-- Gerente (Manager): Can view and update leads for their team or tenant
CREATE POLICY tenant_gerente_leads ON leads
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'gerente'
        AND (
            team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
            OR assigned_to_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR team_id IS NULL
        )
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'gerente'
    );

-- Vendedor (Salesperson): Can ONLY select and update leads assigned directly to them
CREATE POLICY tenant_vendedor_leads_select ON leads
    FOR SELECT
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'vendedor'
        AND (
            assigned_to_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
            OR created_by_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

CREATE POLICY tenant_vendedor_leads_insert ON leads
    FOR INSERT
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'vendedor'
        AND created_by_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    );

CREATE POLICY tenant_vendedor_leads_update ON leads
    FOR UPDATE
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'vendedor'
        AND assigned_to_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'vendedor'
        AND assigned_to_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    );

-- Vendedores CANNOT DELETE LEADS (ISO 27001 Integrity & Least Privilege)
-- (No DELETE policy for vendedor -> operations return 0 rows affected / denied)

-- ----------------------------------------------------------------------------
-- RLS POLICIES FOR AUDIT LOGS (APPEND-ONLY)
-- ----------------------------------------------------------------------------

-- All authenticated roles can INSERT audit logs for their tenant
CREATE POLICY tenant_audit_insert ON audit_logs
    FOR INSERT
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    );

-- Only Admin and System Auditor can SELECT audit logs
CREATE POLICY tenant_audit_select ON audit_logs
    FOR SELECT
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) IN ('admin', 'system_auditor')
    );

-- IMMUTABILITY GUARD: Strictly deny UPDATE and DELETE on audit_logs
CREATE OR REPLACE RULE protect_audit_logs_update AS
    ON UPDATE TO audit_logs DO INSTEAD NOTHING;

CREATE OR REPLACE RULE protect_audit_logs_delete AS
    ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ----------------------------------------------------------------------------
-- RLS POLICIES FOR SECRETS (CONFIDENTIALITY CID)
-- ----------------------------------------------------------------------------

-- Only Admin can access tenant secrets
CREATE POLICY tenant_secrets_admin_only ON tenant_secrets
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'admin'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
        AND current_setting('app.current_user_role', true) = 'admin'
    );
