# Local AI platform deployment — 23/10/2026

Owner approved backup, migrations0012–0013 and local API/UI cutover. Deployed source
checkpoints: `6581925`, `d46a7ae`, profile-selection repair `161c6a8`.

## Data and runtime

- Verified backup: `.runtime/api-platform-backups/ai-platform-20261023`, snapshot
  `20261023T081022Z-cf91d0b8332a`,4142 artifacts,4,267,595,069 manifest bytes.
  Manifest SHA256: `e00883fe4c4bb68bcb26fc617930838118e7e8a10da1ec4b2e8a6a3945e2a3ac`.
- Restored custom dump into disposable databases;29 original table row hashes
  matched and disposable databases were removed. Immediately after migration,
  only the migration ledger changed; six AI tables were added; artifacts matched.
- After startup the strict whole-table comparison flagged `mt5_connections`.
  Separate restored-baseline comparison found unchanged connection identities and
  only `last_synced_at`, `next_sync_at`, `snapshot`, `updated_at` changed by ongoing
  MT5 synchronization. This is runtime drift, not a whole-database equality PASS.
- Native API8010/compact uses `.runtime/api-builds/ai-platform-20261023/release`.
  Scientific descriptor refreshed for changed Python source commitment; installed
  runtime/dependency identities unchanged. Previous descriptor/binaries retained.
- UI5180 promoted from isolated build; unrelated dirty Replay/CSS was excluded.
  Existing brand asset preserved and previous hashed assets retained.

## Verification

- Actual5180→8010, no mocked APIs:6/6 VI/EN ×1440/768/360; persisted profile after
  reload, model catalog, no overflow/page errors. VI dark/EN light screenshots.
- UI initially saved the first catalog model rather than the selected model;
  regression reproduced red, fixed catalog `id` versus stored `model` key mismatch,
  then6/6 focused regression cases passed, including nonfirst/provider selection.
- System default profile matches the saved gateway selection, revision2.
- Invalid workflow422, foreign workspace403. No login or inference submissions.
- Gateway readiness/catalog is verified; real inference, account-pool failover,
  workflow execution and load/throughput acceptance remain unverified.

Detailed local evidence (including preserved initial failures and screenshots):
`.runtime/ai-platform-cutover-20261023/`. Backup/temp storage relocation retains
this path via junction; physical bytes live below `E:\BACKUP-TRADINGWORKSPACE`.

## Rollback

Use the verified pre0012 dump and artifacts with the previous compatible binary
and UI `.runtime/ai-platform-cutover-20261023/ui-before`. Restore into a new
database/artifact root while writers are stopped. Do not reverse only the binary
or overwrite newly accumulated AI history. Owner approval covers this completed
local cutover; it does not authorize broker orders or external provider login.
