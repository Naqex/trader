# CLIProxyAPI embedded administration — 23/10/2026

Owner requested the original running panel inside a dedicated tab, filling the
content viewport without copying/modifying upstream UI. Delivered CLIProxyAPI
between Connections and Models; drawer management link enters this same tab.
WMREPLAY sidebar/header/subnav remain; no extra title, toolbar, padding or card
surrounds the upstream document.

## Boundary and lifecycle

- Lazy component reads existing gateway metadata on entry, with cancellation and
  a10s timeout. Only the fixed loopback management URL is accepted. Gateway not
  ready/error has VI/EN recovery links/retry; no automatic start or secret transfer.
- Original Management Center remains on17852 in a cross-origin iframe. No DOM/CSS
  edits, source fork, postMessage auth or reverse proxy. It uses its own login,
  theme, locale, menu and refresh/polling. Native shell locale does not override it.
- Frame mounts only on this tab and unmounts on departure. No extra idle polling;
  upstream JS/requests stop with the document. Panel bytes stay outside app bundle.
- Sandbox permits scripts/same-origin storage/forms/popups/downloads, write-only
  clipboard delegation; no top-level navigation. OAuth popups can leave sandbox
  for provider authentication; no actual OAuth/login-to-provider was initiated.
- Existing pinned panel/backend hashes/startup checks remain. Loading the original
  UI avoids component drift, but upgrades still need frame/login/backend checks.
  Loopback URL is local-machine scope, not a remote deployment solution.

## Validation and rollout

All temporary sources/builds/reports/screenshots/prior index:
`E:\BACKUP-TRADINGWORKSPACE\ai-gateway-embed-20261023`.

| Check | Result |
| --- | --- |
| Isolated production build | Passed; no new dependency; existing >500kB main chunk warning remains |
| Embedded panel with fixture metadata |6/6 VI/EN at1440/768/360; real unchanged panel login; stopped/error/untrusted-URL recovery; exact content rectangle/bottom alignment; no outer overflow; lazy mount/unmount; reload; zero writes/page errors |
| Native workspace fixture regression |6/6 connections/drawer/model/bot/header-chat, including updated internal management link |
| Actual installed app/API + iframe |`live/report.json`6/6; real admin sign-in from private key file, Providers navigation, responsive screenshots, reload/unmount; zero writes/page errors |
| Actual workspace read-only regression |`workspace-live/report.json`6/6; provider/selection/profiles unchanged; zero writes/page errors |
| Visual review |Authenticated desktop/mobile Providers screenshots reviewed; upstream UI fills content edge-to-edge, shell retained |

Admin login verification reads the private key only inside the test process, never
prints it, places it in a URL or saves it to evidence. Fresh isolated browser
contexts do not alter the owner's existing browser session. Request interception
allows GET/HEAD only, no OAuth/config mutations/inference/provider login. These
checks do not prove OAuth popup flows, model/quota/pool health or throughput.

Candidate source archived from HEAD plus scoped edits; unrelated dirty UI changes
excluded. Hashed assets copied before atomic index replacement; old assets/brand
retained. Existing API/gateway were not restarted. Rollback restores `ui-before`
index atomically; no database migration or data rollback. Preview5188 stopped
after validation; normal5180/8010/17852 retained.
