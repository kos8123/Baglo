import pytest
from baglo.google_guard import handler
from scripts.setup_google_login import settings


def test_google_guard_limits_new_and_existing_google_accounts(monkeypatch):
    monkeypatch.setenv('BAGLO_GOOGLE_ALLOWED_EMAILS','kos8123@gmail.com')
    def event(email,verified='true',source='PreSignUp_ExternalProvider'):
        return {'triggerSource':source,'request':{'userAttributes':{'email':email,'email_verified':verified,'identities':'[{"providerName":"Google"}]'}}}
    allowed=event('KOS8123@gmail.com')
    assert handler(allowed,None) is allowed
    for request in [event('other@gmail.com'),event('kos8123@gmail.com','false'),event('other@gmail.com',source='TokenGeneration_HostedAuth')]:
        with pytest.raises(ValueError):handler(request,None)
    monkeypatch.delenv('BAGLO_GOOGLE_ALLOWED_EMAILS')
    with pytest.raises(ValueError):handler(allowed,None)


def test_google_guard_leaves_native_cognito_flow_intact():
    event={'triggerSource':'PreSignUp_AdminCreateUser','request':{'userAttributes':{'email':'native@example.com'}}}
    assert handler(event,None) is event


def test_oauth_file_validation_requires_web_client_and_exact_cognito_redirect():
    redirect='https://example.auth.us-east-1.amazoncognito.com/oauth2/idpresponse'
    document={'web':{'client_id':'fixture.apps.googleusercontent.com','client_secret':'fixture-secret','redirect_uris':[redirect]}}
    assert settings(document,['KOS8123@gmail.com'],redirect)['allowed_emails']=='kos8123@gmail.com'
    with pytest.raises(ValueError):settings(document,['kos8123@gmail.com'],'https://wrong.example/')
    with pytest.raises(ValueError):settings({'api_key':'not-oauth'},['kos8123@gmail.com'],redirect)


@pytest.mark.parametrize('identities',['invalid','null','{}'])
def test_google_guard_rejects_malformed_identity(identities):
    event={'triggerSource':'TokenGeneration_HostedAuth','request':{'userAttributes':{'identities':identities}}}
    with pytest.raises(ValueError):handler(event,None)
