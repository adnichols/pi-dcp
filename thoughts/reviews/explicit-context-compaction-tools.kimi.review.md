# Kimi K2.5 Review

## Critical Success Factors (from specs)

1. **Correct pi-native integration**: `dcp_pressure` and `dcp_compact` tools must properly integrate with `ctx.compact()` and `ctx.getContextUsage()` to provide real context inspection and trigger actual compaction.

2. **No self-referential pressure loop**: The tools must not count their own tool calls/results in pressure calculations, which would create a feedback loop.

3. **Actionable nudge integration**: Long-session nudges must evolve from passive warnings to explicit instructions that reference the new tools.

## Tasklist Audit against Success Factors

| Success Factor | Phase Coverage | Status |
|----------------|---------------|--------|
| **Correct pi-native integration** | P1 (validation), P2 (pressure tool), P3 (compact tool) | ✓ Covered by 3+ phases |
| **No self-referential pressure loop** | P1 (helper exclusion logic), P2 (tool ignores self-traffic), P4 (regression tests) | ✓ Covered by 3 phases |
| **Actionable nudge integration** | P4 (nudge wording updates, docs) | ⚠️ Only 1 phase - needs stronger coverage |

## Proposed Inline Comments

- Anchor: top of plan
  - `[REVIEW:Kimi K2.5] GAP: The plan does not include a rollback/disabling mechanism. If the new tools cause issues in production, there should be a way to disable them (e.g., via config or feature flag) without a full redeploy. [/REVIEW]`
- Anchor: `## Goal`
  - `[REVIEW:Kimi K2.5] COMMENT: The goal clearly identifies the usability gap. However, it would be stronger with a brief metric or example of how often agents currently ignore nudges due to lack of action surface. [/REVIEW]`
- Anchor: `## Acceptance criteria`
  - `[REVIEW:Kimi K2.5] INCORRECT: Duplicate bullet points. The "Tool outputs clearly distinguish" list appears twice in the acceptance criteria section. Remove the duplicate. [/REVIEW]`
- Anchor: implementation decision for conservative behavior
  - `[REVIEW:Kimi K2.5] AMBIGUITY: "Low pressure" is not defined. What are the specific thresholds? This needs to be defined in P1 or the recommendation logic will be inconsistent. Suggest: document minimum context usage % or token count that triggers the conservative behavior. [/REVIEW]`
- Anchor: implementation decision for per-session guard/cooldown
  - `[REVIEW:Kimi K2.5] RISK: The guard mechanism assumes per-session state persistence across turns. The plan should verify that pi extensions have reliable per-session state storage, or document the fallback if state is lost between turns. [/REVIEW]`
- Anchor: implementation decision for async completion surfacing
  - `[REVIEW:Kimi K2.5] GAP: The plan mentions UI notification for completion but does not specify what notification mechanism to use. Is this `pi.notify()`? `console.log`? Extension UI? This needs to be explicit in P3 work items. [/REVIEW]`
- Anchor: `## Phase 1 (P1)` → `### Tests first`
  - `[REVIEW:Kimi K2.5] GAP: Missing test for the specific threshold that defines "low" vs "high" pressure. Without this, the "conservative behavior" decision cannot be validated. [/REVIEW]`
- Anchor: `## Phase 1 (P1)` → `### Work`
  - `[REVIEW:Kimi K2.5] RISK: The exclusion logic needs to be robust against tool name changes. Consider adding a constant/enum for tool names rather than hardcoding strings in the exclusion logic. [/REVIEW]`
- Anchor: `## Phase 2 (P2)` → `### Tests first`
  - `[REVIEW:Kimi K2.5] GAP: The plan mentions schema in tests but "Implementation decisions" says "Do not try to let the agent specify raw message IDs or compression ranges in v1". The test should verify that the schema does NOT include these excluded parameters to prevent scope creep. [/REVIEW]`
- Anchor: `## Phase 3 (P3)` → `### Tests first`
  - `[REVIEW:Kimi K2.5] GAP: Missing test for the scenario where compaction is in-flight but the agent calls `dcp_pressure`. The pressure tool should still work (read-only) even when compaction is ongoing. [/REVIEW]`
- Anchor: `## Phase 3 (P3)` → `### Work`
  - `[REVIEW:Kimi K2.5] RISK: The `onComplete` and `onError` callbacks may not fire if the extension is unloaded/reloaded during compaction. Need to document expected behavior or add a recovery mechanism. [/REVIEW]`
- Anchor: `## Phase 4 (P4)` → `### Tests first`
  - `[REVIEW:Kimi K2.5] SCOPE DRIFT RISK: The nudge updates are only covered in P4, but nudges are a primary trigger for the tools. If P4 is delayed or skipped, the tools may exist but agents won't know to use them. Consider adding a partial nudge update in P2/P3 that at least mentions `dcp_pressure`. [/REVIEW]`
- Anchor: `## Phase 4 (P4)` → `### Work`
  - `[REVIEW:Kimi K2.5] AMBIGUITY: "If context remains pressured" is vague. The nudge should have concrete criteria (e.g., "If you've received this message 3+ times" or "If context usage > 80%"). [/REVIEW]`
- Anchor: `## Decisions / Deviations Log`
  - `[REVIEW:Kimi K2.5] COMMENT: All decisions are dated the same day (2026-03-28), which appears to be the plan creation date. If these decisions were made during plan development, consider staggering dates to show decision evolution, or add a note that these were all made during initial planning. [/REVIEW]`

## Summary

### Plan Status: Proceed with caution

The plan is structurally sound and addresses the core goal of adding explicit context compaction tools. The phased approach is logical and the decision to use pi-native `ctx.compact()` rather than porting OpenCode's full compression system is appropriately scoped.

### Critical Issues

1. Duplicate bullet points in Acceptance Criteria section need removal
2. Ambiguous “conservative behavior” thresholds need concrete definition in P1
3. UI notification mechanism for compaction completion is unspecified

### Recommendation

Proceed after addressing the critical issues, especially threshold definitions, notification details, and stronger rollout/disable considerations.
