"""Read-only portfolio valuation; derive cost only from recorded fills."""
from concurrent.futures import ThreadPoolExecutor

def portfolio(state, markets):
    books = {}
    realized = 0
    for order in state['orders']:
        if order['status'] != 'filled':
            continue
        symbol = order['symbol']
        qty, cost = books.get(symbol, (0, 0))
        amount = order['quantity']
        price = order.get('fill_price', order['limit_price'])
        if order['side'] == 'buy':
            books[symbol] = (qty+amount, cost+amount*price+order.get('fee', 0))
        elif qty >= amount:
            allocated = round(cost*amount/qty)
            realized += amount*price-order.get('fee', 0)-order.get('tax', 0)-allocated
            books[symbol] = (qty-amount, cost-allocated)
        else:
            books[symbol] = (0, 0)
    def value(pair):
        symbol, quantity = pair
        reserved = sum(o['quantity'] for o in state['orders'] if o['symbol']==symbol and o['side']=='sell' and o['status']=='pending')
        book_qty, cost = books.get(symbol, (0, None))
        known = book_qty == quantity and cost is not None
        row = {'symbol':symbol,'name':next((o.get('name',symbol) for o in reversed(state['orders']) if o['symbol']==symbol),symbol),
               'quantity':quantity,'available_quantity':quantity-reserved,'reserved_quantity':reserved,
               'cost':cost if known else None,'average_price':round(cost/quantity) if known else None,
               'price':None,'market_value':None,'unrealized_pnl':None,'return_percent':None,'as_of':None,'price_kind':'unavailable'}
        try:
            quote = markets.quote(symbol, 'odd_lot' if quantity<1000 else 'board_lot')['quote']
            price = quote['price']
            row.update(price=price, as_of=quote['as_of'], source=quote['source'], price_kind=quote['kind'])
            if price:
                row['market_value'] = price*quantity
                if known:
                    row['unrealized_pnl'] = price*quantity-cost
                    row['return_percent'] = round(row['unrealized_pnl']/cost*100, 2) if cost else None
        except Exception:
            pass
        return row
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(value, [(s,q) for s,q in state['positions'].items() if q>0]))
    complete = all(row['market_value'] is not None for row in rows)
    return {'items':rows,'realized_pnl':realized,'cash':state['cash'],
            'total_market_value':sum(row['market_value'] for row in rows) if complete else None,
            'total_equity':state['cash']+sum(row['market_value'] for row in rows) if complete else None,
            'note':'成本採含買進手續費之移動平均。未實現損益未扣未來賣出費稅；價格可能是最近成交或收盤參考，請看時間。'}
