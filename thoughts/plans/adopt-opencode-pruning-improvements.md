# Plan: adopt OpenCode-style pruning improvements short of full compression

## Goal

Bring the most useful low-complexity pruning ideas from `../opencode-dynamic-context-pruning` into `pi-dcp` without introducing the full `compress` tool, block-summary state machine, or prompt-managed compression workflow.

This plan targets five improvements:

1. protected tools and protected file patterns
2. token-aware pruning stats and visibility
3. age / turn gating before destructive pruning
4. payload redaction as an alternative to deleting whole tool-result messages
5. generalized exact-signature matching for repeated idempotent tool operations

## Repo reality validated

- `pi-dcp` currently runs a simple `prepare -> process -> filter` workflow in `src/workflow.js`.
- Current pruning is delete-based: messages marked with `metadata.shouldPrune` are removed during filter.
- Existing built-in rules live in `src/rules/` and are ordered in `index.ts`.
- Tool-pairing safety is already a core constraint and is covered by `src/rules/tool-pairing.js`, `tests/fix-verification.test.ts`, and `tests/long-session-pressure.test.ts`.
- Current stats only track message counts in `src/cmds/stats.js`; there is no token accounting command.
- Current config surface in `src/config.js` / `src/types.d.ts` does not expose protected tools, protected file patterns, or age gating.
- There is no existing `thoughts/specs/product_intent.md` or `thoughts/plans/AGENTS.md` in this repo, so this plan follows root `AGENTS.md` plus validated code reality.

## Scope

In scope:
- extend config and metadata to support safer pruning decisions
- introduce a redaction/mutation path for tool results and errored payloads
- add token-estimation-based stats and visibility
- expand exact same-operation detection conservatively
- add regression coverage and docs for the new behavior

Out of scope:
- model-exposed `compress` tool
- range/message compression modes
- persisted summary blocks or block placeholder expansion
- prompt override system
- full OpenCode session-state architecture

## Acceptance criteria

- Protected tools and protected file patterns prevent pruning/redaction when configured.
- Resolved errors and superseded repeated results can be delayed by age/turn thresholds instead of pruning immediately.
- Older repeated tool results can be redacted in place when configured, while preserving provider-safe tool pairing.
- `/dcp-stats` reports estimated token savings in addition to message counts.
- A new context-visibility command exposes a rough breakdown of current context cost and estimated savings.
- Repeated-operation matching uses shared normalized exact-signature helpers instead of ad hoc per-tool key construction, with initial coverage for repeated `read`/`bash` operations and unified helper support for path-based `write`/`edit` matching.
- Existing tool-pairing regressions continue to pass.

## Open Questions

- None. Default implementation choices are fixed below to keep the plan execution-ready.

## Implementation decisions locked for execution

- Redaction will be additive, not a replacement for deletion. Rules may choose either `prune` or `redact` actions based on message type and safety.
- The first redaction targets are top-level `toolResult` messages and bulky error payloads; assistant tool-call messages stay structurally intact.
- Exact-signature matching will use one shared normalization/serialization helper. Initial repeated-operation cleanup coverage will be allowlisted to `read` and `bash`, while the same helper also backs path-based `write`/`edit` matching so operation identity stops being rule-specific string assembly.
- Age gating will use **completed user turns after the candidate message** as the unit of age. Default thresholds remain `0` so existing behavior is preserved unless the new config is enabled explicitly.
- Recency protection will treat redaction as destructive in the same way as pruning: recent retained messages should keep full payloads, while already-orphaned invalid `toolResult` messages may still be removed for provider safety.
- Config shape is locked for execution as:
  - `protectedTools: string[]` (default `[]`)
  - `protectedFilePatterns: string[]` (default `[]`)
  - `ageGates: { supersededToolResults: number; errorPurging: number; supersededWrites: number }` (all default `0`)
  - `redaction: { supersededToolResults: boolean; resolvedErrors: boolean }` (both default `false`)
- Token accounting will start with lightweight estimation (`chars/4` fallback or equivalent helper), avoiding tokenizer/runtime dependencies in the first pass.
- Visibility will extend `/dcp-stats` and add a dedicated `/dcp-context` command rather than overloading the existing session-start notification.

## Progress

- [x] P1 Phase 1: config and protection plumbing
- [x] P2 Phase 2: action-aware workflow and redaction support
- [x] P3 Phase 3: age-gated pruning and generalized exact-signature matching
- [x] P4 Phase 4: token-aware stats and context visibility
- [x] P5 Phase 5: docs and regression hardening

## Phase 1 (P1): config and protection plumbing

### End State

`pi-dcp` can be configured with protected tool names, protected file patterns, and age/turn thresholds that later phases can enforce consistently across rules.

### Tests first

Add failing tests proving that:
- a protected tool result is not pruned even when it otherwise matches a superseded-result rule
- a protected file path is not pruned/redacted even when a later identical/superseding operation exists
- configured turn/age thresholds block pruning until the threshold is reached

### Expected files

- `src/config.js`
- `src/types.d.ts`
- `src/metadata.js`
- `src/rules/superseded-tool-results.js`
- `src/rules/superseded-writes.js`
- `src/rules/error-purging.js`
- `tests/fix-verification.test.ts`
- `tests/long-session-pressure.test.ts`
- `tests/` additional targeted config/protection test file if clearer than extending existing suites

### Work

- Extend config types/defaults with the locked shape:
  - `protectedTools: string[]`
  - `protectedFilePatterns: string[]`
  - `ageGates: { supersededToolResults: number; errorPurging: number; supersededWrites: number }`
  - `redaction: { supersededToolResults: boolean; resolvedErrors: boolean }`
- Add helper utilities for:
  - exact/literal protected tool matching
  - simple glob-style protected file path matching
  - extracting tool/file identifiers from current pi message shapes
- Implement one age model everywhere: count completed later user turns after the candidate message; document that definition in config comments and README updates later.
- Thread protection checks and age-gate checks into current rules before any prune/redact decision is made.

### Verify

- `bun test tests/fix-verification.test.ts tests/long-session-pressure.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 2 (P2): action-aware workflow and redaction support

### End State

The pruning engine supports both deleting messages and mutating retained messages. Older tool results and large errored inputs can be replaced by compact placeholders without breaking tool-call / tool-result pairing.

### Tests first

Add failing tests proving that:
- a superseded tool result can remain in history with placeholder content instead of being fully removed
- redacted tool results still preserve `toolCallId`, `toolName`, and pairing invariants
- redacting a recent tool result does not cause recency or tool-pairing rules to resurrect or corrupt it
- redacted error payloads keep enough information for conversational continuity while stripping bulk input/output text

### Expected files

- `src/workflow.js`
- `src/types.d.ts`
- `src/metadata.js`
- `src/rules/error-purging.js`
- `src/rules/superseded-tool-results.js`
- `src/rules/tool-pairing.js`
- `src/rules/recency.js`
- `tests/fix-verification.test.ts`
- `tests/` new workflow/redaction regression file

### Work

- Extend metadata so rules can express an action model, for example:
  - `action: prune | redact | keep`
  - optional redaction reason and replacement payload metadata
- Add a new workflow stage between process and filter that applies message mutations before deletion.
- Implement conservative redaction helpers for top-level `toolResult` messages:
  - replace bulky text with short placeholders
  - preserve structural fields required by providers and existing replay assumptions
- Implement conservative error-input redaction for resolved or stale error cases.
- Keep delete-based behavior available for cases that must truly disappear (for example already orphaned tool results).
- Codify precedence explicitly: protection/age-gate checks block destructive actions, tool-pairing may still delete invalid orphaned results, and recency clears both prune and redact actions for recent retained messages.
- Re-check rule ordering so tool-pairing and recency operate correctly when a message is redacted rather than removed.

### Verify

- `bun test tests/fix-verification.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 3 (P3): age-gated pruning and generalized exact-signature matching

### End State

Repeated-operation detection uses normalized exact signatures and can prune/redact only after the configured age threshold, making pruning less eager and more broadly useful for repeated inspection churn.

### Tests first

Add failing tests proving that:
- repeated `read` and `bash` calls with semantically identical normalized args match even if key order differs
- pruning/redaction does not happen before the configured age threshold
- the latest successful observation remains unmodified while older ones are redacted/pruned
- non-idempotent or protected tools are excluded from signature-based cleanup

### Expected files

- `src/metadata.js`
- `src/rules/superseded-tool-results.js`
- `src/rules/error-purging.js`
- `src/rules/superseded-writes.js`
- `src/analysis.js`
- `tests/long-session-pressure.test.ts`
- `tests/` new repeated-operation matching regression file

### Work

- Add normalized stable-signature helpers for tool arguments:
  - drop undefined/null noise where safe
  - sort object keys recursively
  - serialize exact arguments deterministically
- Replace or supplement `getOperationKey()` with a generalized exact-signature path.
- Start with conservative allowlisting for repeated-operation cleanup:
  - keep `read` and `bash` as first-class repeated-result targets
  - use the same shared signature helper to replace bespoke identity logic for `write`/`edit`
  - allow future expansion without widening behavior accidentally in this pass
- Apply age gating to:
  - superseded repeated successful tool results
  - resolved errors
  - superseded writes where appropriate and safe
- Update long-session pressure analysis to summarize repeated normalized operations where that improves status quality.

### Verify

- `bun test tests/long-session-pressure.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 4 (P4): token-aware stats and context visibility

### End State

Operators can see approximate token savings and current context composition, not just message counts.

### Tests first

Add failing tests proving that:
- pruning stats accumulate estimated token savings for deleted and redacted payloads
- `/dcp-stats` reports both message counts and estimated token savings
- `/dcp-context` reports a stable, human-readable rough breakdown for current session context
- redaction credits only the removed payload size, not the entire retained message shell

### Expected files

- `src/workflow.js`
- `src/cmds/stats.js`
- `src/cmds/` new `context.js` command
- `index.ts`
- `src/types.d.ts`
- `src/metadata.js` or a new token-estimation helper file under `src/`
- `tests/` new stats/context command regression file
- `README.md`
- `docs/CONFIGURATION.md`

### Work

- Add lightweight token-estimation helpers for:
  - whole messages
  - tool-result payload text
  - redacted payload delta
- Extend stats tracking with fields such as:
  - `estimatedTokensPruned`
  - `estimatedTokensRedacted`
  - `lastEstimatedTokensSaved`
  - optional reason buckets if useful
- Update `/dcp-stats` output to show both message and token impact.
- Add `/dcp-context` to show a rough current-context breakdown and DCP savings.
- Optionally enrich status text with token savings only if it stays concise.

### Verify

- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`
- `bun test tests/fix-verification.test.ts tests/long-session-pressure.test.ts`

## Phase 5 (P5): docs and regression hardening

### End State

The new behavior is documented, configurable, and covered by regression tests so another agent can safely extend it later without reintroducing eager or unsafe pruning.

### Tests first

Before finalizing docs, make sure the test suite already captures:
- protected tool/path behavior
- age gating
- redaction semantics
- token-aware stats
- exact-signature matching
- tool-pairing safety after all changes

### Expected files

- `README.md`
- `docs/CONFIGURATION.md`
- `skills/pi-dcp/SKILL.md`
- all touched tests from prior phases

### Work

- Update README feature list and architecture sections to describe:
  - protected tools / paths
  - age-gated cleanup
  - redaction vs deletion
  - token-aware visibility
  - `/dcp-context`
- Update configuration docs and generated config template comments to match the final config shape.
- Update the pi-dcp skill doc so future sessions understand the new controls and observability.
- Do a final pass on rule ordering documentation so tool-pairing and recency expectations remain explicit.

### Verify

- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`
- `bun run build`

## Risks and mitigations

- **Risk: redaction breaks provider replay assumptions.**
  - Mitigation: only redact retained `toolResult` payload content, never required identity fields; keep orphan-pruning tests and add redaction-specific pairing tests.
- **Risk: age model is ambiguous and inconsistently applied.**
  - Mitigation: centralize age calculation in helpers and use one documented definition across rules.
- **Risk: generalized signatures over-match distinct commands.**
  - Mitigation: start with a conservative allowlist and exact normalized argument equality only.
- **Risk: token accounting becomes misleading.**
  - Mitigation: label all values as estimated and calculate redaction savings as payload delta rather than full-message removal.

## Decisions / Deviations Log

- 2026-03-27: Explicitly stopped short of planning the full OpenCode `compress` tool and summary-block architecture.
- 2026-03-27: Locked in `/dcp-context` as the visibility path instead of only extending `/dcp-stats`.
- 2026-03-27: Locked in an additive delete-or-redact action model so incremental adoption does not require rewriting every existing rule at once.
- 2026-03-27: Locked in user-turn-based age gating with default threshold `0` to preserve current behavior unless explicitly configured.
- 2026-03-27: Locked in recency semantics that protect recent messages from both pruning and redaction, except for provider-safety orphan cleanup.
- 2026-03-27: Locked the new config surface to top-level protection arrays plus nested `ageGates` and `redaction` objects so execution does not invent API shape mid-stream.
- 2026-03-27: Implemented completed-turn age gating as “later user messages that have some later non-user reply/tool activity”, so a trailing live user prompt does not age older context by itself (`src/metadata.js`, `tests/protection-config.test.ts`).
- 2026-03-27: Implemented protected file patterns with normalized slash paths plus simple exact/`*`/`**`/`?` glob matching, keeping the first pass dependency-free (`src/metadata.js`).
- 2026-03-27: Added an explicit `keep`/`prune`/`redact` action model while keeping `shouldPrune` compatibility, then inserted a workflow mutation stage that applies redacted placeholder payloads before filtering (`src/metadata.js`, `src/workflow.js`).
- 2026-03-27: Updated recency to clear normal prune/redact actions for recent messages and only preserve provider-safety deletions from tool-pairing, which required updating the prior regression expectation around recent superseded tool results (`src/rules/recency.js`, `src/rules/tool-pairing.js`, `tests/fix-verification.test.ts`).
- 2026-03-27: Kept redacted superseded tool results header-only, while resolved-error redactions may include a compact error-tail summary when a recognizable error token is present; this avoids leaking bulky repeated payload text back into context (`src/workflow.js`, `tests/redaction-workflow.test.ts`).
- 2026-03-27: Replaced repeated read/bash matching with normalized exact argument signatures (sorted object keys, object-level null/undefined elision) so same-operation cleanup no longer over-matches different slices/timeouts while still matching reordered arg objects (`src/metadata.js`, `tests/repeated-operation-signatures.test.ts`).
- 2026-03-27: Moved `write`/`edit` supersession identity onto the same shared signature helper in path mode, preserving the earlier path-based behavior while removing bespoke per-rule identity assembly (`src/metadata.js`, `src/rules/superseded-writes.js`).
- 2026-03-27: Updated conversation-pressure analysis to count repeated reads/bash calls by normalized signature instead of only raw path/command strings, with read labels still rendered concisely from path plus slice hints (`src/analysis.js`).
- 2026-03-27: Added lightweight chars/4 token estimators over serialized message payloads, then threaded estimated prune/redaction savings through detailed workflow results and session stats tracking (`src/token-estimation.js`, `src/workflow.js`, `src/events/context.js`).
- 2026-03-27: Implemented `/dcp-context` as a live session inspection command backed by current session messages rather than only last-run metadata, so the command can show the present role/token breakdown even if pruning did not just run (`src/cmds/context.js`, `index.ts`).
- 2026-03-27: Counted redaction savings as the estimated delta between original and redacted messages, which keeps retained message shells out of the savings total and matches the plan’s rough-estimate intent (`src/workflow.js`, `src/token-estimation.js`, `tests/stats-context.test.ts`).
- 2026-03-27: Refreshed README/config/skill docs to describe the new protection controls, age gates, redaction model, exact-signature matching, token-aware stats, and `/dcp-context`, while also fixing the older docs’ outdated prepare/process/filter-only description (`README.md`, `docs/CONFIGURATION.md`, `skills/pi-dcp/SKILL.md`).

## Plan Changelog

- 2026-03-27: Initial plan created from cross-repo pruning review against `../opencode-dynamic-context-pruning`.
- 2026-03-27: Review pass clarified age-gating semantics, redaction-vs-recency precedence, and the exact-signature rollout scope.
- 2026-03-27: Review pass locked the concrete config API for protection, age gates, and redaction toggles.