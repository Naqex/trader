# Average monthly/daily performance — 25/10/2026

Owner requested merged calendar months without year labels even for a single
source year, period averages instead of totals, and natural Vietnamese titles.
Titles are `Hiệu suất trung bình theo tháng` / `Hiệu suất trung bình theo ngày`;
the daily axis retains weekday names. Shared presentation applies to replay,
Dashboard summaries and Live report components, without changing their clocks.

## Calculation and data flow

- Monthly source stays dated and complete. Presentation groups month-of-year,
  then divides profit/loss/net by the number of represented dated months. It
  does not weight by trade count or introduce absent months into the denominator.
- Weekday presentation divides total net P/L by distinct active local dates.
  Native summary adds `period_count` per weekday; JS ledger adapters use the same
  unique-date rule in Settings timezone. Breakeven days count. Unobserved days
  retain their category/tooltip with no fabricated numeric average or bar.
- Tooltip states the denominator and monthly average profit/loss/net. Unknown
  denominators fail closed. Existing raw source totals, KPI and Equity are intact.

## Verification

- 23 focused web tests PASS; 7 native presentation tests PASS, covering unique
  dates versus trade count, timezone boundaries, zero/unknown and period means.
- Shared component fixture PASS at1440darkVI,390lightVI,1440lightEN. Independent
  numeric example: July totals100/300 produce200, average profit250/loss-50;
  weekday total90 over2active dates produces45. Single-year November shows only
  `Tháng11`; allzero/absent distinction and hover descriptions checked.
- Independent review caught a duplicate translation key that would use `Average
  win` for period profit; distinct keys now render `Average profit`. Reviewed
  source, native/web tests and desktop/mobile candidates accepted after correction.
- Candidate and deployed Dashboard checks PASS across2400dark real data,
  1920light/390dark demo; no JavaScript errors or write requests. Real native
  summary denominators independently matched full analytics ledgers for3sessions.
- Scoped production build excluded unrelated WIP and retained private CSS baseline.

## Local rollout

New native binaries built separately under
`E:/BACKUP-TRADINGWORKSPACE/report-period-averages-20261025/rust-target/release/`.
Idle/schema/capability preflight passed; guarded old-owner stop and detached start
preserved native/compact, DB/artifact/QDM and scientific/legacy settings. No schema
migration, terminal restart/reconnection or broker action. Initial readiness probe
ran before startup finished; subsequent readiness/hash checks passed.
Run ID: `c8726b664f704310a6f24c4e6aea8c19`.

Promotion first stopped on newline-only hash difference in unchanged chart model;
normalized content equality verified before continuing. A pre-promotion UI check
therefore still saw old titles and failed, then passed after actual promotion.
Earlier browser test used HTMLElement.innerText on SVG text; corrected to textContent.

Local scripts, reports, screenshots and rollback descriptors/old binary paths:
`E:/BACKUP-TRADINGWORKSPACE/report-period-averages-20261025/`.
Deployed UI5180 index SHA256:
`342202577677b9e57029cd951c94027a097b56cb53af5423f6711201b003bfc5`.
Old hashed assets/private branding retained. Candidate previews stopped after QA.
