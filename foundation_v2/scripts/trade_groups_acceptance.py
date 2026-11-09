"""Group assertions against the existing disposable native Router/PostgreSQL fixture."""
import copy
import json
import time
import uuid


def check_groups(api, db, connection, snapshot, session_id):
    path = '/api/v2/trade-groups'
    def member(kind, source, trade):
        return dict(kind=kind, source_id=str(source), trade_id=str(trade))
    def merge(members, status=200, **options):
        return api('POST', path, dict(action='merge', expected_revision=api('GET', path)['revision'], members=members), status, **options)
    def split(group):
        return api('POST', path, dict(action='split', expected_revision=api('GET', path)['revision'], id=group['id']))

    brokers = [member('broker', connection, f'position:{n}') for n in [123, 124]]
    body = dict(action='merge', expected_revision=0, members=brokers)
    key = str(uuid.uuid4())
    merged = api('POST', path, body, key=key)
    assert api('POST', path, body, key=key) == merged
    api('POST', path, body, 409)
    merge(brokers, 409)
    assert api('GET', path, workspace='tenant-b')['items'] == []
    assert split(merged['items'][0])['items'] == []
    merge([brokers[0], brokers[0]], 422)
    merge([brokers[0], member('broker', uuid.uuid4(), 'position:124')], 422)
    merge([brokers[0], member('broker', connection, 'position:999')], 404)
    merge([member('broker', str(connection).upper(), f'position:{n}') for n in [123,124]], 422)
    api('POST', path, dict(action='merge', expected_revision=0, members=brokers), 404, workspace='tenant-b')
    assert db.execute('SELECT snapshot FROM mt5_connections WHERE connection_id=%s', (connection,)).fetchone()[0] == snapshot

    for patch, expected in [
        (dict(positions=[dict(identifier=123)]), 422),
        (dict(deals=[fill for fill in snapshot['deals'] if fill['ticket'] != 1230]), 422),
        (dict(deals=[{**fill, 'symbol':'XAUUSD'} if fill['position_id']==124 else fill for fill in snapshot['deals']]), 422),
    ]:
        db.execute('UPDATE mt5_connections SET snapshot=%s WHERE connection_id=%s', (json.dumps({**snapshot, **patch}), connection)); db.commit()
        before_catalog=api('GET', path)
        merge(brokers, expected)
        assert api('GET', path)==before_catalog
    db.execute('UPDATE mt5_connections SET snapshot=%s WHERE connection_id=%s', (json.dumps(snapshot), connection)); db.commit()

    account = api('POST', '/api/v2/live/records', dict(kind='account', payload=dict(name='Group fixture', currency='USD', opening_balance='10000')), 201)
    payload = dict(account_id=account['record_id'], symbol='EURUSD', side='BUY', quantity='1', entry_price='1.1', exit_price='1.11', gross_pnl='100', commission='-1', swap='0', fee='0', opened_at_utc='2026-10-30T03:00:00Z', closed_at_utc='2026-10-30T04:00:00Z', tags=['Keep'], note='Retain source note')
    records = [api('POST', '/api/v2/live/records', dict(kind='trade', payload={**payload, **patch}), 201) for patch in [{}, {}, dict(symbol='XAUUSD'), dict(side='SELL')]]
    manuals = [member('manual', account['record_id'], record['record_id']) for record in records]
    merge([manuals[0], manuals[2]], 422)
    merge([manuals[0], manuals[3]], 422)
    group = merge(manuals[:2])['items'][-1]
    saved = api('GET', '/api/v2/live/records')['items']
    for record in records:
        assert next(row for row in saved if row['record_id'] == record['record_id']) == record
    split(group)

    before = api('GET', f'/api/v2/replay/sessions/{session_id}')
    analytics = api('GET', f'/api/v2/replay/sessions/{session_id}/analytics')
    trades = analytics['ledger']
    assert len(trades) >= 2
    testing = [member('testing', session_id, row['trade_id']) for row in trades[:2]]
    group = merge(testing)['items'][-1]
    assert api('GET', f'/api/v2/replay/sessions/{session_id}') == before
    assert api('GET', f'/api/v2/replay/sessions/{session_id}/analytics') == analytics
    split(group)

    # Labeled synthetic large snapshot: one indexed source read for 500 members.
    large = copy.deepcopy(snapshot)
    template = snapshot['deals'][:2]
    large['deals'] = []
    for position in range(1000, 1500):
        large['deals'].extend({**fill, 'position_id':position, 'ticket':position*10+index, 'order':position*10+index} for index,fill in enumerate(template))
    db.execute('UPDATE mt5_connections SET snapshot=%s WHERE connection_id=%s', (json.dumps(large), connection)); db.commit()
    start = time.monotonic()
    group = merge([member('broker', connection, f'position:{n}') for n in range(1000, 1500)])['items'][-1]
    elapsed = time.monotonic()-start
    assert len(group['members']) == 500
    assert elapsed < 30, elapsed
    split(group)
    db.execute('UPDATE mt5_connections SET snapshot=%s WHERE connection_id=%s', (json.dumps(snapshot), connection)); db.commit()
    return dict(status='PASS', large_broker_members=500, large_merge_seconds=round(elapsed, 3), source_records_preserved=True, replay_analytics_preserved=True)
