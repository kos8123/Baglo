"""Inject public API URL into an already validated Vite artifact; never rebuild it."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
parser=argparse.ArgumentParser()
parser.add_argument('--api-base',required=True)
args=parser.parse_args()
url=urlsplit(args.api_base)
if url.scheme!='https' or not url.netloc or url.query or url.fragment or url.username:
    raise SystemExit('Invalid public API URL')
output=Path('dist')
if not (output/'index.html').is_file():raise SystemExit('Missing validated frontend artifact')
(output/'config.json').write_text(json.dumps({'api_base':args.api_base.rstrip('/')})+'\n')
