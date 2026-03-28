---
date: 2026-03-28
author: pi
original_plan: thoughts/plans/adopt-opencode-pruning-improvements.md
status: graduated
---

# OpenCode-Inspired Pruning Improvements

**Last Updated:** 2026-03-28  
**Status:** ✅ Implemented and verified

## Overview

This feature upgraded `pi-dcp` from a delete-only pruning pass into a more conservative, observable pruning pipeline inspired by lower-complexity ideas from `opencode-dynamic-context-pruning`.

The implemented system adds:
- protected tools and protected file patterns
- age-gated destructive cleanup based on completed later user turns
- in-place redaction for supported stale payloads
- normalized exact-signature matching for repeated `read` / `bash` operations, with shared path-based identity for `write` / `edit`
- token-aware visibility through `/dcp-stats`, `/dcp-context`, and status updates

It explicitly does **not** implement OpenCode's full message/range compression architecture.

## Database Schema

Not applicable. `pi-dcp` is a Pi extension and does not introduce a database schema.

## Runtime Contracts

### Commands

- `/dcp-stats` — shows lifetime/session prune-redact counts plus estimated token savings
- `/dcp-context` — shows current role/token breakdown and tool-result payload pressure

### Configuration

Verified runtime config surface:
- `keepRecentCount: number`
- `protectedTools: string[]`
- `protectedFilePatterns: string[]`
- `ageGates: { supersededToolResults, errorPurging, supersededWrites, staleFileReads }`
- `redaction: { supersededToolResults, resolvedErrors, staleFileReads }`

### Rule/Workflow Surface

The pruning workflow now supports three action states on message metadata:
- `keep`
- `prune`
- `redact`

Redaction preserves provider-relevant tool identity while replacing bulky payload text with compact placeholders.

## Data Flow

1. `context` hook receives the current message list.
2. `prepare` phase annotates message metadata (tool identity, file paths, error state, operation signatures, protections).
3. `process` phase rules choose `keep`, `prune`, or `redact`.
4. mutation stage rewrites redacted messages in place.
5. `tool-pairing` enforces provider-safe tool call/result integrity.
6. `recency` clears ordinary prune/redact actions for the most recent retained messages.
7. filter stage removes only messages still marked for pruning.
8. stats and UI status are updated with message-count and estimated-token impact.

## Behaviors

- Protected tools and matching protected file paths block ordinary prune/redact decisions.
- Destructive cleanup is age-gated using completed later user turns, so a trailing live user prompt does not age older context by itself.
- Older repeated successful `read` / `bash` tool results can be pruned or redacted depending on config.
- Resolved error payloads can be pruned or redacted depending on config.
- Repeated-operation matching uses normalized exact argument signatures for `read` and `bash` and shared path-based signatures for `write` / `edit`.
- `/dcp-stats` and `/dcp-context` expose rough token-cost and savings information rather than only message counts.
- Recency protection treats redaction as destructive, but does not override provider-safety deletions from `tool-pairing`.

## Constraints

- This feature remains an **automatic pruning/redaction** system, not a general compression or history-rewrite mechanism.
- Token accounting is approximate and uses lightweight estimation rather than a tokenizer dependency.
- Exact-signature cleanup is conservative by design and intentionally starts with `read` / `bash` only.
- Provider-safe tool pairing takes precedence over ordinary retention preferences.

## Configuration Notes

Defaults verified in implementation:
- `protectedTools` / `protectedFilePatterns`: empty arrays
- all age gates: `0`
- all redaction toggles: `false`
- `keepRecentCount`: `10`

## Security / Safety

- `tool-pairing` remains the provider-safety backstop and can still delete orphaned invalid tool results.
- Redaction preserves `toolCallId` / `toolName` and the structural message shell needed for replay safety.
- Recency only protects valid retained messages; it does not override provider-safety cleanup.

## Testing

Verified by the current regression suite, especially:
- `tests/protection-config.test.ts`
- `tests/redaction-workflow.test.ts`
- `tests/repeated-operation-signatures.test.ts`
- `tests/stats-context.test.ts`
- `tests/long-session-pressure.test.ts`
- `tests/fix-verification.test.ts`

## Integration Points

Core implementation files:
- `src/config.js`
- `src/types.d.ts`
- `src/metadata.js`
- `src/workflow.js`
- `src/token-estimation.js`
- `src/analysis.js`
- `src/events/context.js`
- `src/cmds/stats.js`
- `src/cmds/context.js`
- `src/rules/superseded-tool-results.js`
- `src/rules/error-purging.js`
- `src/rules/superseded-writes.js`
- `src/rules/recency.js`
- `src/rules/tool-pairing.js`

## Implementation Notes

### Verified match with plan

The core plan landed as intended: safer pruning controls, age gating, additive redaction, exact-signature matching, token-aware visibility, and regression hardening all exist in the current codebase.

### Verified divergence from the original plan

The implementation added **opt-in stale file read invalidation** beyond the original plan scope:
- `staleFileReads` was added to both `ageGates` and `redaction`
- `src/rules/stale-file-reads.js` adds stale-read pruning/redaction after later successful `write` / `edit`

This is a compatible extension of the same pruning architecture and is now part of the documented implementation state.

### Out-of-scope items still not implemented by this feature

The verified codebase still does **not** implement OpenCode's:
- full `compress` tool architecture
- message/range compression state machines
- persisted summary-block placeholder workflow
- prompt-managed compression override system

## Related

- Original plan: `thoughts/plans/adopt-opencode-pruning-improvements.md`
- Configuration docs: `docs/CONFIGURATION.md`
- User-facing overview: `README.md`
