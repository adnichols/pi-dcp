/**
 * DCP before_agent_start handler.
 */
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DcpConfigWithPruneRuleObjects } from "../types.js";
import type { StatsTracker } from "../cmds/stats.js";

export interface BeforeAgentStartEventHandlerOptions {
	config: DcpConfigWithPruneRuleObjects;
	statsTracker: StatsTracker;
}

export declare function createBeforeAgentStartEventHandler(
	options: BeforeAgentStartEventHandlerOptions,
): (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartEventResult | void>;
