"""Validate a downloaded Google Web OAuth client, store securely, print ARN/version only."""
import argparse,json,re
from pathlib import Path


def settings(document,emails,redirect):
    web=document.get('web',{})
    client=web.get('client_id');secret=web.get('client_secret')
    if not isinstance(client,str) or not client.endswith('.apps.googleusercontent.com') or not isinstance(secret,str) or not secret.strip():
        raise ValueError('需要 Google 網頁應用程式 OAuth JSON；Gemini API key 不能替代')
    if redirect not in web.get('redirect_uris',[]):raise ValueError('Google redirect URI 需要包含 '+redirect)
    allowed=sorted({e.strip().casefold() for e in emails if e.strip()})
    if not allowed or any(not re.fullmatch(r'[^\s,@]+@[^\s,@]+\.[^\s,@]+',e) for e in allowed):raise ValueError('至少需要一個有效的允許 Email')
    return {'client_id':client,'client_secret':secret,'allowed_emails':','.join(allowed)}


def main():
    import boto3
    parser=argparse.ArgumentParser();parser.add_argument('--env',choices=['dev','prod'],default='dev');parser.add_argument('--client-json',required=True);parser.add_argument('--allow-email',action='append',required=True);parser.add_argument('--region',default='us-east-1');args=parser.parse_args()
    session=boto3.Session(region_name=args.region);account=session.client('sts').get_caller_identity()['Account']
    redirect=f'https://baglo-{args.env}-{account}-{args.region}.auth.{args.region}.amazoncognito.com/oauth2/idpresponse'
    value=settings(json.loads(Path(args.client_json).read_text()),args.allow_email,redirect)
    client=session.client('secretsmanager');name=f'baglo/{args.env}/google-oauth'
    try:
        client.describe_secret(SecretId=name)
        result=client.put_secret_value(SecretId=name,SecretString=json.dumps(value))
    except client.exceptions.ResourceNotFoundException:
        result=client.create_secret(Name=name,SecretString=json.dumps(value),Tags=[{'Key':'Project','Value':'Baglo'},{'Key':'Environment','Value':args.env}])
    prefix='BAGLO_'+args.env.upper()
    print(f"export {prefix}_GOOGLE_OAUTH_SECRET_ARN={result['ARN']}")
    print(f"export {prefix}_GOOGLE_OAUTH_SECRET_VERSION={result['VersionId']}")
    print('OAuth 設定已安全儲存；接著用既有 Connection ARN 執行 scripts/setup_codepipeline.sh，再啟動該環境 pipeline。')

if __name__=='__main__':main()
