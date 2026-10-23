# CLIProxyAPI persistent management panel — 2026-10-23

Scope: keep one unmodified upstream document alive after first use, across AI tabs
and other app areas. No provider OAuth, model inference or broker requests.

## Behavior and ownership

The stable shell owns a lazy panel outside keyed route boundaries. Leaving the
management tab hides and inerts the host instead of unmounting/reparenting the
iframe. Returning preserves upstream route and unsaved inputs. Language/theme
changes preserve the document. Changing workspace or reloading the application
recreates it; upstream origin storage/auth remains machine-local and shared as
before, not isolated per workspace.

WMREPLAY reads metadata on entry/reentry and explicit retry, aborting reads on
exit. It does not add idle/background polling. A stopped/error/untrusted response
shows recovery while retaining an already-loaded document. Successful explicit
retry loads a fresh panel; transient reads never automatically reload it. The
fixed loopback URL, origin separation, sandbox, no-referrer and clipboard-write
permission are unchanged. Preview/reference routes never initialize a new panel.
Lazy-load failures have a shell-local error boundary.

Hiding is not a true JavaScript freeze. The embedded upstream may retain timers,
network activity and memory, especially on Logs/Quota rather than Providers.
There is no supported parent pause/resume contract in the installed upstream.
No timer patch, DOM/style injection, Chromium-specific lifecycle command or
upstream fork was introduced. Gateway execution is independent of the panel.
Upgraded HTML takes effect on a new document, not by discarding an active form.

Sources: [MDN visibility semantics](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
and [Chrome lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

## Validation

- Isolated HEAD ddf2053 plus scoped source edits; existing unrelated worktree
  edits excluded. Vite build passed; existing main-chunk size warning remains.
- Fixture metadata with real upstream panel: 6/6 (VI/EN,1440/768/360). Tests cover
  stopped,503,untrusted URL,retry,lazy first visit,retained iframe identity,input,
  full content rectangle,no outer overflow,inert hidden host,no native polling,
  cross-area navigation/browser back,language/theme,workspace reset and reload.
- Real local UI/API plus read-only management login: preview 6/6 and installed
  5180 build 6/6. Upstream Providers route survives leaving/returning. No writes
  or page errors; no provider OAuth/inference requests permitted by test routes.
- Native connections/models/Bots regression with actual API: 6/6; existing one
  account,eight catalog models and selection unchanged. No writes/page errors.
- Inspected desktop/mobile screenshots; original upstream responsive layout
  fills the content viewport. No upstream UI customization.
- Outage recovery was fixture-tested; no intentional shutdown of the active
  gateway or API to collect evidence.

Raw reports/screenshots/builds/probe and UI-index rollback are external:
`E:/BACKUP-TRADINGWORKSPACE/ai-gateway-keepalive-20261023/`.
Reports: `fixtures-final/report.json`, `live/report.json`, `installed/report.json`,
`native-live/report.json`, `baseline.json`, `candidate.json`,
`installed-performance.json`, `ui-promotion.json`.

## Bounded performance observation

Same Windows host, headless Chromium,1440x940, fresh browser contexts; five
Bots-to-panel returns after initial load, warmed browser cache per run. Baseline
installed build followed by candidate preview and installed candidate (not an
alternating statistical benchmark). Read-only real local API and panel.

| Observation | Baseline | Installed candidate |
| --- | --- | --- |
| Additional management.html loads over five returns | 5 | 0 |
| Median return-to-visible login input, n5 | 191 ms | 38 ms |
| Authenticated Providers idle20s, gateway requests | 0 | 0 |
| Same idle window, renderer TaskDuration delta | 10.8 ms | 10.5 ms |
| Candidate CSS-hidden Providers20s, gateway requests | N/A | 0 |
| Same hidden window, renderer TaskDuration delta | N/A | 27.6 ms |

TaskDuration covers the observed page renderer, not total system CPU. CDP JS heap
is not total panel/browser RAM; no RAM-reduction claim. These short idle samples
do not establish long-running cost,Logs/Quota polling behavior or provider/model
throughput. Persistent document behavior is the acceptance criterion; timings
are diagnostic evidence. No native background timer was added.

## Local rollout and rollback

Atomic index swap, retained old hashed assets/brand, no API/gateway restart.
Active index SHA256:
`9f49bb57c24cc99c7f0792c45a14606b469959a73271804f26eed8da71dd7132`.
A currently-open app needs one reload to use the new shell.
Rollback: restore `ui-before/index.html` to the active web dist index; previous
assets remain present. Backup and build output are on E, not committed to Git.
