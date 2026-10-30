"""Deterministic adapters. Only Gateway invokes these internal handlers.

Both adapters use the Gateway transaction, so a local failure rolls back the entire
write. A real remote connector needs durable intent, leases and reconciliation.
"""
from .store import uid


def _invoke(db, operation, actor, arguments, request_id, scope):
    tenant, principal = actor['tenant_id'], actor['id']
    job = arguments['job_id']
    if operation == 'job.read':
        return dict(db.execute('SELECT id,title FROM jobs WHERE tenant_id=? AND id=?', (tenant, job)).fetchone())
    if operation == 'business_note.list':
        return {'notes': [dict(row) for row in db.execute('''SELECT id,author_id,text FROM notes
            WHERE tenant_id=? AND job_id=? AND (? != 'own' OR author_id=?)''',
                                                        (tenant, job, scope, principal))]}
    if operation == 'business_note.create':
        record_id = uid()
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?)',
                   (record_id, tenant, principal, job, arguments['text'], request_id))
        record = db.execute('SELECT id,text FROM notes WHERE tenant_id=? AND id=?', (tenant, record_id)).fetchone()
        assert record and record['text'] == arguments['text'], 'Native read-back failed'
        return dict(record_id=record['id'], provider='native', message='Saved in GhostAI.')
    if operation == 'service_request.create':
        record_id = 'fake_' + uid()
        db.execute('INSERT INTO fake_service_requests VALUES (?,?,?,?,?)',
                   (record_id, tenant, job, arguments['text'], request_id))
        record = db.execute('SELECT id,text FROM fake_service_requests WHERE tenant_id=? AND id=?',
                            (tenant, record_id)).fetchone()
        assert record and record['text'] == arguments['text'], 'Fake read-back failed'
        return dict(record_id=record['id'], provider='fake_crm', simulated=True,
                    message='Saved in the local fake CRM. No external CRM was updated.')
    raise RuntimeError('Unregistered adapter')
