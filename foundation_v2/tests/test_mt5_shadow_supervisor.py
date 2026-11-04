"""Real supervisor against synthetic loopback pages; no MT5 or broker access."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from scripts import mt5_observed_capture as capture
from scripts import mt5_shadow_step as shadow


@unittest.skipUnless(os.environ.get('TW_MT5_SHADOW_TEST_BINARY'),
                     'Set TW_MT5_SHADOW_TEST_BINARY to the built mt5-shadow executable')
class ShadowSupervisorTests(unittest.TestCase):
    def exercise(self, *, revise_prefix=False, stop=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            session = root/'session'
            requests, pages = [], {}
            rejected = False
            prefix_before = {}
            binding = dict(workspace_id='fixture', connection_id='492ec8a5-3938-41a3-8a26-8c0f7f59ed43',
                           generation=1, login='123', server='Fixture', environment='demo')
            start = int(time.time())*1000-10000

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def do_GET(self):
                    nonlocal rejected
                    url = urlsplit(self.path)
                    if url.path != '/api/v2/live/trading/ticks':
                        self.send_error(404)
                        return
                    query = parse_qs(url.query)
                    begin, end = int(query['from_msc'][0]), int(query['to_msc'][0])
                    requests.append(begin)
                    # Fail after a durable prefix, not just on the initial request.
                    if len(pages) >= 3 and (not rejected or stop):
                        rejected = True
                        prefix_before.update({p:p.read_bytes() for p in (session/'capture').glob('*.json')})
                        self.send_response(423)
                        self.end_headers()
                        self.wfile.write(b'{"detail":"mt5_connection_not_ready"}')
                        return
                    page = dict(schema_version='mt5-tick-range-v1', status='ready', symbol='EURUSD',
                        binding=binding, from_msc=begin, to_msc=end, observed_at_msc=int(time.time()*1000),
                        clock={'profile':'fixture'}, coverage='broker_history_unverified',
                        execution_capability=False, sdk_version='fixture',
                        source_sha256={'mt5_clock.py':'a'*64,'mt5_tick_capture.py':'b'*64},
                        rows=[dict(time_msc=begin+1,source_time_msc=begin+1,bid=1.1,ask=1.1002,flags=6)])
                    if revise_prefix and rejected and begin == start:
                        page['rows'][0]['bid'] = 1.09999
                    pages[begin] = page
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(capture.encoded(page))

            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(server.server_close)
            try:
                plan = shadow.Plan.model_validate(dict(schema_version='mt5-shadow-session-v2',
                    capture=dict(schema_version='mt5-observed-capture-v1',
                        api_origin=f'http://127.0.0.1:{server.server_port}', binding=binding,
                        symbol='EURUSD',from_msc=start,to_msc=start+14000,page_seconds=2),
                    deadline_msc=start+104000, settle_seconds=30, source_sha256=shadow.source_pins()))
                manifest, secret = root/'plan.json', root/'secret.json'
                manifest.write_bytes(capture.encoded(plan.model_dump(mode='json')))
                secret.write_text('{"owner_bearer":"synthetic-fixture-only"}')
                process = subprocess.Popen([os.environ['TW_MT5_SHADOW_TEST_BINARY'], 'start',
                    '--manifest', str(manifest), '--state-dir', str(session),
                    '--python', sys.executable, '--owner-secret-file', str(secret)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                try:
                    if stop:
                        deadline = time.monotonic()+15
                        while time.monotonic() < deadline:
                            path = session/'lifecycle.json'
                            if path.exists() and json.loads(path.read_text())['state'].get('transport_retry'):
                                (session/'STOP').write_text('stop during read recovery')
                                break
                            time.sleep(0.1)
                        else:
                            self.fail('supervisor never entered read recovery')
                    stdout, stderr = process.communicate(timeout=50)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()
                state = json.loads(stdout)
                self.assertEqual(stderr, b'')
                self.assertTrue(rejected)
                self.assertFalse(state['execution_capability'])
                self.assertEqual(state['transport_retries_total'], 1)
                self.assertEqual(state['manifest_sha256'], hashlib.sha256(manifest.read_bytes()).hexdigest())
                # Committed pages remain byte-identical even on a rejected reread.
                for path, value in prefix_before.items():
                    if path.name != 'state.json':
                        self.assertEqual(path.read_bytes(), value)
                if stop:
                    self.assertEqual(state['status'], 'stopped')
                elif revise_prefix:
                    self.assertEqual(process.returncode, 2)
                    self.assertEqual(state['reason'], 'shadow_observed_window_revised')
                    self.assertEqual(state['status'], 'failed')
                else:
                    self.assertEqual(process.returncode, 0)
                    self.assertEqual(state['status'], 'complete')
                    saved = capture.checked(session/'capture'/'state.json')
                    self.assertEqual(len(saved['pages']), 7)
                    self.assertEqual(saved['tick_count'], 7)
                    self.assertEqual(saved['next_from_msc'], plan.capture.to_msc)
                    self.assertEqual(state['last_transport_retry']['attempts'], 1)
                    self.assertGreaterEqual(requests.count(start), 2)
            finally:
                server.shutdown()
                thread.join(timeout=2)

    def test_transient_read_recovers_same_cursor_without_duplicate_ticks(self):
        self.exercise()

    def test_recovery_reaudits_old_prefix_and_rejects_revision(self):
        self.exercise(revise_prefix=True)

    def test_stop_interrupts_read_recovery(self):
        self.exercise(stop=True)


if __name__ == '__main__':
    unittest.main()
