import json
from urllib.error import HTTPError
import pytest
from baglo import ai


def test_gemini_probe_uses_header_and_schema(monkeypatch):
    monkeypatch.setenv('BAGLO_AI_PROVIDER','gemini')
    monkeypatch.setenv('BAGLO_GEMINI_API_KEY','fixture-gemini-key')
    monkeypatch.delenv('BAGLO_GEMINI_MODEL',raising=False)
    seen=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,*args):return json.dumps({'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'{"ready":true}'}]}}]}).encode()
    def fetch(request,timeout):
        seen.append(request)
        return Response()
    monkeypatch.setattr(ai,'urlopen',fetch)
    assert ai.probe()['connected']
    request=seen[0]
    assert 'fixture-gemini-key' not in request.full_url
    assert request.get_header('X-goog-api-key')=='fixture-gemini-key'
    assert json.loads(request.data)['generationConfig']['responseJsonSchema']['required']==['ready']


def test_quota_failure_never_falls_back(monkeypatch):
    monkeypatch.setenv('BAGLO_AI_PROVIDER','gemini')
    monkeypatch.setenv('BAGLO_GEMINI_API_KEY','fixture-gemini-key')
    monkeypatch.setenv('BAGLO_OPENAI_API_KEY','must-not-use')
    calls=[]
    def fetch(request,timeout):
        calls.append(request.full_url)
        raise HTTPError(request.full_url,429,'quota',{},None)
    monkeypatch.setattr(ai,'urlopen',fetch)
    with pytest.raises(ai.ModelError,match='額度'):ai.probe()
    assert len(calls)==1 and 'googleapis.com' in calls[0]


def test_openai_key_does_not_configure_gemini(monkeypatch):
    monkeypatch.setenv('BAGLO_AI_PROVIDER','gemini')
    monkeypatch.delenv('BAGLO_GEMINI_API_KEY',raising=False)
    monkeypatch.setenv('BAGLO_OPENAI_API_KEY','must-not-use')
    assert not ai.configured()
