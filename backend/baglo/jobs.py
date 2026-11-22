"""Two-phase daily paper AI scheduling. Known accounts only; never scan users."""
from datetime import datetime
from zoneinfo import ZoneInfo
import os
from .domain import DomainError

def handler(event, context):
    from .api import get_store,get_markets
    from .ai import enqueue,execute,settings,update_job
    current=datetime.now(ZoneInfo('Asia/Taipei'))
    if current.weekday()>=5:return {'status':'skipped','reason':'weekend'}
    accounts=[a.strip() for a in os.getenv('BAGLO_AI_ACCOUNTS','').split(',') if a.strip()]
    reports=[]
    store,markets=get_store(),get_markets()
    for account in accounts:
        state=store.read(account);policy=settings(state)
        if not policy['enabled']:continue
        if event.get('phase')=='execute':
            for symbol in policy['symbols']:
                job_id='daily-'+current.date().isoformat()+'-'+symbol
                try:
                    order=execute(store,markets,account,job_id,automatic=True)
                    reports.append({'symbol':symbol,'status':'submitted','order_id':order['id']})
                except DomainError as exc:
                    reports.append({'symbol':symbol,'status':'skipped','reason':str(exc)})
                    try:update_job(store,account,job_id,{'execution_note':str(exc)})
                    except DomainError:pass
        else:
            for symbol in policy['symbols']:
                try:reports.append(enqueue(store,markets,account,symbol,'schedule'))
                except DomainError as exc:reports.append({'symbol':symbol,'status':'blocked','reason':str(exc)})
    return {'status':'processed' if accounts else 'no_accounts_configured','reports':reports}
