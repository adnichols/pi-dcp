# Plan: stale file read invalidation after later write/edit

## Goal

Add a conservative mutation-aware pruning rule to `pi-dcp` so an earlier successful `read(path)` can be removed or redacted after a later successful `write(path)` or `edit(path)` to the same normalized file path.

This is intentionally narrower than generalized mutation inference:
- only `read` -> later `write`/`edit`
- only same normalized path
- only successful top-level `toolResult` messages
- no `bash`
- no `grep` / `find`
- no shell-command path inference
- no dependency graph or transitive invalidation

## Repo reality validated

- Current exact-signature pruning lives in `src/rules/superseded-tool-results.js` and is intentionally scoped to repeated successful `read`/`bash` operations with the same normalized argument signature.
- Current write supersession pruning lives in `src/rules/superseded-writes.js` and is path-based for repeated `write`/`edit` results.
- Shared matching/protection helpers already exist in `src/metadata.js`, especially `getToolResultDescriptor()`, `extractFilePath()`, `getOperationKey()`, `getDestructiveActionGuard()`, `isErrorMessage()`, `markForPrune()`, and `markForRedaction()`.
- Config currently exposes `protectedTools`, `protectedFilePatterns`, `ageGates.{supersededToolResults,errorPurging,supersededWrites}`, and `redaction.{supersededToolResults,resolvedErrors}` in `src/config.js` and `src/types.d.ts`.
- Recency protection runs last via `src/rules/recency.js`, so any new destructive rule must rely on that existing override rather than re-implement recency checks.
- Tool-pairing protection runs after normal pruning rules and before recency, so any new rule must only target top-level `toolResult` messages and preserve normal pairing invariants.
- There is no existing `thoughts/specs/product_intent.md` or `thoughts/plans/AGENTS.md` in this repo.

## Acceptance criteria

- Earlier successful `read(path)` results are invalidated by a later successful `write(path)` or `edit(path)` to the same normalized path.
- Matching uses normalized file path only for invalidation; read `offset`/`limit` do not block invalidation.
- Failed `write`/`edit` results do not invalidate earlier reads.
- Reads of other files are unaffected.
- Existing protections still apply: `keepRecentCount`, `protectedTools`, `protectedFilePatterns`, and configured age gates.
- Existing repeated exact-signature pruning for `read`/`bash` still behaves as it does today.
- Rollout is conservative and clearly separable from OpenCode-parity exact-signature cleanup.

## Open Questions

- None. The plan below locks the implementation choices so execution does not need to invent semantics mid-flight.

## Implementation decisions locked for execution

- **Add a new rule**: implement this as a dedicated rule, recommended name: `stale-file-reads`, instead of extending `superseded-tool-results`.
  - Rationale: current `superseded-tool-results` is exact-signature dedupe for repeated idempotent inspections; the new behavior is mutation invalidation across tool types and should stay independently configurable, testable, and observable.
- **Recommended rule order**: place `stale-file-reads` after `superseded-tool-results` and before `tool-pairing`.
  - This keeps current exact duplicate behavior/reasons intact, then adds mutation-driven cleanup only for the remaining stale reads exact-signature logic does not already remove.
- **Trigger semantics**:
  - candidate to invalidate: earlier successful top-level `toolResult` for `read`
  - invalidating event: later successful top-level `toolResult` for `write` or `edit`
  - match key: same normalized file path only
  - no matching on bash command output, no shell inference, no grep/find, no dependency graph
- **Path matching semantics**:
  - use file path only for stale-read invalidation
  - ignore read `offset` and `limit`
  - rationale: any successful file mutation makes prior slices of that file potentially stale
- **Normalization choice**:
  - strengthen shared path normalization in `src/metadata.js` rather than building rule-local normalization
  - normalize slash direction and collapse lexical `.` / `..` path segments
  - do not attempt cwd-based resolution or symlink/canonical filesystem resolution in the first pass
- **Protection model**:
  - reuse `getDestructiveActionGuard()` against the candidate stale `read` result
  - do not add separate protection evaluation for the later `write`/`edit`, since only the earlier read is being destructively changed
  - explicitly document that `protectedTools` applies to the message being pruned/redacted; for this rule that means protecting `read` suppresses invalidation, while protecting `write`/`edit` alone does not
- **Config model**:
  - if shipped conservatively, add dedicated config knobs instead of reusing `supersededToolResults`
  - recommended additions:
    - `ageGates.staleFileReads?: number`
    - `redaction.staleFileReads?: boolean`
  - guarded rollout should omit `stale-file-reads` from `DEFAULT_CONFIG.rules` initially
- **Default destructive behavior**:
  - if the rule is enabled, default to pruning the stale read result entirely
  - optional redaction can be added behind `redaction.staleFileReads`
  - rationale: once a later write/edit succeeds, the older file snapshot is more misleading than useful in long-horizon coding sessions

## Progress

- [x] P1 Phase 1: add failing tests and metadata support for normalized same-path mutation matching
- [x] P2 Phase 2: implement the `stale-file-reads` rule and wire safety/config behavior
- [x] P3 Phase 3: cover interaction cases, redaction option, and guarded rollout plumbing

## Phase 1 (P1): add failing tests and metadata support for normalized same-path mutation matching

### End State

The repo has failing tests that fully define the desired stale-read invalidation behavior, and `src/metadata.js` exposes the normalized file-path helpers needed to implement it safely and consistently.

### Tests first

Add failing coverage for the exact behavior matrix before implementing the rule.

Recommended test placement:
- new `tests/stale-file-reads.test.ts` for core invalidation semantics
- extend `tests/protection-config.test.ts` for protections and age-gate behavior
- extend `tests/redaction-workflow.test.ts` only if redaction support is implemented in this pass
- optionally extend `tests/repeated-operation-signatures.test.ts` for the post-write reread interaction case

Specific failing cases to add first:
1. `read -> edit` same path => older read invalidated
2. `read -> write` same path => older read invalidated
3. `read(a) -> write(b)` => no invalidation
4. failed `write`/`edit` does not invalidate earlier read
5. recent read protected by `keepRecentCount`
6. `protectedTools: ["read"]` prevents stale-read invalidation
7. `protectedFilePatterns` matching the file path prevents stale-read invalidation
8. one read followed by multiple successful writes still invalidates only once and keeps later mutation history intact
9. `read(before) -> write -> read(after same args) -> read(after same args again)` interaction:
   - stale-file-reads should eliminate the pre-write read
   - existing exact-signature pruning should still collapse older post-write duplicate reads
   - newest post-write read survives

### Expected files

- `tests/stale-file-reads.test.ts` (new)
- `tests/protection-config.test.ts`
- `tests/repeated-operation-signatures.test.ts`
- `src/metadata.js`
- `src/types.d.ts` (only if helper-driven metadata/config typing needs extension immediately)

### Work

- Add a focused test helper file mirroring existing test patterns (`assistantToolCall`, `toolResult`, local config builder).
- In `src/metadata.js`, introduce or export a shared normalized file-path helper for file-bearing tools.
  - Keep it lexical only.
  - Reuse it from `extractFilePath()` so reads and writes/edit results normalize the same way.
- Add a small helper for mutation-aware matching if it improves clarity, e.g.:
  - `isSuccessfulToolResultFor(message, messages, index, toolNames)`
  - or `getNormalizedToolFilePath(message, messages, index)`
- Keep `getOperationKey()` unchanged for exact-signature dedupe; stale-read invalidation should not depend on operation signature equality.

### Verify

- `bun test tests/stale-file-reads.test.ts`
- `bun test tests/protection-config.test.ts tests/repeated-operation-signatures.test.ts`

## Phase 2 (P2): implement the `stale-file-reads` rule and wire safety/config behavior

### End State

A dedicated `stale-file-reads` rule prunes older successful `read` results after a later successful `write`/`edit` to the same normalized path, while honoring all existing destructive-action protections.

### Tests first

Use the failing cases from Phase 1 as the contract. Add any missing guard-specific failures before coding:
- age gate blocks stale-read invalidation until enough completed later user turns exist
- failed writes do not count as invalidators even if later successful reads occur

### Expected files

- `src/rules/stale-file-reads.js` (new, recommended)
- `index.ts`
- `src/config.js`
- `src/types.d.ts`
- `src/metadata.js`
- `tests/stale-file-reads.test.ts`
- `tests/protection-config.test.ts`

### Work

- Implement `src/rules/stale-file-reads.js` with the same prepare/process split used by the existing rules.

Recommended prepare behavior:
- only annotate successful `read` tool results
- store:
  - `toolName = "read"`
  - `filePath` = normalized path from shared helper
  - optional `operationKind = "read"`
- skip anything without a normalized path

Recommended process behavior:
- no-op if another rule already assigned a destructive action
- only consider candidate messages that are successful `read` tool results
- scan later messages for the first successful `write` or `edit` tool result with the same normalized `filePath`
- require top-level `toolResult` messages only
- ignore failed writes/edits via `isErrorMessage()`
- when a later mutation exists, run `getDestructiveActionGuard(msg.message, ctx.messages, ctx.index, ctx.config, ctx.config.ageGates?.staleFileReads ?? 0)`
- if allowed:
  - prune by default with reason like `stale read invalidated by later successful write/edit to ${filePath}`
  - optionally redact when `ctx.config.redaction?.staleFileReads` is enabled

- Wire registration in `index.ts`.
- Recommended guarded rollout:
  - register the rule so it is available by name
  - do **not** add it to `DEFAULT_CONFIG.rules` yet
  - extend config comments/templates/types with `staleFileReads` age gate and redaction toggle
  - update generated config template text in `src/config.js` so the rule appears in the available-rules comments but not in the default enabled list
- If config shape changes, update both `src/config.js` defaults/normalization and `src/types.d.ts` declarations together.

### Verify

- `bun test tests/stale-file-reads.test.ts tests/protection-config.test.ts`
- `bun x tsc -p tsconfig.json --noEmit`

## Phase 3 (P3): cover interaction cases, redaction option, and guarded rollout plumbing

### End State

The new rule works cleanly with exact-signature read dedupe, recency, tool-pairing, and optional redaction, and ships in the most conservative configuration shape.

### Tests first

Add or finish failing integration cases for:
- recency clearing stale-read prune/redact decisions for recent messages
- redaction placeholder behavior for stale reads if `redaction.staleFileReads` is added
- interaction with exact duplicate reads after a mutation
- tool-pairing invariants remain intact when stale reads are pruned or redacted

### Expected files

- `tests/redaction-workflow.test.ts`
- `tests/repeated-operation-signatures.test.ts`
- `tests/fix-verification.test.ts` (only if a pairing regression assertion is needed)
- `src/workflow.js` (only if a new redaction kind label is needed)
- `src/config.js`
- `src/types.d.ts`
- `README.md`
- `docs/CONFIGURATION.md`

### Work

- If redaction is supported:
  - add `redactionKind: "stale-file-read"`
  - update `src/workflow.js` redaction label construction so stale reads get a clear placeholder, e.g. `redacted stale file read`
- Confirm recency stays centralized in `src/rules/recency.js`; do not duplicate recency checks inside the new rule.
- Confirm tool-pairing needs no special handling because only result-side payloads/messages are affected.
- Document the guarded rollout:
  - recommended first enablement is explicit rule inclusion in user config
  - default remains off until live-session evidence is re-validated

### Verify

- `bun test tests/stale-file-reads.test.ts tests/redaction-workflow.test.ts tests/repeated-operation-signatures.test.ts tests/fix-verification.test.ts`
- `bun test`
- `bun x tsc -p tsconfig.json --noEmit`

## Practical recommendations for execution

### Rule design

- **Recommendation**: add a new rule `src/rules/stale-file-reads.js`.
- **Do not** fold this into `superseded-tool-results.js` unless minimizing file count is more important than keeping exact-signature dedupe and mutation invalidation separately configurable.
- Keep the rule narrowly scoped to:
  - earlier successful `read`
  - later successful `write`/`edit`
  - same normalized path only

### Metadata / matching requirements

- Reuse `getToolResultDescriptor()` for tool/result association.
- Reuse and strengthen `extractFilePath()` so both read and write/edit results resolve through one normalized path helper.
- Add/export a dedicated normalized path helper in `src/metadata.js` instead of re-implementing normalization inside the rule.
- Match on **file path only**, not `offset`/`limit`, for stale-read invalidation.
- Keep `getOperationKey()` for exact duplicate pruning only.

### Protection and safety behavior

- Honor `keepRecentCount` by relying on existing `recencyRule` last in rule order.
- Honor `protectedTools` and `protectedFilePatterns` by running `getDestructiveActionGuard()` on the candidate stale read.
- Lock the semantics that tool protection is checked against the destructively changed message:
  - `protectedTools: ["read"]` prevents invalidation
  - `protectedTools: ["write"]` by itself does **not** prevent invalidation, because the later write/edit message is not being pruned or redacted
- Honor existing destructive-action precedence via `hasDestructiveAction()` early return.
- Honor age gates with a **dedicated** `ageGates.staleFileReads`, not `supersededToolResults`.
- Do not add any new shell or dependency inference in this pass.

### Mutation behavior

- Recommended default if enabled: **prune stale reads entirely**.
- Optional mode: `redaction.staleFileReads` retains a placeholder tool result instead of deleting the message.
- Recommended default rollout value: `false` for redaction.

### Rollout recommendation

- **Recommendation**: ship guarded, not default-on.
- Most conservative config shape:
  - add rule name `"stale-file-reads"`
  - register it, but do not include it in `DEFAULT_CONFIG.rules`
  - add optional knobs:
    - `ageGates.staleFileReads: 0`
    - `redaction.staleFileReads: false`
  - list the rule in config-template/docs comments as available but opt-in
- This gives explicit opt-in for the deliberate divergence from OpenCode parity while preserving the current default behavior for all existing users.

## Risks and mitigations

- **Risk: path normalization under-matches equivalent paths**
  - Mitigation: centralize lexical normalization in `src/metadata.js` and cover `./foo`, `foo`, and slash-direction cases in unit tests.
- **Risk: config drift if the rule is added without dedicated knobs**
  - Mitigation: keep `stale-file-reads` independently configurable instead of overloading `supersededToolResults` semantics.
- **Risk: duplicate prune reasons in reread-after-write flows**
  - Mitigation: run `stale-file-reads` after `superseded-tool-results` and keep `hasDestructiveAction()` short-circuiting.
- **Risk: over-broad future expansion**
  - Mitigation: explicitly document non-goals in tests and config comments: no bash inference, no grep/find invalidation, no dependency graph.

## Decisions / Deviations Log

- 2026-03-27: Locked the recommendation to a new `stale-file-reads` rule instead of extending `superseded-tool-results`, because mutation invalidation is a distinct behavior from exact-signature dedupe.
- 2026-03-27: Locked stale-read matching to normalized file path only, intentionally ignoring `read` offsets and limits.
- 2026-03-27: Locked rollout to guarded opt-in by rule inclusion, with dedicated `ageGates.staleFileReads` and `redaction.staleFileReads` if config plumbing is added.
- 2026-03-27: Locked protection semantics to the candidate stale `read` message only; `protectedTools: ["read"]` blocks invalidation, while protecting `write`/`edit` alone does not.
- 2026-03-27: Locked the initial scope to top-level successful `read` and later successful `write`/`edit` tool results only; no shell inference or dependency tracking.
- 2026-03-27: Added a temporary no-op `src/rules/stale-file-reads.js` scaffold during Phase 1 so the new failing tests could compile before Phase 2 implements the rule semantics.
- 2026-03-27: Kept `stale-file-reads` registered but out of `DEFAULT_CONFIG.rules`; docs and config templates now present it as an explicit opt-in rule with dedicated `ageGates.staleFileReads` and `redaction.staleFileReads` controls.

## Plan Changelog

- 2026-03-27: Initial plan created from validated repo state and live-session findings about mutation-driven stale context.
- 2026-03-27: Review pass clarified protection semantics, and added config-template/doc updates for guarded opt-in rollout.