# Live Notes: grouping and persistent folders

Date: 2026-10-29. Scope: the four current owner browser comments on Notes.

## Delivered

- Muted, unfilled Group by menu: None, Note type, Day, Week, Month, Year.
  Updated dates follow the selected timezone; weeks begin Monday. The current
  note schema supports General notes only; no invented trade statistics/types.
- Removed Notes pagination for empty and populated lists. Other ledgers retain it.
- Reused empty illustration and All/add-folder controls with no QA note recreated.
- Centered two-step folder wizard: search/select zero or more notes, Next,
  name, Confirm. Cancel/X/Escape, focus handling, duplicate validation and
  pending/uncertain mutation handling use the shared components/contracts.
- Workspace folders and memberships persist via native GET/POST
  `/api/v2/live/note-folders`. A note may belong to multiple folders.
  Creating a note in a selected folder attaches it in the same transaction.
  Selected folder shows its badge and total visible note count before filtering.
- Additive migration `0017_live_note_folders.sql`; workspace predicates/FKs,
  idempotency receipts, strict payloads and serialized 200-folder limit.
- Loading/error retains folder scope; it never falls back to All silently.

## Verification

| Layer | Evidence | Result |
|---|---|---|
| Model | `node --test tests/liveNoteModel.test.mjs` | 5 pass; timezone, year/week boundaries, unknown dates, filters |
| Native Router + disposable PostgreSQL | `api-rust/tests/live_note_folders_pg.py` | PASS; empty/member folders, restart reads, duplicate/invalid data, cross-workspace denial, idempotency, atomic note rollback, concurrent folder cap |
| Browser fixture | `liveNotesLayout.browser.mjs` | 10 cases PASS; empty/populated lists, filters, error/retry, dark/light, desktop/mobile |
| Stateful browser fixture | `liveNoteFolders.browser.mjs` | PASS at 1920 dark VI, 1440 light EN, 390 dark VI; wizard, reload, membership, grouping, duplicate and uncertain saves |
| Build | Vite + locked release API/admin/research binaries | PASS; existing Vite chunk-size warning |
| Independent review | labels_ui_review | Findings fixed: migration registration, scope on read error, uncertain save lock, concurrent cap, footer spacing, contextual Day label |
| Owner runtime | `liveNotesRuntime.browser.mjs` on port5180 | PASS; real GET only, 0 writes/page errors; no test folders/notes created |

Full reports/screenshots/build outputs: `E:/BACKUP-TRADINGWORKSPACE/notes-folders-20261029` (local, outside Git).

## Local rollout

- Initial preflight refused a stale scientific installation identity without
  touching the owner runtime. Commit `79a9ed88` adds an explicit installation
  root override while preserving all capability root/code/dependency checks.
- Fresh old/candidate ownership, hashes and idle guards passed. Unknown broker
  submissions checked before stop; no terminal or broker action issued.
- Verified PostgreSQL custom dump plus byte-matching artifact backup: 4142 files,
  4247522786 bytes. Private backup/config kept outside Git. Only 0017 was applied.
- New owned native/compact supervisor/API/research ready; existing installed
  scientific/legacy/QDM settings preserved. Concrete rollback script prepared:
  empty 0017 tables only under exact hash/locks, otherwise refuse and retain backup.
- UI index promoted atomically, old hashed assets and private brand retained.
  Served index SHA256: `e64f23fb4e5d63bb52ae853b1f3990fa937bfbecb9c2da52f2c641b54797d86e`.

## Limits

Writes were verified on disposable PostgreSQL and synthetic browser data.
Owner-runtime smoke only reads data/opens dialogs. This receipt does not grant
broker execution or claim whole-product/whole-plan acceptance.
