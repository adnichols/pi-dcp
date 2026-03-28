/// <reference path="./test-shims.d.ts" />

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getContextPressureSnapshot } from "../src/context-pressure";
import { createBeforeAgentStartEventHandler } from "../src/events/beforeAgentStart";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects, StatsTracker } from "../src/types";
import { assistantToolCall, toolResult } from "./pruning-test-helpers";

const baseConfig: DcpConfigWithPruneRuleObjects = {
	enabled: true,
	debug: false,
	rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, supersededToolResultsRule, staleFileReadsRule, toolPairingRule, recencyRule],
	keepRecentCount: 0,
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
	logDir: "",
	};

function createStatsTracker(): StatsTracker {
	return {
		totalPruned: 0,
		totalRedacted: 0,
		totalProcessed: 0,
		estimatedTokensPruned: 0,
		estimatedTokensRedacted: 0,
		lastEstimatedTokensSaved: 0,
		totalNudges: 0,
	};
}

describe("Explicit compaction nudge integration", () => {
	test("nudges reference dcp_pressure and dcp_compact when compaction is recommended", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect repeatedly" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
		];
		const config: DcpConfigWithPruneRuleObjects = {
			...baseConfig,
			nudge: {
				enabled: true,
				minMessages: 1,
				minToolResults: 1,
				minRepeatCount: 2,
				minContextPercent: 50,
				notify: false,
				maxSummaryItems: 2,
			},
		};
		const handler = createBeforeAgentStartEventHandler({ config, statsTracker: createStatsTracker() });
		const result = await handler(
			{ systemPrompt: "Base system prompt" } as any,
			{
				sessionManager: {
					getEntries: () => messages.map((message) => ({ type: "message", message })),
				},
				getContextUsage: () => ({ percent: 85, tokens: 120000 }),
				hasUI: false,
			} as any,
		);

		expect(result?.systemPrompt).toContain("dcp_pressure");
		expect(result?.systemPrompt).toContain("dcp_compact");
		expect(result?.systemPrompt).toContain("Current recommendation: compact now.");
	});

	test("nudge recommendation text stays consistent with the shared pressure helper", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect repeatedly" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
		];
		const config: DcpConfigWithPruneRuleObjects = {
			...baseConfig,
			nudge: {
				enabled: true,
				minMessages: 1,
				minToolResults: 1,
				minRepeatCount: 2,
				minContextPercent: 50,
				notify: false,
				maxSummaryItems: 2,
			},
		};
		const snapshot = getContextPressureSnapshot(messages, config, { percent: 85, tokens: 120000 });
		const handler = createBeforeAgentStartEventHandler({ config, statsTracker: createStatsTracker() });
		const result = await handler(
			{ systemPrompt: "Base system prompt" } as any,
			{
				sessionManager: {
					getEntries: () => messages.map((message) => ({ type: "message", message })),
				},
				getContextUsage: () => ({ percent: 85, tokens: 120000 }),
				hasUI: false,
			} as any,
		);

		expect(snapshot.recommendation).toBe("compact-now");
		expect(result?.systemPrompt).toContain("Current recommendation: compact now.");
	});

	test("prefers branch entries so nudges stay aligned with tool recommendations", async () => {
		const branchMessages: AgentMessage[] = [
			{ role: "user", content: "Inspect repeatedly" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
		];
		const config: DcpConfigWithPruneRuleObjects = {
			...baseConfig,
			nudge: {
				enabled: true,
				minMessages: 1,
				minToolResults: 1,
				minRepeatCount: 2,
				minContextPercent: 50,
				notify: false,
				maxSummaryItems: 2,
			},
		};
		const handler = createBeforeAgentStartEventHandler({ config, statsTracker: createStatsTracker() });
		const result = await handler(
			{ systemPrompt: "Base system prompt" } as any,
			{
				sessionManager: {
					getBranch: () => branchMessages.map((message) => ({ type: "message", message })),
					getEntries: () => [{ type: "message", message: { role: "user", content: "older unrelated message" } }],
				},
				getContextUsage: () => ({ percent: 85, tokens: 120000 }),
				hasUI: false,
			} as any,
		);

		expect(result?.systemPrompt).toContain("Current recommendation: compact now.");
	});

	test("does not inject a nudge when pressure remains low", async () => {
		const config: DcpConfigWithPruneRuleObjects = {
			...baseConfig,
			nudge: {
				enabled: true,
				minMessages: 10,
				minToolResults: 10,
				minRepeatCount: 3,
				minContextPercent: 70,
				notify: false,
				maxSummaryItems: 2,
			},
		};
		const handler = createBeforeAgentStartEventHandler({ config, statsTracker: createStatsTracker() });
		const result = await handler(
			{ systemPrompt: "Base system prompt" } as any,
			{
				sessionManager: {
					getEntries: () => [{ type: "message", message: { role: "user", content: "Hello" } }],
				},
				getContextUsage: () => ({ percent: 20, tokens: 4000 }),
				hasUI: false,
			} as any,
		);

		expect(result).toBeUndefined();
	});
});
