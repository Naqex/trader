# Product Plan → source và bằng chứng — 31/10/2026

WORK: ACTIVE/PARTIAL · REVIEW: REVIEWED-PARTIAL · DOC: FULL

Baseline khảo sát `884d04f2`. Đối chiếu 26 yêu cầu Y và bốn hành trình của
Product Plan; không thay acceptance ledger hoặc tự cấp quyền execution.
Source locator được kiểm ở canonical `foundation_v2`; receipts là bằng chứng
**có ngày/source/scope riêng**, chưa được chạy lại trên candidate audit mới.

## Cách đọc và số liệu

- **R**: tìm được receipt từng kiểm runtime của owner/local đang dùng, có thể
  chỉ là GET/UI. Không có nghĩa runtime đang chạy hôm nay hoặc toàn yêu cầu đạt.
- **F**: bằng chứng fixture/offline/disposable API/database, kể cả browser dùng
  production build + Rust/PostgreSQL thật. Đây vẫn là fixture runtime.
- **P**: chủ yếu contract/tài liệu, chưa đủ proof cho kết quả sản phẩm yêu cầu.
- **X**: deferred bằng current scope 29/10, giữ yêu cầu để có thể mở lại.

Đã map **26/26 yêu cầu**: 24 đang giữ, 2 deferred. Trong 24 đang giữ: **13 R,
9 F, 2 P** theo mức bằng chứng cao nhất được trích bên dưới. Đây là **coverage
đối chiếu**, không phải % hoàn thiện. Không có Y nào được nâng thành full
accepted bởi lượt đọc này; điều đó không có nghĩa implementation đang ở 0%.
Bốn hành trình có source và receipt cho những đoạn cụ thể; chưa có receipt mới
chạy trọn cả bốn trên cùng source/build/database. Nên báo trạng thái từng mảng
cho owner thay vì gộp một % sản phẩm chưa có trọng số/acceptance tương ứng.

## Bằng chứng dùng lại

| Key | Receipt và phạm vi |
|---|---|
| E1 | [Rust-native acceptance 18/10](../rust-native-20261018/ACCEPTANCE-AUDIT.md): extension native/performance đã accepted trong workload được nêu; data/research 13 production-browser checks trên DB tạm, 39-trade oracle; metadata48, tenant/contracts/retry, chart600s, wrapper19/10, setup/rollback; actual owner cutover chỉ đọc chart/Prop |
| E2 | [Practice UI 28/10](../practice-ui-audit-20261028/RECEIPT.md): 16 actual loaded views/8 routes, same-scope delayed response và calendar/sort, GET-only; không research/replay mutation |
| E3 | [Trade data 25/10](../trade-data-audit-20261025/RECEIPT.md): 13 persisted replay trades/3 sessions, prices/fees/net/capital/clocks, 42 sort directions và pagination; actual served read-only QA; historical unknowns giữ unknown |
| E4 | [Prop multiasset 18/10](../prop-multiasset-20261018/CHECKPOINT.md): disposable native/compact + real chart, 8 grouped feature cases, phases/equity/retry/feed/restore; actual owner creator read-only smoke; giới hạn intrabar coverage/currency/ticks giữ nguyên |
| E5 | [Demo trial 29/10](../demo-broker-acceptance-20261029/RECEIPT.md): account-specific authorized demo trial, UI preview/confirm/send + native API, 27 commands; không future trading authority, không unknown/partial-fill coverage |
| E6 | [Live follow-up 29/10](../live-final-audit-20261029/RECEIPT.md): actual local read-only UI, completed lifecycle14trades/net1.01USD, fix deal/trade reconstruction và empty chart, scoped current presentation; generic reportPresentation run vẫn FAIL riêng |
| E7 | [AI workflow fixture 23/10](../ai-workflows-20261023/RECEIPT.md): actual LangGraph process + loopback synthetic model + disposable PG; no real inference/graph resume |
| E8 | [AI local rollout 23/10](../ai-platform-deployment-20261023/RECEIPT.md): actual UI→API profiles/catalog/readiness/reload VI/EN; migration/restore; không inference/failover/throughput |
| E9 | [Learn bridge 02/10](../wm-all-plan-20261002/learn-ready/CHECKPOINT.md): isolated API dùng actual read-only course, 10API/6Learn/6loaded-chart checks; active runtime binding khi đó chưa configured, không learner writes |
| E10 | [UI system 31/10](../ui-system-audit-20261031/REPORT.md): grouping/selection/notes/pickers, native disposable merge/persist/split, actual deployed GET-only regressions và guarded schema20 rollout; không owner merge/trade/delete |
| E11 | [Migration 29/10](../../../../../planning/trader/checkpoints/NAQEX-MIGRATION-20261029.md): source/repo delivery, license/notices/setup/CI/preservation; packaging/public application release deferred |
| E12 | [Operational RESUME](../../../../../planning/trader/research/foundation-validation/20260921T115933Z-315e8ddd/RESUME.md) + exported STATE r389: 37 accepted scoped tasks; historical core/orchestration/engine evidence, không whole-product |

## 26 yêu cầu

Source column rút gọn: UI files ở `foundation_v2/web/src/`; Rust files ở
`foundation_v2/api-rust/src/`; đường dẫn docs/workspace ghi riêng. “Cần bổ sung” là thiếu proof/full scope được nhận
diện, không mặc định là bug hoặc yêu cầu rerun mọi suite cũ.

| Y | Mong muốn, mức proof | Source/contract hiện có | Fixture/offline đã có | Runtime owner/local đã có | Cần bổ sung / giới hạn |
|---|---|---|---|---|---|
| Y01 | Một workspace **R** | `web/src/FxReplayShell.jsx`, `main.jsx`, `clientNavigation.js` | E1 production-route integration; E10 cross-page selection | E2 Testing + E6 Live + E8 AI, khác source/ngày | Bốn hành trình A–D liên tục, giữ context/back/reload trên cùng build; các detail state ngoài sidebar |
| Y02 | UI dễ hiểu VI/EN **R** | `testingLocale.jsx`, `testing-copy.json`, `product-ui-profile.css`, project `ui/display-conventions.md` | E10 theme/locale/mobile component regression | E2/E6/E8 UI actual theo phạm vi | VI/EN còn literal và hidden surfaces chưa phủ hết; audit mới đang sửa; không suy old axe thành full WCAG |
| Y03 | Chart/replay/vẽ **R** | `ReplayWorkspace.jsx`, `TradingViewReplayChart.jsx`, `browserChartAnnotations.js`, Rust `replay_service.rs` | E1 parity/chart endurance; E4 chart switching/protection | E1 owner chart GET; E6 actual MT5 chart đọc | Touch/zoom/dataset-switch/lifecycle toàn bộ + chart state matrix current build; broker/replay không trộn |
| Y04 | Playbook có phiên bản **F** | `PlaybookWorkspace.jsx`, `playbookApi.js`, Rust `metadata_mutations.rs` | E1 metadata48, E12 U3 backend | Chưa tìm proof owner full create→fork→freeze→research→journal trong read-set | Tích hợp strategy/version provenance và UI errors/permissions; source có diff/fork/freeze, không gọi chưa làm |
| Y05 | Data/quality/cost/news **R** | `DataDeskWorkspace.jsx`, `dataDeskApi.js`, Rust `data_routes.rs`, `artifact_data.rs` | E1 CSV120 + streaming420003 + data/research13 | E2 actual Market Data đọc; E1 preserved owner artifacts/cutover | Representative licensed import/quality/cost/news basis trọn workflow; fake vendor fixture không là provider-network acceptance |
| Y06 | Backtest/OOS/stress **F** | `ResearchWorkspace.jsx`, Rust `research_jobs.rs`, `research_execution/*` | E1 reference39-trade oracle; scientific86pure/12persisted; E12 OOS/stress scoped | Chưa tìm owner end-to-end strategy/OOS run mới trong read-set | A trọn chain + evidence đủ quyền/cost/OOS, không cần chiến lược có lời để phần mềm đạt |
| Y07 | Analytics truy nguyên số **R** | `AnalyticsWorkspace.jsx`, `analyticsViewModel.js`, Rust `analytics.rs`, `analytics/*` | E1 Decimal/parity; E3 frozen410-case oracle, rounding/unknown/sorts | E3 persisted replay cell checks; E6 completedLiveTrades/report scope | Mọi chart/metric/drilldown/currency/filter path; historical timestamps/R thiếu evidence vẫn unknown |
| Y08 | Simulation/xác suất/RR/drawdown **R** | `analyticsSimulation.js`, `AnalyticsCharts.jsx`, `RiskWorkspace.jsx`, `prop_core.rs` | E1/E4 financial/Prop fixtures; seeded simulation source | E2 actual Drawdown/Simulation views (read-only) | Statistical/empirical conclusions cần eligible data/sample/assumptions; mở view không xác minh xác suất lợi nhuận |
| Y09 | AI giải thích/overlay/research **R** | `AiChatPanel.jsx`, `AiWorkspace.jsx`, `aiSelection.js`, Rust `ai_context.rs`, `ai_runs.rs` | E7 loopback model/lease/cancel/admission; E1 context corpus | E8 profiles/catalog/readiness actual, không inference | Real model quality/domain-grounding/overlay undo/read-only tool eval; model secret/provider/broker gates riêng |
| Y10 | Demo/live orders lifecycle **R** | `LiveTradingWorkspace.jsx`, `Mt5TradingBar.jsx`, `liveTradingApi.js`, Rust `demo_trading.rs`, `mt5_connector.rs` | E1/E12 fail-closed/retry boundaries; fixture process guards | E5 real demo; E6 fills/journal/report đọc | Unknown/partial/netting/disconnect/recovery/account capabilities khác chưa được trial E5 chứng minh; live tiền thật chưa được cấp |
| Y11 | Learn/thuật ngữ/tiến độ **F** | `LearnWorkspace.jsx`, `learnIntegration.css`, Rust `control_routes/learn.rs`; workspace `education/` | E9 actual course read-only nhưng isolated API/fixture DB | E9 không cấu hình active owner binding khi đó; chưa xác minh binding hiện tại | Contextual playbook/chart links + actual supported binding; không reset progress/đọc đáp án rộng để QA |
| Y12 | Miro **X** | Product Plan/Y12, current-scope29/10 | Lịch sử giữ nguyên | Không cần mở | Deferred; không coi missing board chặn đợt audit này |
| Y13 | Đổi AI/chart/data/broker **F** | `AiWorkspace.jsx`, chart wrappers, Rust provider/data boundary; docs API stack | E1 native/adapter contracts; E7 provider-neutral synthetic transport | E8 một configured gateway; không đủ proof thay mọi vendor | Replacement acceptance riêng cho component thực chọn; không cần cài framework mới để chứng minh abstraction |
| Y14 | Giảm thuê bao/quyền thư viện **P** | Product `THIRD_PARTY_NOTICES.md`, `docs/advanced-charts.md`, workspace `docs/licensing.md` | E11 345 notice entries/guard/license inventory | Không có bảng actual owner subscription/exit-cost thay thế trong read-set | Giữ/giảm chi phí theo nhu cầu thực; license inventory không chứng minh hết quyền data/commercial/distribution |
| Y15 | Repo gọn/tiếp tục được **R** | Product README/AGENTS, `scripts/check_paths.py`, runtime/setup docs | E1 tracked-source build/restore/rollback; E11 path guards | E10 actual guarded backup/cutover và recovery locators | WIP/checkout cũ/evidence chưa retire; clean recursive all-product clone chưa claim; cleanup manifest audit mới |
| Y16 | Tenant/account isolation **F** | Rust `auth.rs`, scoped reads/mutations, keyed Query owner | E1 multiworkspace/scoped contracts; E7 principal denial | Single owner local usage không chứng minh multi-user production | Giữ deny-cross-workspace/re-authorize/idempotency. Không xây 1000-user infra trong đợt một owner |
| Y17 | Client/local/cloud đường phát triển **F** | `clientNavigation.js`, `WorkspaceQueryProvider.jsx`, API contracts/runtime profiles | E1 route/profile/reconnect/wrapper fixture | Một local owner, chưa remote/multi-client production | Contract là nền mở rộng; remote/cloud acceptance không thuộc đợt này |
| Y18 | Trading retry/crash/concurrency **R** | Rust `commands.rs` transaction receipts, `demo_trading.rs`, process ownership | E1 persisted retry/lifecycle/wrapper; E7 leases/unknown/cancel | E5 commands không unknown; E10 migration guards idle/no-unreconciled | E5 không bao unknown-send resend; không suy 27 commands thành mọi broker/fault mode; execution authority vẫn fail-closed |
| Y19 | Work nặng không nghẽn UI **F** | Rust research worker/leases, bounded replay storage; frontend lazy/query owners | E1 mixed-resource compact + chart600s, measurements đúng workload | Owner cutover GET không phải mixed-load benchmark | Đo lại concrete slow journeys trên candidate; không scale testing 1000users hoặc blanket no-lag claim |
| Y20 | Data integrity/reproduce/migrate **R** | Rust `artifact_data.rs`, `replay_storage.rs`, `data_routes/lifecycle.rs`, migrations | E1 immutable publication/streaming/rollback/differential | E1 owner18-table hashes; E8 restored29tables; E10 schema20 preserve counts/artifacts | Scope backup/restore/hash khác nhau, không tuyên bố toàn DB luôn unchanged khi sync MT5 còn ghi; future migrations cần duyệt riêng |
| Y21 | Debug/traces/recovery **R** | `docs/RUST-NATIVE-RUNTIME.md`, runtime manifests/scripts; Rust persisted receipts/events | E1 crash/ownership/restore/wrapper; E7 run step events | E10 owned source/binary/UI hashes/ready/backup/rollback | RPO/RTO và mọi fault model chưa suy từ launcher PASS; no-leak/no-downtime dài hạn chưa chứng minh |
| Y22 | Coordinator/delegate/review/resume **F** | Workspace `tooling/agent-workflow/`; operational ledger/controller/run packets | E12 core ledger/recovery/scoped CO tasks | Current team làm audit không tự nghiệm thu original native Web→Web overlap/10-instance scenario | Giữ artifact authority, không phụ thuộc chat; orchestration developer tooling tách product AI engine; không tái khởi động old workers để đếm đủ |
| Y23 | Chọn engine/hiệu suất có căn cứ **R** | `docs/API-STACK-DECISION-20261009.md`, native adapter inventory, typed boundaries | E1 same-workload diagnostics/financial parity/frontend/layout/mixed load | E1 authorized native/compact cutover + owner read-only chart | Extension đã accepted đúng scope, không bắt làm lại. New audit dùng bottleneck được đo, preserve future swap option |
| Y24 | Vendor exit/sản phẩm dài hạn **P** | Product license/notices/README/security/release docs; workspace architecture ADR | E11 source-delivery/license/CI/portable setup guards | Source publication/CI trong E11 không phải application production | Packaging/public deploy/commercial entitlement/ops/exit-cost tách gate; không đổi license đã cấp trong lịch sử |
| Y25 | Prop challenge lifecycle **F** | `PropWorkspace.jsx`, `propReplaySync.js`, Rust `prop_service.rs`, `prop_core/*` | E4 two-asset phases/reset/retry/feed/expiry/restore; E1 step/feed/error/endurance | E1 owner saved Prop/chart GET; E4 owner creator đọc | Full D/report/journal/export trên supported profile; unknown intrabar path không cho monetary verdict; không suy payout/probability |
| Y26 | Figma Make round-trip **X** | Product Plan/Y26, current-scope29/10 | Receipts lịch sử giữ nguyên | Không cần mở | Deferred; không mở OAuth/upload hoặc chặn current code QA |

## Bốn hành trình

| Hành trình | Source và đoạn đã có proof | Thiếu bằng chứng trọn chuỗi / gate |
|---|---|---|
| **A Nghiên cứu** | DataDesk → Playbook/Research → native reference/scientific/OOS → Analytics/Trade drilldown. E1 data/research13 trên fixture; reference39-trade oracle; E3 actual persisted trades/provenance | Chưa có receipt mới cho mọi bước trên cùng build: chọn licensed data+quality, pinned playbook, budget, costs/baseline/OOS, inspect chart, lưu quyết định/reload. Không mở holdout để lấp matrix |
| **B Luyện/chart** | Replay/chart/source drawing/protection, simulated fills, cutoff, journal. E1 parity/600s desktop; E4 multiasset fill/drag/close/reload trên temporary DB; E3 actual existing trades/drilldown | Current full create/resume→reason/drawing→fill→cutoff→journal/tag/no-trade audit, touch/zoom/hidden surfaces. Native backend fixture có thật vẫn không là owner financial QA |
| **C Giao dịch** | Live account/quote/ticket/risk/preview/confirm→native MT5→receipt/history→report. E5 demo execution + E6 report reconstruction actual; E10 notes/selection actual GET | Account-specific demo only, 1st placement/close qua UI; remaining commands qua same project API. Unknown/partial/disconnect/full management khác cần scope; broker/live/tiền thật chưa authorize bởi audit |
| **D Prop challenge** | Creator profile/version→datasets→replay→equity feed→phase/reset/retry/expiry/resume; E4 native/browser disposable + E1 Prop feed; owner saved Prop load chỉ đọc | Full profile/report/journal/export and all supported coverage chưa có current single-revision packet. Intrabar unknown paths intentionally blocked; no broker/purchase/payout claims |

**4/4 có map và scoped proof; 0/4 được cấp full-current-build acceptance trong
lượt đọc này.** Không dùng 0/4 như % implementation; đây là trạng thái proof mới.

## Những thông tin cũ đã được supersede

1. Rust checkpoint đầu file17/10 ghi ACTIVE/WIP, nhưng final section18/10 và E1
   đóng extension sau authorized cutover. Không dùng phần đầu để báo extension
   vẫn đang blocked hoặc yêu cầu chạy lại toàn suite.
2. `prop-quick-workflow-20261018` từng giới hạn singleasset; E4 sau đó hoàn thiện
   portfolio Prop. Không báo singleasset-only là current constraint. Mixed currency,
   multiasset tick và unknown intrabar coverage vẫn là giới hạn được nêu trong E4.
3. E5 phát hiện deal/trade Analytics sai; E6 sửa và actual count14 đã kiểm.
   Không báo lỗi đếm28 còn mở nếu chưa tái hiện regression mới.
4. E7 là pilot source chưa promote tại thời điểm receipt; E8 xác minh rollout
   AI profiles/catalog sau đó. Không báo API chưa có AI schema, nhưng cũng không
   dùng rollout readiness thay real inference/model-quality proof.
5. Receipt cleanup đầu lane giữ các Sept gap làm **research leads**. Sau reconcile
   E1/E4, các gap đó không tự là defect current source. Matrix này là đối chiếu
   mới hơn về evidence, không sửa bytes của receipt lịch sử hoặc ledger.

## Review độc lập plan/routing mới

[OWNER-SYSTEM-AUDIT-20261031.md](../../../../../planning/trader/OWNER-SYSTEM-AUDIT-20261031.md)
phù hợp authority: phụ lục Product Plan, 12 acceptance outputs riêng; denominator
20 sidebar/49 owner files không giả thành toàn bộ rendered states. O1/O2/O10 tách
source/fixture/runtime; O7/O8 yêu cầu đo đúng workload; O11 bảo toàn WIP; O12 giữ
rollout/migration/broker gate. Không phát hiện blocker scope hoặc master ledger
thứ hai. Trạng thái detailed receipt riêng tránh nhân đôi Product Plan.

Ba điều nên giữ khi viết checkpoint cuối:

- Dùng từ **fixture runtime** và **actual owner local** rõ ràng; Chromium thật và
  Rust/PG thật vẫn có thể dùng synthetic data/disposable DB.
- Findings/state matrix cần source/build/case ID và danh sách denominator cố định;
  file owner count chỉ là entrypoint khảo sát, không là số dialog độc lập.
- Dẫn supersession ở trên trước khi liệt kê phần chưa làm; không gộp các historical
  PASS thành acceptance build mới hoặc các historical WIP thành bug hiện tại.

Validation của lane: source/contract locator existence + targeted source inspection,
read-only receipt reconciliation. Không chạy product test/build/browser/API/DB,
không sửa code/PLAN/ledger, không tái sử dụng approval cũ để gọi broker/provider.
