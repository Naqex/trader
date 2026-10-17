"""Bounded concurrent journeys on the caller's disposable native HTTP fixture."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def benchmark(origin, dataset, initialization, output, resource_snapshot, stages=(0, 500, 5000), repeats=5):
    from uuid import uuid4
    samples = []

    def request(path, body=None, key=None):
        headers = {'x-workspace-id': 'tenant-a', 'content-type': 'application/json'}
        if key:
            headers['idempotency-key'] = key
        req = Request(origin + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        started = time.perf_counter_ns()
        try:
            response = urlopen(req, timeout=30)
        except HTTPError as error:
            raise AssertionError(f'{path}: HTTP {error.code}: {error.read().decode()}') from None
        with response:
            raw = response.read()
            value = json.loads(raw)
            status = response.status
            command_id = response.headers.get('x-command-id')
        return value, dict(elapsed_ms=(time.perf_counter_ns()-started)/1e6,
                           response_bytes=len(raw), status=status,
                           command_id=command_id,
                           response_sha256=hashlib.sha256(raw).hexdigest())

    def session(stage):
        record, _ = request('/api/v2/replay/sessions', {'dataset_id': dataset, 'starting_balance': '100000'})
        path = '/api/v2/replay/sessions/' + record['record_id']
        record, _ = request(path + '/orders/quick', {'expected_revision': record['revision'],
            'operation_id': uuid4().hex, 'side': 'SELL', 'quantity': '0.12',
            'stop_loss': None, 'take_profit': None, 'execution_timing': 'current_quote', **initialization})
        remaining = stage
        while remaining:
            steps = min(1000, remaining)
            record, _ = request(path+'/step', {'expected_revision': record['revision'], 'steps': steps})
            remaining -= steps
        assert record['payload']['execution']['position']['side'] == 'SELL'
        assert record['payload']['execution']['pending_market_order'] is None
        return path, record

    before = resource_snapshot()
    for stage in stages:
        # Separate aggregates avoid turning expected-revision conflicts into a
        # misleading throughput number for successful independent user actions.
        states = [session(stage) for _ in range(4)]
        for concurrency in (1, 4):
            for iteration in range(repeats):
                def action(index):
                    path, record = states[index]
                    body = {'expected_revision': record['revision'], 'operation_id': uuid4().hex,
                            'target_id': record['payload']['execution']['position']['position_id'],
                            'stop_loss': str(1.13 + iteration*.001), 'take_profit': str(1.08-iteration*.001)}
                    key = uuid4().hex
                    changed, timing = request(path+'/orders/protection', body, key)
                    position = changed['payload']['execution']['position']
                    assert position['stop_loss'] == body['stop_loss']
                    assert position['take_profit'] == body['take_profit']
                    assert changed['revision'] == record['revision'] + 1
                    assert len(changed['payload']['execution']['ledger']) == len(record['payload']['execution']['ledger']) + 1
                    retried, retry = request(path+'/orders/protection', body, key)
                    assert changed == retried and retry['response_sha256'] == timing['response_sha256']
                    if iteration == 0 and index == 0:
                        receipt, _ = request('/api/v2/commands/'+timing['command_id'])
                        recovered = json.loads(receipt['result_text']) if receipt['result_text'] is not None else receipt['result_body']
                        assert recovered == changed and receipt['status']=='completed'
                    states[index] = path, changed
                    return dict(stage=stage, concurrency=concurrency, iteration=iteration, worker=index,
                                operation='protection', ledger_events=len(changed['payload']['execution']['ledger']),
                                retry_elapsed_ms=retry['elapsed_ms'], **timing)
                with ThreadPoolExecutor(max_workers=concurrency) as executor:
                    samples.extend(executor.map(action, range(concurrency)))
        for path, record in states:
            request(path+'/orders/close', {'expected_revision': record['revision'],
                'target_id': record['payload']['execution']['position']['position_id'], 'operation_id': uuid4().hex})
    summary = []
    for stage in stages:
        for concurrency in (1, 4):
            group = [s for s in samples if s['stage'] == stage and s['concurrency'] == concurrency]
            times = sorted(s['elapsed_ms'] for s in group)
            summary.append(dict(stage=stage, concurrency=concurrency, samples=len(group),
                p50_ms=times[math.ceil(len(times)*.5)-1], sample_p95_ms=times[math.ceil(len(times)*.95)-1],
                max_ms=max(times), response_bytes=max(s['response_bytes'] for s in group)))
    report = dict(passed=True, scope='release native API, actual loopback HTTP/PostgreSQL; owned synthetic history',
        stages=list(stages), repeats=repeats, samples=samples, summary=summary,
        resource_before=before, resource_after=resource_snapshot(),
        limitations=['Small diagnostic run, not production capacity or stable tail estimate.',
                     'Includes full financial response and exact-retry persistence; excludes browser and PostgreSQL CPU/RSS.',
                     'Concurrent independent replay aggregates; same-aggregate conflicts tested separately in persisted parity suites.'])
    (output/'http-benchmark.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return summary
