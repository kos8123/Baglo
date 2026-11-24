"""Atomic, optimistic account snapshots. SQLite local; DynamoDB on Lambda."""
from copy import deepcopy
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
from .domain import DomainError, new_account

class Store:
    def __init__(self, mode='paper', path=None, table=None):
        self.mode, self.table = mode, table
        self.path = path or os.getenv('BAGLO_LOCAL_DB', 'data/baglo.db')
        if table is None:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            with self.connection() as db:
                db.execute('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def read(self, account):
        if self.table is not None:
            item = self.table.get_item(Key={'pk': account}, ConsistentRead=True).get('Item')
            return json.loads(item['data']) if item else new_account(self.mode)
        with self.connection() as db:
            row = db.execute('SELECT data FROM accounts WHERE id=?', (account,)).fetchone()
        return json.loads(row[0]) if row else new_account(self.mode)

    def mutate(self, account, operation):
        for _ in range(8):
            old = self.read(account)
            state, output = operation(deepcopy(old))
            if state == old:
                return output
            state['version'] = old['version'] + 1
            encoded = json.dumps(state, ensure_ascii=False, separators=(',', ':'))
            if len(encoded.encode()) > 300_000:
                raise DomainError('帳本接近儲存上限；未寫入交易', 409)
            if self.table is not None:
                try:
                    params = {'Item': {'pk': account, 'version': state['version'], 'data': encoded},
                              'ConditionExpression': 'attribute_not_exists(pk)' if old['version'] == 0 else '#v = :old'}
                    if old['version']:
                        params.update(ExpressionAttributeNames={'#v': 'version'}, ExpressionAttributeValues={':old': old['version']})
                    self.table.put_item(**params)
                    return output
                except Exception as exc:
                    if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                        raise
            else:
                with self.connection() as db:
                    if old['version'] == 0:
                        cursor = db.execute('INSERT OR IGNORE INTO accounts VALUES (?,?,?)', (account, state['version'], encoded))
                    else:
                        cursor = db.execute('UPDATE accounts SET version=?,data=? WHERE id=? AND version=?',
                                            (state['version'], encoded, account, old['version']))
                    if cursor.rowcount:
                        return output
        raise DomainError('帳戶同時有其他操作，請稍後重試', 409)
