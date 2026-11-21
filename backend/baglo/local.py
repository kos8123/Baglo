"""Local-only development server: static frontend + loopback demo identity."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
from urllib.parse import urlsplit
from .api import handler

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend'

class LocalHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path.startswith('/api/'):
            self.api()
        else:
            super().do_GET()

    def do_POST(self):
        self.api()

    def api(self):
        size = int(self.headers.get('Content-Length', 0))
        if size > 4096:
            self.send_error(413)
            return
        event = {'rawPath': urlsplit(self.path).path,
                 'requestContext': {'http': {'method': self.command},
                    'authorizer': {'jwt': {'claims': {'sub': 'local-demo'}}}},
                 'headers': dict(self.headers), 'body': self.rfile.read(size).decode()}
        result = handler(event, None)
        data = result['body'].encode()
        self.send_response(result['statusCode'])
        for k, v in result['headers'].items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--demo', action='store_true')
    args = parser.parse_args()
    os.environ['BAGLO_DEMO'] = '1' if args.demo else '0'
    print(f'Baglo http://127.0.0.1:{args.port} — local only; demo fills={args.demo}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(LocalHandler, directory=str(FRONTEND))).serve_forever()

if __name__ == '__main__':
    main()
