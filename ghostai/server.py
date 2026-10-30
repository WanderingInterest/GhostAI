"""Loopback-only HTTP UI/API for exercising the Phase 0 contracts."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from .contracts import Error, strict_object
from .gateway import Gateway
from .store import Store

WEB = Path(__file__).resolve().parent.parent / 'web'


def make_server(store, port=8765):
    gateway = Gateway(store)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log access codes or bodies.

        def respond(self, status, data, mime='application/json'):
            body = json.dumps(data).encode() if mime == 'application/json' else data
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy',
                             "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def check_origin(self):
            host = self.headers.get('Host', '')
            allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if host not in allowed:
                raise Error('Use the local prototype address.', 403)
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + host:
                raise Error('Cross-origin requests are not allowed.', 403)
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise Error('Cross-site requests are not allowed.', 403)

        def token(self):
            auth = self.headers.get('Authorization', '')
            return auth.removeprefix('Bearer ') if auth.startswith('Bearer ') else ''

        def do_GET(self):
            try:
                self.check_origin()
                path = urlsplit(self.path).path
                if path == '/api/state':
                    return self.respond(200, store.snapshot(self.token()))
                if path == '/api/health':
                    with store.transaction() as db:
                        db.execute('SELECT version FROM schema_version').fetchone()
                    return self.respond(200, {'status':'ready', 'mode':'local_prototype', 'providers':['native','fake_crm']})
                assets = {'/': ('index.html','text/html; charset=utf-8'),
                          '/app.js': ('app.js','text/javascript; charset=utf-8'),
                          '/style.css': ('style.css','text/css; charset=utf-8')}
                if path not in assets:
                    raise Error('Not found.', 404)
                file, mime = assets[path]
                return self.respond(200, (WEB / file).read_bytes(), mime)
            except Error as error:
                self.respond(error.code, {'error':str(error)})
            except Exception:
                self.respond(500, {'error':'Local server error.'})

        def do_POST(self):
            try:
                self.check_origin()
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise Error('Use application/json.', 415)
                if self.headers.get('Transfer-Encoding'):
                    raise Error('Transfer encoding is unsupported.')
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    raise Error('Invalid content length.')
                if not 0 < size <= 16384:
                    raise Error('Request body must be between 1 and 16384 bytes.', 413)
                try:
                    payload = json.loads(self.rfile.read(size))
                except (ValueError, UnicodeDecodeError):
                    raise Error('Invalid JSON.')
                path = urlsplit(self.path).path
                token = self.token()
                if path == '/api/companies':
                    strict_object(payload, ('name',))
                    data = store.create_company(payload['name'])
                elif path == '/api/staff':
                    data = store.staff(token, payload)
                elif match := re.fullmatch(r'/api/staff/([a-f0-9]{32})', path):
                    data = store.staff(token, payload, match[1])
                elif path == '/api/operations':
                    data = gateway.submit(token, payload)
                elif match := re.fullmatch(r'/api/requests/([a-f0-9]{32})/(approve|execute)', path):
                    if match[2] == 'approve':
                        strict_object(payload, ('approve',))
                        data = gateway.decide(token, match[1], payload['approve'])
                    else:
                        strict_object(payload, ())
                        data = gateway.execute(token, match[1])
                else:
                    raise Error('Not found.', 404)
                self.respond(200, data)
            except Error as error:
                self.respond(error.code, {'error':str(error)})
            except Exception:
                self.respond(500, {'error':'Local server error.'})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--db', default='.data/ghostai.sqlite3')
    args = parser.parse_args()
    server = make_server(Store(args.db), args.port)
    print(f'GhostAI prototype: http://127.0.0.1:{server.server_port}', flush=True)
    print('Local simulation only. Fake CRM; no live SMS, voice, or AI calls.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
