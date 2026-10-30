PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES (1);
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','technician')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), permissions TEXT NOT NULL,
    UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL,
    expires_at REAL NOT NULL,
    FOREIGN KEY(tenant_id,principal_id) REFERENCES memberships(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES organizations(id),
    title TEXT NOT NULL, UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS assignments (
    tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL, job_id TEXT NOT NULL,
    PRIMARY KEY(tenant_id,principal_id,job_id),
    FOREIGN KEY(tenant_id,principal_id) REFERENCES memberships(tenant_id,id),
    FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT NOT NULL, tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL,
    PRIMARY KEY(tenant_id,id),
    FOREIGN KEY(tenant_id,principal_id) REFERENCES memberships(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS operation_requests (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL, requester_session_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    operation_id TEXT NOT NULL, arguments TEXT NOT NULL, digest TEXT NOT NULL,
    provider TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN
      ('verified_persisted','provider_accepted','pending_confirmation','rejected','failed')),
    receipt TEXT NOT NULL, created_at REAL NOT NULL,
    UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,id),
    FOREIGN KEY(tenant_id,principal_id) REFERENCES memberships(tenant_id,id),
    FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS approvals (
    tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
    expires_at REAL NOT NULL, decision TEXT NOT NULL DEFAULT 'pending'
      CHECK(decision IN ('pending','approved','rejected')),
    approver_id TEXT, approver_session_hash TEXT,
    PRIMARY KEY(tenant_id,request_id),
    FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id),
    FOREIGN KEY(tenant_id,approver_id) REFERENCES memberships(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, author_id TEXT NOT NULL,
    job_id TEXT NOT NULL, text TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
    FOREIGN KEY(tenant_id,author_id) REFERENCES memberships(tenant_id,id),
    FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id),
    FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id)
);
-- A fake provider owned by this database: no external side effects.
CREATE TABLE IF NOT EXISTS fake_service_requests (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT NOT NULL,
    text TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
    FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id),
    FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES organizations(id),
    principal_id TEXT NOT NULL, event TEXT NOT NULL, subject_id TEXT NOT NULL,
    created_at REAL NOT NULL
);
