# CLIProxyAPI local integration — 23 October 2026

Owner approved local CLIProxyAPI evaluation with account risk accepted and no
automatic sign-in. This slice adds a provider, preserving the product's text-chat
harness. It does not add an agent/tool loop or broker authority.

## Implementation and ownership

- `ai_assistant.rs` owns bounded conversation/context validation, server policy,
  one shared turn, workspace/subject ownership, polling, cancellation and TTL.
  Legacy WebGPT aliases remain pinned to WebGPT.
- `ai_gateway.rs` uses the existing reqwest client stack and Responses protocol,
  loopback-only backend configuration and a private inference-key file. It does
  not access OAuth storage or management endpoints. Catalog reads are lazy with
  a 30s success cache; inference has no application retry/fallback.
- Settings selects provider/model, chat uses neutral API routes and requires the
  exact expected provider/model/effort. Stale selection fails before inference.
  Provider/model selection is machine-scoped RAM state and resets to environment
  defaults after an API restart. Existing WebGPT login/probe remains explicit.
- Upstream CLIProxyAPI v8.0.40 remains a separately pinned binary. No fork,
  vendoring, new dependency, service, autostart or global environment change.
  Local config disables management, discovery and request logging; files inherit
  current-user-only Windows ACLs. OAuth storage is not claimed to be encrypted.

## Verification

- Locked Rust release build of all binaries passed.
- 11 focused Rust tests passed, 172 filtered: see `backend-tests.txt`. Actual HTTP
  fixtures exercise policy/context, catalog caching/invalidation, expected
  selection, auth/quota/incomplete/empty/oversized errors, cancellation and scope.
- Vite build passed; existing main-chunk size warning remains. Provider settings
  stays inside the existing lazy Settings chunk; no model-latency claim.
- Existing chat regression passed 360/768/1368px; WebGPT account fixture regression
  passed 360/768/1440px. Neither used a real model.
- Provider UI fixtures passed 1440/360px, vi/dark and en/light, including empty,
  auth/quota/cancel, model choice without fabricated efforts, no idle Settings
  polling, no implicit login/inference/retry, no overflow or page errors.
  See `ui/report.json` and screenshots; light theme is set through actual storage.
- The pinned gateway ran temporarily with the exact initialized private config:
  keyless 401, authenticated 200/empty models, management 404, owned loopback listener,
  zero credential JSON/body log files; process stopped. See `gateway-smoke.json`
  and `private-acl.json`. This is not an inference benchmark.
- Actual preview5180 → API8010 → gateway passed provider selection/refresh and
  empty-model chat lock; foreign workspace 403. No mocks, login/probe/chat requests
  or page errors. Prior provider restored and owned gateway stopped.
  See `local/report.json` and `local/settings-empty-gateway.png`.
- AI environment audit: 0 errors/0 warnings, active 15529/65536 bytes, 50007 bytes reserve.

## Local runtime update

Guarded preflight verified idle jobs/downloads and current schema 11 with no
pending migrations. The manifest-owned prior runtime was stopped using its exact
binary paths, then API8010 started from
`foundation_v2/.runtime/api-builds/ai-provider-20261023/release` with native/compact,
QDM, the existing scientific demo-trading descriptor and legacy codec descriptor.
Readiness passed; runtime receipt in `runtime.json`. No migration, broker command,
terminal restart, credential import or model request was performed.

## Remaining acceptance

Owner must sign in manually and start the foreground gateway using
`docs/AI-PROVIDERS.md`. Catalog availability does not prove real inference.
Single-model inference, real account refresh/revoke, multi-account pool routing,
quota/failover/affinity and actual model performance remain unverified.
The existing harness sends only text and screen/locale, not charts/account data.
