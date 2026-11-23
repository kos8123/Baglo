"""Compile the React terminal to static assets and write public runtime config."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

def add_site_verification(page, token):
    """Insert the Google Search Console HTML-tag token so the home page can be verified."""
    token = token.strip()
    if not token:
        return
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,100}', token):
        raise ValueError('BAGLO_GOOGLE_SITE_VERIFICATION must be the content value of the google-site-verification meta tag')
    html = page.read_text()
    if 'google-site-verification' in html:
        return
    tag = f'<meta name="google-site-verification" content="{token}"/>'
    page.write_text(html.replace('<head>', '<head>' + tag, 1))

def build(output, api_base='', landing=False, market_base=''):
    if api_base:
        parsed = urlsplit(api_base)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('Cloud API URL must be HTTPS without credentials/query/fragment')
    node = os.getenv('BAGLO_NODE_BIN') or shutil.which('node')
    if not node:
        raise RuntimeError('Node.js 24 required; install Node and run pnpm install in frontend first')
    frontend = ROOT/'frontend'
    tsc = frontend/'node_modules/typescript/bin/tsc'
    vite = frontend/'node_modules/vite/bin/vite.js'
    if not tsc.exists() or not vite.exists():
        raise RuntimeError('Frontend dependencies missing: run pnpm --dir frontend install --frozen-lockfile')
    subprocess.run([node, str(tsc), '-b'], cwd=frontend, check=True)
    output = Path(output).resolve()
    if output in [ROOT, frontend] or output in ROOT.parents:
        raise ValueError('Build output must be a dedicated directory')
    subprocess.run([node, str(vite), 'build', '--outDir', str(output)], cwd=frontend, check=True)
    if landing:
        app = output/'index.html'
        home = output/'home.html'
        if not app.is_file() or not home.is_file():
            raise RuntimeError('Cloudflare build requires both the terminal and public home page')
        app.replace(output/'terminal.html')
        home.replace(output/'index.html')
        add_site_verification(output/'index.html', os.getenv('BAGLO_GOOGLE_SITE_VERIFICATION', ''))
    swagger=frontend/'node_modules/swagger-ui-dist'
    (output/'docs').mkdir(exist_ok=True)
    for name in ['swagger-ui-bundle.js','swagger-ui.css','LICENSE']:
        shutil.copyfile(swagger/name,output/'docs'/name)
    (output/'config.json').write_text(json.dumps({'api_base': api_base.rstrip('/'), 'market_base': market_base.rstrip('/')})+'\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='dist')
    parser.add_argument('--api-base', default='')
    parser.add_argument('--market-base', default='')
    parser.add_argument('--landing', action='store_true')
    args = parser.parse_args()
    build(args.output, args.api_base, args.landing, args.market_base)
