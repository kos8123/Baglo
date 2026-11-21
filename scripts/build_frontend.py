"""Build deterministic static assets; config contains public API URL only."""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

def build(output, api_base=''):
    if api_base:
        parsed = urlsplit(api_base)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('Cloud API URL must be HTTPS without credentials/query/fragment')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    for name in ['index.html', 'app.js', 'styles.css']:
        shutil.copyfile(ROOT/'frontend'/name, output/name)
    (output/'config.json').write_text(json.dumps({'api_base': api_base.rstrip('/')})+'\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='dist')
    parser.add_argument('--api-base', default='')
    args = parser.parse_args()
    build(args.output, args.api_base)
