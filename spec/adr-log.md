# ADR Log

## ADR 0004: Add proactive compaction steering for closed-workstream branch shifts
**Status:** Accepted (implemented and verified)
**Date:** 2026-03

**Context:** `pi-dcp` could already prune stale payloads automatically and expose explicit compaction tools, but it was still weak at recognizing when older unique raw history had become summary-safe because a substantial prior turn was closed and a new user branch had begun.

**Decision:**
- extend the shared context-pressure recommendation helper with a compaction-specific `opportunityKind` classification: `none`, `closed-workstream`, `hard-pressure`
- add a new recommendation mode, `compact-before-next-branch`, alongside `wait` and `compact-now`
- keep detection intentionally narrow in v1: only **new-user-turn branch shifts**, not arbitrary intra-turn topic changes
- preserve hard-pressure precedence, self-traffic exclusion, unresolved-error suppression, and explicit Pi-native compaction through `ctx.compact()`
- share wording/rendering across `dcp_pressure`, `dcp_compact`, and `before_agent_start` so tools and nudges stay aligned

**Alternatives considered:**
- OpenCode-style range/message compression
- semantic topic modeling for branch detection
- automatic compaction without explicit agent choice
- leaving compaction steering as a generic churn/pressure nudge only

**Current state:**
- `src/context-pressure.js`
- `src/context-pressure-rendering.js`
- `src/tools/dcp-pressure.js`
- `src/tools/dcp-compact.js`
- `src/events/beforeAgentStart.js`

---

## ADR 0003: Add explicit agent-invoked compaction tools on top of automatic pruning
**Status:** Accepted (implemented and verified)
**Date:** 2026-03

**Context:** `pi-dcp` could already prune automatically and inject long-session nudges, but it lacked a model-callable action surface for inspecting pressure or triggering real compaction.

**Decision:**
- add `dcp_pressure` for explicit inspection of current pressure and predicted ordinary `pi-dcp` savings
- add `dcp_compact` for Pi-native compaction through `ctx.compact()`
- centralize recommendation logic in `src/context-pressure.js` and exclude `dcp_pressure` / `dcp_compact` self-traffic from recommendation-oriented pressure analysis
- keep compaction semantics asynchronous and guard repeated in-flight requests with lightweight in-memory state

**Alternatives considered:**
- OpenCode-style message/range compression tools
- direct extension-managed history rewriting
- passive nudges without an explicit tool workflow

**Current state:**
- `src/context-pressure.js`
- `src/compaction.js`
- `src/tools/dcp-pressure.js`
- `src/tools/dcp-compact.js`
- `src/events/beforeAgentStart.js`
- `index.ts`

---

## ADR 0002: Add conservative stale-file-read invalidation as an opt-in rule
**Status:** Accepted (implemented and verified)
**Date:** 2026-03

**Context:** repeated exact-signature pruning was already available for repeated `read` / `bash` operations, but `pi-dcp` still retained earlier file snapshots after later successful file mutation.

**Decision:**
- add a dedicated `stale-file-reads` rule rather than extending exact-signature dedupe
- invalidate earlier successful `read` results only after later successful `write` / `edit` to the same normalized lexical path
- keep rollout guarded by registering the rule but leaving it out of `DEFAULT_CONFIG.rules`
- add dedicated config support for `ageGates.staleFileReads` and `redaction.staleFileReads`

**Alternatives considered:**
- overloading `superseded-tool-results`
- shell-command path inference
- dependency graph or transitive mutation invalidation
- default-on rollout

**Current state:**
- `src/rules/stale-file-reads.js`
- `src/metadata.js`
- `src/config.js`
- `src/workflow.js`
- `index.ts`

---

## ADR 0001: Adopt action-aware pruning instead of OpenCode-style compression
**Status:** Accepted (implemented and verified)
**Date:** 2026-03

**Context:** `pi-dcp` needed the most useful low-complexity pruning ideas from `opencode-dynamic-context-pruning`, but without importing OpenCode's full compression architecture.

**Decision:**
- extend the automatic pruning pipeline with protected tools, protected file patterns, age-gated destructive cleanup, and additive redaction
- use normalized exact-signature matching for repeated `read` / `bash` cleanup and shared path-based identity for `write` / `edit`
- add lightweight token estimation and operator-visible commands (`/dcp-stats`, `/dcp-context`) instead of a tokenizer dependency or a compression tool
- preserve provider-safe tool call/result integrity with `tool-pairing`, with recency only clearing ordinary prune/redact actions

**Alternatives considered:**
- model-exposed `compress` tool
- range/message compression modes
- persisted summary blocks / placeholder expansion
- prompt override system
- full OpenCode session-state architecture

**Current state:**
- `src/workflow.js`
- `src/metadata.js`
- `src/token-estimation.js`
- `src/cmds/stats.js`
- `src/cmds/context.js`
- `src/rules/superseded-tool-results.js`
- `src/rules/error-purging.js`
- `src/rules/superseded-writes.js`
- `src/rules/recency.js`
- `src/rules/tool-pairing.js`
- `src/rules/stale-file-reads.js`

---
