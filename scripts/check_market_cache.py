"""Audit the Cloudflare R2 K-line cache through the public Pages endpoint.

Usage: python3 scripts/check_market_cache.py [--base https://baglo.pages.dev] [--limit N]
Reports, per exchange, how many stocks have ~10 years of daily bars, which are
missing recent days, and which have gaps the official sources say should exist.
"""
import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from urllib.request import Request, urlopen

API = 'https://5ck9jrcbe3.execute-api.us-east-1.amazonaws.com'


def get(url):
    with urlopen(Request(url, headers={'User-Agent': 'baglo-cache-audit'}), timeout=30) as response:
        return json.load(response), response.headers.get('X-Baglo-Cache', '')


def last_weekday(today):
    day = today - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.isoformat()


def check(base, item):
    try:
        data, cache = get(f"{base}/market/history/{item['symbol']}?months=120&offset=0")
    except Exception as exc:
        return {**item, 'problem': 'error', 'detail': str(exc)[:80]}
    bars = data.get('bars') or []
    missing = [w for w in data.get('warnings') or [] if '暫無資料' in w]
    return {**item, 'cache': cache, 'bars': len(bars), 'first': bars[0]['date'] if bars else None,
            'last': bars[-1]['date'] if bars else None, 'missing_months': len(missing)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='https://baglo.pages.dev')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()
    catalog, _ = get(API+'/api/instruments/export')
    items = [{'symbol': i['symbol'], 'exchange': i.get('exchange', '?')} for i in catalog['items']]
    if args.limit:
        items = items[:args.limit]
    with ThreadPoolExecutor(args.workers) as pool:
        results = list(pool.map(lambda item: check(args.base, item), items))
    expected_last = last_weekday(date.today())
    summary = Counter()
    for r in results:
        if r.get('problem'):
            r['status'] = 'error'
        elif not r['bars']:
            r['status'] = 'empty'
        elif r['first'] > '2017-01-31' and r['missing_months']:
            r['status'] = 'short'  # stock older than its stored history
        elif r['last'] < expected_last:
            r['status'] = 'stale'
        else:
            r['status'] = 'ok'
        summary[(r['exchange'], r['status'])] += 1
    for (exchange, status), count in sorted(summary.items()):
        print(f'{exchange:5} {status:6} {count}')
    bad = [r for r in results if r['status'] != 'ok']
    print(f'\n{len(results)} checked, {len(bad)} need attention (last expected trading day {expected_last})')
    for r in bad[:40]:
        print(r)
    json.dump(results, open('market-cache-audit.json', 'w'), ensure_ascii=False, indent=1)
    print('full results: market-cache-audit.json')


if __name__ == '__main__':
    main()
