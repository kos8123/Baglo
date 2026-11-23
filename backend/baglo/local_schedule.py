"""Local daily opt-in paper execution; one model decision per symbol/day."""
from datetime import datetime
from zoneinfo import ZoneInfo
import logging
import threading


def tick(store, markets, current=None):
    from .ai import settings, enqueue, execute, update_job
    from .domain import DomainError
    current=current or datetime.now(ZoneInfo('Asia/Taipei'))
    if current.weekday()>=5 or not (8,30)<=(current.hour,current.minute)<=(13,30):return
    account='local-demo'
    state=store.read(account)
    policy=settings(state)
    if not policy['enabled']:return
    if state.get('ai_selection_mode'):
        return selection_tick(store,markets,account,current)
    for symbol in policy['symbols']:
        job_id='daily-'+current.date().isoformat()+'-'+symbol
        job=next((j for j in store.read(account).get('ai_jobs',[]) if j['id']==job_id),None)
        if not job:
            if (current.hour,current.minute)<(13,20):enqueue(store,markets,account,symbol,'schedule')
            continue
        if job['status']!='completed' or job.get('order_id') or job.get('auto_attempted_at') or (current.hour,current.minute)<(9,5):continue
        # Persist before attempting: a restart cannot silently retry a skipped decision.
        update_job(store,account,job_id,{'auto_attempted_at':current.isoformat()})
        try:execute(store,markets,account,job_id,automatic=True)
        except DomainError as exc:update_job(store,account,job_id,{'execution_note':str(exc)})


def selection_tick(store,markets,account,current):
    from .selection_research import start
    from .backtest import read
    from .ai import enqueue,execute,update_job
    from .domain import DomainError
    state=store.read(account)
    report=read(account,state['ai_selection_job']) if state.get('ai_selection_job') else None
    if not report or report.get('day')!=current.date().isoformat():
        if (current.hour,current.minute)<(13,0):start(store,markets,account,'schedule')
        return
    symbols=report.get('selected_symbols') or ([report['selected_symbol']] if report.get('selected_symbol') else [])
    if report['status']!='completed' or not symbols:return
    for symbol in symbols:
        state=store.read(account)
        job_id='daily-'+current.date().isoformat()+'-'+symbol
        job=next((j for j in state.get('ai_jobs',[]) if j['id']==job_id),None)
        if not job:
            if (current.hour,current.minute)<(13,20):enqueue(store,markets,account,symbol,'schedule')
            continue
        if job['status']!='completed' or job.get('order_id') or job.get('auto_attempted_at') or (current.hour,current.minute)<(9,5):continue
        update_job(store,account,job_id,{'auto_attempted_at':current.isoformat(),'selection_report_id':report['id']})
        try:execute(store,markets,account,job_id,automatic=True)
        except DomainError as exc:update_job(store,account,job_id,{'execution_note':str(exc)})


def start():
    from .api import get_store,get_markets
    stop=threading.Event()
    def loop():
        while not stop.is_set():
            try:tick(get_store(),get_markets())
            except Exception:logging.exception('Local paper schedule iteration failed')
            stop.wait(60)
    threading.Thread(target=loop,name='baglo-paper-schedule',daemon=True).start()
    return stop
