# Page navigation performance — 2026-10-21

Scope: the reported slow page changes on local WMREPLAY 5180, backed by native Rust/compact PostgreSQL on 8010. Baseline source: `f501dc724048e1bc769c7013b1a55271436168f9`. This is a scoped performance receipt, not whole-product acceptance.

## Findings and changes

- Route lazy loading already existed. Two static imports bypassed its benefit: the Session picker imported the full Analytics workspace for pure model helpers, and the shell imported the AI panel for its icon. Helpers now come directly from their model; Analytics and AI interfaces load on demand. The existing icon is extracted unchanged.
- The AI loading/error surface preserves its close control, Escape, modal keyboard containment and opener restoration. Import failure stays inside the existing error boundary. After first opening, the panel stays mounted to preserve chat state.
- Session dataset metadata now uses the existing workspace-scoped cache instead of issuing a separate request on every return. Its existing 15-second TTL, mutation invalidation, scope isolation and denial clearing remain authoritative. No financial response cache was added.
- Replay/prop identity enrichment repeatedly extracted fields from large JSON documents inside an OR join. One shared SQL statement now materializes the required scalar fields once, retaining current-revision/deleted/workspace filters and all three identity paths. Both catalog and dashboard use it.
- Trade server pagination was already present and remains intact. Browser page 2 requests `page=2&page_size=10` and renders three remaining trades rather than fetching an unpaged ledger.

## Measurements

Same local release workload and owner data, sequential read-only HTTP requests; one first request plus five warm samples per endpoint. Table reports the median of the five warm samples. No synthetic throttling; these small local samples are not field INP or production p95 measurements. Before/after builds were idle for the final comparison; the earlier `after-http.json` overlapped a database profiling probe and is not the final comparison.

| API | Before | After | Payload |
| --- | ---: | ---: | ---: |
| Replay session catalog | 419.79 ms | 128.02 ms | 2,595 B |
| Dashboard sessions, page 1/size 3 | 428.29 ms | 136.40 ms | 17,114 B |
| Overview | 15.35 ms | 15.89 ms | 3,897 B |
| Trades, page 1/size 10, warm projection | 2.11 ms | 2.32 ms | 24,272 B |
| Selected session metadata | 99.15 ms | 95.79 ms | 1,434 B |
| Selected session analytics | 210.73 ms | 208.74 ms | 8,084 B |

The two affected list APIs improve about 69%. Raw samples: `before-http.json` and `after-isolated-http.json`. Paired read-only SQL checks returned identical two-row identities: baseline execution samples 303–336 ms versus 8–9 ms for the candidate (`identity-query.json`). HTTP contract parity is tested separately, not inferred from timings or payload sizes.

Main minified JS: 603.45 kB baseline (`../live-ui-followup-20261021/build.log`) to 574.53 kB; gzip 175.04 to 165.57 kB. The main chunk still exceeds Vite's 500 kB advisory. Browser evidence confirms the Session route does not request AnalyticsWorkspace or AiChatPanel; AI requests its chunk only when opened. Repeated Overview → Session navigation reuses dataset metadata and keeps SPA navigation.

## Verification

- `node --test --test-concurrency=1 tests/*.test.mjs`: 428 passed, 0 failed (`node-tests-final.log`). During initial concurrent build, a wall-clock heartbeat recovery test failed twice. Its existing injected clock now drives watchdog and reconnect separately, preserving both assertions without increasing a timeout; production event behavior is unchanged.
- `cargo test --lib --locked`: 151 passed, 16 ignored (`rust-tests.log`). Ignored tests were not claimed as exercised.
- `run_catalog_parity.py`: 60 native HTTP contract cases match the Python oracle, using an owned disposable PostgreSQL fixture; explicit prop identity, legacy name fallback and resume binding added for both workspaces (`catalog-parity.json`). Owner DB not used for fixture mutation.
- Production `npm run build`: passed (`build.log`). Built main `index-DvFwtqrb.js` is observed on 5180.
- Browser: Session report and expected -2.28 USD PnL; repeated navigation/metadata reuse; Trade pages 1 and 2; Analytics metrics; AI load-on-open and close. At 768px, deliberately blocking the AI chunk produced a contained error, with Escape closing and focus returning to its opener. The console import error in `after-browser.json` is from that deliberate blocked-chunk case on the preceding build. Blocking was cleared and the final build loaded successfully.
- Independent source review found two lazy-AI accessibility/error containment defects; both fixed and re-reviewed with no blocker. `git diff --check` passed.

## Runtime and limits

New native binaries are active under `api-rust/target/navigation-candidate/release`; readiness and executable/source hashes are in `runtime-provenance.json`. The first restart attempt was correctly rejected by executable ownership checks; the original runtime stayed up. A verified stop using its old owner followed by the new native startup succeeded. No schema migration, financial mutation or provider/broker enablement was needed. Previous owner and binaries remain locally available for rollback. Main 8010/5180 stay running.

This does not make every navigation instantaneous. Session analytics still costs about 209 ms; metadata about 96 ms. The first trade projection after restart still reads full source ledgers (observed 362 ms), then serves paged warm reads; it is not database-source pagination. Larger-data source pagination and additional bundle splitting require their own measured workload. No claim is made that Rust alone fixes frontend rendering, network payloads or every page.

Screenshots: `trades-page2.jpg`, `analytics-ai-lazy.jpg`. Request/check receipts: `before-browser.json`, `after-browser.json`. Earlier failed test/restart attempts remain here as diagnostic evidence rather than acceptance results.
