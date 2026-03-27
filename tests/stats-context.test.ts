/// <reference path="./test-shims.d.ts" />

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { analyzeConversationPressure } from "../src/analysis";
import { createContextCommand } from "../src/cmds/context";
import { createStatsCommand } from "../src/cmds/stats";
import { estimateMessageTokens } from "../src/token-estimation";
import { deduplicationRule } from "../src/rules/deduplication";
import { recencyRule } from "../src/rules/recency";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflowDetailed } from "../src/workflow";

describe("Token-aware stats and context visibility", () => {
	const assistantToolCall = (id: string, name: string, args: Record<string, unknown>): AgentMessage =>
		({
			role: "assistant",
			content: [
				{ type: "text", text: `Running ${name}` },
				{ type: "toolCall", id, name, arguments: args },
			],
		} as AgentMessage);

	const toolResult = (
		id: string,
		toolName: string,
		text: string,
		overrides: Record<string, unknown> = {},
	): AgentMessage =>
		({
			role: "toolResult",
			toolCallId: id,
			toolName,
			content: text.length === 0 ? [] : [{ type: "text", text }],
			isError: false,
			timestamp: Date.now(),
			...overrides,
		} as AgentMessage);

	const config: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [deduplicationRule, supersededToolResultsRule, toolPairingRule, recencyRule],
		keepRecentCount: 0,
		protectedTools: [],
		protectedFilePatterns: [],
		ageGates: {
			supersededToolResults: 0,
			errorPurging: 0,
			supersededWrites: 0,
		},
		redaction: {
			supersededToolResults: true,
			resolvedErrors: false,
		},
	};

	test("workflow stats accumulate estimated token savings for pruned and redacted content", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect things" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "old read output ".repeat(40)),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "new read output"),
			{ role: "assistant", content: "Done." } as AgentMessage,
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const result = applyPruningWorkflowDetailed(messages, config);

		expect(result.stats.prunedCount).toBe(1);
		expect(result.stats.redactedCount).toBe(1);
		expect(result.stats.estimatedTokensPruned).toBeGreaterThan(0);
		expect(result.stats.estimatedTokensRedacted).toBeGreaterThan(0);
		expect(result.stats.estimatedTokensSaved).toBe(result.stats.estimatedTokensPruned + result.stats.estimatedTokensRedacted);
	});

	test("redaction credits only the removed payload delta, not the whole retained message shell", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "very large payload ".repeat(60)),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "fresh"),
		];

		const result = applyPruningWorkflowDetailed(messages, config);
		const originalOlderResultTokens = estimateMessageTokens(messages[2] as AgentMessage);

		expect(result.stats.redactedCount).toBe(1);
		expect(result.stats.estimatedTokensRedacted).toBeGreaterThan(0);
		expect(result.stats.estimatedTokensRedacted).toBeLessThan(originalOlderResultTokens);
	});

	test("dcp-stats reports both message counts and estimated token savings", async () => {
		const notified: Array<{ message: string; level?: string }> = [];
		const command = createStatsCommand(
			{
				totalPruned: 3,
				totalRedacted: 2,
				totalProcessed: 20,
				estimatedTokensPruned: 120,
				estimatedTokensRedacted: 35,
				lastEstimatedTokensSaved: 40,
				lastProcessed: 8,
				lastPruned: 1,
				lastRedacted: 1,
				lastPressureSummary: "20 msgs · 8 tool results",
			},
			4,
		);

		await command.handler([], {
			ui: {
				notify: (message: string, level?: string) => notified.push({ message, level }),
			},
		} as any);

		expect(notified).toHaveLength(1);
		expect(notified[0].message).toContain("Total messages pruned: 3");
		expect(notified[0].message).toContain("Total messages redacted: 2");
		expect(notified[0].message).toContain("Estimated tokens pruned: ~120");
		expect(notified[0].message).toContain("Estimated tokens redacted: ~35");
		expect(notified[0].message).toContain("Last run token savings: ~40");
	});

	test("dcp-context reports a stable rough breakdown of current context cost and savings", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the repo" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "repo contents"),
			{ role: "assistant", content: "Done." } as AgentMessage,
		];
		const notified: Array<{ message: string; level?: string }> = [];
		const command = createContextCommand({
			totalPruned: 0,
			totalProcessed: 0,
			estimatedTokensPruned: 120,
			estimatedTokensRedacted: 30,
			lastPressureSummary: analyzeConversationPressure(messages).totalMessages + " msgs",
		});

		await command.handler([], {
			sessionManager: {
				getEntries: () => messages.map((message) => ({ type: "message", message })),
			},
			ui: {
				notify: (message: string, level?: string) => notified.push({ message, level }),
			},
		} as any);

		expect(notified).toHaveLength(1);
		expect(notified[0].message).toContain("DCP Context:");
		expect(notified[0].message).toContain("Messages: 4");
		expect(notified[0].message).toContain("Estimated current context:");
		expect(notified[0].message).toContain("toolResult:");
		expect(notified[0].message).toContain("Tool result payloads:");
		expect(notified[0].message).toContain("Estimated DCP savings this session: ~150");
	});
});
