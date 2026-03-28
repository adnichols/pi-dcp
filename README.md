# Pi-DCP: Dynamic Context Pruning Extension

![Monolith logo](pi-dcp-banner.png)

Pi-DCP trims stale conversation context before each LLM call so long coding sessions stay cheaper and easier for the model to follow without breaking tool-call / tool-result replay safety.

## What it does

Pi-DCP now supports both **deletion** and **in-place redaction**:

- removes duplicate plain messages
- removes superseded `write` / `edit` results
- removes or redacts resolved errors
- removes or redacts older repeated `read` / `bash` results
- optionally removes or redacts stale `read` results after later successful `write` / `edit` operations to the same file
- exposes `dcp_pressure` and `dcp_compact` tools so the agent can inspect pressure and trigger pi-native compaction explicitly
- protects recent messages unless provider safety requires deletion
- protects configured tools and file paths from destructive cleanup
- delays destructive cleanup until enough later completed user turns have passed
- reports rough token savings and current-context composition
- nudges the agent during long, noisy sessions

## Installation

Clone the repository into your pi agent extensions directory:

```bash
git clone https://github.com/zenobi-us/pi-dcp.git ~/.pi/agent/extensions/pi-dcp
```

## Commands

- `/dcp-debug` - toggle debug logging
- `/dcp-stats` - show session pruning/redaction counts plus estimated token savings
- `/dcp-context` - show a rough live context breakdown and estimated DCP savings
- `/dcp-toggle` - enable/disable the extension
- `/dcp-recent <number>` - set how many recent messages are always protected
- `/dcp-tools` - show expanded tool information
- `/dcp-logs` - inspect extension logs

## Model-callable context tools

When the extension is enabled, pi-dcp also registers two tools the agent can call directly:

- `dcp_pressure` - inspect current context pressure, repeated inspection churn, and predicted ordinary pi-dcp savings
- `dcp_compact` - trigger pi-native compaction with optional focus instructions

These tools are intentionally different from ordinary automatic pruning:

- automatic pruning only removes/redacts context that pi-dcp can safely trim before the next provider call
- explicit compaction asks pi itself to summarize and reload older context
- `dcp_pressure` ignores prior `dcp_pressure` / `dcp_compact` traffic in its recommendation path so the tools do not inflate their own pressure signal

## Configuration

Pi-DCP loads config from project or user config files, package.json config keys, env vars, or defaults.

Key options:

```ts
export default {
  enabled: true,
  debug: false,
  rules: [
    "deduplication",
    "superseded-writes",
    "error-purging",
    "superseded-tool-results",
    "tool-pairing",
    "recency",
  ],
  keepRecentCount: 10,
  protectedTools: [],
  protectedFilePatterns: [],
  ageGates: {
    supersededToolResults: 0,
    errorPurging: 0,
    supersededWrites: 0,
    staleFileReads: 0,
  },
  redaction: {
    supersededToolResults: false,
    resolvedErrors: false,
    staleFileReads: false,
  },
  nudge: {
    enabled: true,
    minMessages: 60,
    minToolResults: 30,
    minRepeatCount: 3,
    minContextPercent: 70,
    notify: true,
    maxSummaryItems: 2,
  },
};
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for details.

## Architecture

### Workflow

Pi-DCP uses a five-step pipeline:

1. **Prepare** - rules annotate metadata
2. **Process** - rules choose `keep`, `prune`, or `redact`
3. **Mutate** - redactions replace bulky payloads with compact placeholders
4. **Filter** - pruned messages are removed
5. **Report** - stats and status text are updated

### Rule ordering

Default rule order is intentional:

1. `deduplication`
2. `superseded-writes`
3. `error-purging`
4. `superseded-tool-results`
5. `tool-pairing`
6. `recency`

Opt-in rule available but disabled by default:

- `stale-file-reads` (recommended placement: after `superseded-tool-results` and before `tool-pairing`)

Why it matters:

- cleanup rules decide what is obsolete
- `tool-pairing` can still force provider-safety deletions for orphaned tool results
- `recency` runs last so recent retained messages keep their full payloads instead of being pruned/redacted
- explicit compaction is separate from this rule pipeline and is only triggered when the agent or user calls `dcp_compact`

### Matching repeated operations

Repeated-operation cleanup uses shared normalized signatures:

- `read` and `bash` use **exact normalized arguments**
- `write` and `edit` use **shared path-based signatures**
- opt-in `stale-file-reads` uses **normalized file path only**, intentionally ignoring `read` offsets/limits
- protected tools/paths are excluded
- different `read` slices or different `bash` timeouts no longer over-match

### Age gating

Age gates are measured in **completed later user turns**.
A later user turn counts only if some later non-user reply/tool activity exists, so a trailing live user prompt does not age older context by itself.

## Safety controls

### Protected tools

Use `protectedTools` to prevent destructive cleanup for specific tools:

```ts
protectedTools: ["read", "write"]
```

### Protected file paths

Use `protectedFilePatterns` for exact paths or simple glob patterns:

```ts
protectedFilePatterns: [
  "README.md",
  "docs/**",
  "src/**/*.ts",
]
```

### Redaction vs deletion

- **Prune** removes the whole message
- **Redact** keeps the message shell and tool identity, but replaces bulky payload text
- redaction is currently used for older repeated tool results, stale file reads, and resolved errors when enabled
- **Compaction** is different again: it is pi-native session summarization, triggered explicitly through `dcp_compact` rather than by the ordinary prune/redact rules

## Visibility

Pi-DCP provides rough observability without a tokenizer dependency:

- footer/status updates include prune/redaction counts and estimated token savings
- `/dcp-stats` shows lifetime/session totals
- `/dcp-context` shows the current role/token breakdown and tool-result payload pressure
- long-session nudge text highlights repeated reads and repeated bash calls

All token numbers are estimates based on a lightweight chars-per-token heuristic.

## Custom rules

Custom rules still implement the `PruneRule` interface, but can now express an action model:

```ts
const myRule = {
  name: "my-rule",
  process(msg) {
    msg.metadata.action = "prune";
    msg.metadata.pruneReason = "obsolete";

    // or:
    // msg.metadata.action = "redact";
    // msg.metadata.redactionReason = "payload too large";
    // msg.metadata.redactionKind = "custom";
  },
};
```

When writing custom rules:

- avoid touching user messages unless you truly mean to
- prefer `tool-pairing` and `recency` after destructive rules
- treat redaction as destructive for recent-message semantics
- preserve provider-required tool identity fields if you mutate tool results

## Development

### Verification

```bash
bun test
bun x tsc -p tsconfig.json --noEmit
bun run build
```

### Project structure

```text
src/
  analysis.js
  config.js
  metadata.js
  token-estimation.js
  workflow.js
  cmds/
  events/
  rules/
```

## License

MIT
