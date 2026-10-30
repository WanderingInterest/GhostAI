"""Sole operation boundary: trusted session, schema, policy, approval, receipt."""
import hashlib
import json
import time

from . import connectors
from .contracts import OPERATIONS, Error, Status, bounded_text, result, strict_object
from .store import canonical, uid


def digest(tenant, principal, conversation, operation, arguments, provider):
    return hashlib.sha256(canonical([tenant, principal, conversation, operation, arguments, provider]).encode()).hexdigest()


class Gateway:
    def __init__(self, store):
        self.store = store

    def _authorize(self, db, actor, op, args):
        current = db.execute('SELECT * FROM memberships WHERE tenant_id=? AND id=? AND active=1',
                             (actor['tenant_id'], actor['id'])).fetchone()
        if not current:
            raise Error('Employee access revoked.', 403)
        scope = 'all' if current['role'] == 'owner' else json.loads(current['permissions']).get(op.operation_id)
        if scope not in op.scopes:
            raise Error('Operation is not permitted for this employee.', 403)
        if not db.execute('SELECT 1 FROM jobs WHERE tenant_id=? AND id=?',
                          (actor['tenant_id'], args['job_id'])).fetchone():
            raise Error('Job not found in this company.', 404)
        if scope != 'all' and not db.execute('''SELECT 1 FROM assignments
            WHERE tenant_id=? AND principal_id=? AND job_id=?''',
                                            (actor['tenant_id'], actor['id'], args['job_id'])).fetchone():
            raise Error('This job is outside the employee’s assigned scope.', 403)
        return scope

    def submit(self, token, payload):
        strict_object(payload, ('operation_id','arguments','idempotency_key','conversation_id'))
        operation = bounded_text(payload['operation_id'], 'operation_id', 120)
        if operation not in OPERATIONS:
            raise Error('Operation is not registered.')
        op = OPERATIONS[operation]
        args = op.validate(payload['arguments'])
        key = bounded_text(payload['idempotency_key'], 'idempotency_key', 120)
        conversation = bounded_text(payload['conversation_id'], 'conversation_id', 120)
        with self.store.transaction() as db:
            actor = self.store.authenticate(db, token)
            tenant, principal = actor['tenant_id'], actor['id']
            self._authorize(db, actor, op, args)
            existing_conversation = db.execute('SELECT principal_id FROM conversations WHERE tenant_id=? AND id=?',
                                               (tenant, conversation)).fetchone()
            if existing_conversation and existing_conversation[0] != principal:
                raise Error('Conversation belongs to a different employee.', 403)
            proposal = digest(tenant, principal, conversation, operation, args, op.provider)
            existing = db.execute('SELECT * FROM operation_requests WHERE tenant_id=? AND idempotency_key=?',
                                  (tenant, key)).fetchone()
            if existing:
                if existing['digest'] != proposal:
                    raise Error('Idempotency key already belongs to a different proposal.', 409)
                if op.risk == 'READ' and existing['status'] == Status.VERIFIED:
                    return self._execute(db, tenant, existing['id'])
                return json.loads(existing['receipt'])
            db.execute('INSERT OR IGNORE INTO conversations VALUES (?,?,?)', (conversation, tenant, principal))
            request = uid()
            receipt = result(request, operation, Status.PENDING)
            db.execute('''INSERT INTO operation_requests
                (id,tenant_id,principal_id,conversation_id,requester_session_hash,idempotency_key,
                 operation_id,arguments,digest,provider,status,receipt,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (request, tenant, principal, conversation, actor['token_hash'], key, operation,
                        canonical(args), proposal, op.provider, Status.PENDING, canonical(receipt), time.time()))
            self.store.audit(db, tenant, principal, 'operation.requested', request)
            if op.risk == 'SENSITIVE':
                db.execute('INSERT INTO approvals (tenant_id,request_id,digest,expires_at) VALUES (?,?,?,?)',
                           (tenant, request, proposal, time.time() + 600))
                self.store.audit(db, tenant, principal, 'approval.requested', request)
            else:
                receipt = self._execute(db, tenant, request)
        return receipt

    def decide(self, token, request_id, approve):
        if type(approve) is not bool:
            raise Error('approve must be boolean.')
        with self.store.transaction() as db:
            owner = self.store.owner(db, token)
            tenant = owner['tenant_id']
            row = db.execute('''SELECT a.*,r.status FROM approvals a JOIN operation_requests r
                ON r.tenant_id=a.tenant_id AND r.id=a.request_id
                WHERE a.tenant_id=? AND a.request_id=?''', (tenant, request_id)).fetchone()
            if not row:
                raise Error('Approval not found.', 404)
            if row['decision'] != 'pending' or row['status'] != Status.PENDING:
                raise Error('Approval decision is already final.', 409)
            expired = row['expires_at'] <= time.time()
            decision = 'approved' if approve and not expired else 'rejected'
            db.execute('''UPDATE approvals SET decision=?,approver_id=?,approver_session_hash=?
                WHERE tenant_id=? AND request_id=?''',
                       (decision, owner['id'], owner['token_hash'], tenant, request_id))
            self.store.audit(db, tenant, owner['id'], 'approval.' + ('expired' if expired else decision), request_id)
            if decision == 'rejected':
                req = db.execute('SELECT * FROM operation_requests WHERE tenant_id=? AND id=?',
                                 (tenant, request_id)).fetchone()
                return self._finish(db, req, Status.REJECTED, error='Approval expired.' if expired else 'Owner denied request.')
            return dict(request_id=request_id, decision=decision)

    def execute(self, token, request_id):
        with self.store.transaction() as db:
            caller = self.store.authenticate(db, token)
            tenant = caller['tenant_id']
            req = db.execute('SELECT * FROM operation_requests WHERE tenant_id=? AND id=?',
                             (tenant, request_id)).fetchone()
            if not req or (caller['role'] != 'owner' and req['principal_id'] != caller['id']):
                raise Error('Request not found.', 404)
            # Recheck before returning even cached receipts containing resource IDs.
            if caller['role'] != 'owner':
                self._authorize(db, caller, OPERATIONS[req['operation_id']], json.loads(req['arguments']))
            if req['status'] != Status.PENDING:
                if OPERATIONS[req['operation_id']].risk == 'READ' and req['status'] == Status.VERIFIED:
                    return self._execute(db, tenant, request_id)
                return json.loads(req['receipt'])
            return self._execute(db, tenant, request_id)

    def _finish(self, db, req, status, data=None, error=None):
        receipt = result(req['id'], req['operation_id'], status, data, error)
        db.execute('UPDATE operation_requests SET status=?,receipt=? WHERE tenant_id=? AND id=?',
                   (status, canonical({**receipt, 'data': {}} if OPERATIONS[req['operation_id']].risk == 'READ' else receipt), req['tenant_id'], req['id']))
        self.store.audit(db, req['tenant_id'], req['principal_id'], 'operation.' + str(status), req['id'])
        return receipt

    def _execute(self, db, tenant, request_id):
        req = db.execute('SELECT * FROM operation_requests WHERE tenant_id=? AND id=?', (tenant, request_id)).fetchone()
        op = OPERATIONS[req['operation_id']]
        args = op.validate(json.loads(req['arguments']))
        try:
            actor = db.execute('''SELECT m.* FROM memberships m JOIN sessions s
                ON s.tenant_id=m.tenant_id AND s.principal_id=m.id
                WHERE m.tenant_id=? AND m.id=? AND m.active=1 AND s.token_hash=? AND s.expires_at>?''',
                               (tenant, req['principal_id'], req['requester_session_hash'], time.time())).fetchone()
            if not actor:
                raise Error('Requesting employee session expired or access revoked.', 403)
            scope = self._authorize(db, actor, op, args)
            expected = digest(tenant, actor['id'], req['conversation_id'], op.operation_id, args, op.provider)
            if req['digest'] != expected or req['provider'] != op.provider:
                raise Error('Proposal integrity check failed.', 403)
            if op.risk == 'SENSITIVE':
                approval = db.execute('SELECT * FROM approvals WHERE tenant_id=? AND request_id=?',
                                      (tenant, request_id)).fetchone()
                if not approval or approval['digest'] != expected or approval['expires_at'] <= time.time():
                    raise Error('Approval expired or proposal changed.', 403)
                if approval['decision'] == 'pending':
                    return json.loads(req['receipt'])
                if approval['decision'] != 'approved':
                    raise Error('Approval denied.', 403)
                approver = db.execute('''SELECT 1 FROM memberships m JOIN sessions s
                    ON s.tenant_id=m.tenant_id AND s.principal_id=m.id
                    WHERE m.tenant_id=? AND m.id=? AND m.active=1 AND m.role='owner'
                    AND s.token_hash=? AND s.expires_at>?''',
                                      (tenant, approval['approver_id'], approval['approver_session_hash'], time.time())).fetchone()
                if not approver:
                    raise Error('Approver authorization expired or was revoked.', 403)
        except Error as error:
            return self._finish(db, req, Status.REJECTED, error=str(error))
        # Savepoint prevents a failed adapter from leaving a write behind a failed receipt.
        db.execute('SAVEPOINT adapter_write')
        started = time.monotonic()
        try:
            data = connectors._invoke(db, op.operation_id, actor, args, request_id, scope)
            if time.monotonic() - started > op.timeout_seconds:
                raise TimeoutError('Local operation exceeded deadline')
            db.execute('RELEASE adapter_write')
        except Exception:
            db.execute('ROLLBACK TO adapter_write')
            db.execute('RELEASE adapter_write')
            return self._finish(db, req, Status.FAILED, error='Operation failed; no local changes were saved.')
        return self._finish(db, req, Status.VERIFIED, data=data)
