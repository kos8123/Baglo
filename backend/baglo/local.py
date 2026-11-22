"""Local-only development server: static frontend + loopback demo identity."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
from urllib.parse import urlsplit, parse_qs
from .api import handler

FRONTEND = Path(__file__).resolve().parents[2] / 'dist'

class LocalHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path.startswith('/api/'):
            self.api()
        else:
            if urlsplit(self.path).path in ('/','/index.html','/config.json'):
                if 'If-Modified-Since' in self.headers:del self.headers['If-Modified-Since']
            super().do_GET()

    def end_headers(self):
        if not urlsplit(self.path).path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_PUT(self):
        self.api()

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
                 'queryStringParameters': {k: values[-1] for k, values in parse_qs(urlsplit(self.path).query).items()},
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
    parser.add_argument('--env-file', default='.env.local')
    args = parser.parse_args()
    if not (FRONTEND/'index.html').exists():
        parser.error('React build missing. Run pnpm --dir frontend install, then python scripts/build_frontend.py')
    env_file = Path(args.env_file)
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() in {'BAGLO_FUGLE_API_KEY', 'BAGLO_LOCAL_DB', 'BAGLO_MARKET_CACHE', 'BAGLO_OPENAI_API_KEY', 'BAGLO_OPENAI_MODEL'}:
                os.environ.setdefault(key.strip(), value.strip().strip(chr(34)).strip(chr(39)))
    os.environ['BAGLO_DEMO'] = '1' if args.demo else '0'
    print(f'Baglo http://127.0.0.1:{args.port} — local only; demo fills={args.demo}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(LocalHandler, directory=str(FRONTEND))).serve_forever()

if __name__ == '__main__':
    main()
