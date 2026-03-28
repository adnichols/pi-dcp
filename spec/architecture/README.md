# Architecture Docs

| Feature | Document | Status | Summary |
|---|---|---|---|
| Proactive Compaction Steering | [proactive-compaction-steering.md](./proactive-compaction-steering.md) | ✅ Implemented | Adds branch-shift-aware compaction steering so older closed work is more likely to become summary-only before a new heavy branch begins. |
| Explicit Context Compaction Tools | [explicit-context-compaction-tools.md](./explicit-context-compaction-tools.md) | ✅ Implemented | Adds `dcp_pressure` and `dcp_compact` for agent-invoked pressure inspection and Pi-native compaction. |
| Stale File Read Invalidation | [stale-file-read-invalidation.md](./stale-file-read-invalidation.md) | ✅ Implemented | Adds an opt-in rule that invalidates earlier `read` results after later successful `write` / `edit` to the same file. |
| OpenCode-Inspired Pruning Improvements | [opencode-pruning-improvements.md](./opencode-pruning-improvements.md) | ✅ Implemented | Adds protections, age-gated prune/redact decisions, exact-signature cleanup, and token-aware context visibility. |
