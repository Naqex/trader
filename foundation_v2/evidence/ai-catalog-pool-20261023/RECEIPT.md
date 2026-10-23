# Model catalog handoff and Antigravity pool audit — 2026-10-23

## Implemented behavior

The lazily-loaded gateway panel refreshes the native catalog when leaving its tab
or opening Mentor while the panel remains active. It reuses the existing
`POST /api/v2/ai/assistant/connections/local-gateway/refresh` with an empty object;
this only refreshes catalog state, not credentials/configuration/profiles. On
completion a workspace-scoped `wm-ai-provider-change` notifies mounted readers.
Connections,Model and chat reuse their existing loaders. No iframe remount,
polling,DOM/storage access or extra framework/service is added. Work remains in
the lazy panel chunk rather than expanding shell ownership.

Successful refresh keeps the selected model and default/profile/run snapshots.
Failed synchronization is surfaced by existing native error UI. A monotonically
increasing chat catalog request revision prevents a late older response from
replacing the refreshed catalog; it also keeps an older request from clearing a
newer error/loading state. Successful reload clears only its own catalog error,
not unrelated run errors. Workspace teardown aborts pending refresh; a newer
handoff supersedes the older client request. Server refresh is read-only catalog
work even if the client has already left the screen.

There is no cross-origin upstream change callback. Handoff is deliberately the
refresh point, not a claim of realtime push after every upstream edit. Changes
made in a separate admin window without visiting/leaving the embedded panel can
still require native Refresh models or the next catalog read after its30s TTL.

## Current runtime pool — read-only inspection

- Backend CLIProxyAPI v8.0.40; official unmodified Management Center v1.26.7.
- `GET /v8/management/credentials`:3Antigravity OAuth credential records, all
  active,disabled=false,unavailable=false,no cooldown entries at the snapshot.
- Per-credential `GET /v8/management/credentials/models` lists the same8IDs.
- Effective `GET /v8/management/config/routing/strategy`:round-robin.
- Current persisted v8 routing has session-affinity=true. Retry settings remain
  request-retry=0,max-retry-credentials=1,max-retry-interval=0.
- This is one eligible-credential pool, with selection per provider/model and
  session affinity. A bound eligible session can keep the same credential. The
  selector filters availability/priority before rotation. Do not promise strict
  A-B-C alternation across messages or one account per browser tab.
- Each credential retains its own quota/context; no quota/context concatenation.
  Additional credentials do not change native admission/concurrency settings.
- Snapshot success counters were1/0/0; this is not evidence of three-account
  inference/rotation/failover acceptance. No inference,quota probe,OAuth flow or
  settings mutation was used for this audit. No subscription tier is asserted
  from a credential's OAuth account_type or active status.

No tokens,keys,email addresses,project IDs or filenames are in the audit report.
Source excerpts were downloaded read-only from the official pinned tag; no
upstream source/install script was executed.

Sources:
- [Pinned configuration](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/config.example.yaml)
- [Pinned selector](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/sdk/cliproxy/auth/selector.go)
- [Official management API](https://help.router-for.me/management/apiv8)

## Capability boundary

The live public model list has ID/object/owned_by; per-credential model metadata
has ID/display_name/owned_by/type. Neither supplies complete effort levels or
verified feature behavior. Existing native capability states stay unverified;
no hardcoded model-name heuristics,effort slider,tool authority or vision input
was introduced. The existing text Responses adapter remains the execution path.
Rich capability support and per-model inference/tool/vision acceptance are still
pending, not implied by discovering a model or an active credential. Models
with an upstream high/thinking alias keep that exact ID; it is not an invented
list of configurable effort levels.

## Verification and local rollout

Source baseline7c3e83f plus scoped edits,isolated HEAD build on E; unrelated dirty
Replay/CSS/evidence excluded. Vite build passed; existing main chunk warning
remains. Actual local API and read-only admin-login embed acceptance passed6/6
on preview. Native UI/API regression passed6/6 (VI/EN,1440/768/360):3credentials,
8models,selection unchanged,no configuration/inference writes or page errors.

Catalog fixtures passed4/4 (VI/EN,1440/360): simulate upstream model addition,
refresh on native handoff and opening Mentor,one retained iframe,no idle refresh,
late stale response after a newer response,unchanged selection,unknown effort,
synchronization failure disables native picker,successful later handoff recovers.
All non-GET requests except the exact empty-body catalog refresh are forbidden.
Historical embed fixtures also passed6/6 with the refresh POST allowlisted;
forbidden writes/page errors remain zero.

Installed5180 embed acceptance passed6/6 and catalog fixtures passed4/4,
with zero forbidden writes or page errors. Verification and promotion are
recorded outside Git under:
`E:/BACKUP-TRADINGWORKSPACE/ai-catalog-pool-20261023/`:
`pool-audit.json`,`catalog-race-final/report.json`,`embed-live/report.json`,
`native-live/report.json`,`installed/report.json`,`installed-catalog/report.json`,
`ui-promotion.json`. Screenshots and temporary source/builds are also on E.

UI index swapped atomically; previous assets/brand retained,no API/gateway restart.
Active index SHA256:
`94f92599937cc03f257c284f3c21ab0539aba1e26b1642a788cffb32381f7fe8`.
Rollback restores `ui-before/index.html` from that external directory to the
active dist index. An already-open app needs one reload to receive this shell.
This receipt proves catalog/route behavior and current pool configuration,not
model inference correctness,throughput,three-account failover or broker execution.
