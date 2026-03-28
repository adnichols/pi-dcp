# Opus 4.6 Review

## Proposed Inline Comments

- Anchor: `## Acceptance criteria`
  - `[REVIEW:Opus 4.6] INCORRECT: The acceptance criteria duplicate the nested bullet list under “Tool outputs clearly distinguish”. Remove the duplicate list to avoid ambiguity about what exactly must be verified. [/REVIEW]`
- Anchor: top of plan / `## Repo reality validated`
  - `[REVIEW:Opus 4.6] GAP: The plan assumes `ctx.compact()` can be safely triggered from inside a tool `execute()` handler, but the validated repo reality only shows `ctx.compact()` used from commands and turn/event handlers. Add an explicit Phase 1 integration spike that proves tool-initiated compaction is safe with pi's turn lifecycle and tool-result delivery. Treat failure of that spike as a blocker that changes the entire design. [/REVIEW]`
- Anchor: `## Implementation decisions locked for execution`
  - `[REVIEW:Opus 4.6] AMBIGUITY: The recommendation logic is described as “heuristic” but the thresholds are not locked. This leaves a material product decision to implementation time. Add explicit numeric/default thresholds (or a locked config shape for them) so execution does not invent compaction policy mid-flight. [/REVIEW]`
- Anchor: implementation decision for cooldown
  - `[REVIEW:Opus 4.6] AMBIGUITY: “enough new messages accrue” is not concrete enough for the cooldown guard. Lock a specific threshold (for example N new messages or a new user turn) so tests and implementation align. [/REVIEW]`
- Anchor: `Recommended tool behavior` → `dcp_pressure`
  - `[REVIEW:Opus 4.6] GAP: The recommendation value `clean up manually first` is not actionable because the plan does not define what manual cleanup options the agent actually has besides these new tools. Either remove that recommendation mode or define the exact intended agent action. [/REVIEW]`
- Anchor: `## Phase 1 (P1)` → `### Tests first`
  - `[REVIEW:Opus 4.6] GAP: Add a failing test for the critical architecture spike: calling `ctx.compact()` from inside a registered tool must either be proven to work safely or return a documented fallback path. Without this, the highest-risk design assumption is not validated first. [/REVIEW]`
- Anchor: `## Phase 1 (P1)` → `### Work`
  - `[REVIEW:Opus 4.6] GAP: The plan should explicitly mention how messages are extracted from `ctx.sessionManager.getEntries()` / `getBranch()` into the `AgentMessage[]` shape expected by `analysis.js` and `workflow.js`. This is a subtle but important integration seam. [/REVIEW]`
- Anchor: `## Phase 2 (P2)` → `### Expected files`
  - `[REVIEW:Opus 4.6] GAP: If these tools use parameter schemas via `Type.Object(...)`, the plan should either lock the import source (`@sinclair/typebox` or another supported package) or add a dependency-evaluation note. Right now the build-vs-buy/dependency decision is implicit. [/REVIEW]`
- Anchor: `## Phase 3 (P3)` → `### Work`
  - `[REVIEW:Opus 4.6] RISK: The compaction guard state is under-specified for extension reload/restart behavior. If the extension reloads mid-compaction, `inFlight` resets and the agent could immediately retrigger compaction. Document whether that is acceptable or add a lightweight persisted marker. [/REVIEW]`
- Anchor: `## Phase 3 (P3)` → `### Work`
  - `[REVIEW:Opus 4.6] RISK: The plan relies on `onComplete` / `onError` callbacks for lifecycle feedback, but does not state whether follow-up UI notification is sufficient if the tool result itself may have been generated on pre-compaction context. Clarify what user/agent-visible success looks like after compaction completes. [/REVIEW]`
- Anchor: `## Phase 4 (P4)` → `### Work`
  - `[REVIEW:Opus 4.6] RISK: Nudge text and tool `promptGuidelines` may drift if they separately describe when to compact. Explicitly state that both should consume the shared recommendation helper to avoid contradictory guidance over time. [/REVIEW]`
- Anchor: `## Risks and mitigations`
  - `[REVIEW:Opus 4.6] GAP: Add a risk that post-compaction pressure analysis may become harder to reason about because pi compaction replaces older history with a summary, changing what `pi-dcp` can observe. The plan should document whether recommendation quality after a compaction is acceptable or needs dedicated handling. [/REVIEW]`

## Summary

### Plan status
Needs targeted revision before execution — fundamentally sound but has one critical blocker and several gaps that would force implementer decisions mid-flight.

### Critical blocker
1. `ctx.compact()` from inside a tool `execute()` handler is unvalidated. This is the central mechanism of the entire plan, yet the documented examples only show `ctx.compact()` called from commands and event handlers — never from within a tool's `execute()`. Phase 1 must include an explicit integration spike that proves this works before any other work begins.

### Other important issues
- thresholds for recommendations/cooldowns are not locked
- `clean up manually first` is not actionable
- schema dependency choice is implicit
- `ctx.sessionManager` message extraction seam is not called out
- post-compaction recommendation behavior is not documented

### Recommendation
Major revision needed on the critical blocker; proceed with caution on the rest. If the tool-triggered compaction spike fails, the design will need a different trigger mechanism.
