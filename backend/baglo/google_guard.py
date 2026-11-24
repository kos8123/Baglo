"""Permit verified Google accounts (all of them when open sign-up is on, otherwise only listed
emails); never merge accounts by email."""
import json,os


def handler(event,context):
    attrs=event.get('request',{}).get('userAttributes',{})
    external=event.get('triggerSource')=='PreSignUp_ExternalProvider'
    try:identities=json.loads(attrs.get('identities','[]'))
    except (ValueError,TypeError):raise ValueError('無法驗證登入來源') from None
    if not isinstance(identities,list):raise ValueError('無法驗證登入來源')
    google=any(isinstance(x,dict) and x.get('providerName')=='Google' for x in identities)
    if not external and not google:return event
    email=attrs.get('email','').strip().casefold()
    if not email or str(attrs.get('email_verified','')).lower()!='true':
        raise ValueError('此 Google 帳戶的 email 尚未驗證，無法登入 Baglo。')
    if os.getenv('BAGLO_GOOGLE_OPEN_SIGNUP')=='true':
        return event
    allowed={x.strip().casefold() for x in os.getenv('BAGLO_GOOGLE_ALLOWED_EMAILS','').split(',') if x.strip()}
    if not allowed or email not in allowed:
        raise ValueError('此 Google 帳戶尚未獲准使用 Baglo，請聯絡管理員。')
    return event
