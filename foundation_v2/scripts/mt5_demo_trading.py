"""Dedicated, policy-bound DEMO trading adapter. Private stdin; never retries sends.

This module deliberately has no dependency on the investor/read-only connector.
Only main() imports the SDK, after validating the operator's local policy.
"""
import importlib
import base64
import json
import math
import os
from pathlib import Path
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal


class Denied(Exception):
    pass


def deny(reason):
    raise Denied(reason)


def finite(value, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        deny('demo_invalid_number')
    if positive and value <= 0:
        deny('demo_invalid_number')
    return float(value)


def validate_policy(policy, workspace, check_path=True):
    if not isinstance(policy, dict) or policy.get('enabled') is not True or policy.get('mode') != 'demo':
        deny('demo_policy_locked')
    if policy.get('workspace_id') != workspace:
        deny('demo_policy_locked')
    login = policy.get('login')
    if not isinstance(login, str) or not login.isascii() or not login.isdigit() or login.startswith('0') or len(login) > 18:
        deny('demo_policy_invalid')
    if not isinstance(policy.get('server'), str) or not policy['server'].strip() or len(policy['server']) > 160:
        deny('demo_policy_invalid')
    symbols = policy.get('symbols')
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 32 or len(set(symbols)) != len(symbols):
        deny('demo_policy_invalid')
    if any(not isinstance(s, str) or not 1 <= len(s) <= 64 or any(ord(c) < 32 for c in s) for s in symbols):
        deny('demo_policy_invalid')
    for field in ('max_risk_amount', 'max_risk_pct', 'max_volume'):
        finite(policy.get(field), True)
    for field, low, high in [('max_positions', 1, 100), ('max_quote_age_ms', 250, 5000), ('deviation_points', 0, 100), ('magic', 1, 2147483647)]:
        value = policy.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            deny('demo_policy_invalid')
    if policy['max_risk_pct'] > 100 or finite(policy.get('cost_buffer_per_lot')) < 0:
        deny('demo_policy_invalid')
    path = Path(policy.get('terminal_path', ''))
    if not path.is_absolute() or path.name.lower() != 'terminal64.exe':
        deny('demo_terminal_invalid')
    if check_path:
        import stat
        for item in [path, *path.parents]:
            if item.is_symlink() or (item.exists() and getattr(item.lstat(), 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024)):
                deny('demo_terminal_invalid')
        if not path.is_file():
            deny('demo_terminal_missing')
        if str(path).replace('\\', '/').lower() == 'c:/program files/metatrader 5/terminal64.exe':
            deny('demo_terminal_not_dedicated')
        readonly = os.environ.get('TW_V2_MT5_TERMINAL')
        if readonly and path.resolve() == Path(readonly).resolve():
            deny('demo_terminal_not_dedicated')
        if 'mt5-connectors' in {part.lower() for part in path.parts}:
            deny('demo_terminal_not_dedicated')
    return policy


def identity(sdk, policy):
    account, terminal = sdk.account_info(), sdk.terminal_info()
    if account is None or terminal is None or not terminal.connected:
        deny('demo_disconnected')
    if str(account.login) != policy['login'] or account.server != policy['server']:
        deny('demo_identity_changed')
    # ACCOUNT_TRADE_MODE_DEMO is 0. Never infer mode from a server's display name.
    if account.trade_mode != 0:
        deny('demo_account_required')
    if not account.trade_allowed or not account.trade_expert or not terminal.trade_allowed or terminal.tradeapi_disabled:
        deny('demo_trading_disabled')
    expected = Path(policy['terminal_path']).parent
    if os.path.normcase(str(Path(terminal.path).resolve())) != os.path.normcase(str(expected.resolve())):
        deny('demo_terminal_identity_changed')
    return account


def instrument(sdk, policy, symbol, now=None):
    if symbol not in policy['symbols']:
        deny('demo_symbol_denied')
    identity(sdk, policy)
    info = sdk.symbol_info(symbol)
    if info is None:
        deny('demo_symbol_unavailable')
    if not info.visible and not sdk.symbol_select(symbol, True):
        deny('demo_symbol_unavailable')
    quote = sdk.symbol_info_tick(symbol)
    if quote is None:
        deny('demo_quote_unavailable')
    for value in (quote.bid, quote.ask, info.trade_tick_size, info.point, info.volume_min, info.volume_max, info.volume_step):
        finite(value, True)
    age = int((time.time() if now is None else now) * 1000) - quote.time_msc
    if age < -1000 or age > policy['max_quote_age_ms'] or quote.ask < quote.bid:
        deny('demo_quote_stale')
    return info, quote


def aligned(value, step):
    ratio = Decimal(str(value)) / Decimal(str(step))
    return abs(ratio - ratio.to_integral_value()) <= Decimal('0.000001')


def inventory(sdk):
    positions, orders = sdk.positions_get(), sdk.orders_get()
    if positions is None or orders is None:
        deny('demo_inventory_unavailable')
    return positions, orders


def stop_risk(sdk, policy, symbol, side, volume, entry, stop):
    identity(sdk, policy)
    profit = sdk.order_calc_profit(0 if side == 'BUY' else 1, symbol, volume, entry, stop)
    if profit is None:
        deny('demo_risk_unavailable')
    # A profitable stop has no price risk, but still reserves explicit cost buffer.
    return max(0.0, -finite(profit)) + volume * policy['cost_buffer_per_lot']


def risk_budget(sdk, policy, account, positions, orders, candidate, exclude=None):
    total = candidate
    for item in [*positions, *orders]:
        if exclude is not None and item.ticket == exclude and item in positions:
            continue
        if item.symbol not in policy['symbols'] or item.sl <= 0:
            deny('demo_existing_risk_unknown')
        side = 'BUY' if item.type in (0, 2, 4, 6) else 'SELL'
        # Equity already contains floating P/L: reserve remaining downside from
        # the current liquidation quote, including profitable positions.
        if item in positions:
            _, quote = instrument(sdk,policy,item.symbol)
            reference = quote.bid if side == 'BUY' else quote.ask
        else:
            reference = item.price_open
        total += stop_risk(sdk, policy, item.symbol, side, item.volume if item in positions else item.volume_current, reference, item.sl)
    equity = finite(account.equity, True)
    limit = min(policy['max_risk_amount'], equity * policy['max_risk_pct'] / 100)
    if total > limit + 1e-8:
        deny('demo_risk_limit')
    return total, limit


def filling(info):
    # Symbol filling_mode is a bitmask, while ORDER_FILLING_* are enum values.
    if info.filling_mode & 1:
        return 0  # FOK
    if info.filling_mode & 2:
        return 1  # IOC
    if info.trade_exemode != 2:
        return 2  # RETURN is forbidden for market execution.
    deny('demo_filling_unsupported')


def request_comment(request_id):
    return 'wm:' + base64.urlsafe_b64encode(uuid.UUID(request_id).bytes).decode().rstrip('=')


def protection(info, quote, side, sl, tp, required=False):
    if required and sl is None:
        deny('demo_stop_required')
    stop = 0.0 if sl is None else finite(sl, True)
    target = 0.0 if tp is None else finite(tp, True)
    distance = max(info.trade_stops_level, info.trade_freeze_level) * info.point
    reference = quote.bid if side == 'BUY' else quote.ask
    for value in (stop, target):
        if value and not aligned(value, info.trade_tick_size):
            deny('demo_price_step')
    if stop and (reference - stop if side == 'BUY' else stop - reference) <= distance:
        deny('demo_stop_direction_or_distance')
    if target and (target - reference if side == 'BUY' else reference - target) <= distance:
        deny('demo_target_direction_or_distance')
    return stop, target


def prepare(sdk, policy, command):
    if command.get('mode') != 'demo' or str(command.get('account_id')) != policy['login'] or command.get('server') != policy['server']:
        deny('demo_identity_mismatch')
    symbol, action = command.get('symbol'), command.get('action', 'place')
    info, quote = instrument(sdk, policy, symbol)
    account = identity(sdk, policy)
    positions, orders = inventory(sdk)
    request = {'symbol': symbol, 'magic': policy['magic'], 'comment': request_comment(command['request_id']) if command.get('request_id') else 'wm:preview'}
    estimated, margin, total_risk, limit = None, None, None, None
    if action == 'place':
        if command.get('order_type') != 'market':
            deny('demo_order_type_unsupported')
        side = command.get('side')
        if side not in ('BUY', 'SELL'):
            deny('demo_side_invalid')
        # Netting would merge user/order state. Initial workspace explicitly supports hedging only.
        if account.margin_mode != 2:
            deny('demo_hedging_required')
        if info.trade_mode != 4 or not (info.order_mode & 1) or not (info.order_mode & 16):
            deny('demo_symbol_trade_disabled')
        if len(positions) + len(orders) >= policy['max_positions']:
            deny('demo_position_limit')
        volume = finite(command.get('volume'), True)
        if volume < info.volume_min or volume > min(info.volume_max, policy['max_volume']) or not aligned(volume, info.volume_step):
            deny('demo_volume_step_or_limit')
        price = quote.ask if side == 'BUY' else quote.bid
        sl, tp = protection(info, quote, side, command.get('stop_loss'), command.get('take_profit'), True)
        if tp and not (info.order_mode & 32):
            deny('demo_symbol_trade_disabled')
        estimated = stop_risk(sdk, policy, symbol, side, volume, price, sl)
        total_risk, limit = risk_budget(sdk, policy, account, positions, orders, estimated)
        identity(sdk, policy)
        margin = sdk.order_calc_margin(0 if side == 'BUY' else 1, symbol, volume, price)
        if margin is None or finite(margin) < 0 or margin > finite(account.margin_free):
            deny('demo_margin_insufficient')
        request.update(action=1, type=0 if side == 'BUY' else 1, volume=volume, sl=sl, tp=tp, deviation=policy['deviation_points'], type_filling=filling(info))
        if info.trade_exemode != 2:
            request['price'] = price
    elif action in ('close', 'protect', 'cancel'):
        ticket = command.get('ticket')
        if isinstance(ticket, bool) or not isinstance(ticket, int) or ticket <= 0:
            deny('demo_ticket_invalid')
        items = orders if action == 'cancel' else positions
        item = next((p for p in items if p.ticket == ticket and p.symbol == symbol), None)
        if item is None or item.magic != policy['magic']:
            deny('demo_ticket_not_managed')
        if action == 'cancel':
            if info.trade_freeze_level * info.point >= min(abs(item.price_open - quote.bid), abs(item.price_open - quote.ask)):
                deny('demo_frozen')
            request.update(action=8, order=ticket)
        elif action == 'close':
            if command.get('volume') is not None and command['volume'] != item.volume:
                deny('demo_partial_close_unsupported')
            side = 'SELL' if item.type == 0 else 'BUY'
            price = quote.bid if side == 'SELL' else quote.ask
            request.update(action=1, position=ticket, type=1 if side == 'SELL' else 0, volume=item.volume, deviation=policy['deviation_points'], type_filling=filling(info))
            if info.trade_exemode != 2:
                request['price'] = price
        else:
            side = 'BUY' if item.type == 0 else 'SELL'
            sl, tp = protection(info, quote, side, command.get('stop_loss'), command.get('take_profit'), True)
            # Reject modifying an already frozen level as well as a new frozen level.
            reference = quote.bid if side == 'BUY' else quote.ask
            if any(value and abs(value - reference) <= info.trade_freeze_level * info.point for value in (item.sl, item.tp)):
                deny('demo_frozen')
            estimated = stop_risk(sdk, policy, symbol, side, item.volume, quote.bid if side == 'BUY' else quote.ask, sl)
            total_risk, limit = risk_budget(sdk, policy, account, positions, orders, estimated, ticket)
            request.update(action=6, position=ticket, sl=sl, tp=tp)
    else:
        deny('demo_action_unsupported')
    identity(sdk, policy)
    check = sdk.order_check(request)
    if check is None or check.retcode != 0:
        deny('demo_order_check_rejected')
    return request, {'passed': True, 'reason': 'demo_preview_passed', 'entry_price': price if action in ('place', 'close') else None, 'estimated_stop_risk': estimated, 'margin_required': margin, 'currency': account.currency, 'total_stop_risk': total_risk, 'risk_limit': limit, 'risk_estimate_excludes': ['slippage', 'gap_risk'], 'cost_buffer_per_lot': policy['cost_buffer_per_lot']}


def execute(sdk, policy, command, before_send=lambda: None):
    request, preview = prepare(sdk, policy, command)
    # No cached preview is trusted. Re-read identity AND quote immediately before send.
    identity(sdk, policy)
    _, last_quote = instrument(sdk, policy, command['symbol'])
    if preview['entry_price'] is not None:
        expected = last_quote.ask if request['type'] == 0 else last_quote.bid
        if expected != preview['entry_price']:
            deny('demo_quote_changed_preview_again')
    before_send()
    identity(sdk, policy)
    try:
        result = sdk.order_send(request)  # Exactly one call, including timeouts/requotes.
    except Exception:
        return {'status': 'unknown', 'reason': 'demo_send_outcome_unknown'}
    if result is None:
        return {'status': 'unknown', 'reason': 'demo_send_outcome_unknown'}
    code = result.retcode
    # Timeout/connection/internal error are deliberately not treated as safe failures.
    if code in (10012, 10031, 10011):
        return {'status': 'unknown', 'reason': 'demo_send_outcome_unknown', 'retcode': code}
    if code in (10009, 10010):
        status, reason = 'filled', 'demo_order_filled' if code == 10009 else 'demo_order_partially_filled'
    elif code in (10008, 10025):
        status, reason = 'accepted', 'demo_order_accepted'
    elif 10004 <= code <= 10046:
        status, reason = 'rejected', 'demo_broker_rejected'
    else:
        status, reason = 'unknown', 'demo_send_outcome_unknown'
    return {'status': status, 'reason': reason, 'retcode': code, 'requires_reconciliation': code in (10008, 10010), 'order': getattr(result, 'order', None), 'deal': getattr(result, 'deal', None), 'volume': getattr(result, 'volume', None), 'price': getattr(result, 'price', None), 'estimate': preview}


def snapshot(sdk, policy, symbol, timeframe='M1'):
    info, quote = instrument(sdk, policy, symbol)
    account = identity(sdk, policy)
    positions, orders = inventory(sdk)
    if timeframe not in ('M1','M5','M15','H1','H4','D1'):
        deny('demo_timeframe_unsupported')
    rates = sdk.copy_rates_from_pos(symbol, getattr(sdk, 'TIMEFRAME_' + timeframe), 0, 300)
    if rates is None:
        deny('demo_bars_unavailable')
    def row(item, pending=False):
        return {'ticket': item.ticket, 'symbol': item.symbol, 'side': 'BUY' if item.type in (0, 2, 4, 6) else 'SELL', 'volume': item.volume_current if pending else item.volume, 'price_open': item.price_open, 'sl': item.sl, 'tp': item.tp, 'profit': getattr(item, 'profit', None), 'type': item.type, 'managed': item.magic == policy['magic']}
    identity(sdk, policy)
    return {'status': 'ready', 'reason': 'demo_ready', 'mode': 'demo', 'execution_enabled': True, 'account': {key: getattr(account, key) for key in ('server', 'currency', 'balance', 'equity', 'margin', 'margin_free', 'trade_mode')} | {'login': str(account.login)}, 'symbols': policy['symbols'], 'symbol': symbol, 'timeframe': timeframe, 'quote': {'bid': quote.bid, 'ask': quote.ask, 'time_msc': quote.time_msc}, 'instrument': {'symbol':symbol, 'asset_class':'fx' if info.trade_calc_mode in (0,5) else 'other', 'tick_size': info.trade_tick_size, 'point': info.point, 'digits': info.digits, 'quantity_min': info.volume_min, 'quantity_max': info.volume_max, 'quantity_step': info.volume_step, 'stops_level': info.trade_stops_level, 'freeze_level': info.trade_freeze_level}, 'positions': [row(p) for p in positions], 'orders': [row(p, True) for p in orders], 'bars': [{'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(r['time']))), **{key: float(r[key]) for key in ('open', 'high', 'low', 'close')}, 'volume': int(r['tick_volume'])} for r in rates], 'policy': {key: policy[key] for key in ('max_risk_amount', 'max_risk_pct', 'max_positions', 'max_volume', 'max_quote_age_ms', 'cost_buffer_per_lot')}}


def reconcile(sdk, policy, command, submitted_at, previous):
    """Prove a known broker outcome; absence of evidence is never a rejection."""
    identity(sdk, policy)
    if command.get('mode') != 'demo' or command.get('account_id') != policy['login'] or command.get('server') != policy['server'] or command.get('symbol') not in policy['symbols']:
        deny('demo_identity_mismatch')
    started = datetime.fromisoformat(submitted_at.replace('Z','+00:00'))
    now = datetime.now(timezone.utc)
    if started.tzinfo is None or started > now + timedelta(seconds=1) or now - started > timedelta(days=7):
        return {'resolved':False,'reason':'demo_reconciliation_window_unavailable'}
    start_msc = int(started.timestamp()*1000) - 1000
    positions, active_orders = inventory(sdk)
    action = command['action']
    ticket = command.get('ticket')
    if action == 'protect':
        position = next((p for p in positions if p.ticket == ticket and p.symbol == command['symbol'] and p.magic == policy['magic']),None)
        if position and position.time_update_msc >= int(started.timestamp()*1000) and position.sl == command['stop_loss'] and position.tp == (command.get('take_profit') or 0):
            identity(sdk, policy)
            return {'resolved':True,'status':'accepted','reason':'demo_reconciled_protection_active','requires_reconciliation':False,'position':ticket,'evidence':{'sl':position.sl,'tp':position.tp,'time_update_msc':position.time_update_msc}}
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    if action == 'cancel':
        if any(p.ticket == ticket for p in active_orders):
            return {'resolved':False,'reason':'demo_reconciliation_unproven'}
        history = sdk.history_orders_get(ticket=ticket)
        if history is None:
            deny('demo_history_unavailable')
        matched = [o for o in history if o.ticket == ticket and o.symbol == command['symbol'] and o.magic == policy['magic'] and o.state == 2 and o.time_done_msc >= int(started.timestamp()*1000)]
        if len(matched) == 1:
            identity(sdk, policy)
            return {'resolved':True,'status':'accepted','reason':'demo_reconciled_cancelled','requires_reconciliation':False,'order':ticket}
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    if action not in ('place','close'):
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    tag = request_comment(command['request_id'])
    if any(o.comment == tag and o.magic == policy['magic'] for o in active_orders):
        return {'resolved':False,'reason':'demo_reconciliation_still_active'}
    # Bounded seven-day window. Exact request tag is mandatory for deal attribution.
    deals = sdk.history_deals_get(started-timedelta(seconds=60),now+timedelta(seconds=1))
    if deals is None or len(deals) > 100000:
        deny('demo_history_unavailable')
    expected_side = 0 if command.get('side') == 'BUY' else 1
    matches = [d for d in deals if d.comment == tag and d.magic == policy['magic'] and d.symbol == command['symbol'] and d.time_msc >= start_msc]
    if not matches:
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    if action == 'place':
        if any(d.entry != 0 or d.type != expected_side for d in matches):
            return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    else:
        if any(d.entry not in (1,3) or d.position_id != ticket for d in matches) or any(p.ticket == ticket for p in positions):
            return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    order_ids = {d.order for d in matches}
    if len(order_ids) != 1:
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    order_id = next(iter(order_ids))
    history = sdk.history_orders_get(ticket=order_id)
    if history is None:
        deny('demo_history_unavailable')
    order = next((o for o in history if o.ticket == order_id and o.comment == tag and o.magic == policy['magic'] and o.symbol == command['symbol'] and o.state in (2,4,6)),None)
    if order is None:
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    volume = sum(Decimal(str(d.volume)) for d in matches)
    expected_volume = Decimal(str(command['volume'])) if action == 'place' else Decimal(str(order.volume_initial))
    # Final order accounting must prove that there is no remaining executable lot.
    if volume <= 0 or volume > expected_volume or volume != Decimal(str(order.volume_initial)) - Decimal(str(order.volume_current)):
        return {'resolved':False,'reason':'demo_reconciliation_unproven'}
    identity(sdk,policy)
    return {'resolved':True,'status':'filled','reason':'demo_reconciled_filled' if volume == expected_volume else 'demo_reconciled_partial_final','requires_reconciliation':False,'order':order_id,'deals':[d.ticket for d in matches],'volume':float(volume),'price':float(sum(Decimal(str(d.price))*Decimal(str(d.volume)) for d in matches)/volume)}


def current_policy(policy, workspace):
    try:
        path = Path(os.environ['TW_V2_MT5_DEMO_POLICY'])
        if not path.is_absolute() or path.is_symlink() or path.stat().st_size > 16384:
            deny('demo_policy_invalid')
        current = json.loads(path.read_text(encoding='utf-8'))
        validate_policy(current, workspace)
        if current != policy:
            deny('demo_policy_changed')
    except (OSError, KeyError, ValueError):
        deny('demo_policy_locked')


def run(request, sdk_loader=None):
    # No SDK import/initialize, even for snapshots, until every policy gate passes.
    policy = validate_policy(request.get('policy'), request.get('workspace'))
    current_policy(policy, request.get('workspace'))
    action = request.get('operation')
    if action not in ('snapshot', 'preview', 'command', 'reconcile'):
        deny('demo_action_unsupported')
    try:
        sdk = (sdk_loader or (lambda: importlib.import_module('MetaTrader5')))()
    except ImportError:
        deny('demo_sdk_missing')
    if not sdk.initialize(path=policy['terminal_path'], portable=True, timeout=5000):
        deny('demo_terminal_unavailable')
    try:
        identity(sdk, policy)
        if action == 'snapshot':
            return snapshot(sdk, policy, request.get('symbol'), request.get('timeframe','M1'))
        command = request.get('command', {})
        if action == 'reconcile':
            return reconcile(sdk,policy,command,request['submitted_at_utc'],request.get('previous',{}))
        if action == 'preview':
            return prepare(sdk, policy, command)[1]
        return execute(sdk, policy, command, lambda: current_policy(policy, request.get('workspace')))
    finally:
        sdk.shutdown()


def main():
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            deny('demo_request_invalid')
        response = run(json.loads(raw))
    except Denied as error:
        response = {'status': 'rejected', 'passed': False, 'reason': str(error)}
    except Exception:
        # Unexpected failures could follow submission; never classify as safe to retry.
        response = {'status': 'unknown', 'passed': False, 'reason': 'demo_adapter_failed'}
    sys.stdout.write(json.dumps(response, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
