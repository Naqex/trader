"""One owned terminal per authenticated connection. JSON lines, never retry sends."""
import base64
import hashlib
import hmac
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from decimal import Decimal
from datetime import datetime, timezone

# The API launches Python -I; load only sibling code from this checked-in folder.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mt5_connector as connector
import mt5_demo_trading as trading
import mt5_symbol_catalog


def fence(request, operation):
    """A saved password alone never grants authority after pause/reconnect/remove."""
    import psycopg
    try:
        with psycopg.connect(os.environ['TW_V2_DATABASE_URL'], connect_timeout=5) as db:
            row = db.execute('SELECT generation,requested_mode,status,credential FROM mt5_connections WHERE workspace_id=%s AND connection_id=%s',
                             (request['workspace'], request['connection_id'])).fetchone()
        statuses = ('queued', 'syncing', 'connected') if operation in ('collect', 'health') else ('connected',)
        mode = request.get('requested_mode')
        if mode not in ('read_only', 'trading') or (mode == 'read_only' and operation not in ('collect', 'health', 'snapshot', 'symbols')):
            raise RuntimeError('mt5_connection_revoked')
        if not row or row[0] != request['generation'] or row[1] != mode or row[2] not in statuses or row[3] != request['credential']:
            raise RuntimeError('mt5_connection_revoked')
    except (KeyError, psycopg.Error):
        raise RuntimeError('mt5_connection_revoked') from None


def automation_grant(request, secret):
    """Read native approved authority/reservations; never accept policy in JSON.

    The native caller holds its existing terminal advisory lock through the
    exchange. Grant revocation takes that same lock before acknowledging it.
    This reader does not acquire a second lock or mutate grants/counters.
    """
    import psycopg
    from psycopg.rows import dict_row
    try:
        context = request['automation']
        if not isinstance(context, dict) or set(context) != {'grant_id', 'credential_id', 'policy_sha256', 'artifact_sha256'}:
            raise ValueError()
        grant_id, credential_id = uuid.UUID(context['grant_id']), uuid.UUID(context['credential_id'])
        request_id = uuid.UUID(request['command']['request_id'])
        for key in ('policy_sha256', 'artifact_sha256'):
            value = context[key]
            if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError()
        if request['operation'] not in ('command', 'preview', 'reconcile'):
            raise ValueError()
        with psycopg.connect(os.environ['TW_V2_DATABASE_URL'], connect_timeout=5, row_factory=dict_row) as db:
            row = db.execute('''SELECT g.policy_sha256,g.policy,g.status,g.expires_at,g.approved_at,g.approved_by,
                g.terminal_key,g.credential_id AS grant_credential_id,r.credential_id AS request_credential_id,
                r.policy_sha256 AS request_policy_sha256,r.risk_reserved,r.fingerprint AS request_fingerprint,
                d.fingerprint AS receipt_fingerprint,d.terminal_key AS request_terminal_key,d.command_body,d.status AS request_status,
                (SELECT COUNT(*) FROM automation_grant_requests a WHERE a.workspace_id=g.workspace_id AND a.grant_id=g.grant_id) AS attempts,
                (SELECT COALESCE(SUM(a.risk_reserved),0) FROM automation_grant_requests a WHERE a.workspace_id=g.workspace_id AND a.grant_id=g.grant_id) AS reserved_total,
                (SELECT c.paused FROM mt5_demo_controls c WHERE c.terminal_key=g.terminal_key) AS paused,
                EXISTS(SELECT 1 FROM mt5_demo_requests u WHERE u.terminal_key=g.terminal_key AND u.request_id<>r.request_id
                    AND (u.status='unknown' OR u.result->>'requires_reconciliation'='true')) AS unresolved
                FROM automation_grants g JOIN automation_grant_requests r USING(workspace_id,grant_id)
                JOIN mt5_demo_requests d ON d.workspace_id=r.workspace_id AND d.request_id=r.request_id
                WHERE g.workspace_id=%s AND g.grant_id=%s AND r.request_id=%s''',
                (request['workspace'], grant_id, request_id)).fetchone()
            if row is None:
                raise ValueError()
            policy = row['policy']
            digest = hashlib.sha256(json.dumps(policy, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                                               allow_nan=False).encode('utf-8')).hexdigest()
            expected_terminal = hashlib.sha256(f"mt5-managed:{request['workspace']}:{request['connection_id']}".encode()).hexdigest()
            if (not hmac.compare_digest(digest, context['policy_sha256']) or
                    row['policy_sha256'] != digest or row['request_policy_sha256'] != digest or
                    row['grant_credential_id'] != credential_id or row['request_credential_id'] != credential_id or
                    row['terminal_key'] != expected_terminal or
                    row['request_terminal_key'] != expected_terminal or
                    row['request_fingerprint'] != row['receipt_fingerprint'] or
                    policy['connection_id'] != request['connection_id'] or
                    policy['connection_generation'] != request['generation'] or
                    policy['environment'] != 'demo' or policy['login'] != secret['login'] or
                    policy['server'] != secret['server'] or policy['artifact_sha256'] != context['artifact_sha256'] or
                    row['command_body'] != request['command']):
                raise ValueError()
            expiry = datetime.fromisoformat(policy['expires_at'].replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            if (expiry.tzinfo is None or expiry != row['expires_at'] or
                    not isinstance(row['approved_at'], datetime) or row['approved_at'].tzinfo is None or
                    row['approved_at'] > now or not row['approved_by'] or row['status'] not in ('active', 'revoked')):
                raise ValueError()
            if request['operation'] != 'reconcile':
                if (row['status'] != 'active' or expiry <= now or row['request_status'] != 'unknown' or
                        row['paused'] is not False or row['unresolved'] is not False or
                        type(row['attempts']) is not int or not 1 <= row['attempts'] <= policy['max_attempts']):
                    raise ValueError()
                reserved = Decimal(str(row['reserved_total']))
                current = Decimal(str(row['risk_reserved']))
                if (not reserved.is_finite() or not current.is_finite() or reserved < current or current < 0 or
                        reserved > Decimal(policy['max_aggregate_risk_amount']) or
                        current != (Decimal(policy['max_risk_amount']) if request['command'].get('action') == 'place' else Decimal(0))):
                    raise ValueError()
            owned = db.execute('''SELECT d.result->>'order' AS opening_order
                FROM automation_grant_requests r JOIN mt5_demo_requests d USING(workspace_id,request_id)
                WHERE r.workspace_id=%s AND r.grant_id=%s AND r.policy_sha256=%s
                    AND d.terminal_key=%s AND r.fingerprint=d.fingerprint
                    AND d.status='filled' AND d.command_body->>'action'='place'
                    AND d.result->>'requires_reconciliation' IS DISTINCT FROM 'true' ''',
                (request['workspace'], grant_id, digest, expected_terminal)).fetchall()
        identifiers = []
        for item in owned:
            text = item['opening_order']
            if not isinstance(text, str) or not text.isascii() or not text.isdigit() or int(text) <= 0:
                raise ValueError()
            identifiers.append(int(text))
        return {'policy': policy, 'owned_order_ids': identifiers, 'risk_reserved': row['risk_reserved']}
    except (KeyError, TypeError, AttributeError, ValueError, ArithmeticError, psycopg.Error):
        raise trading.Denied('demo_automation_grant_denied') from None


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
        try:
            account = connector.verify_identity(self.sdk, self.secret, self.context['requested_mode'])
        except RuntimeError as error:
            if str(error) in ('mt5_disconnected', 'mt5_terminal_unavailable') and self.process and self.process.poll() is not None:
                raise RuntimeError('mt5_terminal_stopped') from None
            raise
        info = self.sdk.terminal_info()
        if not info or Path(info.path).resolve() != self.terminal.parent.resolve() or Path(info.data_path).resolve() != self.terminal.parent.resolve():
            raise RuntimeError('mt5_terminal_isolation_failed')
        return account

    def handle(self, request):
        if any(request.get(key) != value for key,value in self.context.items()):
            raise RuntimeError('mt5_connection_revoked')
        operation = request['operation']
        if operation not in ('collect','health','snapshot','symbols','preview','command','reconcile'):
            raise RuntimeError('mt5_request_invalid')
        if self.context['requested_mode'] == 'read_only' and operation not in ('collect', 'health', 'snapshot', 'symbols'):
            raise RuntimeError('mt5_connection_revoked')
        self.guard(request, operation)
        automation = None
        if 'automation' in request:
            automation = automation_grant(request, self.secret)
        account = self.check_identity()
        if operation == 'health':
            result = {'status':'ready','connected':True}
        elif operation == 'symbols':
            result = mt5_symbol_catalog.catalog(self.sdk)
        elif operation == 'collect':
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
            read_only = self.context['requested_mode'] == 'read_only'
            policy = trading.BrokerPolicy(mode=mode, read_only=read_only, login=self.secret['login'], server=self.secret['server'], terminal_path=str(self.terminal),
                                          symbols=names, max_quote_age_ms=5000, deviation_points=10, magic=1464685138, cost_buffer_per_lot=0)
            if automation is not None:
                policy = trading.AutomationBrokerPolicy._from_authenticated_worker(policy, automation['policy'],
                    owned_order_ids=automation['owned_order_ids'], risk_reserved=automation['risk_reserved'])
            if operation == 'snapshot':
                symbol = request.get('symbol')
                if not symbol:
                    # A broker may list an unsuffixed instrument with zero quotes
                    # alongside its quoted account-specific variant (EURUSDm).
                    preferred = [s for s in ('EURUSD','EURUSDm','XAUUSD','XAUUSDm') if s in names]
                    candidates = preferred or [s.name for s in symbols if s.visible and s.name in names] or names[:1]
                    visible = {s.name for s in symbols if s.visible}
                    for candidate in candidates:
                        if candidate not in visible and not self.sdk.symbol_select(candidate, True):
                            continue
                        quote = self.sdk.symbol_info_tick(candidate)
                        if quote is None:
                            continue
                        try:
                            bid, ask = trading.finite(quote.bid, True), trading.finite(quote.ask, True)
                        except trading.Denied:
                            continue
                        if ask >= bid:
                            symbol = candidate
                            break
                    if not symbol:
                        trading.deny('demo_quote_unavailable')
                result = trading.snapshot(self.sdk, policy, symbol, request.get('timeframe','M1'), request.get('bar_count',300))
                result['account']['trade_mode'] = mode
                result['account_environment'] = mode
                result['verified_permissions'] = {'read':True,'trade':not read_only}
            elif operation == 'preview':
                result = trading.prepare(self.sdk, policy, request.get('command',{}))[1]
            elif operation == 'reconcile':
                result = trading.reconcile(self.sdk, policy, request['command'], request['submitted_at_utc'], request.get('previous',{}))
            else:
                def before_send():
                    self.guard(request, 'command')
                    self.check_identity()
                    if automation is not None:
                        current = automation_grant(request, self.secret)
                        if current != automation:
                            raise trading.Denied('demo_automation_grant_denied')
                result = trading.execute(self.sdk, policy, request['command'], before_send)
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
                if isinstance(error, trading.Denied) and error.data_quality is not None:
                    response['data_quality'] = error.data_quality
            except Exception:
                # A failure may occur after send. Keep its receipt unresolved.
                response = {'error':'mt5_worker_failed','status':'unknown','passed':False,'reason':'demo_adapter_failed'}
            print(json.dumps(response, allow_nan=False, separators=(',',':')), flush=True)
    finally:
        if session:
            session.close()


if __name__ == '__main__':
    main()
