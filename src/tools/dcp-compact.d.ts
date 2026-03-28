import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ExplicitCompactionState } from "../compaction.js";
import type { DcpConfigWithPruneRuleObjects } from "../types.js";

export declare function createDcpCompactTool(
    config: DcpConfigWithPruneRuleObjects,
    state: ExplicitCompactionState,
): ToolDefinition;
