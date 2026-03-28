# Plan: proactive compaction steering for closed workstreams

## Goal

Make `pi-dcp` better at steering the agent to compact older, no-longer-relevant conversation history — not just structurally stale tool payloads — so the model is more likely to prune/redact what it safely can and trigger Pi-native compaction when a prior workstream is effectively closed.

For this pass, “closed prior workstream” is intentionally narrowed to **new-user-turn branch shifts only**. It does not attempt to detect intra-turn branch changes under the same user request.

This plan is specifically about **stronger compaction instincts and better steering**, not about porting OpenCode's full compression architecture.

## Repo reality validated

- `pi-dcp` already has two distinct context-management mechanisms:
  - **automatic prune/redact** in `src/workflow.js` plus `src/rules/*`
  - **explicit Pi-native compaction** through `dcp_pressure` / `dcp_compact`
- Current automatic pruning is good at structurally stale context:
  - repeated `read` / `bash` results
  - stale file reads
  - resolved errors
  - superseded writes
- Current explicit compaction exists but is still mostly **agent-driven on demand**:
  - `src/tools/dcp-pressure.js`
  - `src/tools/dcp-compact.js`
  - shared recommendation helper in `src/context-pressure.js`
- Current nudge behavior in `src/events/beforeAgentStart.js` is helpful but still mostly **pressure/churn-oriented**:
  - context usage percent
  - repeated reads/bash
  - tool-result volume
  - predicted ordinary DCP savings
- The current recommendation model does **not** explicitly reason about:
  - "a prior workstream is now closed"
  - "a new user request started after a substantial prior branch"
  - "the old raw history is still unique but is probably summary-safe now"
- This means `pi-dcp` is good at deleting stale payload noise, but weaker at telling the agent:
  - "older history is no longer active; compact before starting the next branch"
- Existing helpers already provide the building blocks needed for a conservative first pass:
  - `src/context-pressure.js` centralizes recommendation logic
  - `src/tools/dcp-pressure.js` / `src/tools/dcp-compact.js` already return concise text plus structured `details`
  - `src/events/beforeAgentStart.js` already injects actionable nudges before agent work begins
- Pi already exposes the right primitive for this via `ctx.compact()`; the gap is now **recommendation quality + prompt steering**, not missing compaction capability.
- `pi-dcp` does not currently have `thoughts/specs/product_intent.md` or `thoughts/plans/AGENTS.md`, so this plan follows root `AGENTS.md` plus verified repo state.
- OpenCode DCP achieves stronger behavior through:
  - an always-on system stance around compression housekeeping
  - dedicated context-limit / turn / iteration nudges
  - a custom `compress` tool and range/message compression model
- That exact architecture is not portable to Pi without much more scope, but the **steering philosophy** is portable.

## Problem statement

Today `pi-dcp` mostly answers:
- "what obvious stale payloads can be pruned or redacted safely?"
- "is the context large or repetitive enough that compaction might be worthwhile?"

But the user need is stronger:
- when older context is no longer relevant to the current task, the model should have enough guidance to either:
  - let ordinary prune/redact rules clean up stale payloads, and/or
  - trigger compaction because older raw history is now summary-safe

In this plan, that broader need is addressed only through the safer proxy of **a substantial prior turn followed by a new user turn**.

The missing piece is **closed-workstream steering**:
- older history may still be unique, so rule-based pruning cannot remove it
- yet it may no longer need to remain raw in context
- in that case the correct action is usually **compaction**, not more passive waiting

## Scope

In scope:
- strengthen the shared recommendation helper so it can recognize branch-shift / closed-workstream compaction opportunities
- make `dcp_pressure` and `dcp_compact` speak in more actionable terms for those situations
- make long-session nudges more like an explicit context-management workflow and less like a passive warning
- keep the implementation Pi-native (`ctx.compact()`), not OpenCode-style range/message compression
- document the difference between:
  - rule-based stale payload cleanup
  - compaction of older, summary-safe history

Out of scope for this pass:
- OpenCode-style `compress` range/message parity
- message IDs / compressed blocks / placeholder expansion
- extension-managed history rewriting
- automatic background compaction with no explicit model choice
- semantic topic modeling or embedding-based thread detection

## Acceptance criteria

- `pi-dcp` can recommend compaction even when predicted ordinary prune/redact savings are small, if the session shows a **substantial prior turn + new-user-turn branch shift** signal.
- `dcp_pressure` clearly distinguishes the two compaction-relevant opportunity types:
  - closed-workstream compaction opportunity
  - urgent context-limit pressure
- `dcp_pressure` still reports predicted ordinary prune/redact savings separately, but cleanup-only signals do **not** become a first-class compaction opportunity enum in this plan.
- The shared pressure snapshot exposes a structured opportunity classification that tools and nudges can consume without string parsing.
- `dcp_compact` accepts the stronger non-`wait` recommendations without requiring `force` in those cases.
- Long-session nudges tell the agent when it should compact because a prior branch is likely summary-safe, not only when repeated tool churn is high.
- The agent gets stronger context-management guidance without changing existing automatic pruning semantics.
- Existing self-traffic exclusion for `dcp_pressure` / `dcp_compact` remains intact.
- Tests cover branch-shift / closed-workstream recommendation cases in addition to current churn/usage cases.

## Implementation decisions locked for execution

- **Keep Pi-native compaction.**
  - Continue to use `dcp_compact` + `ctx.compact()`, not a new `compress` tool.
- **Strengthen steering, not automation.**
  - The extension should steer the model harder toward compaction, but should not auto-call `ctx.compact()` itself in this pass.
- **Add branch-shift / closed-workstream signals to the shared pressure snapshot.**
  - All branch-shift metrics in this plan are computed from the **filtered message list** already used by `getContextPressureSnapshot()` after excluding `dcp_pressure` / `dcp_compact` self-traffic.
  - Recommended new signals:
    - `latestUserIndex`
    - `messagesSinceLatestUser`
    - `nonUserMessagesSinceLatestUser`
    - `successfulNonDcpToolResultsSinceLatestUser`
    - `previousTurnMessageCount`
    - `previousTurnToolResultCount`
    - `previousTurnEstimatedTokens`
    - `previousTurnUnresolvedErrorCount`
    - `hasClosedWorkstreamBoundary`
    - `opportunityKind: "none" | "closed-workstream" | "hard-pressure"`
  - `opportunityKind` is only for compaction opportunities; ordinary DCP cleanup pressure remains represented by the existing predicted prune/redact fields.
  - `previousTurnUnresolvedErrorCount` is defined from `applyPruningWorkflowDetailed(filteredMessages, config).withMetadata`: count messages in the immediately previous completed turn where `metadata.isError === true` and `metadata.errorResolved !== true`.
  - `previousTurnEstimatedTokens` is defined from the same filtered message list using `estimateMessageTokens()` from `src/token-estimation.js`, summed over the messages belonging to the immediately previous completed turn.
  - Latest-user text extraction for continuation suppression uses one shared helper over the filtered message list:
    - if `message.content` is a string, trim/lowercase that string
    - if `message.content` is an array, concatenate only `text` parts with newlines, then trim/lowercase
    - if no text content exists, treat the normalized latest-user text as the empty string
  - Precedence rule when multiple compaction signals coexist:
    - if hard-pressure criteria are met, `opportunityKind = "hard-pressure"` and `recommendation = "compact-now"`
    - else if closed-workstream criteria are met, `opportunityKind = "closed-workstream"` and `recommendation = "compact-before-next-branch"`
    - else `opportunityKind = "none"` and `recommendation = "wait"`
  - Rationale: the simplest portable proxy for “older context is now likely summary-safe” is that a **new user turn** arrived after a substantial prior turn/workstream, while still avoiding obvious “keep raw details handy” cases like unresolved errors.
- **Lock the first closed-workstream heuristic to turn boundaries, not semantic topic classification.**
  - Canonical turn model for this plan:
    - a turn starts at a `user` message
    - that turn includes all following non-user messages until the next `user` message
    - messages before the first `user` message do not count as a turn for closed-workstream detection
    - the “immediately previous completed turn” is the turn anchored at the second-most-recent `user` message, measured relative to the current turn anchor
  - The branch-shift boundary is anchored at the latest `user` message and **persists through the early part of the new turn** until meaningful new-branch work begins.
  - “Meaningful new-branch work begins” when either of these becomes true after the latest `user` message, excluding `dcp_pressure` / `dcp_compact` traffic:
    - `successfulNonDcpToolResultsSinceLatestUser >= 2`, or
    - `nonUserMessagesSinceLatestUser >= 6`
  - This intentionally leaves a shallow-probe grace window so the agent can call `dcp_pressure` and do a small amount of refinement work before `dcp_compact` stops honoring the branch-shift opportunity.
  - Add a conservative, non-semantic same-workstream safeguard so follow-ups do not trigger branch-shift compaction too easily:
    - suppress `closed-workstream` when the normalized latest-user text exactly matches one of:
      - `continue`
      - `keep going`
      - `go on`
      - `one more tweak`
      - `retry`
    - also suppress `closed-workstream` when the normalized latest-user text starts with one of:
      - `continue `
      - `keep going `
      - `go on `
      - `retry `
      - `fix `
      - `update `
      - `finish `
    - also suppress `closed-workstream` when the normalized latest-user text contains either:
      - `same file`
      - `failing test`
  - A workstream is considered “closed enough to recommend compaction” when all are true:
    1. there is a latest `user` message and a previous completed turn before it
    2. the boundary persistence window is still active
    3. the immediately previous turn has at least one of:
       - `previousTurnMessageCount >= 12`
       - `previousTurnToolResultCount >= 6`
       - `previousTurnEstimatedTokens >= 1200`
    4. the immediately previous turn has `previousTurnUnresolvedErrorCount === 0`
    5. the latest user text is not suppressed by the same-workstream safeguards above
    6. the session also has at least one of:
       - `totalMessages >= 40`
       - `toolResultCount >= 20`
       - `context usage >= 70%`
- **Refine the recommendation enum to remove the current dead-end wording.**
  - Replace/retire `clean-up-manually-first` in the shared recommendation path.
  - Locked recommendation modes for the new helper:
    - `wait`
    - `compact-before-next-branch`
    - `compact-now`
  - Semantics:
    - `compact-now`: immediate compaction strongly recommended
    - `compact-before-next-branch`: older history is likely summary-safe before starting the new branch
    - `wait`: no compaction recommendation
- **Keep existing hard-pressure thresholds, then layer closed-workstream logic on top.**
  - Retain current defaults:
    - `compactContextPercent: 80`
    - `meaningfulSavingsTokens: 400`
    - `repeatedOperationCount: 2`
  - Add closed-workstream thresholds as listed above.
  - These thresholds are intentionally **hard-coded and non-configurable in this pass**; Phase 4 docs must call that out explicitly.
- **`dcp_compact` should compact by default for both non-wait recommendations.**
  - If recommendation is `compact-now` or `compact-before-next-branch`, `force` is not required.
  - `focus` alone still does **not** override `wait`.
  - In branch-shift mode, `dcp_compact` must always preserve the current branch goal by including the latest user request in `customInstructions` automatically, even when the caller does not pass `focus`.
- **Adopt a stronger context-management stance in prompting, but keep it lightweight.**
  - Lock one shared renderer/source for recommendation wording and severity text so `dcp_pressure`, `dcp_compact`, and `before_agent_start` do not drift.
  - Do not import OpenCode's prompt files verbatim.
  - Do add concise guidance that says, in effect:
    - older closed work should become summary-only
    - prefer compaction before starting a new heavy branch when prior work is closed
    - keep active work raw; compact stale work
  - Apply this stance in two places:
    - `before_agent_start` nudge text
    - `promptGuidelines` / result phrasing for `dcp_pressure` and `dcp_compact`
- **Use two nudge severities in v1 of this steering upgrade.**
  - `branch-shift nudge`: “inspect/compact before starting the next branch”
  - `critical-context nudge`: “compact now before normal exploration continues”
  - Nudge gating contract:
    - `config.nudge.enabled` remains the master on/off switch
    - `critical-context` and `branch-shift` nudges bypass the older churn-oriented `minMessages` / `minToolResults` / `minRepeatCount` / `minContextPercent` thresholds because their eligibility is decided by the shared recommendation helper itself
    - when the shared recommendation is `wait`, existing generic churn/pressure nudges continue to use the current `config.nudge` gates
  - Do not add a separate iteration nudge yet, because current Pi integration already has a stable `before_agent_start` surface and this plan should not depend on unvalidated mid-turn prompt injection.
- **Automatic prune/redact rules remain unchanged.**
  - This plan is about compaction steering layered on top of the existing rule-based cleanup.

## Progress

- [x] P1 Phase 1: extend shared pressure snapshot with closed-workstream / branch-shift signals
- [x] P2 Phase 2: update `dcp_pressure` and `dcp_compact` recommendation semantics
- [x] P3 Phase 3: strengthen nudge/prompt steering for branch-shift and critical-context cases
- [x] P4 Phase 4: docs and regression hardening

## Resume Instructions (Agent)

- Continue working in this same plan file: `thoughts/plans/proactive-compaction-steering.md`.
- Do not change product code until execution mode is explicitly chosen; in plan mode, update only this plan file.
- Start with Phase 1 and lock the shared helper semantics before touching tool or nudge wording.
- When resuming after interruption:
  1. read this plan
  2. inspect `src/context-pressure.js`, `src/tools/dcp-pressure.js`, `src/tools/dcp-compact.js`, and `src/events/beforeAgentStart.js`
  3. verify whether any Phase 1 boundary/window semantics have already been implemented
  4. update `## Progress` checkboxes before and after each completed phase
- Do not stop at a phase boundary if the next phase is unblocked; continue until the plan is complete or a real blocker appears.
- Preserve locked choices in this plan, especially:
  - `opportunityKind` remains compaction-only
  - all branch-shift metrics are computed from filtered messages after DCP self-traffic exclusion
  - boundary persistence window stays defined by non-DCP tool results / non-user message count
  - the latest user request must be preserved automatically in branch-shift compaction instructions
  - branch-shift thresholds remain hard-coded in this pass unless the plan is explicitly revised

## Phase 1 (P1): extend shared pressure snapshot with closed-workstream / branch-shift signals

### End state

`src/context-pressure.js` can tell the difference between:
- ordinary repeated-payload churn
- hard context pressure
- a likely closed prior workstream before a new user branch

### Tests first

Add failing unit coverage proving that:
- a new user message after a substantial previous turn produces `hasClosedWorkstreamBoundary = true`
- small prior turns do not produce a closed-workstream recommendation
- low predicted prune/redact savings can still lead to `compact-before-next-branch` when the boundary signal is present
- the boundary signal persists through shallow new-turn probing, but disappears after meaningful new-branch work begins
- self-traffic exclusion still works with the new signals
- `wait` remains the result when neither pressure nor branch-shift criteria are met
- exact canned continuation messages such as `continue` do **not** trigger `closed-workstream`
- same-workstream follow-ups phrased differently also stay suppressed, e.g.:
  - `finish the refactor above`
  - `fix the failing test from that change`
  - `continue in the same file`
- threshold boundary tests cover all locked cutoffs and OR-combination logic:
  - `>=12` vs `11`
  - `>=6` vs `5`
  - `>=1200` vs `1199`
  - `>=40` vs `39`
  - `>=20` vs `19`
  - `>=70%` vs `69%`
- coexistence precedence is explicit: when closed-workstream and hard-pressure are both true, `hard-pressure` wins and the recommendation is `compact-now`

### Expected files

- `src/context-pressure.js`
- `src/context-pressure.d.ts`
- `tests/context-pressure.test.ts`
- optionally a new focused test file if the turn-boundary logic becomes clearer separately

### Work

- Add helpers to derive the canonical current-turn anchor and the immediately previous completed turn from the filtered message list using the locked user-message-bounded turn model above.
- Add one shared latest-user-text normalization helper for continuation suppression over string and multipart user content.
- Compute and expose branch-shift signals in the shared snapshot, including:
  - unresolved-error count from workflow metadata
  - per-turn estimated tokens via `estimateMessageTokens()`
  - boundary persistence window state
  - continuation suppression state
  - structured `opportunityKind`
- Update recommendation building to output:
  - `wait`
  - `compact-before-next-branch`
  - `compact-now`
- Keep recommendation logic centralized so tools and nudges stay aligned.

### Verify

- `bun test tests/context-pressure.test.ts`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 2 (P2): update `dcp_pressure` and `dcp_compact` recommendation semantics

### End state

The explicit context tools explain and honor the stronger recommendation model, especially the “compact before starting this new branch” case.

### Tests first

Add failing tests proving that:
- `dcp_pressure` text/details distinguish branch-shift compaction from urgent compact-now pressure
- `dcp_compact` compacts by default for `compact-before-next-branch`
- branch-shift compaction instructions automatically preserve the latest user request/current branch goal
- `dcp_compact` still skips on `wait` unless `force` is true
- `focus` does not override `wait` by itself
- existing in-flight / stale / failure guard behavior remains unchanged
- a shallow probe after `dcp_pressure` does not immediately erase a branch-shift recommendation before `dcp_compact` can act

### Expected files

- `src/tools/dcp-pressure.js`
- `src/tools/dcp-pressure.d.ts`
- `src/tools/dcp-compact.js`
- `src/tools/dcp-compact.d.ts`
- `tests/dcp-pressure-tool.test.ts`
- `tests/dcp-compact-tool.test.ts`

### Work

- Update `dcp_pressure` result phrasing to name the compaction opportunity type clearly and expose it in structured `details`.
- Update `dcp_compact` skip/compact decision logic to accept both non-`wait` recommendation modes.
- Ensure `dcp_compact` automatically folds the latest user request/current branch goal into `customInstructions` for branch-shift compaction.
- Refresh tool `promptGuidelines` so the model sees the stronger “compact closed work, keep active work raw” stance even without a nudge.
- Keep immediate tool results concise and explicitly asynchronous.
- Preserve current hardening:
  - self-traffic exclusion
  - stale in-flight recovery
  - synchronous failure handling
  - rejected-promise handling

### Verify

- `bun test tests/dcp-pressure-tool.test.ts tests/dcp-compact-tool.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 3 (P3): strengthen nudge/prompt steering for branch-shift and critical-context cases

### End state

`before_agent_start` nudges stop acting like generic warnings and instead coach the agent to:
- compact immediately under critical pressure
- compact before branching when older work appears closed
- keep active work raw and summary-safe work compressed

### Tests first

Add failing tests proving that:
- a branch-shift case injects a “compact before next branch” style nudge
- a critical-context case injects stronger “compact now” wording
- cleanup-only sessions keep their existing generic churn/pressure wording and do not claim a new compaction opportunity type
- low-pressure sessions do not get the stronger compaction stance
- nudge recommendation text still matches the shared helper recommendation exactly
- nudges still prefer branch entries so they align with tools

### Expected files

- `src/events/beforeAgentStart.js`
- `tests/explicit-compaction-nudge.test.ts`
- possibly a small shared prompt/constants module under `src/` if that keeps text maintainable

### Work

- Add one shared recommendation/nudge renderer or formatter module consumed by:
  - `dcp_pressure`
  - `dcp_compact`
  - `before_agent_start`
- Replace the current mostly generic actionable-path wording with two severity-specific variants:
  - branch-shift guidance
  - critical-context guidance
- Add a short context-management stance emphasizing:
  - compact stale/closed work
  - keep active work raw
  - prefer compaction before starting another heavy exploration branch when the prior one is done
- Implement the locked nudge gating contract:
  - `config.nudge.enabled` still controls whether nudges are injected at all
  - branch-shift / critical-context nudges key off shared recommendation state, not the old churn thresholds
  - generic churn nudges still use the existing `config.nudge` thresholds when recommendation is `wait`
- Keep the prompt concise enough to avoid becoming its own context burden.

### Verify

- `bun test tests/explicit-compaction-nudge.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 4 (P4): docs and regression hardening

### End state

The new behavior is documented as a distinct layer on top of ordinary pruning: `pi-dcp` now helps the agent decide when older unique history should become summary-only.

### Tests first

Before finalizing docs, make sure regression coverage captures:
- closed-workstream recommendations
- branch-shift nudges
- critical-context nudges
- explicit tool semantics for the new recommendation enum
- no regressions to existing pruning behavior

### Expected files

- `README.md`
- `docs/CONFIGURATION.md`
- `skills/pi-dcp/SKILL.md`
- touched tests from prior phases

### Work

- Document the distinction between:
  - prune/redact = safe stale payload cleanup
  - compaction = collapsing older raw history that is now summary-safe
- Document the new branch-shift recommendation model and stronger nudges.
- Explain that this is inspired by OpenCode's compression **steering** but still uses Pi-native compaction instead of OpenCode's custom compression toolchain.
- Document explicitly in `docs/CONFIGURATION.md` that the branch-shift thresholds are intentionally hard-coded in this pass and are not user-configurable yet.

### Verify

- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`
- `bun run build`

## Risks and mitigations

- **Risk: overcompacting active work because turn-boundary heuristics are too eager.**
  - Mitigation: narrow the feature claim to new-user-turn branch shifts only, require both a substantial previous turn and a sufficiently large overall session before recommending branch-shift compaction, suppress branch-shift recommendations when the previous turn still contains unresolved errors, and add conservative same-workstream suppression phrases grounded in observable text.
- **Risk: stronger nudges become noisy or repetitive.**
  - Mitigation: keep the current fingerprinting/suppression model and only add two clearly distinct severity paths.
- **Risk: recommendation logic drifts again between tools and nudges.**
  - Mitigation: keep all compaction-opportunity logic in `src/context-pressure.js` and have nudges render from that shared snapshot.
- **Risk: trying to imitate OpenCode too literally expands scope into a custom compression system.**
  - Mitigation: lock the plan to Pi-native compaction + better steering only.
- **Risk: ordinary pruning gets conflated with compaction in docs or prompts.**
  - Mitigation: explicitly document and test the difference between stale payload cleanup and summary-safe history compaction.

## Decisions / Deviations Log

- 2026-03-28: Locked this follow-up to proactive compaction steering rather than further pruning-rule expansion.
- 2026-03-28: Narrowed the v1 claim to new-user-turn branch shifts only; intra-turn branch changes remain out of scope for this pass.
- 2026-03-28: Locked the first “closed workstream” heuristic to turn-boundary signals only; no semantic topic modeling in this pass.
- 2026-03-28: Locked the new recommendation enum to `wait`, `compact-before-next-branch`, and `compact-now`.
- 2026-03-28: Locked stronger prompting to two severity paths (branch-shift and critical-context) instead of importing OpenCode's full multi-prompt injection stack.
- 2026-03-28: Locked `dcp_compact` to compact by default for both non-`wait` recommendation modes, while keeping `focus` non-overriding without `force`.
- 2026-03-28: Locked all branch-shift metrics to the filtered post-self-traffic message list, per-turn token counts to `estimateMessageTokens()`, hard-pressure to win precedence over `closed-workstream`, and branch-shift compaction to preserve the latest user request automatically.
- 2026-03-28: Locked branch-shift/critical-context nudges to reuse shared recommendation state while bypassing the older churn thresholds, with `config.nudge.enabled` remaining the master toggle.

## Plan changelog

- 2026-03-28: Initial plan created from the gap between current Pi-native compaction tooling and the user's desired “older irrelevant context should become summary-only” behavior.
- 2026-03-28: Review pass added a structured `opportunityKind`, locked unresolved-error suppression for branch-shift compaction, and explicitly extended the stronger context-management stance into tool prompt guidance as well as nudges.
- 2026-03-28: Multi-model review integration narrowed `opportunityKind` to compaction-only states, locked canonical turn segmentation plus a boundary persistence window, added a narrow continuation-suppression safeguard, expanded Phase 1 threshold/false-positive tests, documented hard-coded threshold behavior, and added the required `Resume Instructions (Agent)` section.
- 2026-03-28: Second multi-model review integration locked canonical computation sources (filtered messages, `estimateMessageTokens()`, shared latest-user-text normalization), added opportunity precedence rules, narrowed the feature claim to new-user-turn branch shifts, strengthened same-workstream safeguards, required automatic preservation of the latest user request in branch-shift compaction, and made shared renderer + nudge-gating contracts explicit.
- 2026-03-28: Phase 1 executed: `src/context-pressure.js` now computes branch-shift metrics on the filtered message list, uses `estimateMessageTokens()` for previous-turn token totals, distinguishes `opportunityKind` values (`none`, `closed-workstream`, `hard-pressure`), and applies hard-pressure precedence over branch-shift compaction. `tests/context-pressure.test.ts` now covers boundary persistence, same-workstream suppression, threshold edges, and coexistence precedence.
- 2026-03-28: Phase 2 executed: `dcp_pressure` now reports branch-shift vs hard-pressure opportunities explicitly, `dcp_compact` accepts `compact-before-next-branch` without `force`, branch-shift compaction automatically preserves the latest user request in `customInstructions`, and tool guidance now reinforces “compact closed work, keep active work raw.”
- 2026-03-28: Phase 3 executed: `before_agent_start` now uses severity-specific branch-shift vs critical-context wording, compaction-worthy recommendations bypass the older churn thresholds while `config.nudge.enabled` remains the master toggle, and shared recommendation wording now comes from `src/context-pressure-rendering.js` to keep tools and nudges aligned.
- 2026-03-28: Phase 4 executed: README/config/skill docs now distinguish automatic prune/redact from explicit compaction, document the new `compact-before-next-branch` vs `compact-now` model, and explicitly note that branch-shift thresholds are hard-coded in this pass. Full verification passed with `bun test`, `bun x tsc -p tsconfig.json --noEmit`, and `bun run build`.
