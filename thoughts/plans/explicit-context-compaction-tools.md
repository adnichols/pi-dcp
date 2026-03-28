# Plan: explicit agent-invoked context compaction tools for pi-dcp

## Goal

Add explicit tools to `pi-dcp` that let the agent inspect context pressure and trigger real session-level context cleanup, instead of only receiving passive long-session nudges.

This should close the usability gap highlighted by the home-directory "cursors" session:
- `pi-dcp` can currently nudge when context is large or noisy
- but the agent has no `pi-dcp` tool it can call to act on that signal
- unlike `opencode-dynamic-context-pruning`, which exposes a model-callable `compress` tool

Because pi already has native compaction (`ctx.compact()` and `session_before_compact`), the recommended design is **pi-native explicit compaction**, not a literal port of OpenCode's message/range compression state machine.

## Repo reality validated

- `pi-dcp` currently registers **commands only**, not model-callable tools (`index.ts`).
  - current commands: `dcp-init`, `dcp-toggle`, `dcp-tools`, `dcp-debug`, `dcp-recent`, `dcp-stats`, `dcp-context`, `dcp-logs`
- Current pruning behavior is automatic and advisory:
  - `src/events/context.js` applies pruning before each LLM call
  - `src/events/beforeAgentStart.js` injects long-session nudges into the system prompt
- The nudge is currently triggered by any of:
  - repeated reads
  - repeated bash commands
  - many tool results
  - high context usage
  This means the agent may be nudged even when `pi-dcp` has very little actually-prunable churn left.
- `src/analysis.js` already computes pressure summaries (`repeatedReads`, `repeatedBashCommands`, total tool results).
- Once `dcp_pressure` / `dcp_compact` exist, their own tool calls/results would otherwise contribute to tool-result volume and could create self-referential pressure unless the analysis/recommendation path explicitly excludes them.
- `src/workflow.js` already computes actual predicted prune/redact results and estimated token savings via `applyPruningWorkflowDetailed()`.
- `pi-dcp` has no stateful session-rewrite mechanism of its own; its current design is rule-based message filtering before provider calls.
- Pi extension docs confirm:
  - custom model-callable tools are registered with `pi.registerTool()` (`docs/extensions.md`)
  - tool execute handlers receive full extension context, including `ctx.getContextUsage()` and `ctx.compact()`
  - `ctx.sessionManager` is read-only from extensions
  - compaction can be triggered programmatically with `ctx.compact()`
  - compaction behavior can be customized with `session_before_compact`
  - `ctx.compact()` is documented as fire-and-forget / async; extension examples trigger it from commands or turn handlers, not from a tool that then keeps working in the same turn

[REVIEW:Opus 4.6] GAP: The plan should verify what happens when `ctx.compact()` is called *from inside a tool's `execute()` handler*. The documented examples show it called from commands and event handlers, but a tool execute is different-it runs mid-turn while the LLM is generating. Does compaction wait for the current turn to finish? Does calling it mid-tool-execution cause a session reload that invalidates the remaining tool calls in the same assistant message (pi runs tools in parallel by default)? This is the single most critical integration risk and needs explicit validation in Phase 1, not just a passing mention. If it turns out `ctx.compact()` from a tool handler triggers an immediate reload, the tool result may never be delivered to the model. [/REVIEW]
- OpenCode DCP exposes a model-callable `compress` tool (`opencode-dynamic-context-pruning/index.ts`) backed by its own custom compression state and message transforms.
- OpenCode's exact model/range compression behavior is **not** directly portable to pi because pi already has native compaction primitives and does not expose arbitrary session-history mutation APIs through `ctx.sessionManager`.
- There is still no `thoughts/specs/product_intent.md` or `thoughts/plans/AGENTS.md` in this repo, so this plan follows root `AGENTS.md` plus validated code reality.

## Problem statement

Today, `pi-dcp` can tell the agent:
- "this session is large"
- "you have lots of tool results"
- "you've reread some things"

But it cannot let the agent do any of the following through a tool call:
- inspect whether a compaction is actually worthwhile
- trigger compaction now
- focus compaction on preserving a particular task thread

So the nudge can feel like a dead end: it raises concern without providing an action surface.

## Scope

In scope:
- add explicit `pi.registerTool()` tools for context inspection and compaction
- reuse existing `analysis` + `workflow` helpers so tool outputs reflect real `pi-dcp` behavior
- use pi-native `ctx.compact()` as the actual purge primitive
- integrate nudges/tool guidance so the agent knows when to call the new tools
- add docs and tests covering the new tool workflow

Out of scope for this pass:
- full OpenCode-style `compressMessage` / `compressRange` parity
- custom message/block IDs and placeholder state machines
- arbitrary historical message replacement from extension state
- automatic silent compaction with no explicit tool or command surface
- changing pi core compaction algorithms themselves

## Acceptance criteria

- `pi-dcp` exposes at least one model-callable tool the agent can use to inspect context pressure.
- `pi-dcp` exposes at least one model-callable tool the agent can use to trigger compaction.
- The compaction tool triggers real pi session compaction via `ctx.compact()`, not just ordinary pre-request pruning.
- The compaction tool does not falsely imply that compaction has already completed; its output and prompt guidance clearly tell the agent that compaction was started asynchronously and that it should avoid more heavy exploration in the same turn.
- Tool outputs clearly distinguish:
  - current pressure / context usage
  - predicted `pi-dcp` prune/redact impact
  - whether compaction is recommended
- `dcp_pressure` / `dcp_compact` do not materially worsen their own recommendation logic by counting their own prior tool-call churn as context pressure.

[REVIEW:Opus 4.6] AMBIGUITY: The three sub-bullets here ("current pressure / context usage", "predicted pi-dcp prune/redact impact", "whether compaction is recommended") are duplicated from the earlier acceptance criterion about tool outputs. This appears to be a copy-paste artifact. Remove or clarify to avoid confusion during execution. [/REVIEW]
- Long-session nudges can reference the explicit tool path, so the agent is told what action to take.
- Repeated compaction requests are guarded so the agent cannot easily spam compaction calls in the same session.
- Tests cover tool behavior, recommendation heuristics, and compaction-trigger wiring.
- Existing rule-based pruning behavior remains unchanged when the new tools are not used.

## Open questions

- None. Implementation choices below are locked so execution does not have to invent semantics mid-flight.

## Implementation decisions locked for execution

- **Use pi-native compaction, not a full OpenCode port.**
  - Rationale: pi already exposes `ctx.compact()` and compaction lifecycle hooks; `pi-dcp` should leverage that instead of re-implementing a parallel compression architecture.

[REVIEW:Opus 4.6] RISK: Good decision, but note the practical limitation: `ctx.compact()` summarizes *everything before the keep-recent window* into a single LLM-generated summary. DCP's rule-based pruning removes specific stale/duplicate messages. These two mechanisms are complementary but operate at very different granularities. The plan should acknowledge that after compaction, DCP's rule-based pruning loses visibility into the pre-compaction history (it's now a summary), so the agent may see reduced predicted savings from `dcp_pressure` post-compaction even if the session is still large. This affects how the recommendation logic should behave after a compaction has already occurred in the session. [/REVIEW]
- **Ship two model-callable tools in the first pass:**
  1. `dcp_pressure` - inspect current context pressure and predicted `pi-dcp` savings
  2. `dcp_compact` - trigger pi compaction now, optionally with focus instructions
- **Do not try to let the agent specify raw message IDs or compression ranges in v1.**
  - Rationale: pi does not expose arbitrary message rewriting APIs; range/message compression would require a new state model that is much larger than this user request.
- **Recommendation logic will be heuristic but grounded in existing real metrics.**
  - It must explicitly ignore `pi-dcp`'s own inspection/compaction tool traffic so the tools do not manufacture their own pressure signal.
  - Use:
    - `analyzeConversationPressure()`
    - `applyPruningWorkflowDetailed()`
    - `ctx.getContextUsage()`
  - The tool should explain *why* compaction is or is not recommended.
- **`dcp_compact` should accept optional focus instructions**, e.g. "preserve the active cursor investigation and recent Ghostty findings".
  - These become `ctx.compact({ customInstructions })` input.

[REVIEW:Opus 4.6] AMBIGUITY: The `customInstructions` field maps cleanly to the documented `ctx.compact()` API, good. However, the plan should specify what happens when `focus` is provided but the recommendation logic says "don't compact". Currently the plan says `force` overrides, but should `focus` without `force` also imply "I really want this"? Clarify the interaction matrix: (`focus` only → still checks recommendation? `focus` + `force` → always compacts? no `focus`, no `force` → pure recommendation?). The current spec leans toward "focus alone doesn't override" but the agent might reasonably provide focus without force and be surprised by a no-op. [/REVIEW]
- **`dcp_compact` must be explicit about asynchronous semantics.**
  - It should report `started` / `skipped` / `already in flight`, never `completed` from the immediate tool result.
  - Its prompt guidance and result text should tell the model to stop or minimize further exploration until compaction completes.
- **`dcp_compact` should default to conservative behavior.**
  - If pressure is low and `force` is not set, it should return a no-op/recommendation result instead of compacting immediately.
- **Add a lightweight per-session guard/cooldown** for explicit compaction requests.
  - Recommended behavior:
    - only one in-flight compaction at a time
    - suppress repeated immediate re-trigger attempts until either compaction finishes or enough new messages accrue

[REVIEW:Opus 4.6] GAP: "Enough new messages accrue" is not quantified. The Phase 3 work section mentions state fields (`inFlight: boolean`, `last request time / last message count`) but doesn't specify the threshold. Should be locked: e.g., "at least N new user turns or M new messages since last compaction before allowing re-trigger". Without this, the implementer must invent the threshold mid-flight, which this plan explicitly tries to avoid. [/REVIEW]
- **Nudges should evolve from passive warning to actionable instruction.**
  - When the new tools are active, nudge text should mention them explicitly instead of only telling the agent to "avoid rereads".
- **Do not make compaction-tool success depend on synchronous completion.**
  - The tool returns that compaction was started/scheduled, while completion is surfaced via UI notification and session compaction events.
- **Prefer small shared helper modules over embedding logic in `index.ts`.**
  - Recommended new modules:
    - `src/tools/dcp-pressure.js`
    - `src/tools/dcp-compact.js`
    - `src/compaction.js` or `src/context-pressure.js` for shared heuristics/state

[REVIEW:Opus 4.6] AMBIGUITY: The repo currently uses `.js` source files (not `.ts`) in `src/` with separate `.d.ts` declaration files. Phase 2's "Expected files" lists `src/tools/dcp-pressure.js` and `src/tools/dcp-pressure.d.ts`, which is consistent. However, `index.ts` is TypeScript. The plan should explicitly note the convention: new tool files follow the existing `.js` + `.d.ts` pattern, not `.ts`. This prevents the implementer from creating `.ts` files in `src/tools/` which would be inconsistent. [/REVIEW]
- **If schema support is needed, add an explicit supported schema dependency/import path rather than relying on transitive package availability.**

[REVIEW:Opus 4.6] GAP: `pi.registerTool()` uses `@sinclair/typebox` for parameter schemas (visible in extension docs examples: `Type.Object`, `Type.String`, `Type.Optional`, `StringEnum`). This repo has no direct `@sinclair/typebox` dependency in `package.json`-it would come transitively through the pi peer dependency. The plan acknowledges this risk in the abstract but doesn't lock the decision: should `@sinclair/typebox` be added as an explicit dev/peer dependency, or should the tools define parameters with plain JSON Schema objects (which typebox `Type.*` calls produce)? Lock this choice. The simplest path is adding `@sinclair/typebox` as a devDependency since the pi peer already ships it. [/REVIEW]

## Recommended tool behavior

### `dcp_pressure`

Purpose:
- Give the agent a compact diagnostic snapshot before it decides whether to compact.

Recommended output fields:
- current total messages
- current tool-result count
- current context usage percent/tokens if available
- repeated reads/bash summaries from `analysis.js`
- predicted prune/redact counts if current `pi-dcp` workflow runs
- predicted estimated token savings
- recommendation:
  - `compact now`
  - `wait / continue normally`
  - `clean up manually first`
- concise rationale string

[REVIEW:Opus 4.6] GAP: The recommendation enum includes `clean up manually first` but the plan doesn't define what "manually" means for the agent. DCP prunes automatically on each context event. The agent can't manually delete specific messages. The only "manual" action available is calling `dcp_compact`. If this recommendation means "stop rereading files and let DCP's automatic pruning catch up", say that explicitly. Otherwise this recommendation value is a dead end-the same problem the plan is solving for nudges. [/REVIEW]

Recommended prompt guidance:
- use when nudged by `pi-dcp`
- use before a long new investigative branch
- use when unsure whether compaction is worthwhile

### `dcp_compact`

Purpose:
- Let the agent trigger compaction deliberately.

Recommended parameters:
- `focus?: string`
- `force?: boolean`

Recommended behavior:
- inspect current pressure first
- if compaction is not recommended and `force !== true`, return a no-op explanation
- if compaction is already in flight, return an "already compacting" result
- otherwise call `ctx.compact({ customInstructions, onComplete, onError })`
- return a tool result that says compaction was triggered and includes the reason/focus snapshot
- make the tool result text explicit that compaction is asynchronous and the agent should avoid more heavy context-building work until compaction finishes

[REVIEW:Opus 4.6] RISK: The "avoid more heavy context-building work until compaction finishes" guidance is only enforceable via prompt text in the tool result-the model may ignore it and keep calling tools. Since compaction is async and fires `onComplete` later, there's a race: the model could queue several more tool calls before compaction actually processes. The plan's guard against repeated `dcp_compact` calls is good, but doesn't prevent the model from calling *other* tools (read, bash, etc.) that add context while compaction is pending. This is probably acceptable for v1 but should be documented as a known limitation rather than presented as if the guidance reliably prevents it. [/REVIEW]

Recommended prompt guidance:
- use after `dcp_pressure` says compaction is recommended
- use when context is large enough that continuing the current turn is likely to degrade quality
- after calling it, avoid continuing with more heavy exploration in the same turn unless absolutely necessary

## Progress

- [x] P1 Phase 1: validate pi-native compaction integration points and extract shared recommendation helpers
- [x] P2 Phase 2: add the `dcp_pressure` tool and actionable inspection output
- [x] P3 Phase 3: add the `dcp_compact` tool with compaction guards and notifications
- [x] P4 Phase 4: connect nudges/docs/tests to the new explicit tool workflow

## Phase 1 (P1): validate pi-native compaction integration points and extract shared recommendation helpers

### End state

The codebase has a single shared helper that can evaluate current pressure, predicted `pi-dcp` savings, and compaction recommendation, and the plan for using pi-native compaction is validated against extension APIs.

[REVIEW:Opus 4.6] GAP: The end state says "the plan for using pi-native compaction is validated against extension APIs" but doesn't specify what artifact that validation produces. Phase 1 Work says to validate the helper "behaves sensibly" but doesn't include an explicit task to test-call `ctx.compact()` from a tool handler to confirm it works. This is the highest-risk integration point. Add a concrete spike/smoke test: register a minimal tool that calls `ctx.compact()` and verify the tool result is still delivered to the model. If this fails, the entire plan needs replanning. [/REVIEW]

### Tests first

Add failing unit coverage for pure helper behavior before wiring tools:
- recommendation returns "no compact" when pressure and predicted savings are low
- recommendation returns "compact" when context usage is high even if ordinary pruning savings are small
- recommendation returns "compact" when tool-result pressure is high and predicted savings are meaningful
- recommendation ignores prior `dcp_pressure` / `dcp_compact` tool traffic so the tools do not create self-referential pressure
- recommendation output is stable and explainable

[REVIEW:Opus 4.6] GAP: These tests are for the recommendation helper, but the end state also claims validation of pi-native compaction integration. There should be at least one integration-level test (even if manual/smoke) that confirms `ctx.compact()` can be called from within a tool `execute()` handler without breaking session state. Pure unit tests of the recommendation logic are necessary but not sufficient for the Phase 1 end state. [/REVIEW]

### Expected files

- `src/analysis.js`
- `src/workflow.js`
- new shared helper file under `src/` (recommended: `src/context-pressure.js`)
- `src/types.d.ts`
- `tests/` new tool/helper recommendation test file

[REVIEW:Opus 4.6] AMBIGUITY: This lists `src/analysis.js` and `src/workflow.js` as expected files but doesn't clarify whether they're being modified or just consumed. Phase 1 Work says "extend or wrap analysis" which suggests modifications. Be explicit: will `analyzeConversationPressure()` get a new parameter to exclude tool names, or will the new `context-pressure.js` wrapper do the filtering before calling the existing function? The latter is cleaner and avoids touching a well-tested module. [/REVIEW]

### Work

- Introduce a shared helper that combines:
  - `analyzeConversationPressure(messages)`
  - `applyPruningWorkflowDetailed(messages, config)`
  - `ctx.getContextUsage()` snapshot
- Extend or wrap analysis so `pi-dcp`'s own explicit tools (`dcp_pressure`, `dcp_compact`) can be excluded from recommendation-oriented pressure calculations.
- Define the recommendation model for tools and nudges:
  - summary text
  - recommendation enum / mode
  - rationale list
  - predicted savings snapshot
- Keep this helper independent of `pi.registerTool()` so it is easy to test.
- Validate that the helper behaves sensibly on:
  - high-volume but low-prunable sessions
  - repeat-heavy sessions
  - post-compaction small sessions

[REVIEW:Opus 4.6] GAP: The recommendation thresholds are not specified anywhere in the plan. What context usage percent triggers "compact now"? What predicted token savings count as "meaningful"? The existing nudge config has concrete defaults (`minMessages: 60`, `minToolResults: 30`, `minContextPercent: 70`). The recommendation helper should reuse or explicitly relate to these thresholds. Without locked thresholds, the implementer must invent them-contradicting the plan's goal of locking all decisions pre-execution. [/REVIEW]

### Verify

- `bun test <new helper/tool recommendation test file>`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 2 (P2): add the `dcp_pressure` tool and actionable inspection output

### End state

The agent can call a `dcp_pressure` tool to see whether context cleanup is actually warranted.

### Tests first

Add failing tests proving that:
- the tool registers with the expected name/description/schema
- the tool uses current session messages from `ctx.sessionManager`
- the tool returns predicted prune/redact counts and estimated savings
- the tool returns an explicit recommendation and rationale
- the tool ignores prior `dcp_pressure` / `dcp_compact` traffic in its recommendation path
- the tool is safe in non-UI environments and when context usage is unavailable

[REVIEW:Opus 4.6] GAP: Testing "the tool uses current session messages from `ctx.sessionManager`" requires mocking `ctx.sessionManager.getEntries()`. The existing test suite doesn't mock pi extension context-it tests pure functions directly (e.g., `applyPruningWorkflow(messages, config)`). The plan should note that Phase 2 introduces a new test pattern (mocked ctx) and may need a shared test helper for creating fake `ExtensionContext` objects. Since `pi-shims.d.ts` types everything as `any`, the mocking is straightforward, but the pattern should be established explicitly. [/REVIEW]

### Expected files

- `index.ts`
- new `src/tools/dcp-pressure.js`
- new `src/tools/dcp-pressure.d.ts`
- `src/types.d.ts`
- `tests/` new tool registration/execution test file
- possibly `README.md` / docs in a later phase only

### Work

- Register `dcp_pressure` via `pi.registerTool()`.
- Add `promptSnippet` and `promptGuidelines` so the tool appears in the agent's tool instructions.
- Inside execute:
  - collect current branch/session messages via `ctx.sessionManager`
  - compute the shared pressure/recommendation snapshot
  - return a concise text result plus richer `details`
- Reuse existing session analysis helpers rather than re-deriving counts in the tool itself.
- Keep the returned text short enough to avoid becoming a new context burden.

[REVIEW:Opus 4.6] RISK: Note that `ctx.sessionManager.getEntries()` returns *all* session entries (including compaction entries, headers, etc.), while `analyzeConversationPressure()` and `applyPruningWorkflowDetailed()` expect an array of `AgentMessage`. The existing `beforeAgentStart` handler already does this filtering: `.filter(entry => entry?.type === 'message').map(entry => entry.message)`. The plan should call out this extraction step explicitly so it doesn't get missed. Similarly, the `context` event handler receives `event.messages` which is already the filtered message array-different from what the tool will get from `ctx.sessionManager`. [/REVIEW]

### Verify

- `bun test <new tool test file>`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 3 (P3): add the `dcp_compact` tool with compaction guards and notifications

### End state

The agent can explicitly trigger real pi compaction through a `dcp_compact` tool, with protection against accidental repeated calls.

### Tests first

Add failing tests proving that:
- `dcp_compact` calls `ctx.compact()` when recommendation or `force` allows it
- `dcp_compact` does not compact when recommendation is negative and `force` is false
- repeated immediate calls are suppressed while compaction is in flight
- `focus` text becomes `customInstructions`
- the immediate tool result text says compaction was started asynchronously rather than completed
- completion/error callbacks update UI or extension state predictably

[REVIEW:Opus 4.6] GAP: Missing test case: what happens when `ctx.compact()` is called but the session is too small for pi's native compaction to do anything meaningful (e.g., the session has fewer messages than `keepRecentTokens` worth of content)? Pi's compaction will likely no-op or produce a trivial summary. The tool should detect this scenario and return a useful message rather than saying "compaction started" for something that won't meaningfully help. [/REVIEW]

### Expected files

- `index.ts`
- new `src/tools/dcp-compact.js`
- new `src/tools/dcp-compact.d.ts`
- new shared state/helper file if needed (`src/compaction.js` or similar)
- `src/types.d.ts`
- `tests/` tool execution + guard tests

### Work

- Register `dcp_compact` via `pi.registerTool()`.
- Add a lightweight per-session compaction guard/cooldown.
  - Recommended state:
    - `inFlight: boolean`
    - last request time / last message count
- Build `customInstructions` from:
  - optional `focus`
  - shared pressure snapshot if useful
- Call `ctx.compact({ customInstructions, onComplete, onError })`.
- Return a short tool result that states one of:
  - compaction started
  - already compacting
  - not recommended, skipped
  - forced compaction started
- Make the returned text explicitly asynchronous, e.g. "compaction started; pause heavy exploration until it finishes".
- Prefer UI notify + internal state updates for lifecycle feedback.
- Only add custom steering/session messages after compaction if evidence shows the agent truly needs them; keep v1 minimal.

[REVIEW:Opus 4.6] RISK: The guard state (`inFlight`, last request time, last message count) lives in extension-level JavaScript variables. These reset on `/reload`. If the user reloads the extension while compaction is in flight, the guard state is lost and the agent could re-trigger compaction. This is a minor edge case for v1 but worth noting. Also, the `onComplete` callback needs to reset `inFlight = false`-make sure the `onError` callback does too, otherwise a failed compaction permanently blocks future attempts until extension reload. [/REVIEW]

### Verify

- `bun test <tool execution + guard tests>`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 4 (P4): connect nudges, docs, and regression coverage to the new explicit tool workflow

### End state

Long-session nudges become actionable, docs explain the new tools, and regression tests show the full inspection→compact workflow.

### Tests first

Add failing tests proving that:
- nudge text references the new tool path when appropriate
- the recommendation logic used by nudges and tools stays consistent
- existing pruning stats/context commands still work unchanged
- explicit compaction tools do not change ordinary pruning results unless invoked

[REVIEW:Opus 4.6] GAP: Missing test: verify that the nudge *only* references the tool path when the tools are actually registered (i.e., when `config.enabled` is true). If the extension is disabled, tools aren't registered, and nudges mentioning `dcp_pressure` / `dcp_compact` would be confusing dead-ends. [/REVIEW]

### Expected files

- `src/events/beforeAgentStart.js`
- `README.md`
- `docs/CONFIGURATION.md`
- possibly `src/cmds/context.js` / `src/cmds/stats.js` if output cross-links are helpful
- `tests/long-session-pressure.test.ts`
- new end-to-end-ish tool/nudge regression file if clearer

### Work

- Update nudge wording so it becomes actionable, e.g.:
  - "If context remains pressured, call `dcp_pressure` to inspect and `dcp_compact` to compact."
- Ensure nudge copy does not imply that automatic pruning alone will always meaningfully reduce context.

[REVIEW:Opus 4.6] RISK: The nudge is injected into the system prompt via `before_agent_start`. The tool names `dcp_pressure` and `dcp_compact` will appear in the system prompt nudge text, but they'll also appear in the tools list via `promptSnippet`. Ensure the nudge wording doesn't duplicate what `promptGuidelines` already says, or the agent sees redundant instructions. Consider having the nudge say something brief like "Consider calling dcp_pressure" and leave the detailed guidance to `promptGuidelines`. [/REVIEW]
- Update README/config docs with:
  - what the new tools do
  - how they differ from ordinary automatic pruning
  - why compaction is pi-native rather than OpenCode-style range compression
- Add a long-horizon regression scenario showing:
  - the agent can inspect pressure
  - compaction would be recommended
  - ordinary pruning remains separate from explicit compaction
  - repeated use of `dcp_pressure` itself does not inflate the recommendation into a self-fulfilling nudge

### Verify

- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`
- `bun run build`

## Risks and mitigations

- **Risk: explicit compaction is triggered too eagerly and disrupts flow.**
  - Mitigation: add shared recommendation heuristics plus `force` override rather than unconditional compaction.
- **Risk: tool-triggered compaction during a running turn behaves unexpectedly or the agent keeps exploring on pre-compaction context.**
  - Mitigation: lean on pi's documented `ctx.compact()` API, add guard tests, and keep tool result semantics asynchronous ("started", not "completed") with explicit guidance to stop heavy exploration after the call.

[REVIEW:Opus 4.6] RISK: This mitigation is insufficient for the scenario where compaction triggers a session reload mid-turn. If pi reloads the session after compaction completes (which the compaction docs describe: "Session reloads, using summary + messages from firstKeptEntryId onwards"), and this reload happens while the agent is still processing tool results from the same turn, the behavior is undefined. The plan should include a Phase 1 spike to confirm this race condition doesn't occur (i.e., that `ctx.compact()` from a tool handler defers the reload until the current turn completes). [/REVIEW]
- **Risk: nudges and recommendations disagree.**
  - Mitigation: centralize recommendation logic in one shared helper consumed by both tools and nudge code.
- **Risk: trying to copy OpenCode too literally bloats scope.**
  - Mitigation: explicitly lock v1 to pi-native compaction, no raw message/range compression.
- **Risk: tool output itself becomes more context noise or self-inflates pressure heuristics.**
  - Mitigation: keep returned text concise, move structured detail into `details`, and explicitly exclude `dcp_pressure` / `dcp_compact` traffic from recommendation-oriented pressure calculations.

[REVIEW:Opus 4.6] GAP: The exclusion of `dcp_pressure` / `dcp_compact` from pressure calculations is well-motivated, but the plan doesn't address whether DCP's existing automatic pruning rules (deduplication, superseded tool results, etc.) should also exclude these tool calls/results. If the agent calls `dcp_pressure` multiple times, the deduplication rule might try to prune earlier `dcp_pressure` results-which is actually desirable for context savings but could confuse the self-referential pressure story. Clarify: should DCP rules prune old `dcp_pressure` results (yes, saves tokens) while the recommendation helper ignores them (yes, avoids self-inflation)? These are independent concerns. [/REVIEW]

## Decisions / Deviations Log

- 2026-03-28: Locked the first pass to pi-native compaction (`ctx.compact()`) instead of porting OpenCode's message/range compression system.
- 2026-03-28: Locked the first tool surface to two tools (`dcp_pressure`, `dcp_compact`) rather than a larger multi-command or message-ID compression API.
- 2026-03-28: Locked recommendation heuristics to reuse existing `analysis.js`, `workflow.js`, and `ctx.getContextUsage()` so explicit tools reflect actual current `pi-dcp` behavior.
- 2026-03-28: Locked `dcp_compact` to asynchronous "start compaction" semantics, with guards against repeated in-flight requests.
- 2026-03-28: Locked `dcp_compact` result/prompt language to explicitly tell the agent not to treat the same turn as already compacted.
- 2026-03-28: Locked recommendation logic to exclude `dcp_pressure` / `dcp_compact` self-traffic so explicit context tools do not create their own pressure signal.
- 2026-03-28: Implemented shared context-pressure helper defaults with conservative recommendation thresholds: compact at ~80% context usage, or when repeated-inspection churn exists and predicted DCP savings are at least ~400 estimated tokens (`src/context-pressure.js`, `tests/context-pressure.test.ts`).
- 2026-03-28: Added `dcp_pressure` as a model-callable tool and used a plain JSON-schema empty object for v1 parameters instead of adding a new schema dependency, keeping the tool zero-argument and dependency-light (`src/tools/dcp-pressure.js`, `tests/dcp-pressure-tool.test.ts`).
- 2026-03-28: Implemented `dcp_compact` with explicit async-start semantics plus a lightweight in-memory in-flight guard and lifecycle callbacks that reset state on completion/error (`src/tools/dcp-compact.js`, `src/compaction.js`, `tests/dcp-compact-tool.test.ts`).
- 2026-03-28: Updated long-session nudges to reuse shared pressure snapshots and explicitly point the agent at `dcp_pressure` / `dcp_compact`, so warnings become actionable rather than purely advisory (`src/events/beforeAgentStart.js`, `tests/explicit-compaction-nudge.test.ts`).
- 2026-03-28: Locked nudge follow-up work to make the advice actionable instead of only warning about context size.

## Plan changelog

- 2026-03-28: Initial plan created after comparing `pi-dcp` with `opencode-dynamic-context-pruning` and reviewing pi’s custom tool + compaction APIs.
- 2026-03-28: Phase 1 executed: added `src/context-pressure.js` plus `tests/context-pressure.test.ts` to centralize recommendation heuristics and self-traffic exclusion before tool registration work begins.
- 2026-03-28: Phase 2 executed: registered `dcp_pressure` in `index.ts`, added session-entry extraction support, and covered the tool with definition/execution tests.
- 2026-03-28: Phase 3 executed: registered `dcp_compact` in `index.ts`, added shared explicit-compaction state helpers, and verified start/skip/in-flight/completion/error behavior in tests.
- 2026-03-28: Phase 4 executed: connected nudges to the shared recommendation helper, documented the new tool workflow, and added explicit nudge/tool consistency coverage.
