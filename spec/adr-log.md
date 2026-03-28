# ADR Log

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
