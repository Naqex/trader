"""One owned terminal per authenticated connection. JSON lines, never retry sends."""
import base64
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime

# The API launches Python -I; load only sibling code from this checked-in folder.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mt5_connector as connector
import mt5_demo_trading as trading


def fence(request, operation):
    """A saved password alone never grants authority after pause/reconnect/remove."""
    import psycopg
    try:
        with psycopg.connect(os.environ['TW_V2_DATABASE_URL'], connect_timeout=5) as db:
            row = db.execute('SELECT generation,requested_mode,status,credential FROM mt5_connections WHERE workspace_id=%s AND connection_id=%s',
                             (request['workspace'], request['connection_id'])).fetchone()
        statuses = ('queued', 'syncing', 'connected') if operation == 'collect' else ('connected',)
        mode = request.get('requested_mode')
        if mode not in ('read_only', 'trading') or (mode == 'read_only' and operation != 'collect'):
            raise RuntimeError('mt5_connection_revoked')
        if not row or row[0] != request['generation'] or row[1] != mode or row[2] not in statuses or row[3] != request['credential']:
            raise RuntimeError('mt5_connection_revoked')
    except (KeyError, psycopg.Error):
        raise RuntimeError('mt5_connection_revoked') from None


class Session:
    def __init__(self, request, guard=fence, sdk_loader=None):
        self.context = {key: request[key] for key in ('workspace','connection_id','generation','credential','root','requested_mode')}
        self.guard, self.process, self.sdk = guard, None, None
        if self.context['requested_mode'] not in ('read_only', 'trading'):
            raise RuntimeError('mt5_connection_revoked')
        guard(request, request['operation'])
        self.secret = json.loads(connector.protect(base64.b64decode(request['credential'], validate=True), connector.entropy(request), True))
        self.terminal, config = connector.prepare_terminal(request['root'], request['connection_id'], trading=self.context['requested_mode'] == 'trading')
        try:
            self.sdk = (sdk_loader or (lambda: importlib.import_module('MetaTrader5')))()
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
            self.process = subprocess.Popen([str(self.terminal), '/portable', f'/config:{config}'], cwd=self.terminal.parent,
                                            startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not self.sdk.initialize(str(self.terminal), login=int(self.secret['login']), password=self.secret['password'], server=self.secret['server'], timeout=60000, portable=True):
                raise RuntimeError(connector.initialization_error(self.sdk))
            self.check_identity()
        except Exception:
            self.close()
            raise

    def check_identity(self):
        account = connector.verify_identity(self.sdk, self.secret, self.context['requested_mode'])
        info = self.sdk.terminal_info()
        if not info or Path(info.path).resolve() != self.terminal.parent.resolve() or Path(info.data_path).resolve() != self.terminal.parent.resolve():
            raise RuntimeError('mt5_terminal_isolation_failed')
        return account

    def handle(self, request):
        if any(request.get(key) != value for key,value in self.context.items()):
            raise RuntimeError('mt5_connection_revoked')
        operation = request['operation']
        if operation not in ('collect','snapshot','preview','command','reconcile'):
            raise RuntimeError('mt5_request_invalid')
        if self.context['requested_mode'] == 'read_only' and operation != 'collect':
            raise RuntimeError('mt5_connection_revoked')
        self.guard(request, operation)
        account = self.check_identity()
        if operation == 'collect':
            result = connector.snapshot(self.sdk, self.secret, datetime.fromisoformat(request['from_utc'].replace('Z','+00:00')),
                                        request['history_from_utc'], self.context['requested_mode'], request['generation'])
        else:
            symbols = self.sdk.symbols_get()
            if symbols is None:
                raise RuntimeError('demo_symbol_unavailable')
            names = sorted({item.name for item in symbols if item.trade_mode != 0})
            if not names or len(names) > 10000:
                raise RuntimeError('demo_symbol_unavailable')
            mode = {0:'demo',2:'real'}[account.trade_mode]
            policy = trading.BrokerPolicy(mode=mode, login=self.secret['login'], server=self.secret['server'], terminal_path=str(self.terminal),
                                          symbols=names, max_quote_age_ms=5000, deviation_points=10, magic=1464685138, cost_buffer_per_lot=0)
            if operation == 'snapshot':
                symbol = request.get('symbol') or next((s for s in ('EURUSD','EURUSDm','XAUUSD','XAUUSDm') if s in names), next((s.name for s in symbols if s.visible and s.name in names), names[0]))
                result = trading.snapshot(self.sdk, policy, symbol, request.get('timeframe','M1'))
                result['account']['trade_mode'] = mode
                result['account_environment'] = mode
                result['verified_permissions'] = {'read':True,'trade':True}
            elif operation == 'preview':
                result = trading.prepare(self.sdk, policy, request.get('command',{}))[1]
            elif operation == 'reconcile':
                result = trading.reconcile(self.sdk, policy, request['command'], request['submitted_at_utc'], request.get('previous',{}))
            else:
                result = trading.execute(self.sdk, policy, request['command'], lambda: (self.guard(request, 'command'), self.check_identity()))
        if operation != 'command':
            self.guard(request, operation)
        return result

    def close(self):
        if self.sdk:
            self.sdk.shutdown()
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        connector.clean_terminal(self.context['root'], self.context['connection_id'])


def main():
    session = None
    try:
        while raw := sys.stdin.buffer.readline(32770):
            try:
                if len(raw) > 32768 or not raw.endswith(b'\n'):
                    raise RuntimeError('mt5_request_invalid')
                request = json.loads(raw)
                if session is None:
                    session = Session(request)
                response = session.handle(request)
            except (RuntimeError, trading.Denied) as error:
                code = str(error)
                if code not in connector.ERRORS and not code.startswith('demo_'):
                    code = 'mt5_worker_failed'
                response = {'error':code,'status':'rejected','passed':False,'reason':code}
            except Exception:
                # A failure may occur after send. Keep its receipt unresolved.
                response = {'error':'mt5_worker_failed','status':'unknown','passed':False,'reason':'demo_adapter_failed'}
            print(json.dumps(response, allow_nan=False, separators=(',',':')), flush=True)
    finally:
        if session:
            session.close()


if __name__ == '__main__':
    main()
