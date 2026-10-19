"""Bounded product-assistant evals. Default validates fixtures; --live sends synthetic prompts to the selected account/model."""
from __future__ import annotations
import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse

V2 = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--origin', default='http://127.0.0.1:5180')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    url = urlparse(origin)
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.path or url.query or url.fragment or url.username:
        parser.error('Use a plain local HTTP origin')
    fixture = json.loads((V2/'scripts/fixtures/ai_chat_evals.json').read_text(encoding='utf-8'))
    cases = fixture['cases']
    assert len(cases) == len({case['id'] for case in cases}) == 8
    for case in cases:
        assert case['expected'] and case['locale'] in ('vi', 'en')
        assert len(json.dumps(case).encode()) < 49152
        assert [m['role'] for m in case['messages']] == ['user', 'assistant'] * (len(case['messages'])//2) + ['user']
    if not args.live:
        print('8 behavioral eval fixtures valid; no model called or behavior graded')
        return

    def call(path, method='GET', body=None):
        headers = {'X-Workspace-Id':'tenant-a', 'Origin':origin, 'Content-Type':'application/json'}
        request = Request(origin+'/api/v2/ai/chatgpt'+path, method=method, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    account = call('/account')
    if account['status'] == 'stopped':
        account = call('/account/start', 'POST', {})
    assert account.get('login_state_present') and not account.get('operation'), 'Connect the saved account first; eval does not open login'
    selection = account['selection']
    output = V2/'.runtime/ai-chat-evals'
    output.mkdir(parents=True, exist_ok=True)
    if (output/'report.json').exists():
        (output/'report.json').rename(output/f'attempt-{time.time_ns()}.json')
    report = {'scope':'Real selected ChatGPT Web model; synthetic prompts only; no chart/account figures sent',
              'policy_version':fixture['policy_version'], 'selection':selection, 'review':'pending', 'results':[]}
    for case in cases:
        started, turn_id = time.monotonic(), None
        record = {**case, 'case_id':case['id'], 'review':'pending'}
        try:
            turn = call('/chat', 'POST', {'messages':case['messages'], 'context':{'screen':case['screen'], 'locale':case['locale']}})
            turn_id = turn['id']
            assert turn['grounding']['policy_version'] == fixture['policy_version'], 'Deploy current policy before live evals'
            assert turn['selection'] == selection, 'Selection changed; stop instead of silently testing another model'
            while time.monotonic()-started < 205:
                result = call('/chat/'+turn_id)
                if result['status'] != 'running':
                    record.update(result)
                    assert result['status'] == 'completed', result.get('error', result['status'])
                    break
                time.sleep(.75)
            else:
                raise TimeoutError('Eval deadline reached')
        except Exception as error:
            record['failure'] = str(error)
        finally:
            if turn_id:
                try:
                    call('/chat/'+turn_id, 'DELETE')
                except Exception as error:
                    record['failure'] = f'Cancel/status cleanup failed: {error}'
            record['seconds'] = round(time.monotonic()-started, 2)
            report['results'].append(record)
            (output/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'case':case['id'], 'status':record.get('status', 'failed'), 'seconds':record['seconds']}, ensure_ascii=False), flush=True)
        if 'failure' in record:
            raise RuntimeError('Eval stopped; see local report. No retry or fallback.')
    print('Outputs captured. Review expected behavior against text; transport completion is not a behavior pass.')


if __name__ == '__main__':
    main()
