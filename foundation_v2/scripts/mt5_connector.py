"""Private stdin/stdout adapter for the local, read-only MetaTrader connector.

The native API owns process-tree lifetime. No trading functions are used. Secrets
are DPAPI-bound to this Windows user and this workspace/connection identity.
"""
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone


ERRORS = {'mt5_login_failed', 'mt5_disconnected', 'mt5_identity_changed',
          'mt5_investor_required', 'mt5_history_failed', 'mt5_snapshot_failed',
          'mt5_history_too_large', 'mt5_terminal_missing', 'mt5_sdk_missing',
          'mt5_secret_unavailable', 'mt5_terminal_isolation_failed',
          'mt5_sync_timeout', 'mt5_terminal_unavailable', 'mt5_version_unsupported',
          'mt5_initialization_failed', 'mt5_auth_failed', 'mt5_trading_disabled',
          'mt5_account_mode_unsupported', 'mt5_connection_revoked'}


def initialization_error(sdk):
    # SDK descriptions can contain account/server details; expose only known codes.
    try:
        error = sdk.last_error()
        code = error[0] if isinstance(error, (tuple, list)) and error else None
    except Exception:
        code = None
    if code == -6:
        return 'mt5_auth_failed'
    if code == -10005:
        return 'mt5_sync_timeout'
    if code in (-10000, -10001, -10002, -10003):
        return 'mt5_terminal_unavailable'
    if code == -5:
        return 'mt5_version_unsupported'
    return 'mt5_initialization_failed'


def protect(raw, entropy, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('mt5_secret_unavailable')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    def blob(value):
        buf = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
        return Blob(len(value), buf)
    source, context, output = blob(raw), blob(entropy.encode()), Blob()
    crypto, kernel = ctypes.windll.crypt32, ctypes.windll.kernel32
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    fn = crypto.CryptUnprotectData if decrypt else crypto.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    if not fn(ctypes.byref(source), None, ctypes.byref(context), None, None, 1, ctypes.byref(output)):
        raise RuntimeError('mt5_secret_unavailable')
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def entropy(request):
    return json.dumps(['wmreplay-mt5-v1', request['workspace'], request['connection_id']], separators=(',', ':'))


def terminal_source():
    configured = os.environ.get('TW_V2_MT5_TERMINAL')
    paths = [Path(configured)] if configured else [Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'MetaTrader 5/terminal64.exe']
    for path in paths:
        if path.is_absolute() and path.is_file() and not path.is_symlink():
            return path.resolve()
    raise RuntimeError('mt5_terminal_missing')


def require_local_tree(path):
    import stat
    for item in [path, *path.parents]:
        if item.exists() or item.is_symlink():
            if item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                raise RuntimeError('mt5_terminal_isolation_failed')


def private_directory(path):
    """Only the current Windows user and SYSTEM inherit access to session files."""
    from ctypes import wintypes
    advapi, kernel = ctypes.windll.advapi32, ctypes.windll.kernel32
    token, descriptor, sid_text = wintypes.HANDLE(), ctypes.c_void_p(), wintypes.LPWSTR()
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    advapi.SetFileSecurityW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise RuntimeError('mt5_terminal_isolation_failed')
    try:
        size = wintypes.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        buffer = ctypes.create_string_buffer(size.value)
        if not advapi.GetTokenInformation(token, 1, buffer, size, ctypes.byref(size)):
            raise RuntimeError('mt5_terminal_isolation_failed')
        sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
        if not advapi.ConvertSidToStringSidW(sid, ctypes.byref(sid_text)):
            raise RuntimeError('mt5_terminal_isolation_failed')
        sddl = f'D:P(A;OICI;FA;;;{sid_text.value})(A;OICI;FA;;;SY)'
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None) or not advapi.SetFileSecurityW(str(path), 0x80000004, descriptor):
            raise RuntimeError('mt5_terminal_isolation_failed')
    finally:
        kernel.CloseHandle(token)
        if sid_text:
            kernel.LocalFree(sid_text)
        if descriptor:
            kernel.LocalFree(descriptor)


def clean_terminal(root, connection_id):
    import uuid
    root = Path(root).absolute()
    folder = root / str(uuid.UUID(connection_id))
    require_local_tree(folder)
    if not folder.exists():
        return
    # Check every descendant before deletion so junctions cannot redirect cleanup.
    for directory, subdirs, files in os.walk(folder, followlinks=False):
        for name in [*subdirs, *files]:
            require_local_tree(Path(directory) / name)
    for item in folder.iterdir():
        if item.name == 'terminal64.exe':
            continue
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()


def discovery_directories(source):
    """Read only public broker discovery from data belonging to this install."""
    yield source.parent / 'Config'
    base = Path(os.environ.get('APPDATA', '')) / 'MetaQuotes' / 'Terminal'
    if not base.is_absolute() or not base.exists():
        return
    require_local_tree(base)
    for folder in base.iterdir():
        origin = folder / 'origin.txt'
        if not folder.is_dir() or not origin.is_file():
            continue
        require_local_tree(origin)
        if origin.stat().st_size > 4096:
            continue
        raw = origin.read_bytes()
        installed = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig').strip().rstrip('\x00')
        if os.path.normcase(str(Path(installed).resolve())) == os.path.normcase(str(source.parent.resolve())):
            yield folder / 'Config'


def prepare_terminal(root, connection_id, trading=False):
    # Only API-generated UUIDs enter a path. Never touch the user's active terminal.
    import uuid
    connection_id = str(uuid.UUID(connection_id))
    root = Path(root).absolute()
    require_local_tree(root)
    root = root.resolve(strict=False)
    root.mkdir(parents=True, exist_ok=True)
    private_directory(root)
    folder = root / connection_id
    if folder.is_symlink() or (folder.exists() and folder.resolve().parent != root):
        raise RuntimeError('mt5_terminal_isolation_failed')
    folder.mkdir(parents=True, exist_ok=True)
    clean_terminal(root, connection_id)
    source = terminal_source()
    target = folder / 'terminal64.exe'
    if target.is_symlink():
        raise RuntimeError('mt5_terminal_isolation_failed')
    if not target.exists() or hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
        shutil.copy2(source, target)
    # Broker discovery only: no accounts.dat, profiles, EAs or saved passwords.
    config = folder / 'Config'
    config.mkdir(exist_ok=True)
    for directory in discovery_directories(source):
        for item in directory.glob('*'):
            if item.is_file() and (item.name.lower() == 'servers.dat' or item.suffix.lower() == '.srv'):
                require_local_tree(item)
                shutil.copy2(item, config / item.name)
    settings = folder / 'connector.ini'
    settings.write_text(f'[Common]\nKeepPrivate=0\n[Experts]\nEnabled={int(trading)}\nAllowLiveTrading={int(trading)}\nAllowDllImport=0\n', encoding='utf-16')
    return target, settings


def verify_identity(sdk, secret, requested_mode='read_only'):
    account, terminal = sdk.account_info(), sdk.terminal_info()
    if not account or not terminal or not terminal.connected:
        raise RuntimeError('mt5_disconnected')
    if str(account.login) != secret['login'] or account.server != secret['server']:
        raise RuntimeError('mt5_identity_changed')
    # Permission is independent of demo/real. A read-only connection never sends,
    # even when the credential also has trading rights at the broker.
    if requested_mode == 'trading':
        if account.trade_mode not in (0, 2):
            raise RuntimeError('mt5_account_mode_unsupported')
        if not (account.trade_allowed and account.trade_expert and terminal.trade_allowed and not terminal.tradeapi_disabled):
            raise RuntimeError('mt5_trading_disabled')
    return account


def snapshot(sdk, secret, start, history_from, requested_mode='read_only', generation=None):
    account = verify_identity(sdk, secret, requested_mode)
    now = datetime.now(timezone.utc)
    positions, orders = sdk.positions_get(), sdk.orders_get()
    if positions is None or orders is None:
        raise RuntimeError('mt5_snapshot_failed')
    deals, cursor = {}, start
    while cursor < now:
        end = min(cursor + timedelta(days=31), now)
        chunk = sdk.history_deals_get(cursor, end)
        if chunk is None:
            raise RuntimeError('mt5_history_failed')
        for item in chunk:
            if start.timestamp() * 1000 <= item.time_msc <= now.timestamp() * 1000:
                deals[str(item.ticket)] = {key: getattr(item, key) for key in ('ticket','order','position_id','symbol','type','entry','volume','price','profit','commission','swap','fee','time_msc')}
        if len(deals) > 200_000:
            raise RuntimeError('mt5_history_too_large')
        cursor = end
    quotes = []
    for symbol in sorted({item.symbol for item in [*positions, *orders]})[:100]:
        tick = sdk.symbol_info_tick(symbol)
        if tick and tick.bid > 0 and tick.ask > 0:
            quotes.append(dict(symbol=symbol,bid=tick.bid,ask=tick.ask,time_msc=tick.time_msc))
    verify_identity(sdk, secret, requested_mode)
    rows = sorted(deals.values(), key=lambda item: (item['time_msc'], item['ticket']))
    environment = {0:'demo',1:'contest',2:'real'}.get(account.trade_mode,'unknown')
    permissions = dict(read=True, trade=requested_mode == 'trading')
    return dict(status='ready', source=f"{account.server} / MT5", mode=environment,
        account_environment=environment, verified_permissions=permissions,
        execution_binding=dict(login=str(account.login),server=account.server,account_environment=environment,generation=generation,verified_permissions=permissions) if requested_mode == 'trading' else None,
        captured_at_utc=now.isoformat(), history_from_utc=history_from, history_read_from_utc=start.isoformat(), execution_capability=False,
        account={**{key:getattr(account,key) for key in ('currency','balance','equity','profit','margin','margin_free','leverage')},'account_ref':f"…{str(account.login)[-4:]}"},
        positions=[{key:getattr(item,key) for key in ('ticket','symbol','type','volume','price_open','price_current','sl','tp','profit','swap','time')} for item in positions],
        orders=[{key:getattr(item,key) for key in ('ticket','symbol','type','volume_current','price_open','sl','tp','time_setup')} for item in orders],
        deals=[item for item in rows if item['type'] in (0,1)], cashflows=[item for item in rows if item['type'] not in (0,1)], quotes=quotes)


def run(request):
    if request['action'] == 'seal':
        raw = json.dumps(request['secret'], ensure_ascii=False).encode()
        return {'credential':base64.b64encode(protect(raw, entropy(request))).decode()}
    if request['action'] == 'probe':
        terminal_source()
        try:
            import MetaTrader5
        except ImportError:
            raise RuntimeError('mt5_sdk_missing') from None
        return {'available': True}
    if request['action'] == 'cleanup_all':
        root = Path(request['root']).absolute()
        require_local_tree(root)
        if root.exists():
            import uuid
            private_directory(root)
            for folder in root.iterdir():
                if folder.is_dir():
                    try:
                        uuid.UUID(folder.name)
                    except ValueError:
                        continue
                    clean_terminal(root, folder.name)
        return {'cleaned': True}
    if request['action'] == 'cleanup':
        for attempt in range(30):
            try:
                clean_terminal(request['root'], request['connection_id'])
                break
            except PermissionError:
                if attempt == 29:
                    raise
                time.sleep(.2)
        return {'cleaned': True}
    secret = json.loads(protect(base64.b64decode(request['credential'], validate=True), entropy(request), True))
    terminal, config = prepare_terminal(request['root'], request['connection_id'])
    try:
        import MetaTrader5 as sdk
    except ImportError:
        raise RuntimeError('mt5_sdk_missing') from None
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    # All descendants remain in the native API's kill-on-close job object.
    process = subprocess.Popen([str(terminal), '/portable', f'/config:{config}'], cwd=terminal.parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not sdk.initialize(str(terminal), login=int(secret['login']), password=secret['password'], server=secret['server'], timeout=60000, portable=True):
            raise RuntimeError(initialization_error(sdk))
        info = sdk.terminal_info()
        if not info or Path(info.path).resolve() != terminal.parent.resolve() or Path(info.data_path).resolve() != terminal.parent.resolve():
            raise RuntimeError('mt5_terminal_isolation_failed')
        start = datetime.fromisoformat(request['from_utc'].replace('Z','+00:00'))
        return snapshot(sdk, secret, start, request['history_from_utc'])
    finally:
        sdk.shutdown()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        # The native owner closes the entire job (including MT5 WebView children)
        # before its separate cleanup action. Deleting here races their file locks
        # and can replace a successful snapshot or an auth error with PermissionError.


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ValueError('request too large')
        print(json.dumps(run(json.loads(raw)), allow_nan=False))
    except Exception as error:
        # Never forward SDK messages or exception text containing credentials.
        print(json.dumps({'error':str(error) if str(error) in ERRORS else 'mt5_connector_failed'}))
        sys.exit(1)
