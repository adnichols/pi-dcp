# Configuration Guide

Pi-DCP uses a dependency-light config loader so it can run from a source checkout or symlinked extension directory without requiring an installed runtime config package.

## Resolution order

Highest to lowest priority:

1. CLI flags (`--dcp-enabled`, `--dcp-debug`)
2. Environment variables (`DCP_ENABLED`, `DCP_DEBUG`, `DCP_KEEP_RECENT_COUNT`, `DCP_RULES`)
3. Project config file in the current working directory
4. User config file in `~`
5. `package.json` keys: `pi-dcp` or `dcp`
6. Built-in defaults

## Supported config files

- `dcp.config.ts`
- `dcp.config.mts`
- `dcp.config.js`
- `dcp.config.mjs`
- `dcp.config.cjs`
- `dcp.config.json`
- `dcp.config.toml`
- `dcp.config.yaml`
- `dcp.config.yml`
- `.dcprc`
- `.dcprc.json`
- `.dcprc.toml`
- `.dcprc.yaml`
- `.dcprc.yml`

## Config shape

```ts
export interface DcpConfig {
  enabled?: boolean;
  debug?: boolean;
  keepRecentCount: number;
  protectedTools?: string[];
  protectedFilePatterns?: string[];
  ageGates?: {
    supersededToolResults?: number;
    errorPurging?: number;
    supersededWrites?: number;
    staleFileReads?: number;
  };
  redaction?: {
    supersededToolResults?: boolean;
    resolvedErrors?: boolean;
    staleFileReads?: boolean;
  };
  logDir?: string;
  nudge?: {
    enabled?: boolean;
    minMessages?: number;
    minToolResults?: number;
    minRepeatCount?: number;
    minContextPercent?: number;
    notify?: boolean;
    maxSummaryItems?: number;
  };
}
```

## Default config

```ts
export default {
  enabled: true,
  debug: true,
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

## Option reference

### `keepRecentCount`

Number of trailing messages that recency always protects from normal prune/redact decisions.

Provider-safety orphan cleanup from `tool-pairing` can still delete invalid tool results even when they are recent.

### `protectedTools`

Exact tool-name allowlist for destructive-action protection.

```ts
protectedTools: ["read", "write"]
```

If a message belongs to one of these tools, normal cleanup rules will not prune or redact it.

### `protectedFilePatterns`

Exact file paths or simple glob patterns that block normal prune/redact decisions.

Supported pattern style is intentionally simple and dependency-free:

- exact paths: `README.md`
- segment wildcard: `src/*.ts`
- recursive wildcard: `src/**/*.ts`
- single-char wildcard: `file-?.txt`

Paths are matched after slash normalization.

### `ageGates`

Minimum completed later user turns required before destructive cleanup can apply.

```ts
ageGates: {
  supersededToolResults: 2,
  errorPurging: 1,
  supersededWrites: 3,
  staleFileReads: 2,
}
```

A **completed later user turn** means a later user message that already has some later non-user reply/tool activity after it. A trailing live user prompt does not age older context by itself.

### `redaction`

Enable in-place redaction instead of full deletion for supported cleanup paths.

```ts
redaction: {
  supersededToolResults: true,
  resolvedErrors: true,
  staleFileReads: true,
}
```

Current behavior:

- `supersededToolResults: true` keeps older repeated `read`/`bash` tool results but replaces bulky payloads with compact placeholders
- `staleFileReads: true` keeps stale pre-mutation `read` results but replaces them with compact placeholders
- `resolvedErrors: true` keeps resolved error messages but strips bulky error payload text

### `nudge`

Controls long-session prompt nudging and UI notifications.

- `minMessages`: minimum conversation size before nudging
- `minToolResults`: minimum tool-result count before nudging
- `minRepeatCount`: repeated-operation count that qualifies as churn
- `minContextPercent`: estimated context-window percentage threshold
- `notify`: whether to emit UI notifications
- `maxSummaryItems`: how many repeated reads/bash commands to include in the summary

## Example configs

### Conservative defaults with visibility only

```ts
import type { DcpConfig } from "~/.pi/agent/extensions/pi-dcp/src/types";

export default {
  enabled: true,
  debug: false,
  keepRecentCount: 10,
} satisfies DcpConfig;
```

### Safe cleanup with protected docs and delayed pruning

```ts
import type { DcpConfig } from "~/.pi/agent/extensions/pi-dcp/src/types";

export default {
  keepRecentCount: 12,
  protectedTools: ["write"],
  protectedFilePatterns: ["docs/**", "README.md"],
  ageGates: {
    supersededToolResults: 2,
    errorPurging: 1,
    supersededWrites: 3,
    staleFileReads: 2,
  },
} satisfies DcpConfig;
```

### Aggressive cleanup with redaction enabled

```ts
import type { DcpConfig } from "~/.pi/agent/extensions/pi-dcp/src/types";

export default {
  keepRecentCount: 8,
  redaction: {
    supersededToolResults: true,
    resolvedErrors: true,
    staleFileReads: true,
  },
  nudge: {
    enabled: true,
    minMessages: 40,
    minToolResults: 20,
    minRepeatCount: 2,
    minContextPercent: 60,
    notify: true,
    maxSummaryItems: 3,
  },
} satisfies DcpConfig;
```

## Runtime commands

- `/dcp-toggle`
- `/dcp-debug`
- `/dcp-recent <number>`
- `/dcp-stats`
- `/dcp-context`

## Built-in rules

1. `deduplication`
2. `superseded-writes`
3. `error-purging`
4. `superseded-tool-results`
5. `tool-pairing`
6. `recency`

Additional opt-in built-in rule:

7. `stale-file-reads` (recommended placement: after `superseded-tool-results` and before `tool-pairing`)

Default ordering matters:

- cleanup rules run first
- `tool-pairing` enforces provider-safe tool call/result integrity
- `recency` runs last and clears ordinary prune/redact actions for recent retained messages

## Observability

Pi-DCP exposes only rough token estimates.

- `/dcp-stats` shows lifetime/session counts plus estimated tokens pruned/redacted
- `/dcp-context` shows the current role/token breakdown and tool-result payload pressure
- footer/status text includes the last run’s rough savings

Token estimates use a lightweight chars/4 heuristic over serialized message payloads. They are directional, not billing-accurate.

## Troubleshooting

### Config not loading

- verify file location/name
- enable `--dcp-debug=true`
- check for syntax errors in JSON/TOML/YAML/TS
- look for `[pi-dcp] Loaded config from ...` in logs

### A tool result was kept unexpectedly

Check, in order:

- whether the tool is in `protectedTools`
- whether the file path matches `protectedFilePatterns`
- whether the relevant `ageGates` threshold was met (`staleFileReads` for stale read invalidation)
- whether `keepRecentCount` protected it
- whether `tool-pairing` kept it for provider safety

### A recent tool result was still deleted

That usually means `tool-pairing` detected an orphaned or otherwise provider-unsafe tool result. Recency does not override provider-safety deletions.
