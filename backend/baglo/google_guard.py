"""Permit only verified, explicitly listed Google accounts; never merge accounts by email."""
import json,os


def handler(event,context):
    attrs=event.get('request',{}).get('userAttributes',{})
    external=event.get('triggerSource')=='PreSignUp_ExternalProvider'
    try:identities=json.loads(attrs.get('identities','[]'))
    except (ValueError,TypeError):raise ValueError('無法驗證登入來源') from None
    if not isinstance(identities,list):raise ValueError('無法驗證登入來源')
    google=any(isinstance(x,dict) and x.get('providerName')=='Google' for x in identities)
    if not external and not google:return event
    allowed={x.strip().casefold() for x in os.getenv('BAGLO_GOOGLE_ALLOWED_EMAILS','').split(',') if x.strip()}
    email=attrs.get('email','').strip().casefold()
    if not allowed or email not in allowed or str(attrs.get('email_verified','')).lower()!='true':
        raise ValueError('此 Google 帳戶尚未獲准使用 Baglo，請聯絡管理員。')
    return event
