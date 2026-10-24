# MT5 read services and native MCP adapter

2026-10-24. Rust owns admission, binding, validation and evidence. Internal
features call these services directly. Native MT5 MCP is an optional upstream
connection, not a new gateway or WMREPLAY MCP server. Provider routing and broker
execution are unchanged. No trade/file/tester tools are exposed.

## Data paths

- Symbols: existing owned SDK worker, separate read-only `symbols` operation.
  Metadata includes description, broker path/category when available, currencies,
  calculation/trade/order modes and finite swap values. Disabled symbols retain
  their raw mode; catalog inclusion does not assert permission to trade. No
  quote, symbol selection, OrderCheck or OrderSend is needed.
- Picker: fetch when opened, search descriptions/paths and names, prefer recognized
  broker groups, retain unknown groups. Name heuristics remain a display fallback
  when metadata is unavailable. No catalog payload added to the market stream.
- Indicators/calendar/event: official Apache-2.0 `rmcp` 3.7.0 client, initialize
  protocol 2025-06-18, HTTP loopback. Only client/Streamable HTTP features. Its
  reqwest 0.13 dependency is separate from application reqwest 0.12; no unrelated
  client migration, OAuth, server features, macros or TLS setup.
- Each uncached MCP read checks account login/server/connected state before and
  after, and the canonical MQL5 folder of the selected owned terminal. Raw
  account/workspace inventories are not returned to the caller/model.

Rust checks saved workspace/status/mode/verified binding before and after every
read, including cache hits. Generation changes invalidate old bindings/cache.
Read-only application accounts can use the services. The worker retains pre/post
DB revocation fences. These catalogs are current external data, not replay-cutoff
market evidence or proof of indicator values. Existing replay evidence stays
cutoff bounded. AI still analyzes supplied evidence, without an autonomous tool loop.

## HTTP and AI contract

`GET /api/v2/ai/assistant/mt5/{connection_uuid}/{tool}` uses existing local
peer/origin and `X-Workspace-Id` authorization. Returns
`{provenance:{source,connection_id,generation,captured_at_utc,sha256,read_only},data}`.

| Tool | Query | Meaning |
| --- | --- | --- |
| `symbols` | none | SDK catalog, <=10,000 entries |
| `indicators` | none | Standard MT5 indicator catalog; not chart buffers or Advanced Charts parity |
| `calendar` | `from`, `to` | Server-local ISO datetimes without timezone; interval >0 and <=7 days, <=32 values |
| `event` | `event_id` | Positive uint64 decimal string; event definition including name/unit/importance |

Calendar timestamps remain `trade_server_local_offset_unknown`. Passing `Z` or
offset is rejected. No UTC/GMT+7 conversion, session-open inference, trade lock or
offset inference from last-known terminal time. Truncation is preserved. Event
definitions can be fetched separately and joined by ID. No macro-calendar UI or
automatic event enrichment in this slice.

Chat/evidence-review source picker exposes `mt5_symbols` and, when configured for
the current generation, `mt5_indicators`. References remain `{kind,id}`. At most
64 items /24 KiB of item data attach to a run, with total count, truncation and hash.

## Resource and error policy

- MCP overall deadline 12 seconds, no automatic retry or session-recovery replay.
  Slow native calendar reads can time out; report that and let the caller decide.
- Two concurrent cache misses per API process, no unbounded queue. Cache TTL60s,
  <=32 entries /8 MiB serialized data. SDK catalog retains cold-worker HTTP budget120s.
- SSE event max1 MiB; semantic response cap after SDK decoding1 MiB; catalog result
  max2 MiB. Upstream SDK buffers JSON HTTP bodies before the application size
  check: this is not a hard JSON-wire memory cap. Do not broaden to arbitrary MCP
  peers without a transport audit.
- `isError`, `ok:false`, wrong schema/account/path, disconnect and revoke never
  become empty successful evidence. No stale-on-error result. Cache capture time
  is retained and the UI labels caching. No provider quota/inference is consumed.

## Optional native configuration

Default: native MCP disabled; SDK symbols remain available. `TW_MT5_MCP_CONFIG`
points to an absolute private JSON file <=32 KiB, with no plaintext key:

```json
{"bindings":[{
  "workspace_id":"tenant-a",
  "connection_id":"00000000-0000-4000-8000-000000000001",
  "generation":1,
  "endpoint":"http://127.0.0.1:22346/mcp",
  "key_env":"TW_MT5_MCP_KEY_ACCOUNT_A"
}]}
```

UUID/generation must match the saved connection. The secret comes from the named
API-process environment variable, never the browser/config/repo/provenance. No
global environment or Codex MCP registration needed. <=10 bindings; endpoints
cannot be shared between accounts. Literal127.0.0.1/::1 only, explicit port>1024,
exact `/mcp`, no URL credentials/query, redirects, proxies or external OAuth.

The adapter does not enable terminal MCP, open ports or persist its settings.
The owner separately authorized local API/UI rollout and reconnect of the selected
account. Existing cold-start cleanup removes manual terminal settings;
reconnect/upgrade therefore requires native setup and a fresh matching binding.
Fail unavailable rather than switching terminals. Automatic MCP terminal lifecycle
and an external WMREPLAY MCP server remain future work.

Local rollout and exact validation boundaries:
[24 October receipt](../evidence/mt5-read-tools-20261024/RECEIPT.md).

## Validation commands

- Python worker tests and Node category tests use synthetic SDK/catalog.
- Rust `ai_mt5_tools` unit tests run an HTTP fixture through the official SDK.
- `scripts/rust_runtime_parity.py` with
  `TW_RUST_RUNTIME_TEST_FILTER=ai_mt5_tools::tests::postgres_mt5_read_scope_and_cache_revocation`
  owns a disposable PostgreSQL cluster; no terminal/broker operations.
- `web/run_mt5_read_tools_acceptance.mjs`: production UI with isolated HTTP/SSE
  fixtures at390/768/1440, zero broker calls/API writes.
- Ignored `native_mt5_read_smoke` requires explicit config,
  `TW_MT5_MCP_NATIVE_READ_SMOKE=1`, `TW_MT5_MCP_TEST_LOGIN`, `TW_MT5_MCP_TEST_SERVER`.
  It only reads native identity/workspace/standard indicator catalog.

References: [official Rust SDK](https://github.com/modelcontextprotocol/rust-sdk),
[MT5 configuration](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration),
[local discovery](../evidence/mt5-native-mcp-20261024/RESEARCH.md).
