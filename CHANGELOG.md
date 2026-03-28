# Changelog

## Explicit context compaction tools - 2026-03-28

### Added

- model-callable `dcp_pressure` and `dcp_compact` tools for explicit pressure inspection and Pi-native compaction
- shared context-pressure recommendation helper reused by tools and long-session nudges
- lightweight explicit compaction state/guard handling for in-flight, stale, synchronous-failure, and rejected-promise cases

### Changed

- long-session nudges now point the agent at the explicit inspection → compaction workflow
- explicit compaction recommendations ignore prior `dcp_pressure` / `dcp_compact` self-traffic

### Technical Notes

- verified against `thoughts/plans/explicit-context-compaction-tools.md`
- documented actual minor divergence: the final guard uses in-flight plus stale-time recovery, but no post-completion message-count cooldown
- architecture doc: `spec/architecture/explicit-context-compaction-tools.md`

## Stale file read invalidation - 2026-03-28

### Added

- opt-in `stale-file-reads` rule for invalidating earlier successful `read` results after later successful `write` / `edit` to the same normalized path
- dedicated config knobs: `ageGates.staleFileReads` and `redaction.staleFileReads`
- stale-read redaction placeholders that preserve tool-result structure when enabled

### Changed

- shared path normalization now underpins both stale-read invalidation and path-based write/edit matching
- docs/config comments now expose `stale-file-reads` as a guarded, explicit opt-in rule

### Technical Notes

- verified against `thoughts/plans/stale-file-read-invalidation.md`
- default rollout remains guarded: registered, documented, and configurable, but not enabled in `DEFAULT_CONFIG.rules`
- architecture doc: `spec/architecture/stale-file-read-invalidation.md`

## OpenCode-inspired pruning improvements - 2026-03-28

### Added

- protected tool and protected file-path controls for ordinary prune/redact decisions
- age-gated cleanup for superseded tool results, resolved errors, superseded writes, and stale file reads
- additive redaction for repeated tool results, resolved errors, and stale file reads
- `/dcp-context` for live context-cost inspection alongside token-aware `/dcp-stats`
- normalized exact-signature matching for repeated `read` / `bash` operations and shared path-based identity for `write` / `edit`

### Changed

- the pruning workflow now supports `keep` / `prune` / `redact` actions and mutates retained messages before filtering
- session stats and status text now track estimated token savings for both pruned and redacted content
- recency clears ordinary destructive actions for recent retained messages while `tool-pairing` remains the provider-safety backstop

### Technical Notes

- verified against `thoughts/plans/adopt-opencode-pruning-improvements.md`
- documented actual divergence: implementation also added opt-in stale file read invalidation beyond the original plan scope
- architecture doc: `spec/architecture/opencode-pruning-improvements.md`

## [0.1.0](https://github.com/zenobi-us/pi-dcp/compare/v0.0.1...v0.1.0) (2026-02-03)


### Features

* add tools expansion control and banner ([5c81aac](https://github.com/zenobi-us/pi-dcp/commit/5c81aac2d31df0ab7d0684a33f1947b65b9760e5))


### Bug Fixes

* update installation instructions to require cloning into extensions directory ([89ce1e2](https://github.com/zenobi-us/pi-dcp/commit/89ce1e2dbeacc42a69f7d38b46040ce4f6aa4620))

## 0.0.1 (2026-01-10)


### Features

* initial commit - pi-dcp project setup ([1bb7c5e](https://github.com/zenobi-us/pi-dcp/commit/1bb7c5e12d0737235274bef41bdf41e45dbd3feb))


### Bug Fixes

* adjust version ([a141dd9](https://github.com/zenobi-us/pi-dcp/commit/a141dd9ec243e77de76c04ab547d23b333dbeb3c))
* allow intial manual publish ([bcdf8ca](https://github.com/zenobi-us/pi-dcp/commit/bcdf8cad23b43948f0f0a6fb1ba4eb1e0fc7a452))
* initial release ([dad713d](https://github.com/zenobi-us/pi-dcp/commit/dad713dda0a5070b381df1db9455bdea1fbaa07a))
* syntax in publish ([9d6aa87](https://github.com/zenobi-us/pi-dcp/commit/9d6aa874bf3058975a6a8e252e498d95b1c89071))
* trigger initial release ([a51f78e](https://github.com/zenobi-us/pi-dcp/commit/a51f78ea700b7df041d6d83da125988ef289f707))
