from datetime import datetime
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from baglo.matching import apply_matches, gather, session_day

TZ = ZoneInfo('Asia/Taipei')


def at(text):
    return datetime.fromisoformat(text).replace(tzinfo=TZ)


def account(*orders, cash=30_000_000, positions=None):
    return {'cash': cash, 'positions': dict(positions or {}), 'orders': list(orders), 'version': 1, 'mode': 'paper'}


def order(side='buy', limit=200000, created='2026-11-24T10:03:27', quantity=10, market_type='odd_lot', symbol='2330'):
    return {'id': side+created, 'symbol': symbol, 'side': side, 'quantity': quantity, 'limit_price': limit,
            'market_type': market_type, 'status': 'pending', 'reserved': 1, 'created_at': at(created).isoformat()}


def candle(minute, open_, high, low, close=None):
    return {'at': at('2026-11-24T'+minute), 'open': open_, 'high': high, 'low': low, 'close': close or open_}


def market(bars=None, daily=None, day='2026-11-24'):
    return {'intraday': {('2330', 'odd_lot'): {'date': day, 'bars': bars or []}}, 'daily': {'2330': daily}}


def test_session_rolls_after_close_and_over_weekend():
    assert session_day(at('2026-11-24T10:00').isoformat()).isoformat() == '2026-11-24'
    assert session_day(at('2026-11-24T13:31').isoformat()).isoformat() == '2026-11-25'
    assert session_day(at('2026-11-22T10:00').isoformat()).isoformat() == '2026-11-23'  # Sunday -> Monday
    assert session_day(at('2026-11-27T20:00').isoformat()).isoformat() == '2026-11-30'  # Friday night -> Monday


def test_buy_fills_at_limit_when_low_touches_and_charges_fee():
    bars = [candle('10:03:00', 199000, 199000, 198000),  # same minute as the order: ignored
            candle('10:04:00', 201000, 201500, 200500),
            candle('10:05:00', 201000, 201000, 200000)]
    state, changed = apply_matches(account(order()), market(bars), at('2026-11-24T10:06'))
    filled = state['orders'][0]
    assert changed and filled['status'] == 'filled'
    assert filled['fill_price'] == 200000 and filled['fill_source'] == 'intraday_1m'
    assert filled['filled_at'].startswith('2026-11-24T10:05')
    assert filled['fee'] == 2850 and filled['tax'] == 0  # 0.1425% of NT$20,000
    assert state['cash'] == 30_000_000 - 2_000_000 - 2850
    assert state['positions']['2330'] == 10 and filled['reserved'] == 0


def test_buy_gets_better_open_price_when_market_already_below_limit():
    state, _ = apply_matches(account(order()), market([candle('10:04:00', 199000, 199500, 198500)]), at('2026-11-24T10:06'))
    assert state['orders'][0]['fill_price'] == 199000


def test_sell_fills_when_high_touches_and_pays_tax():
    sell = order('sell', limit=210000)
    state, _ = apply_matches(account(sell, positions={'2330': 10}), market([candle('10:04:00', 209000, 210000, 208000)]), at('2026-11-24T10:06'))
    filled = state['orders'][0]
    assert filled['status'] == 'filled' and filled['fill_price'] == 210000
    assert filled['tax'] == 6300 and state['positions']['2330'] == 0
    assert filled['fee'] == 2993  # 0.1425% of NT$21,000, rounded half up
    assert state['cash'] == 30_000_000 + 2_100_000 - 2993 - 6300


def test_untouched_order_waits_during_session_and_expires_after_close():
    bars = [candle('10:04:00', 201000, 202000, 200500)]
    waiting, changed = apply_matches(account(order()), market(bars), at('2026-11-24T11:00'))
    assert not changed and waiting['orders'][0]['status'] == 'pending'
    expired, changed = apply_matches(account(order()), market(bars), at('2026-11-24T13:45'))
    assert changed and expired['orders'][0]['status'] == 'expired' and expired['orders'][0]['reserved'] == 0
    assert expired['cash'] == 30_000_000


def test_earlier_session_uses_daily_bar_then_expires_if_untouched():
    weekend = order(created='2026-11-22T10:00:00')  # Sunday order -> Monday session
    daily = [{'date': '2026-11-23', 'open': 202000, 'high': 203000, 'low': 199500, 'close': 201000}]
    state, _ = apply_matches(account(weekend), market(daily=daily), at('2026-11-24T08:00'))
    assert state['orders'][0]['status'] == 'filled' and state['orders'][0]['fill_source'] == 'daily_bar'
    assert state['orders'][0]['fill_price'] == 200000
    high = [{'date': '2026-11-23', 'open': 205000, 'high': 206000, 'low': 204000, 'close': 205000}]
    state, _ = apply_matches(account(order(created='2026-11-22T10:00:00')), market(daily=high), at('2026-11-24T08:00'))
    assert state['orders'][0]['status'] == 'expired'


def test_missing_data_keeps_order_pending():
    state, changed = apply_matches(account(order(created='2026-11-22T10:00:00')),
                                   {'intraday': {}, 'daily': {'2330': None}}, at('2026-11-24T08:00'))
    assert not changed and state['orders'][0]['status'] == 'pending'
    state, changed = apply_matches(account(order()), {'intraday': {('2330', 'odd_lot'): None}, 'daily': {}}, at('2026-11-24T13:50'))
    assert not changed and state['orders'][0]['status'] == 'pending'


def test_minimum_fee_applies_to_small_trades():
    small = order(limit=10000, quantity=10)  # NT$1,000 trade: fee would be NT$1.43, minimum is NT$20
    bars = [{'at': at('2026-11-24T10:04:00'), 'open': 10000, 'high': 10000, 'low': 10000, 'close': 10000}]
    state, _ = apply_matches(account(small), market(bars), at('2026-11-24T10:06'))
    assert state['orders'][0]['fee'] == 2000


def test_insufficient_cash_at_fill_expires_instead_of_overdrawing():
    state, _ = apply_matches(account(order(), cash=1000), market([candle('10:04:00', 199000, 199500, 198500)]), at('2026-11-24T10:06'))
    assert state['orders'][0]['status'] == 'expired' and state['cash'] == 1000


def test_gather_fetches_once_per_symbol_and_respects_budget():
    calls = []
    markets = SimpleNamespace(history=lambda symbol, months: calls.append(('daily', symbol)) or {'bars': []},
                              intraday_candles=lambda symbol, kind: calls.append(('intraday', symbol)) or None)
    state = account(order(), order('sell', created='2026-11-24T10:05:00'), order(created='2026-11-22T10:00:00'))
    gather(state, markets, at('2026-11-24T10:30'))
    assert sorted(calls) == [('daily', '2330'), ('intraday', '2330')]
    calls.clear()
    assert gather(state, markets, at('2026-11-24T10:30'), budget=-1) == {'intraday': {}, 'daily': {}}
    assert calls == []
