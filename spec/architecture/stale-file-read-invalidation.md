---
date: 2026-03-28
author: pi
original_plan: thoughts/plans/stale-file-read-invalidation.md
status: graduated
---

# Stale File Read Invalidation

**Last Updated:** 2026-03-28  
**Status:** ✅ Implemented and verified

## Overview

This feature adds a conservative, opt-in pruning rule that invalidates an earlier successful `read` result after a later successful `write` or `edit` to the same normalized file path.

The implementation is intentionally narrow:
- only top-level successful `toolResult` messages
- only earlier `read` results
- only later successful `write` / `edit` results
- only same normalized lexical file path
- no shell inference, dependency graph traversal, or transitive invalidation

## Database Schema

Not applicable.

## API / Runtime Contracts

### Rule

- Rule name: `stale-file-reads`
- Registration: built into the extension and available by name
- Default rollout: **registered but not enabled in `DEFAULT_CONFIG.rules`**

### Configuration

Verified config surface:
- `ageGates.staleFileReads`
- `redaction.staleFileReads`

The rule also respects existing shared protections:
- `keepRecentCount`
- `protectedTools`
- `protectedFilePatterns`

## Data Flow

1. `prepare` identifies successful `read` tool results and records normalized `filePath` metadata.
2. `process` scans later messages for the first successful `write` or `edit` to the same normalized path.
3. shared destructive-action guards enforce protection and age-gate checks.
4. if allowed, the stale read is either:
   - pruned by default, or
   - redacted when `redaction.staleFileReads` is enabled
5. `tool-pairing` and `recency` continue to run after the rule.

## Behaviors

- A prior successful `read(path)` is invalidated by a later successful `write(path)` or `edit(path)` to the same normalized file path.
- Matching uses normalized file path only; `read` `offset` / `limit` do not prevent invalidation.
- Failed writes/edits do not invalidate earlier reads.
- Reads of other files are unaffected.
- `protectedTools: ["read"]` blocks invalidation of stale reads.
- Protecting `write` / `edit` alone does not block invalidation, because the destructive action applies to the earlier `read` message.
- `keepRecentCount` can clear stale-read prune/redact actions for recent retained messages.
- Optional redaction preserves the tool-result shell while replacing stale file contents with a placeholder.

## Constraints

- Path normalization is lexical only: slash normalization plus `.` / `..` collapse.
- There is no cwd-based resolution, symlink canonicalization, shell-path inference, or content-level mutation analysis.
- The rule stays separate from repeated-operation exact-signature dedupe.
- Because rollout is guarded, users only get this behavior when they explicitly add `"stale-file-reads"` to their configured rule list.

## Configuration Notes

Verified defaults:
- `ageGates.staleFileReads = 0`
- `redaction.staleFileReads = false`
- `stale-file-reads` is not in `DEFAULT_CONFIG.rules`

## Safety

- The rule only targets top-level `toolResult` messages.
- Shared `getDestructiveActionGuard()` protection logic applies before any prune/redact decision.
- `tool-pairing` remains the provider-safety backstop.
- `recency` can clear ordinary stale-read prune/redact actions for recent retained messages.

## Testing

Verified by:
- `tests/stale-file-reads.test.ts`
- `tests/protection-config.test.ts`
- `tests/redaction-workflow.test.ts`
- `tests/repeated-operation-signatures.test.ts`
- `tests/fix-verification.test.ts`

## Integration Points

Primary implementation files:
- `src/rules/stale-file-reads.js`
- `src/metadata.js`
- `src/config.js`
- `src/types.d.ts`
- `src/workflow.js`
- `index.ts`

## Implementation Notes

### Verified match with plan

The implemented rule matches the planned conservative scope and guarded rollout:
- dedicated `stale-file-reads` rule
- path-only invalidation
- opt-in default rollout
- dedicated `ageGates.staleFileReads` and `redaction.staleFileReads`
- protection and recency behavior delegated to shared existing infrastructure

### Notable interactions

`stale-file-reads` runs after repeated exact-signature cleanup and before `tool-pairing`, which keeps exact-duplicate read behavior separate from mutation-based invalidation.

## Related

- Original plan: `thoughts/plans/stale-file-read-invalidation.md`
- Broader pruning architecture: `spec/architecture/opencode-pruning-improvements.md`
