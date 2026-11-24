"""Two-phase daily paper AI scheduling for listed or opted-in accounts; never scans users."""
from datetime import datetime
from zoneinfo import ZoneInfo
import os
import time
from .domain import DomainError

def handler(event, context):
    from .api import get_store,get_markets
    from .ai import enqueue,execute,settings,update_job
    current=datetime.now(ZoneInfo('Asia/Taipei'))
    if current.weekday()>=5:return {'status':'skipped','reason':'weekend'}
    from .ai import scheduled_accounts
    store,markets=get_store(),get_markets()
    accounts=scheduled_accounts(store)
    started=time.monotonic()
    from .matching import settle
    # Fill or expire pending paper orders on every tick (including after the close),
    # before any new AI order is placed.
    # Stop well inside the 180s Lambda timeout; skipped accounts are handled on the next tick.
    for account in accounts:
        if time.monotonic()-started>90:break
        settle(store,markets,account,current)
    if event.get('phase')=='execute' and not (9,5)<=(current.hour,current.minute)<=(13,30):return {'status':'skipped','reason':'outside_execution_window'}
    reports=[]
    for account in accounts:
        if time.monotonic()-started>140:
            reports.append({'account':account,'status':'deferred','reason':'time_budget'})
            continue
        state=store.read(account);policy=settings(state)
        if not policy['enabled']:continue
        if state.get('ai_selection_mode'):
            from .local_schedule import selection_tick
            try:
                selection_tick(store,markets,account,current)
                reports.append({'account':account,'status':'selection_tick'})
            except DomainError as exc:reports.append({'account':account,'status':'blocked','reason':str(exc)})
            continue
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
