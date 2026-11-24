from baglo.api import handler


def test_preflight_does_not_require_identity_but_actions_still_do():
    for path in ('/api/config','/api/account','/api/orders','/api/ai/jobs'):
        result=handler({'rawPath':path,'requestContext':{'http':{'method':'OPTIONS'}}},None)
        assert result['statusCode']==204 and result['body']==''
    for method,path in [('GET','/api/account'),('POST','/api/orders'),('POST','/api/ai/test')]:
        assert handler({'rawPath':path,'requestContext':{'http':{'method':method}}},None)['statusCode']==401
