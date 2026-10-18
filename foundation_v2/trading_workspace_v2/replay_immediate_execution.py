"""Manual Market fills at the already-visible closed checkpoint, without advancing time."""

from decimal import Decimal

from .execution_semantics import protection_brackets, quote_from_mid
from .replay_execution import (
    ReplayExecutionError, ReplayExecutionSnapshotV2, ReplayMarginAdmission,
    ReplayOpenPosition, _decimal, _event_type, _liquidation_pnl,
)
from .retained import CostModel, InstrumentSpec


def fill_current_quote(snapshot, *, mid_close, virtual_time_utc):
    order = snapshot.pending_market_order
    if order is None or snapshot.position is not None or order.submitted_cursor_index != snapshot.cursor_index:
        raise ReplayExecutionError('current-quote fill requires a newly submitted market order')
    if snapshot.ledger and virtual_time_utc != snapshot.ledger[-1]['virtual_time_utc']:
        raise ReplayExecutionError('current quote must retain the canonical checkpoint time')
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    costs = CostModel.from_mapping(snapshot.cost_model)
    mid = _decimal(mid_close, 'mid_close', positive=True)
    tick_mode = snapshot.schema_version == 'replay-execution-tick-v1'
    provenance = {}
    if tick_mode:
        # Manual actions retain the quote but omit its tick-window boundaries.
        prior = next((raw['details'] for raw in reversed(snapshot.ledger)
            if 'bid' in raw.get('details', {}) and 'window_start_msc' in raw['details']), None)
        if prior is None or snapshot.last_bid is None or snapshot.last_ask is None:
            raise ReplayExecutionError('current broker quote is unavailable')
        bid, ask = snapshot.last_bid, snapshot.last_ask
        provenance = {key: prior[key] for key in ('tick_snapshot_id', 'tick_snapshot_sha256', 'quote_source',
            'time_msc', 'sequence', 'bid', 'ask', 'window_start_msc', 'window_end_msc')}
    else:
        bid, ask = quote_from_mid(mid, spread_price=snapshot.spread_price, tick_size=instrument.tick_size)
    fill = ask if order.side == 'BUY' else bid
    # Protections only cover quotes after this cutoff, never the past OHLC range.
    reference = bid if order.side == 'BUY' else ask
    if not protection_brackets(order.side, reference, order.stop_loss, order.take_profit):
        raise ReplayExecutionError('protection must bracket the current closeable quote')
    details = {'operation_id': order.operation_id, 'side': order.side, 'quantity': str(order.quantity),
        'fill_price': str(fill), 'execution_timing': 'current_quote', 'mid_close': str(mid),
        'bid_close': str(bid), 'ask_close': str(ask), 'quote_mid_close': str((bid + ask) / 2),
        **provenance}
    rejected = False
    if isinstance(snapshot, ReplayExecutionSnapshotV2):
        required = fill * order.quantity * instrument.contract_size * costs.quote_to_account_rate / snapshot.research_margin.leverage
        admission = ReplayMarginAdmission(**snapshot.research_margin.model_dump(), required_account=required,
            available_account=snapshot.starting_balance, submitted_cursor_index=snapshot.cursor_index)
        details['margin_admission'] = admission.model_dump(mode='json')
        rejected = required > snapshot.starting_balance
    position = None
    floating = Decimal('0')
    if rejected:
        details['reason'] = 'insufficient_research_margin'
    else:
        position = ReplayOpenPosition(position_id=f'replay-pos-{snapshot.event_sequence + 1}',
            source_operation_id=order.operation_id, side=order.side, quantity=order.quantity,
            entry_bid=bid, entry_ask=ask, entry_fill=fill, stop_loss=order.stop_loss, take_profit=order.take_profit,
            opened_cursor_index=snapshot.cursor_index, opened_time_utc=virtual_time_utc)
        floating, _ = _liquidation_pnl(position, exit_bid=bid, exit_ask=ask, instrument=instrument, cost_model=costs)
        details['position_id'] = position.position_id
    coverage = next((raw['details'].get('intrabar_equity_coverage', 'insufficient')
        for raw in reversed(snapshot.ledger) if raw.get('kind') == 'price_mark'), 'complete')
    details.update(open_position=position.model_dump(mode='json') if position else None,
        pending_market_order=None, intrabar_equity_coverage=coverage)
    events = []
    for index, kind in enumerate(('order_rejected' if rejected else 'market_fill', 'price_mark'), 1):
        event = _event_type(snapshot)(sequence=snapshot.event_sequence + index, kind=kind,
            replay_session_id=snapshot.replay_session_id, branch_id=snapshot.branch_id,
            dataset_id=snapshot.dataset_id, dataset_sha256=snapshot.dataset_sha256,
            cursor_index=snapshot.cursor_index, virtual_time_utc=virtual_time_utc,
            balance=snapshot.balance, floating_pl=floating, equity=snapshot.balance + floating,
            open_positions=int(position is not None), pending_orders=0, details=details)
        events.append(event.model_dump(mode='json'))
    return snapshot.model_copy(update={'position': position, 'pending_market_order': None,
        'floating_pl': floating, 'equity': snapshot.balance + floating,
        'event_sequence': events[-1]['sequence'], 'ledger': [*snapshot.ledger, *events]})


def validate_current_quote_fill(snapshot, event):
    if event.details.get('execution_timing') != 'current_quote':
        return
    if event.kind == 'price_mark':
        prior = next((raw for raw in snapshot.ledger if raw['sequence'] == event.sequence - 1), None)
        if (prior is None or prior['kind'] not in {'market_fill', 'order_rejected'}
                or prior['cursor_index'] != event.cursor_index or prior['virtual_time_utc'] != event.virtual_time_utc
                or prior['details'] != event.details
                or any(Decimal(str(prior[key])) != getattr(event, key) for key in ('balance', 'floating_pl', 'equity'))
                or prior['open_positions'] != event.open_positions or prior['pending_orders'] != event.pending_orders):
            raise ReplayExecutionError('current quote mark differs from its immediate fill checkpoint')
        return
    if event.kind not in {'market_fill', 'order_rejected'}:
        raise ReplayExecutionError('unsupported current quote event')
    d = event.details
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    costs = CostModel.from_mapping(snapshot.cost_model)
    if snapshot.schema_version == 'replay-execution-tick-v1':
        bid, ask = _decimal(d['bid'], 'bid'), _decimal(d['ask'], 'ask')
    else:
        bid, ask = quote_from_mid(d['mid_close'], spread_price=snapshot.spread_price, tick_size=instrument.tick_size)
    fill = ask if d.get('side') == 'BUY' else bid
    if _decimal(d['fill_price'], 'fill') != fill:
        raise ReplayExecutionError('current fill differs from its cutoff quote')
    if event.kind == 'market_fill':
        p = ReplayOpenPosition.model_validate(d['open_position'])
        if (p.entry_bid != bid or p.entry_ask != ask or p.entry_fill != fill or p.side != d['side']
                or p.quantity != _decimal(d['quantity'], 'quantity') or p.position_id != d['position_id']
                or p.source_operation_id != d['operation_id'] or p.opened_cursor_index != event.cursor_index
                or p.opened_time_utc != event.virtual_time_utc):
            raise ReplayExecutionError('current fill position differs from its execution')
        floating, _ = _liquidation_pnl(p, exit_bid=bid, exit_ask=ask, instrument=instrument, cost_model=costs)
        if event.floating_pl != floating:
            raise ReplayExecutionError('current fill pnl differs from its closeable quote')
