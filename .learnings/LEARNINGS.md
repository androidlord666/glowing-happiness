# Learnings

## [LRN-20260303-001] best_practice

**Logged**: 2026-03-03T20:25:00Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
Separate app logic from platform scaffolding early to avoid build blockers.

### Details
The project started as app-only TypeScript files, then needed a full React Native Android/iOS scaffold for APK delivery. A full scaffold was added later under `StakeNBakeMobile/` and the app logic migrated.

### Suggested Action
Use the mobile scaffold as canonical app root (`StakeNBakeMobile/`) and keep all future app work there.

### Metadata
- Source: conversation
- Related Files: StakeNBakeMobile/, README.md
- Tags: react-native, mobile, build

---

## [LRN-20260303-002] harden_security

**Logged**: 2026-03-03T20:25:00Z
**Priority**: critical
**Status**: pending
**Area**: config

### Summary
Tokens pasted in chat should be treated as compromised and rotated immediately.

### Details
Discord bot token and GitHub PAT were shared in chat for setup speed. This is functional but high-risk.

### Suggested Action
Adopt short-lived/fine-scoped credentials and rotate immediately after setup/deploy.

### Metadata
- Source: conversation
- Related Files: README.md
- Tags: security, tokens, operational

---
