import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from ghostai.server import make_server
from ghostai.store import Store


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = make_server(Store(Path(cls.temp.name) / 'http.sqlite3'), 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, body=None, token='', method=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        data = None if body is None else json.dumps(body)
        combined = {'Content-Type':'application/json', 'Authorization':'Bearer '+token, **(headers or {})}
        connection.request(method or ('GET' if body is None else 'POST'), path, data, combined)
        response = connection.getresponse()
        raw = response.read()
        result = json.loads(raw) if response.getheader('Content-Type') == 'application/json' else raw.decode()
        connection.close()
        return response.status, result

    def test_full_owner_technician_approval_workflow(self):
        code, owner = self.request('/api/companies', {'name':'HTTP demo'})
        self.assertEqual(code, 200)
        token = owner['access_code']
        _, state = self.request('/api/state', token=token)
        job = state['jobs'][0]['id']
        _, staff = self.request('/api/staff', dict(name='Taylor', permissions={
            'job.read':'assigned', 'business_note.create':'assigned', 'service_request.create':'assigned'},
            job_ids=[job], active=True), token)
        tech = staff['access_code']
        for operation in ('business_note.create','service_request.create'):
            _, receipt = self.request('/api/operations', dict(operation_id=operation,
                arguments={'job_id':job,'text':'Leaking valve'}, idempotency_key=operation,
                conversation_id='http-conversation'), tech)
            if operation == 'service_request.create':
                self.assertEqual(receipt['status'], 'pending_confirmation')
                request = receipt['request_id']
                self.assertEqual(self.request(f'/api/requests/{request}/approve', {'approve':True}, tech)[0], 403)
                self.assertEqual(self.request(f'/api/requests/{request}/approve', {'approve':True}, token)[0], 200)
                _, receipt = self.request(f'/api/requests/{request}/execute', {}, token)
            self.assertEqual(receipt['status'], 'verified_persisted')
        self.assertEqual(self.request('/api/state', token=tech)[1]['staff'], [])
        self.assertEqual(self.request('/api/fake-crm', {'text':'bypass'}, tech)[0], 404)

    def test_invalid_auth_host_origin_and_payloads(self):
        self.assertEqual(self.request('/api/state')[0], 401)
        self.assertEqual(self.request('/api/health', headers={'Host':'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/companies', {'name':'bad'}, headers={'Origin':'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/companies', [], method='POST')[0], 400)
        self.assertEqual(self.request('/api/companies', {'name':'x','role':'owner'})[0], 400)
        self.assertEqual(self.request('/api/companies', {'name':'x'*20000})[0], 413)
        self.assertEqual(self.request('/api/companies', {'name':'x'}, headers={'Content-Type':'text/plain'})[0], 415)

    def test_static_ui_health_and_no_path_traversal(self):
        self.assertIn('GhostAI', self.request('/')[1])
        self.assertEqual(self.request('/api/health')[1]['status'], 'ready')
        self.assertIn('function render', self.request('/app.js')[1])
        self.assertEqual(self.request('/../infra/schema.sql')[0], 404)


if __name__ == '__main__':
    unittest.main()
