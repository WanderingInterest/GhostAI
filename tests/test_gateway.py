from concurrent.futures import ThreadPoolExecutor
import json
import hashlib
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from ghostai.contracts import DEFAULT_PERMISSIONS, Error, OPERATIONS, Status
from ghostai.gateway import Gateway
from ghostai.store import Store, uid


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'test.sqlite3'
        self.store = Store(self.path)
        self.gateway = Gateway(self.store)
        self.company = self.store.create_company('Pool Company')
        self.owner = self.company['access_code']
        self.other = self.store.create_company('Other Company')['access_code']
        self.jobs = self.store.snapshot(self.owner)['jobs']
        self.job = self.jobs[0]['id']
        self.permissions = {**DEFAULT_PERMISSIONS, 'service_request.create':'assigned'}
        self.staff_data = dict(name='Alex', permissions=self.permissions, job_ids=[self.job], active=True)
        self.employee = self.store.staff(self.owner, self.staff_data)
        self.tech = self.employee['access_code']

    def tearDown(self):
        self.temp.cleanup()

    def proposal(self, operation='business_note.create', job=None, text='Service complete', key=None, **extras):
        args = {'job_id': job or self.job}
        if 'text' in OPERATIONS[operation].fields:
            args['text'] = text
        return dict(operation_id=operation, arguments=args, idempotency_key=key or uid(),
                    conversation_id='test-conversation', **extras)

    def submit(self, token=None, **kwargs):
        token = token or self.tech
        payload = self.proposal(**kwargs)
        payload['conversation_id'] = hashlib.sha256(token.encode()).hexdigest()
        return self.gateway.submit(token, payload)

    def pending(self):
        return self.submit(operation='service_request.create')['request_id']

    def update(self, **changes):
        self.staff_data = {**self.staff_data, **changes}
        return self.store.staff(self.owner, self.staff_data, self.employee['principal_id'])

    def count(self, table):
        with self.store.transaction() as db:
            return db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]

    def test_native_note_verified_and_read_back(self):
        receipt = self.submit()
        self.assertEqual(receipt['status'], Status.VERIFIED)
        self.assertEqual(receipt['data']['provider'], 'native')
        notes = self.submit(operation='business_note.list')['data']['notes']
        self.assertEqual(notes[0]['text'], 'Service complete')
        self.assertEqual(notes[0]['id'], receipt['data']['record_id'])

    def test_unknown_operations_and_extra_identity_fields_rejected(self):
        payload = self.proposal()
        for change in ({'operation_id':'shell.exec'}, {'tenant_id':self.company['tenant_id']},
                       {'principal_id':self.employee['principal_id']}, {'arguments':{'job_id':self.job,'text':'x','risk':'READ'}}):
            with self.subTest(change=change), self.assertRaises(Error):
                self.gateway.submit(self.tech, {**payload, **change})
        self.assertEqual(self.count('notes'), 0)

    def test_strict_types_empty_and_size_limits(self):
        for value in ('', 123, None, ['x'], 'x'*2001):
            payload = self.proposal()
            payload['arguments']['text'] = value
            with self.subTest(value=str(value)[:20]), self.assertRaises(Error):
                self.gateway.submit(self.tech, payload)

    def test_default_permissions_and_owner_customization(self):
        new = self.store.staff(self.owner, dict(name='New', permissions=DEFAULT_PERMISSIONS, job_ids=[self.job], active=True))
        self.assertEqual(self.store.snapshot(new['access_code'])['permissions'], DEFAULT_PERMISSIONS)
        with self.assertRaises(Error):
            self.submit(new['access_code'], operation='service_request.create')
        self.update(permissions={'job.read':'all'})
        self.assertEqual(self.submit(operation='job.read', job=self.jobs[1]['id'])['status'], Status.VERIFIED)
        with self.assertRaises(Error):
            self.submit()

    def test_technician_cannot_enroll_or_escalate_permissions(self):
        with self.assertRaises(Error):
            self.store.staff(self.tech, self.staff_data)
        for perms in ({'shell.exec':'all'}, {'service_request.create':'no_approval'}, {'job.read':['all']}):
            with self.subTest(perms=perms), self.assertRaises(Error):
                self.update(permissions=perms)

    def test_cross_tenant_and_assignment_boundaries(self):
        foreign_job = self.store.snapshot(self.other)['jobs'][0]['id']
        for job in (foreign_job, self.jobs[1]['id']):
            with self.subTest(job=job), self.assertRaises(Error):
                self.submit(job=job)
        with self.assertRaises(Error):
            self.update(job_ids=[foreign_job])
        with self.assertRaises(Error):
            self.store.staff(self.other, self.staff_data, self.employee['principal_id'])

    def test_note_own_scope_and_read_replay_after_scope_reduction(self):
        self.submit()
        self.submit(self.owner, text='Owner private note')
        self.update(permissions={**self.permissions, 'business_note.list':'all'})
        payload = self.proposal('business_note.list')
        first = self.gateway.submit(self.tech, payload)
        self.assertEqual(len(first['data']['notes']), 2)
        self.update(permissions={**self.permissions, 'business_note.list':'own'})
        replay = self.gateway.submit(self.tech, payload)
        self.assertEqual(len(replay['data']['notes']), 1)
        cached = self.gateway.execute(self.tech, first['request_id'])
        self.assertEqual(len(cached['data']['notes']), 1)
        self.assertEqual(cached['data']['notes'][0]['text'], 'Service complete')

    def test_idempotency_and_changed_proposal_conflict(self):
        payload = self.proposal()
        first = self.gateway.submit(self.tech, payload)
        self.assertEqual(first, self.gateway.submit(self.tech, payload))
        payload['arguments']['text'] = 'Changed'
        with self.assertRaises(Error) as raised:
            self.gateway.submit(self.tech, payload)
        self.assertEqual(raised.exception.code, 409)
        self.assertEqual(self.count('notes'), 1)

    def test_concurrent_duplicates_execute_once(self):
        payload = self.proposal()
        with ThreadPoolExecutor(max_workers=6) as pool:
            receipts = list(pool.map(lambda _: self.gateway.submit(self.tech, payload), range(12)))
        self.assertTrue(all(r == receipts[0] for r in receipts))
        self.assertEqual(self.count('notes'), 1)

    def test_restart_preserves_request_and_approval(self):
        request = self.pending()
        restarted = Gateway(Store(self.path))
        restarted.decide(self.owner, request, True)
        receipt = restarted.execute(self.owner, request)
        self.assertTrue(receipt['data']['simulated'])
        self.assertEqual(receipt, restarted.execute(self.owner, request))
        self.assertEqual(self.count('fake_service_requests'), 1)

    def test_sensitive_requires_owner_approval(self):
        request = self.pending()
        self.assertEqual(self.gateway.execute(self.tech, request)['status'], Status.PENDING)
        self.assertEqual(self.count('fake_service_requests'), 0)
        with self.assertRaises(Error):
            self.gateway.decide(self.tech, request, True)
        self.gateway.decide(self.owner, request, True)
        self.assertEqual(self.gateway.execute(self.tech, request)['status'], Status.VERIFIED)

    def test_approval_is_tenant_scoped_and_immutable(self):
        request = self.pending()
        with self.assertRaises(Error):
            self.gateway.decide(self.other, request, True)
        with self.assertRaises(Error):
            self.gateway.execute(self.other, request)
        self.gateway.decide(self.owner, request, False)
        with self.assertRaises(Error):
            self.gateway.decide(self.owner, request, True)
        self.assertEqual(self.gateway.execute(self.tech, request)['status'], Status.REJECTED)
        self.assertEqual(self.count('fake_service_requests'), 0)

    def test_permission_and_assignment_revocation_before_execution(self):
        for changes in ({'permissions':{}}, {'job_ids':[]}, {'active':False}):
            with self.subTest(changes=changes):
                # Each iteration uses a fresh employee because deactivation kills sessions.
                employee = self.store.staff(self.owner, dict(name='Temp', permissions=self.permissions, job_ids=[self.job], active=True))
                request = self.submit(employee['access_code'], operation='service_request.create')['request_id']
                self.gateway.decide(self.owner, request, True)
                self.store.staff(self.owner, {**self.staff_data, **changes}, employee['principal_id'])
                receipt = self.gateway.execute(self.owner, request)
                self.assertEqual(receipt['status'], Status.REJECTED)
        self.assertEqual(self.count('fake_service_requests'), 0)

    def test_expiry_and_approver_revocation(self):
        for target in ('approval','requester_session','approver_session','approver_role'):
            with self.subTest(target=target):
                request = self.pending()
                self.gateway.decide(self.owner, request, True)
                with self.store.transaction() as db:
                    if target == 'approval':
                        db.execute('UPDATE approvals SET expires_at=0 WHERE request_id=?', (request,))
                    elif target.endswith('session'):
                        principal = self.employee['principal_id'] if target == 'requester_session' else self.company['principal_id']
                        db.execute('UPDATE sessions SET expires_at=0 WHERE principal_id=?', (principal,))
                    else:
                        db.execute("UPDATE memberships SET role='technician' WHERE id=?", (self.company['principal_id'],))
                    # Internal execution exercises rechecks without an already-revoked caller session.
                    receipt = self.gateway._execute(db, self.company['tenant_id'], request)
                    self.assertEqual(receipt['status'], Status.REJECTED)
                    db.execute('UPDATE sessions SET expires_at=?', (time.time()+1000,))
                    db.execute("UPDATE memberships SET role='owner' WHERE id=?", (self.company['principal_id'],))
        self.assertEqual(self.count('fake_service_requests'), 0)

    def test_proposal_tampering_rejected(self):
        request = self.pending()
        self.gateway.decide(self.owner, request, True)
        with self.store.transaction() as db:
            db.execute('UPDATE operation_requests SET arguments=? WHERE id=?',
                       (json.dumps({'job_id':self.job,'text':'Tampered'}), request))
        self.assertEqual(self.gateway.execute(self.owner, request)['status'], Status.REJECTED)
        self.assertEqual(self.count('fake_service_requests'), 0)

    def test_expired_pending_approval_never_executes(self):
        request = self.pending()
        with self.store.transaction() as db:
            db.execute('UPDATE approvals SET expires_at=0 WHERE request_id=?', (request,))
        self.assertEqual(self.gateway.decide(self.owner, request, True)['status'], Status.REJECTED)

    def test_adapter_failure_rolls_back_and_hides_exception(self):
        from ghostai import connectors
        original = connectors._invoke
        def broken(*args):
            original(*args)
            raise RuntimeError('SECRET_PROVIDER_KEY')
        with patch('ghostai.connectors._invoke', side_effect=broken):
            receipt = self.submit()
        self.assertEqual(receipt['status'], Status.FAILED)
        self.assertNotIn('SECRET', json.dumps(receipt))
        self.assertEqual(self.count('notes'), 0)

    def test_timeout_is_failed_and_rolled_back(self):
        with patch('ghostai.gateway.time.monotonic', side_effect=[0, 10]):
            receipt = self.submit()
        self.assertEqual(receipt['status'], Status.FAILED)
        self.assertEqual(self.count('notes'), 0)

    def test_revoked_session_and_old_receipt_access(self):
        receipt = self.submit()
        self.update(job_ids=[])
        with self.assertRaises(Error):
            self.gateway.execute(self.tech, receipt['request_id'])
        self.update(active=False)
        with self.assertRaises(Error):
            self.store.snapshot(self.tech)
        self.update(active=True)
        with self.assertRaises(Error):
            self.store.snapshot(self.tech)

    def test_audit_and_snapshot_do_not_leak_private_note_payloads(self):
        self.submit(text='PRIVATE TEST NOTE')
        snapshot = self.store.snapshot(self.owner)
        self.assertNotIn('PRIVATE TEST NOTE', json.dumps(snapshot))
        other = self.store.snapshot(self.other)
        self.assertEqual(other['receipts'], [])
        with self.store.transaction() as db:
            self.assertNotIn('PRIVATE TEST NOTE', json.dumps([dict(r) for r in db.execute('SELECT * FROM audit_events')]))

    def test_conversation_cannot_be_claimed_by_another_employee(self):
        payload = self.proposal()
        self.gateway.submit(self.tech, payload)
        with self.assertRaises(Error):
            self.gateway.submit(self.owner, payload)


if __name__ == '__main__':
    unittest.main()
