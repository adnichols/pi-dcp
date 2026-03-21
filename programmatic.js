/**
 * Minimal programmatic exports for pi-dcp
 *
 * This module exports only the core workflow functions without the extension-specific
 * code (commands, event handlers) that have heavy peer dependencies.
 *
 * Use this when importing pi-dcp programmatically from pi-mono.
 */
// Core workflow
export { applyPruningWorkflow } from "./src/workflow.js";
// Metadata helpers
export { createMessageWithMetadata, hashMessage, hasToolUse, hasToolResult, isToolBearingMessage, isErrorMessage, extractFilePath, isSameOperation, } from "./src/metadata.js";
// Rule registry
export { registerRule, getAllRules } from "./src/registry.js";
// Built-in rules
export { deduplicationRule } from "./src/rules/deduplication.js";
export { supersededWritesRule } from "./src/rules/superseded-writes.js";
export { errorPurgingRule } from "./src/rules/error-purging.js";
export { toolPairingRule } from "./src/rules/tool-pairing.js";
export { recencyRule } from "./src/rules/recency.js";
//# sourceMappingURL=programmatic.js.map