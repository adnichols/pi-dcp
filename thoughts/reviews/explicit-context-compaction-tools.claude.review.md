# Claude review: explicit context compaction tools

Date: 2026-03-28
Reviewer: Claude Code
Scope: `dcp_pressure`, `dcp_compact`, shared pressure logic, before-agent-start nudges, docs, and tests.

## Overall assessment

Well-structured and internally consistent implementation. Shared `getContextPressureSnapshot()` keeps `dcp_pressure`, `dcp_compact`, and nudges aligned. No critical bugs were identified.

## Findings

### Medium

1. **`ctx.compact()` API shape was assumed, not validated**
   - Risk: if the callback-based call shape were wrong, explicit compaction could fail at runtime and leave the in-flight latch stuck.
   - Follow-up taken: validated against pi compaction docs and the installed `examples/extensions/trigger-compact.ts` example, which uses `ctx.compact({ customInstructions, onComplete, onError })`.

2. **`inFlight` latch had no timeout/recovery**
   - Risk: if callbacks never fired, the session could remain permanently blocked from future explicit compaction attempts.
   - Follow-up taken: add stale in-flight recovery based on `lastStartedAt` and recover state before handling a new request.

### Low / Low-Medium

3. **Nudges used `getEntries()` while tools preferred `getBranch()`**
   - Risk: nudges and tools could disagree in branched sessions.
   - Follow-up taken: align `beforeAgentStart` with tool behavior by preferring `getBranch()` and falling back to `getEntries()`.

4. **Tool fallback/error paths lacked coverage**
   - Missing coverage:
     - `getEntries()` fallback path
     - `ctx.compact` unavailable path
   - Follow-up taken: add tests for these paths.

5. **No protection against synchronous `ctx.compact()` throws**
   - Risk: state could remain in-flight if `ctx.compact()` threw immediately.
   - Follow-up taken: wrap `ctx.compact()` in `try/catch`, reset state on synchronous failure, and surface a failed tool result.

## Response summary

The implementation was hardened in response to the review by:
- validating the callback-based `ctx.compact()` API against pi docs/examples
- adding stale in-flight compaction recovery
- handling synchronous `ctx.compact()` failures cleanly
- aligning nudges with branch-scoped session data
- adding test coverage for `getEntries()` fallback and unavailable/failing compaction paths

## Result

After these changes:
- targeted tests pass
- full `bun test` passes
- `bun x tsc -p tsconfig.json --noEmit` passes
- `bun run build` passes
