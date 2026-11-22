"""Exercise the CloudShell command plan against a fake CLI, never an AWS account."""
import json,os,subprocess,sys
from pathlib import Path


def test_rerun_preserves_existing_secret_and_schedule_parameters(tmp_path):
    fake=tmp_path/'aws'
    fake.write_text('#!'+sys.executable+'\n'+'''
import json,os,sys
args=sys.argv[1:]
with open(os.environ['BAGLO_TEST_CAPTURE'],'a') as stream:stream.write(json.dumps(args)+'\\n')
if args[:2]==['codeconnections','get-connection']:print('AVAILABLE')
elif args[:2]==['sts','get-caller-identity']:print('fixture account')
elif args[:2]==['cloudformation','describe-stacks']:
    query=args[args.index('--query')+1] if '--query' in args else ''
    values={'GeminiSecretArn':'arn:fixture-gemini','FugleSecretArn':'arn:fixture-fugle','GeminiModel':'fixture-model','AiSchedule':'DISABLED','AiAccounts':'fixture-sub','ExistingOidcProviderArn':'arn:fixture-oidc','DeployRoleArn':'arn:fixture-deploy','CloudFormationRoleArn':'arn:fixture-cfn','ArtifactBucket':'fixture-artifacts','ConsoleUrl':'https://example.invalid/pipeline'}
    print(next((value for key,value in values.items() if "'"+key+"'" in query),'None'))
''')
    fake.chmod(0o755)
    env={k:v for k,v in os.environ.items() if not k.startswith('BAGLO_')}
    capture=tmp_path/'calls.jsonl'
    env.update(PATH=str(tmp_path)+os.pathsep+env['PATH'],BAGLO_TEST_CAPTURE=str(capture),AWS_REGION='us-east-1')
    root=Path(__file__).resolve().parents[1]
    subprocess.run(['bash',str(root/'scripts/setup_codepipeline.sh'),'arn:aws:codeconnections:us-east-1:123456789012:connection/fixture'],env=env,check=True,capture_output=True)
    calls=[json.loads(line) for line in capture.read_text().splitlines()]
    deployments=[c for c in calls if c[:2]==['cloudformation','deploy']]
    assert len(deployments)==2  # dev bootstrap + dev pipeline; no prod by default
    pipeline=deployments[-1]
    assert 'GeminiSecretArn=arn:fixture-gemini' in pipeline
    assert 'FugleSecretArn=arn:fixture-fugle' in pipeline
    assert 'GeminiModel=fixture-model' in pipeline
    assert 'AiSchedule=DISABLED' in pipeline


def test_cloudshell_pending_connection_resumes_without_duplicate_resources(tmp_path):
    fake=tmp_path/'aws'
    fake.write_text('#!'+sys.executable+'\n'+'''
import json,os,sys
args=sys.argv[1:]
path=os.environ['BAGLO_TEST_CAPTURE']
try:
    prior=[json.loads(line) for line in open(path)]
except FileNotFoundError:prior=[]
with open(path,'a') as stream:stream.write(json.dumps(args)+'\\n')
arn='arn:aws:codeconnections:us-east-1:123456789012:connection/fixture'
if args[:2]==['sts','get-caller-identity']:print('fixture account')
elif args[:2]==['codeconnections','list-connections']:print(json.dumps([arn] if any(x[:2]==['codeconnections','create-connection'] for x in prior) else []))
elif args[:2]==['codeconnections','create-connection']:print(arn)
elif args[:2]==['codeconnections','get-connection']:print('PENDING')
else:raise SystemExit('Unexpected mutation while connection is pending')
''')
    fake.chmod(0o755)
    env=os.environ.copy();capture=tmp_path/'pending.jsonl'
    env.update(PATH=str(tmp_path)+os.pathsep+env['PATH'],BAGLO_TEST_CAPTURE=str(capture),AWS_REGION='us-east-1')
    script=Path(__file__).resolve().parents[1]/'scripts/cloudshell_start.sh'
    for _ in range(2):
        result=subprocess.run(['bash',str(script),'dev'],env=env,check=True,capture_output=True,text=True)
        assert 'PENDING' in result.stdout
    calls=[json.loads(line) for line in capture.read_text().splitlines()]
    assert sum(c[:2]==['codeconnections','create-connection'] for c in calls)==1
    assert not any(c[0] in ('cloudformation','secretsmanager') for c in calls)
