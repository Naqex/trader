# Contributing

Use a short-lived `codex/<task>` branch and a focused pull request. Keep related
changes in coherent Conventional Commits. Review the diff before committing;
never include personal runtime, credentials, downloaded vendor libraries or
unrelated working changes.

Build/test commands are in [README](README.md). PR checks use disposable fixtures,
never a developer's broker account or database. Add regression coverage for
meaningful behavior changes. Do not regenerate financial or visual goldens just
to make a failure pass.

Keep persisted IDs, migration checksums, storage keys, `TW_V2_*` configuration
and API contracts stable unless an explicit migration is part of the change.
Product display names and repository paths are not storage identities.

For versions, packaging and release PRs use [release policy](docs/releases.md).
