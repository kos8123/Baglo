import pytest
from scripts.release_manifest import create,verify,AREAS


def test_release_binds_code_iac_and_frontend_without_secret_files(tmp_path):
    for area in AREAS:
        (tmp_path/area).mkdir()
        (tmp_path/area/'fixture.txt').write_text('validated')
    (tmp_path/'buildspec-deploy.yml').write_text('version: 0.2')
    (tmp_path/'.env.local').write_text('not-in-artifact')
    create(tmp_path,'a'*40)
    manifest=verify(tmp_path)
    assert '.env.local' not in manifest['files']
    (tmp_path/'backend/fixture.txt').write_text('changed after validation')
    with pytest.raises(ValueError,match='changed'):verify(tmp_path)


def test_release_rejects_additional_deploy_file(tmp_path):
    for area in AREAS:(tmp_path/area).mkdir()
    (tmp_path/'buildspec-deploy.yml').write_text('version: 0.2')
    create(tmp_path,'b'*40)
    (tmp_path/'scripts/unvalidated.py').write_text('unexpected')
    with pytest.raises(ValueError,match='file list'):verify(tmp_path)
