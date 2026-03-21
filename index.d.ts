/**
 * Pi-DCP: Dynamic Context Pruning Extension
 *
 * Intelligently prunes conversation context to optimize token usage
 * while preserving conversation coherence.
 *
 * Features:
 * - Deduplication: Remove duplicate tool outputs
 * - Superseded writes: Remove older file versions
 * - Error purging: Remove resolved errors
 * - Recency protection: Always keep recent messages
 *
 * Architecture:
 * - Prepare phase: Rules annotate message metadata
 * - Process phase: Rules make pruning decisions
 * - Filter phase: Remove pruned messages
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI): Promise<void>;
export { applyPruningWorkflow } from "./src/workflow.js";
export { DcpConfig, DcpConfigWithPruneRuleObjects } from "./src/types.js";
export { getAllRules } from "./src/registry.js";
//# sourceMappingURL=index.d.ts.map