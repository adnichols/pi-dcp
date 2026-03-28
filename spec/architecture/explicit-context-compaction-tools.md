---
date: 2026-03-28
author: pi
original_plan: thoughts/plans/explicit-context-compaction-tools.md
status: graduated
---

# Explicit Context Compaction Tools

**Last Updated:** 2026-03-28  
**Status:** ✅ Implemented and verified

## Overview

This feature adds model-callable tools that let the agent inspect context pressure and trigger Pi's native session compaction explicitly.

It closes the earlier gap where `pi-dcp` could only warn via long-session nudges but could not offer an action surface to inspect pressure or compact the session.

The implementation is explicitly Pi-native:
- `dcp_pressure` inspects pressure and predicted ordinary `pi-dcp` savings
- `dcp_compact` triggers `ctx.compact()`
- nudges now reference the tool workflow directly

It does **not** implement OpenCode-style message/range compression state machines.

## Database Schema

Not applicable.

## API / Runtime Contracts

### Model-callable tools

- `dcp_pressure`
  - zero-argument pressure inspection tool
  - uses a plain JSON-schema empty object for parameters
- `dcp_compact`
  - parameters:
    - `focus?: string`
    - `force?: boolean`

### Tool result semantics

`dcp_compact` immediate results are intentionally asynchronous and return one of:
- `started`
- `skipped`
- `already-in-flight`
- `failed`

The tool does not claim synchronous completion from the immediate tool result.

## Data Flow

1. `dcp_pressure` and `dcp_compact` pull current branch/session messages from `ctx.sessionManager`.
2. `src/context-pressure.js` converts entries to message arrays, excludes self-traffic from `dcp_pressure` / `dcp_compact`, analyzes pressure, and runs ordinary pruning prediction through `applyPruningWorkflowDetailed()`.
3. `dcp_pressure` returns a concise summary plus a structured snapshot in `details`.
4. `dcp_compact` evaluates the same shared recommendation snapshot.
5. If allowed, `dcp_compact` starts Pi-native compaction with `ctx.compact({ customInstructions, onComplete, onError })`.
6. Lightweight in-memory state tracks whether an explicit compaction is in flight.
7. `before_agent_start` nudges reuse the same shared recommendation logic and point the agent at `dcp_pressure` / `dcp_compact`.

## Behaviors

- The agent can inspect context pressure with `dcp_pressure`.
- The agent can trigger real session compaction with `dcp_compact`.
- Recommendation logic ignores prior `dcp_pressure` / `dcp_compact` traffic so the tools do not inflate their own pressure signal.
- Shared thresholds currently recommend `compact-now` at roughly:
  - `>= 80%` context usage, or
  - repeated-inspection churn with `>= ~400` estimated tokens of ordinary DCP savings
- `dcp_compact` defaults to conservative behavior and skips compaction unless recommendation is `compact-now` or `force: true` is provided.
- `focus` text is turned into compaction `customInstructions`, but does not override recommendation by itself.
- Long-session nudges now include an actionable path telling the agent to call `dcp_pressure` and `dcp_compact`.

## Constraints

- Explicit compaction is separate from ordinary automatic prune/redact behavior.
- Compaction relies on Pi's native `ctx.compact()` behavior, not direct session-history rewriting by `pi-dcp`.
- Guard state is in-memory only and resets if the extension reloads.
- The implementation guards only against in-flight or stale-in-flight repeated requests; it does not impose a post-completion message-count cooldown.
- Guidance telling the agent to pause heavy exploration after compaction is advisory, not enforced.

## Configuration Notes

These tools do not add a dedicated new config block in v1. They reuse existing pruning configuration and shared recommendation heuristics.

The nudge system uses existing `config.nudge` settings while sharing recommendation logic from `src/context-pressure.js`.

## Safety

- `dcp_compact` checks `typeof ctx.compact === "function"`.
- synchronous exceptions and rejected promise returns from `ctx.compact()` are handled and reset state safely.
- stale in-flight recovery resets the guard after a two-minute timeout.
- completion and error callbacks both clear `inFlight` state.

## Testing

Verified by:
- `tests/context-pressure.test.ts`
- `tests/dcp-pressure-tool.test.ts`
- `tests/dcp-compact-tool.test.ts`
- `tests/explicit-compaction-nudge.test.ts`

## Integration Points

Primary implementation files:
- `src/context-pressure.js`
- `src/compaction.js`
- `src/tools/dcp-pressure.js`
- `src/tools/dcp-compact.js`
- `src/events/beforeAgentStart.js`
- `index.ts`

## Implementation Notes

### Verified match with plan

The core planned workflow landed:
- two tools (`dcp_pressure`, `dcp_compact`)
- shared recommendation logic
- self-traffic exclusion
- Pi-native compaction via `ctx.compact()`
- actionable long-session nudges
- test coverage for registration, guard behavior, and nudge/tool consistency

### Verified divergence from plan

The final guard behavior is slightly narrower than the original plan text:
- the plan discussed suppressing repeats until compaction finishes **or enough new messages accrue**
- the implemented behavior uses an in-flight guard plus stale timeout recovery, but no post-completion message-count threshold

This is a minor implementation simplification and does not change the core user-facing tool workflow.

### Added hardening beyond the initial plan

Post-review hardening added:
- stale in-flight recovery
- branch-scoped session-entry preference for nudge/tool consistency
- synchronous `ctx.compact()` failure recovery
- rejected-promise handling when `ctx.compact()` returns a failing promise

## Related

- Original plan: `thoughts/plans/explicit-context-compaction-tools.md`
- Broader pruning architecture: `spec/architecture/opencode-pruning-improvements.md`
