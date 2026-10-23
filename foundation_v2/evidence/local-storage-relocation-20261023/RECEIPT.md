# Local backup/temp relocation — 23/10/2026

Owner requested backup and temporary storage under `E:\BACKUP-TRADINGWORKSPACE`
to free D. Both volumes are healthy NTFS; D is a Samsung860 EVO SSD, E a WD HDD.

## Result

- Moved156 directories /136,217 files /97,202,061,065 logical bytes into
  `E:\BACKUP-TRADINGWORKSPACE\workspace`, preserving workspace-relative paths.
- D free space increased from33,178,546,176 to120,072,949,760 bytes: measured
  increase86,894,403,584 bytes. Logical file sizes and allocated space freed are
  reported separately; this is not a claim that97.2GB of allocation was freed.
- Each old directory is an NTFS junction to its new location. Existing consumers
  keep their paths; writes through these junctions go to E. No global TEMP/env,
  service configuration or source repository root was relocated.
- Scope: API backup tree, historical Rust target directories and API builds,
  `.tmp`/`tmp`, selected tool caches, isolated QA/build output and small historical
  backups across the workspace. Incomplete historical backup bundles were retained
  unchanged; relocation does not promote them into valid backups.
- Kept active API/rollback binaries, live artifact/data roots, PostgreSQL, MT5,
  QDM, Python/engine installations and current Rust `debug/release` on SSD.
  Media outputs/models and dependency caches tied to installations were retained.

## Verification and future behavior

- SHA256/path/size comparison of source, destination and staged source completed
  before removing originals. All156 junction targets and absence of staged source
  duplicates verified after completion.
- Archived AI build's nested `node_modules` junction was recorded, detached without
  deleting dependencies, then restored to its original live dependency target.
- Existing backup verifier accepted the relocated AI bundle snapshot
  `20261023T081022Z-cf91d0b8332a`:4143 entries including the PostgreSQL dump.
- Actual write through the old backup directory reached E; the default next-backup
  output resolved to E. `backup_api_platform.py` now confines new output below the
  resolved dedicated backup root, retaining artifact-overlap, existing-directory,
  quiescence and budget guards. Child junction escapes and arbitrary output reject.
- Focused validation: `tests/test_api_platform_backup.py` and
  `tests/test_artifact_storage_architecture.py`:20 passed,1 skipped (Windows symbolic
  link privilege). Junction-specific coverage passed.
- Final native API binary and served UI index hashes match the deployment receipt;
  API8010 readiness and5180 gateway catalog pass. No inference/login/order commands
  were sent. Small during-copy readiness sample median4.45ms (5 requests), not an
  inference-throughput or whole-product benchmark.

Detailed inventories, allowlists, SHA256 manifests, copy logs, completed records,
summary and verification scripts: `E:\BACKUP-TRADINGWORKSPACE\relocation-20261023`.
Operational explanation: `E:\BACKUP-TRADINGWORKSPACE\README.md`.

To reverse a relocation, stop that directory's consumers, copy E data to a new
directory on D, verify it, and replace only the junction with the checked directory.
Keep E available while links remain in use. Do not recursively delete through a
junction. This receipt covers local storage relocation, not Product Plan completion.
