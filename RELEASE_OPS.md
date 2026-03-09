# RELEASE_OPS.md

## Branching policy

- `main`: active development
- `release`: pinned known-good branch for store uploads

## Promotion flow

1. Ensure release candidate commit on `main` passed CI + smoke.
2. Fast-forward `release` to the approved commit:
   ```bash
   git checkout release || git checkout -b release
   git merge --ff-only <approved_commit_sha>
   git push origin release
   ```
3. Upload artifact built from `release` run.

## Required gate

- `RELEASE_GATE.md` checklist must be fully checked.
- No upload from unreviewed `main` commits.

## Tagging convention

Tag every shipped build:

- format: `v<versionName>+code<versionCode>`
- examples:
  - `v1.8+code9`
  - `v1.7+code8`

Commands:
```bash
git tag -a v1.8+code9 -m "Staking with Solana Mobile release v1.8 (code 9)"
git push origin v1.8+code9
```

## Rollback

If a release fails production checks:

1. Keep store upload paused.
2. Re-point `release` to last known-good tag:
   ```bash
   git checkout release
   git reset --hard v1.7+code8
   git push --force-with-lease origin release
   ```
3. Trigger release workflow from `release`.
