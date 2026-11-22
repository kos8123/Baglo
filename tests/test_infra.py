from pathlib import Path
import json
import yaml

ROOT = Path(__file__).resolve().parents[1]
class Loader(yaml.SafeLoader):
    pass

def tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {suffix: loader.construct_scalar(node)}
    return {suffix: loader.construct_sequence(node)}
Loader.add_multi_constructor('!', tag)

def test_deployment_requires_identity_and_has_no_demo_or_public_bucket():
    template = yaml.load((ROOT/'infra/template.yaml').read_text(), Loader=Loader)
    resources = template['Resources']
    api = resources['HttpApi']['Properties']
    assert api['Auth']['DefaultAuthorizer'] == 'Cognito'
    assert api['Auth']['Authorizers']['Cognito']['AuthorizationScopes'] == ['baglo-api/access']
    assert resources['Api']['Properties']['Environment']['Variables']['BAGLO_DEMO'] == '0'
    for name in ['WebsiteBucket', 'ResearchBucket']:
        assert all(resources[name]['Properties']['PublicAccessBlockConfiguration'].values())
    assert template['Parameters']['PremarketScheduleState']['Default'] == 'DISABLED'
    assert resources['Ledger']['DeletionPolicy'] == 'Retain'
    assert 'AWS::EC2::Instance' not in [r['Type'] for r in resources.values()]

def test_static_assets_have_no_credentials_or_server_side_dependency():
    assert json.loads((ROOT/'frontend/public/config.json').read_text()) == {'api_base': ''}
    paths = list((ROOT/'frontend/src').rglob('*.ts')) + list((ROOT/'frontend/src').rglob('*.tsx'))
    for path in paths:
        text = path.read_text()
        assert 'sk-proj-' not in text and 'OPENAI_API_KEY' not in text
    assert "createRoot" in (ROOT/'frontend/src/main.tsx').read_text()
    assert 'lightweight-charts' in (ROOT/'frontend/package.json').read_text()
    assert 'script type="module"' in (ROOT/'frontend/index.html').read_text()

def test_cloudflare_pages_build_has_public_home_legal_and_terminal_routes():
    build=(ROOT/'scripts/cloudflare_build.sh').read_text()
    assert '--landing' in build and 'BAGLO_API_BASE' in build
    assert (ROOT/'frontend/public/home.html').is_file()
    assert (ROOT/'frontend/public/privacy.html').is_file()
    assert (ROOT/'frontend/public/terms.html').is_file()
    template=yaml.load((ROOT/'infra/template.yaml').read_text(), Loader=Loader)
    assert 'FrontendUrl' in template['Parameters']
    client=template['Resources']['Client']['Properties']
    assert any('/terminal' in str(value) for value in client['CallbackURLs'])
