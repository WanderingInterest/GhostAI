"""Durable local storage. Transactions serialize policy changes and prototype writes."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import time
import uuid

from .contracts import DEFAULT_PERMISSIONS, Error, bounded_text, validate_permissions


def uid():
    return uuid.uuid4().hex


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.executescript((Path(__file__).resolve().parent.parent / 'infra/schema.sql').read_text())

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def audit(self, db, tenant, actor, event, subject):
        db.execute('INSERT INTO audit_events VALUES (?,?,?,?,?,?)',
                   (uid(), tenant, actor, event, subject, time.time()))

    def issue_session(self, db, tenant, principal):
        token = secrets.token_urlsafe(32)
        db.execute('INSERT INTO sessions VALUES (?,?,?,?)',
                   (token_hash(token), tenant, principal, time.time() + 86400))
        return token

    def authenticate(self, db, token):
        if not isinstance(token, str) or not token or len(token) > 200:
            raise Error('Access code required.', 401)
        row = db.execute('''SELECT m.*, s.token_hash FROM sessions s JOIN memberships m
            ON m.tenant_id=s.tenant_id AND m.id=s.principal_id
            WHERE s.token_hash=? AND s.expires_at>? AND m.active=1''',
                         (token_hash(token), time.time())).fetchone()
        if not row:
            raise Error('Session expired or access revoked.', 401)
        return dict(row)

    def owner(self, db, token):
        actor = self.authenticate(db, token)
        if actor['role'] != 'owner':
            raise Error('Company owner access required.', 403)
        return actor

    def create_company(self, name):
        name = bounded_text(name, 'company', 120)
        with self.transaction() as db:
            tenant, owner = uid(), uid()
            db.execute('INSERT INTO organizations VALUES (?,?)', (tenant, name))
            db.execute('INSERT INTO memberships VALUES (?,?,?,?,?,?)',
                       (owner, tenant, 'Owner', 'owner', 1, '{}'))
            token = self.issue_session(db, tenant, owner)
            for title in ('Johnson property — weekly service', 'Martinez property — repair visit'):
                db.execute('INSERT INTO jobs VALUES (?,?,?)', (uid(), tenant, title))
            self.audit(db, tenant, owner, 'company.created', tenant)
        return dict(tenant_id=tenant, principal_id=owner, access_code=token)

    def staff(self, token, payload, member_id=None):
        from .contracts import strict_object
        strict_object(payload, ('name', 'permissions', 'job_ids', 'active'))
        name = bounded_text(payload['name'], 'name', 120)
        permissions = validate_permissions(payload['permissions'])
        jobs = payload['job_ids']
        if not isinstance(jobs, list) or len(jobs) > 100 or any(not isinstance(j, str) for j in jobs):
            raise Error('job_ids must be a list of at most 100 job IDs.')
        if type(payload['active']) is not bool:
            raise Error('active must be boolean.')
        with self.transaction() as db:
            owner = self.owner(db, token)
            tenant = owner['tenant_id']
            if member_id:
                member = db.execute('SELECT * FROM memberships WHERE tenant_id=? AND id=?',
                                    (tenant, member_id)).fetchone()
                if not member or member['role'] != 'technician':
                    raise Error('Technician not found.', 404)
            for job in jobs:
                if not db.execute('SELECT 1 FROM jobs WHERE tenant_id=? AND id=?', (tenant, job)).fetchone():
                    raise Error('Job not found in this company.', 404)
            member = member_id or uid()
            if member_id:
                db.execute('UPDATE memberships SET name=?,permissions=?,active=? WHERE tenant_id=? AND id=?',
                           (name, canonical(permissions), int(payload['active']), tenant, member))
                db.execute('DELETE FROM assignments WHERE tenant_id=? AND principal_id=?', (tenant, member))
            else:
                db.execute('INSERT INTO memberships VALUES (?,?,?,?,?,?)',
                           (member, tenant, name, 'technician', int(payload['active']), canonical(permissions)))
            for job in set(jobs):
                db.execute('INSERT INTO assignments VALUES (?,?,?)', (tenant, member, job))
            # Revocation kills sessions permanently; reactivation requires a new enrollment in Phase 0.
            if not payload['active']:
                db.execute('DELETE FROM sessions WHERE tenant_id=? AND principal_id=?', (tenant, member))
            access = self.issue_session(db, tenant, member) if not member_id and payload['active'] else None
            self.audit(db, tenant, owner['id'], 'staff.updated' if member_id else 'staff.enrolled', member)
        return dict(principal_id=member, access_code=access)

    def snapshot(self, token):
        from .contracts import OPERATIONS
        with self.transaction() as db:
            actor = self.authenticate(db, token)
            tenant = actor['tenant_id']
            owner = actor['role'] == 'owner'
            permissions = {name: 'all' for name in OPERATIONS} if owner else json.loads(actor['permissions'])
            jobs = [dict(r) for r in db.execute('SELECT id,title FROM jobs WHERE tenant_id=?', (tenant,))]
            # Job names are private too; note-only staff see only accessible targets.
            assigned = {r[0] for r in db.execute('SELECT job_id FROM assignments WHERE tenant_id=? AND principal_id=?',
                                               (tenant, actor['id']))}
            if not owner:
                jobs = [j for j in jobs if 'all' in permissions.values() or
                        (permissions and j['id'] in assigned)]
            staff, approvals, audit = [], [], []
            if owner:
                for row in db.execute('SELECT id,name,role,active,permissions FROM memberships WHERE tenant_id=?', (tenant,)):
                    member = dict(row)
                    member['permissions'] = json.loads(member['permissions'])
                    member['job_ids'] = [r[0] for r in db.execute(
                        'SELECT job_id FROM assignments WHERE tenant_id=? AND principal_id=?', (tenant, member['id']))]
                    staff.append(member)
                approvals = [dict(r) for r in db.execute('''SELECT r.id,r.operation_id,r.arguments,m.name,
                    a.decision,a.expires_at FROM operation_requests r JOIN approvals a
                    ON a.tenant_id=r.tenant_id AND a.request_id=r.id
                    JOIN memberships m ON m.id=r.principal_id AND m.tenant_id=r.tenant_id
                    WHERE r.tenant_id=? AND r.status='pending_confirmation' ''', (tenant,))]
                audit = [dict(r) for r in db.execute('''SELECT event,subject_id,created_at FROM audit_events
                    WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30''', (tenant,))]
            receipts = [json.loads(r[0]) for r in db.execute('''SELECT receipt FROM operation_requests
                WHERE tenant_id=? AND (?=1 OR principal_id=?) ORDER BY created_at DESC LIMIT 20''',
                                                           (tenant, int(owner), actor['id']))]
            # Receipts of formerly authorized records must not leak revoked content.
            receipts = [{k: r[k] for k in ('request_id','operation_id','status','error')} for r in receipts]
            company = db.execute('SELECT name FROM organizations WHERE id=?', (tenant,)).fetchone()[0]
            return dict(company=company, actor={k: actor[k] for k in ('id','name','role')},
                        permissions=permissions, jobs=jobs, staff=staff, approvals=approvals,
                        receipts=receipts, audit=audit,
                        operations=[dict(id=op.operation_id, risk=op.risk, provider=op.provider,
                                         scopes=op.scopes) for op in OPERATIONS.values()],
                        default_permissions=DEFAULT_PERMISSIONS)
