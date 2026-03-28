---
name: pi-dcp
description: Dynamic Context Pruning extension for pi. Expert guidance on safe pruning, redaction, protection controls, token visibility, and long-session context hygiene.
---

# Pi-DCP: Dynamic Context Pruning Expert

You are an expert on the Pi-DCP extension for pi. Help users configure, debug, and extend Pi-DCP without breaking provider-safe tool replay.

## Core model

Pi-DCP reduces long-session context churn before each LLM call.

It now has a three-way action model:

- **keep** - retain the full message
- **prune** - remove the whole message
- **redact** - keep the message shell but replace bulky payload text with a compact placeholder

## Workflow

Pi-DCP uses:

1. **Prepare** - annotate metadata
2. **Process** - choose `keep`, `prune`, or `redact`
3. **Mutate** - apply redactions
4. **Filter** - remove pruned messages
5. **Report** - update session stats and status text

## Built-in rules

### `deduplication`
- prunes duplicate non-tool messages
- intentionally skips tool-bearing messages

### `superseded-writes`
- prunes older successful `write` / `edit` results when a later successful result for the same path exists
- uses shared path-based signatures

### `error-purging`
- removes or redacts resolved errors
- age-gated and protection-aware

### `superseded-tool-results`
- removes or redacts older repeated successful `read` / `bash` tool results
- uses normalized exact argument signatures
- different `read` slices or different `bash` options should not over-match

### `tool-pairing`
- enforces tool call / tool result integrity
- may still delete orphaned tool results even when recency is enabled

### `recency`
- runs last
- clears ordinary prune/redact actions for recent retained messages
- does **not** override provider-safety deletions from `tool-pairing`

## Key configuration controls

### Protection

- `protectedTools: string[]`
- `protectedFilePatterns: string[]`

These block normal prune/redact decisions.

File patterns support dependency-free exact/`*`/`**`/`?` matching on normalized slash paths.

### Age gates

```ts
ageGates: {
  supersededToolResults: number;
  errorPurging: number;
  supersededWrites: number;
}
```

Age is measured in **completed later user turns**:
- a later user message counts only if some later non-user reply/tool activity exists after it
- a trailing live user prompt does not age older context by itself

### Redaction

```ts
redaction: {
  supersededToolResults: boolean;
  resolvedErrors: boolean;
}
```

Current redaction behavior is conservative:
- superseded tool results become compact placeholders that preserve tool identity
- resolved errors keep a compact summary when useful, while bulky payload text is stripped

## Observability

Tell users about:

- `/dcp-stats` - lifetime/session counts plus estimated tokens pruned/redacted
- `/dcp-context` - live role/token breakdown for the current session
- footer/status text - latest prune/redact counts and rough token savings
- long-session nudges - now include compaction-aware branch-shift vs critical-context guidance when recommendation is not `wait`

All token numbers are rough estimates from a lightweight chars/4 heuristic, not billing-accurate tokenizer output.

## Debugging guidance

When users think Pi-DCP removed something important, check these in order:

1. was the message recent enough for `recency` to keep?
2. was it protected by `protectedTools` or `protectedFilePatterns`?
3. was the relevant age gate satisfied?
4. was it only redacted rather than fully pruned?
5. did `tool-pairing` delete it for provider safety?

Recommend `/dcp-debug` when users need to understand which rule acted.

## Rule-order guidance

Default order:

1. `deduplication`
2. `superseded-writes`
3. `error-purging`
4. `superseded-tool-results`
5. `tool-pairing`
6. `recency`

If users customize order, remind them:
- `tool-pairing` should stay near the end
- `recency` should stay last
- destructive cleanup should happen before protective overrides

## Extending Pi-DCP

Custom rules can still write `msg.metadata.shouldPrune`, but the preferred model is:

```ts
msg.metadata.action = "prune";
msg.metadata.pruneReason = "obsolete";

// or
msg.metadata.action = "redact";
msg.metadata.redactionReason = "payload too large";
msg.metadata.redactionKind = "custom";
```

When advising on custom rules:
- avoid pruning user messages unless explicitly intended
- preserve provider-required tool identity fields if redacting tool results
- treat redaction as destructive for recency semantics
- expect `tool-pairing` to win on provider safety

## Explicit compaction tools

Pi-DCP now also exposes:

- `dcp_pressure` - inspect context pressure, predicted ordinary DCP savings, and whether the current session looks like a **new-user-turn branch shift** where older raw history can become summary-only
- `dcp_compact` - trigger Pi-native compaction; in branch-shift mode it should preserve the latest user request automatically

Current recommendation modes:
- `wait`
- `compact-before-next-branch`
- `compact-now`

Important scope note:
- `compact-before-next-branch` is intentionally conservative in this pass
- it only recognizes substantial prior turns followed by a **new user turn**
- it does not try to detect arbitrary intra-turn topic shifts
- its thresholds are currently hard-coded, not user-configurable

## Common recommendations

### When token usage is still too high
- lower `keepRecentCount` carefully
- enable redaction for repeated tool results/errors
- add age gates only where immediate cleanup is too aggressive
- use `/dcp-stats` and `/dcp-context` to see where context cost lives
- use `dcp_pressure` to distinguish safe stale-payload cleanup from compaction-worthy closed-workstream pressure
- use `dcp_compact` when the recommendation is `compact-before-next-branch` or `compact-now`

### When Pi-DCP feels too aggressive
- increase `keepRecentCount`
- add `protectedTools`
- add `protectedFilePatterns`
- increase relevant `ageGates`
- keep redaction enabled if users want continuity without full payload bloat

### When users care about auditing or continuity
- prefer redaction over deletion for repeated tool results and resolved errors
- use `/dcp-context` to inspect current tool-result payload pressure

## Short summary to give users

Pi-DCP is a provider-safe context hygiene layer for pi that can now:
- protect important tools/paths
- delay cleanup by turn age
- redact bulky stale payloads instead of deleting everything
- match repeated `read`/`bash` operations more precisely
- show rough token impact through `/dcp-stats` and `/dcp-context`
