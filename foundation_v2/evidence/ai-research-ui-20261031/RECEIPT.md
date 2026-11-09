# AI Research UI — owner review

Date:31/10/2026. **UI PROTOTYPE READY FOR OWNER REVIEW; BACKEND/SERVICES DEFERRED.**
Scope: [UI slice plan](../../../../../planning/trader/AI-RESEARCH-UI-PROTOTYPE-20261031.md).
Source baseline: Trader HEAD `884d04f2` plus pre-existing owner-system audit WIP.
This receipt does not accept that WIP, the full product, or any engine/provider.

## What changed

- AI navigation adds Research/Nghiên cứu via the existing shell and lazy route.
- List/search/status filter with selected-task detail, process, experiments and
  activity. Flat layout and compact tokens, AppIcon, SearchInput, FxSelect and
  LegacyModal are reused; no package added.
- New research dialog creates a browser-only draft. Explore sample flow lets
  the owner choose an illustrative outcome, open a sample process, and view a
  sample result manually. No generated metric, real run or automatic timer.
- Sample stop, further-research and demo-review choices have explicit preview
  confirmation. Reset restores fixtures after confirmation.
- Browser state is namespaced by workspace. Read/corruption/write failures are
  visible. No broker credential, DB, real dataset or holdout is accessed.
- Research preview replaces the shell's Real data label with UI preview and
  disables its workspace event subscription. Existing workflows stay intact.

## Data and state

`aiResearchPreview.js` owns fixed illustrative records and display scenarios.
`AiResearchWorkspace.jsx` owns local selection/dialog/tab/draft state and browser
snapshot `naqex:ai-research-preview:v1:<workspace>`. New drafts do not call APIs;
sample outcomes are user-controlled fixture transitions. Metrics are illustrative
and do not represent evaluations or financial evidence.

User feedback on this prototype precedes backend/services work. Runtime/lifecycle,
data authority and promotion rules must be connected through real contracts in a
later slice; the current browser snapshot is not an authoritative research store.

## Verification

- Production build PASS: `npm run build -- --outDir ../.runtime/ai-research-ui-20261031`
  from `foundation_v2/web`. Default build output/active API not replaced.
- `node tests/aiResearchPreview.browser.mjs` PASS: five configurations (1920 dark
  VI; 1440 dark VI; 1440 light EN; 768 dark VI; 390 light EN), plus storage-denial
  and corrupt-snapshot recovery. See [report](browser/report.json).
- Journeys: create/select/reload; workspace isolation; draft→sample process→sample
  result; demo/rework choices; stop/Escape/focus return; tabs/arrow keys; search,
  empty/filter/reset; insufficient-evidence/run-error views.
- Observed report: no page errors, blocked write attempts or external requests;
  no document horizontal overflow in the five configurations. Desktop action
  footer fits the viewport; narrow experiment table has its own scroll region.
- Root reviewed [dark overview](browser/overview-1440-dark-vi.png),
  [create dialog](browser/create-1440-dark-vi.png),
  [mobile light](browser/overview-390-light-en.png) and
  [light experiments](browser/experiments-1440-light-en.png).
- Initial smoke failed because `main.jsx` normalized the new section to
  connections. Route allowlist fixed; integrated browser journeys then passed.
  Rendered review also found missing semantic token aliases; switched to actual
  product tokens and rechecked the final build.
- Focused existing navigation tests PASS5/5. The combined run with
  `shellPreferences.test.mjs` is5PASS/1FAIL: its static assertion expects old
  inline wordmark geometry. Executing the exact test against HEAD copies of its
  three source inputs fails at the same assertion before this slice; see
  [baseline evidence](shell-baseline.json). It is not silently fixed or reported
  passing here; prototype browser journeys above pass separately.
- Existing bundle-size warnings remain. No backend/API integration, model output
  quality, measured performance, broker behavior, independent UI acceptance or
  full-product acceptance is claimed.

## Preview for owner

[Open](http://127.0.0.1:5218/?workspace=tenant-a&view=ai&area=ai&section=research&lang=vi)

Isolated loopback static server, started for this task:
`node foundation_v2/.runtime/ai-research-ui-20261031/serve.mjs` from Trader.
Only GET/HEAD assets; `/api` returns explicit unavailable, other methods return
405, no proxy target. Build/runtime files are ignored. Server is kept running for
owner review; this is not a rollout to5180 or a backend restart.

Pre-existing product/root WIP remains untouched and uncommitted by this slice.
The superproject's already-dirty submodule pin is not advanced across unrelated
prior product commits; this slice's source commit is kept in the product repo.
