"""Record/verify exactly the artifact tested by CI; never include local secrets/state."""
import argparse,hashlib,json,os,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
AREAS=('backend','infra','scripts','dist')

def files(root):
    return sorted(p for area in AREAS for p in (root/area).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ('.pyc','.pyo'))+[root/'buildspec-deploy.yml']

def create(root,revision):
    if not re.fullmatch('[0-9a-f]{40}',revision):raise ValueError('CI must supply the full source commit SHA')
    (root/'dist/release.json').write_text(json.dumps({'commit':revision,'built_at':datetime.now(timezone.utc).isoformat()})+'\n')
    manifest={'commit':revision,'files':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files(root)}}
    (root/'release-manifest.json').write_text(json.dumps(manifest,sort_keys=True)+'\n')
    return manifest

def verify(root):
    manifest=json.loads((root/'release-manifest.json').read_text())
    if not re.fullmatch('[0-9a-f]{40}',manifest.get('commit','')):raise ValueError('Invalid release commit')
    actual={str(p.relative_to(root)) for p in files(root)}
    if actual!=set(manifest['files']):raise ValueError('Validated artifact file list changed')
    for name,digest in manifest['files'].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest:raise ValueError('Validated artifact changed: '+name)
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['create','verify']);parser.add_argument('--revision',default=os.getenv('CODEBUILD_RESOLVED_SOURCE_VERSION',''));args=parser.parse_args()
    result=create(ROOT,args.revision) if args.mode=='create' else verify(ROOT)
    print(result['commit'])
