# Errors

## [ERR-20260303-001] gateway_restart_healthcheck

**Logged**: 2026-03-03T20:25:00Z
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
Gateway restart health check timed out despite service later reporting channel OK.

### Error
Timed out after 60s waiting for gateway port 18789 to become healthy.

### Context
During Discord channel configuration updates, restart command timed out intermittently.

### Suggested Fix
After restart timeout, run `openclaw status` as source of truth before reapplying config changes.

### Metadata
- Reproducible: unknown
- Related Files: none

---
