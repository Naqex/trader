# Dashboard daily/monthly charts — 26/10/2026

Owner assigned the follow-up from the
[FX Replay chart audit](../../../ui/references/fxreplay/testing-dashboard-charts.md).

Status: **PASS for this Dashboard slice**, including deployed local API/UI.

## Behavior and data

- Bounded filters spanning at most 31 inclusive calendar dates use days; Lifetime,
  longer and one-sided ranges keep months. The boundary uses local dates in
  Settings timezone, including DST transitions.
- API adds `chart_period`, and bounded-range `days`/`activity_days`. Existing
  `months`/`activity_months` retain their contract. No database migration.
- Closed fills are dated after filtering and lineage deduplication. Daily rates
  use the existing after-fee win count divided by closed fills, including
  breakeven. Unknown dates stay unassigned; absent days are not 0%.
- Practice intervals are clipped, unioned across selected sessions and split at
  local midnight. Cached trade reports still refresh activity intervals per read.
- Daily axes show local day/month labels and tooltips retain full ISO dates.
  Win-rate tooltips retain one decimal place; axes remain integer 0–100%.
  Info text follows daily/monthly mode in VI/EN. Demo uses dated sample data.
- Custom-range browser QA exposed a label selector matching the date widget's
  root span. Restricting it to the text span restores the date fields and removes
  the horizontal overflow. No global input styling changed.

Trade-off: daily detail is limited to 31 selected dates to keep Dashboard readable.
Undated historical fills cannot be assigned to invented days. Previous calendar
week/month filter semantics remain unchanged.

## Validation

Local artifacts and rerun scripts:
`E:/BACKUP-TRADINGWORKSPACE/dashboard-charts-20261026/RESUME.md`.

- 26 Dashboard model/demo tests passed.
- Native focused runs: 5 Dashboard, 6 activity, 9 presentation tests passed; these
  patterns overlap. Cover DST, union/clipping,31/32-date boundary, missing dates,
  weighted after-fee rates including breakeven and actual activity metadata.
- Native HTTP on disposable PostgreSQL passed seven groups: cold/cache close
  counts, midnight union, fresh interval under cached heads, timezone grouping,
  monthly scopes, single local day and empty states.
- Candidate Playwright:12 cases passed, 320–1920px, VI/EN, light/dark, fractional
  and zero rates, missing dates, no-trades, denied/error and real workspace reads.
  No browser writes or broker routes. Root/horizontal overflow checked.
- Independent source and screenshot review passed; raw review includes hashes.

- Deployed Playwright: the same 12 cases passed at port 5180. Real UI filter journey
  selected Last week → Last month → Lifetime, receiving daily → daily → monthly
  projections, with displayed point counts and date keys matching real responses.
- Four read-only deployed API scopes passed: Lifetime, previous calendar week,
  previous calendar month and a longer range. Activity buckets sum to the measured
  total, and symbol counts sum to closed fills. One legacy undated close remains
  unassigned rather than becoming a fake chart observation.

## Local runtime

Native/compact ownership and scientific/legacy capabilities were preserved through
the guarded check-only/idle/stop/start flow. No migration, broker execution or
terminal reconnect. Both runtime and UI processes remain owned by Windows.

- Run ID: `7d40eb234219409f8f7d7b833cbbbdaf`.
- API SHA256: `5b95efc97ecb6d592a41efef701a3ddce07753d367341a55e1b5867aba5481e5`.
- UI index SHA256: `5c1aec832ab3963f68241e8ba89f8bafa278e4f47478f99b80947a55518e598d`.
- Native rollback: local `backend-before-release/rollback.json`; old binaries kept.
- UI rollback: local `ui-before-release/`; atomic index swap retains old hashed
  assets for already-open pages. New source build excludes unrelated dirty work.

This receipt covers Dashboard only. It does not establish calculation parity with
FX backend or complete acceptance for other pages. The comparison workflow remains
[verification-workflow.md](../../../ui/references/fxreplay/verification-workflow.md).

## Test corrections retained in the record

Initial browser expectations assumed VI date slashes and full EN duration words;
the established locale renders `31-01` and `1 hr 5 min`. Custom-range overflow
was a real UI defect and was fixed. HTTP fixture setup was corrected to use UUID
event IDs, valid <=30-second measured intervals and matching replay lineage IDs;
these setup failures were not product computation failures. An initial rebuild
used the wrong cwd and failed before producing output; the scoped build then passed.
