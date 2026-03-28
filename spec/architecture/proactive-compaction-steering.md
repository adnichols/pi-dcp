---
date: 2026-03-28
author: pi
original_plan: thoughts/plans/proactive-compaction-steering.md
status: graduated
---

# Proactive Compaction Steering

**Last Updated:** 2026-03-28  
**Status:** ✅ Implemented and verified

## Overview

This feature strengthens `pi-dcp`'s compaction steering so the agent is more likely to compact older raw history when it has become summary-safe, even if ordinary prune/redact savings are small.

The implementation stays Pi-native and recommendation-driven:
- automatic prune/redact behavior is unchanged
- explicit compaction still flows through `dcp_pressure` and `dcp_compact`
- the new logic adds a conservative `closed-workstream` signal for **new-user-turn branch shifts**
- hard context pressure still wins when context is genuinely urgent

This is inspired by OpenCode's compression steering philosophy, but it does **not** add OpenCode-style message/range compression, placeholder blocks, or extension-managed history rewriting.

## Database Schema

Not applicable.

## API / Runtime Contracts

### Recommendation model

The shared recommendation enum is now:
- `wait`
- `compact-before-next-branch`
- `compact-now`

The shared structured opportunity classification is now:
- `none`
- `closed-workstream`
- `hard-pressure`

### Tool semantics

- `dcp_pressure`
  - reports the current recommendation plus structured opportunity details
  - distinguishes branch-shift compaction from urgent hard-pressure compaction
- `dcp_compact`
  - compacts by default for both non-`wait` recommendations
  - still skips on `wait` unless `force: true`
  - automatically preserves the latest user request in branch-shift compaction instructions

### Nudge semantics

`before_agent_start` now has two compaction-aware severity paths:
- **branch-shift** — compact before starting the next heavy branch
- **critical-context** — compact now before normal exploration continues

`config.nudge.enabled` remains the master toggle.

## Data Flow

1. `src/context-pressure.js` filters session messages to exclude prior `dcp_pressure` / `dcp_compact` self-traffic.
2. The same helper computes both ordinary prune/redact pressure and branch-shift signals.
3. Branch-shift detection uses the filtered message list and a user-anchored turn model.
4. The helper computes previous-turn size, tool-result volume, estimated token load, unresolved-error state, continuation suppression, and shallow-probe grace-window state.
5. A shared recommendation is produced with precedence:
   - `hard-pressure` → `compact-now`
   - else `closed-workstream` → `compact-before-next-branch`
   - else `wait`
6. `dcp_pressure`, `dcp_compact`, and `before_agent_start` all render from the same shared recommendation state.

## Behaviors

- `pi-dcp` can now recommend compaction even when ordinary prune/redact savings are modest, if the prior turn looks substantial and closed.
- Closed-workstream steering is intentionally narrow in this pass:
  - only **new-user-turn branch shifts** are recognized
  - arbitrary intra-turn topic changes are out of scope
- Branch-shift recommendations survive shallow probing in the early part of the new turn.
- Branch-shift recommendations are suppressed for obvious same-workstream continuations like `continue`, `retry`, `fix ...`, `same file`, or `failing test` phrasing.
- Closed-workstream compaction is suppressed when the previous turn still contains unresolved errors.
- Hard-pressure recommendations still win over closed-workstream recommendations.
- Long-session nudges now coach the agent to keep active work raw and compact stale closed work.

## Constraints

- Thresholds for branch-shift detection are intentionally **hard-coded** in this pass and are not user-configurable yet.
- Automatic prune/redact rules are unchanged; this is a steering layer on top.
- The feature relies on Pi-native compaction via `ctx.compact()`, not custom session rewriting.
- Intra-turn branch-change detection and semantic topic modeling remain out of scope.

## Configuration Notes

No new dedicated config block was added.

Relevant behavior:
- `config.nudge.enabled` controls whether any nudge is injected
- older churn thresholds still govern generic `wait`-state nudges
- branch-shift and critical-context compaction nudges bypass those older churn thresholds because they are driven by shared recommendation state

## Safety

- Prior `dcp_pressure` / `dcp_compact` traffic is excluded from recommendation-oriented pressure analysis.
- Branch-shift compaction preserves the latest user request automatically so the current branch goal stays explicit during compaction.
- Previous-turn unresolved errors suppress closed-workstream compaction.
- Existing explicit-compaction guardrails remain in place, including in-flight suppression and failure recovery.

## Testing

Verified by:
- `tests/context-pressure.test.ts`
- `tests/dcp-pressure-tool.test.ts`
- `tests/dcp-compact-tool.test.ts`
- `tests/explicit-compaction-nudge.test.ts`
- full verification with `bun test`, `bun x tsc -p tsconfig.json --noEmit`, and `bun run build`

## Integration Points

Primary implementation files:
- `src/context-pressure.js`
- `src/context-pressure.d.ts`
- `src/context-pressure-rendering.js`
- `src/context-pressure-rendering.d.ts`
- `src/tools/dcp-pressure.js`
- `src/tools/dcp-compact.js`
- `src/events/beforeAgentStart.js`

## Implementation Notes

### Verified match with plan

The planned steering upgrade landed as intended:
- shared branch-shift and hard-pressure recommendation logic
- new `compact-before-next-branch` mode
- branch-shift-aware `dcp_pressure` and `dcp_compact`
- automatic preservation of the latest user request during branch-shift compaction
- severity-specific nudges with shared wording/rendering
- explicit docs describing the difference between automatic prune/redact and explicit compaction

### Important design choices preserved

- `opportunityKind` is compaction-specific only; ordinary cleanup pressure still lives in the prune/redact prediction fields.
- Branch-shift metrics are computed from the filtered post-self-traffic message list.
- Per-turn token estimates use `estimateMessageTokens()`.
- Hard-pressure takes precedence over closed-workstream opportunities.
- Branch-shift support is intentionally limited to new-user-turn boundaries in v1.

## Related

- Original plan: `thoughts/plans/proactive-compaction-steering.md`
- Explicit compaction tools: `spec/architecture/explicit-context-compaction-tools.md`
- Broader pruning architecture: `spec/architecture/opencode-pruning-improvements.md`
