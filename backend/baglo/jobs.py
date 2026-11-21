"""Scheduled premarket audit. Does not imply analysis or trading is enabled."""
from datetime import datetime
import json
import os
from zoneinfo import ZoneInfo

def handler(event, context):
    import boto3
    current = datetime.now(ZoneInfo('Asia/Taipei'))
    if current.weekday() >= 5:
        return {'status': 'skipped', 'reason': 'weekend'}
    # Exact holiday calendar and point-in-time data adapters remain a prerequisite.
    report = {'date': current.date().isoformat(), 'status': 'blocked', 'orders_created': 0,
              'reason': 'Premarket orchestration, trading calendar and AI provider not enabled; data adapters are available on demand',
              'created_at': current.isoformat()}
    key = 'premarket/' + current.date().isoformat() + '.json'
    s3 = boto3.client('s3')
    try:
        s3.put_object(Bucket=os.environ['BAGLO_DATA_BUCKET'], Key=key,
                      Body=json.dumps(report).encode(), ContentType='application/json', IfNoneMatch='*')
    except Exception as exc:
        if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'PreconditionFailed':
            raise
        return {'status': 'already_recorded'}
    return report
