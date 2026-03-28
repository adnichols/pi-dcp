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
import type { StatsTracker } from "./src/cmds/stats.js";
import { loadConfig } from "./src/config.js";
import { createStatsCommand } from "./src/cmds/stats.js";
import { createContextCommand } from "./src/cmds/context.js";
import { createDebugCommand } from "./src/cmds/debug.js";
import { createToggleCommand } from "./src/cmds/toggle.js";
import { createRecentCommand } from "./src/cmds/recent.js";
import { createInitCommand } from "./src/cmds/init.js";
import { createToolsExpandedCommand } from "./src/cmds/tools-expanded.js";
import { dcpLogsCommand } from "./src/cmds/logs.js";
import { createDcpPressureTool } from "./src/tools/dcp-pressure.js";
import { createDcpCompactTool } from "./src/tools/dcp-compact.js";
import { createExplicitCompactionState } from "./src/compaction.js";
import { createContextEventHandler } from "./src/events/context.js";
import { createBeforeAgentStartEventHandler } from "./src/events/beforeAgentStart.js";
import { createSessionStartEventHandler } from "./src/events/sessionStart.js";
import { getLogger, LogLevel } from "./src/logger.js";

// Register all built-in rules on import
import { registerRule } from "./src/registry.js";
import { deduplicationRule } from "./src/rules/deduplication.js";
import { supersededWritesRule } from "./src/rules/superseded-writes.js";
import { errorPurgingRule } from "./src/rules/error-purging.js";
import { supersededToolResultsRule } from "./src/rules/superseded-tool-results.js";
import { staleFileReadsRule } from "./src/rules/stale-file-reads.js";
import { toolPairingRule } from "./src/rules/tool-pairing.js";
import { recencyRule } from "./src/rules/recency.js";
import type { DcpConfig, DcpConfigWithPruneRuleObjects } from "./src/types.js";

// Register in order they should typically be applied
registerRule(deduplicationRule);
registerRule(supersededWritesRule);
registerRule(errorPurgingRule);
registerRule(supersededToolResultsRule);
registerRule(staleFileReadsRule);
// Tool-pairing MUST run before recency to ensure pairs are intact
registerRule(toolPairingRule);
// Recency should be LAST to override other decisions
registerRule(recencyRule);

export default async function (pi: ExtensionAPI) {
	const config = await loadConfig(pi)

	// Initialize logger with config-based settings
	const logger = getLogger({
		minLevel: config.debug ? LogLevel.DEBUG : LogLevel.INFO,
		enableConsole: false, // Don't duplicate to console (not visible in pi anyway)
	});

	logger.info("pi-dcp extension loaded", {
		enabled: config.enabled,
		debug: config.debug,
		rules: config.rules.length,
	});

	pi.registerCommand("dcp-init", createInitCommand());
	pi.registerCommand("dcp-toggle", createToggleCommand(config));
	pi.registerCommand("dcp-tools", createToolsExpandedCommand());

	if (!config.enabled) {
		return; // Exit early if extension is disabled
	}

	const explicitCompactionState = createExplicitCompactionState();
	pi.registerTool(createDcpPressureTool(config));
	pi.registerTool(createDcpCompactTool(config, explicitCompactionState));

	// Track stats across session
	const statsTracker: StatsTracker = {
		totalPruned: 0,
		totalRedacted: 0,
		totalProcessed: 0,
		estimatedTokensPruned: 0,
		estimatedTokensRedacted: 0,
		lastEstimatedTokensSaved: 0,
		totalNudges: 0,
	};

	// Register commands
	pi.registerCommand("dcp-debug", createDebugCommand(config));
	pi.registerCommand("dcp-recent", createRecentCommand(config));
	pi.registerCommand("dcp-stats", createStatsCommand(statsTracker, config.rules.length));
	pi.registerCommand("dcp-context", createContextCommand(statsTracker));
	pi.registerCommand("dcp-logs", dcpLogsCommand);

	// Hook into context event (before each LLM call)
	pi.on("context", createContextEventHandler({ config, statsTracker }));
	pi.on("before_agent_start", createBeforeAgentStartEventHandler({ config, statsTracker }));
	pi.on("session_start", createSessionStartEventHandler({ config }));

}



// Export workflow for programmatic use
export { applyPruningWorkflow } from "./src/workflow.js";
export type { DcpConfig, DcpConfigWithPruneRuleObjects } from "./src/types.js";
export { getAllRules } from "./src/registry.js";
