/**
 * Regression tests for the pi-mono/OpenAI tool-pairing fix.
 */

/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow } from "../src/workflow";

describe("Fix Verification: pi-mono tool history", () => {
	beforeAll(() => {
		registerRule(deduplicationRule);
		registerRule(supersededWritesRule);
		registerRule(errorPurgingRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

	const assistantToolCall = (id: string, toolName = "read", args: Record<string, unknown> = { path: "test.txt" }) =>
		({
			role: "assistant",
			content: [
				{ type: "text", text: "Running tool." },
				{ type: "toolCall", id, name: toolName, arguments: args },
			],
		} as AgentMessage);

	const toolResult = (
		id: string,
		toolName: string,
		text: string,
		overrides: Record<string, unknown> = {},
	) =>
		({
			role: "toolResult",
			toolCallId: id,
			toolName,
			content: text.length === 0 ? [] : [{ type: "text", text }],
			isError: false,
			timestamp: Date.now(),
			...overrides,
		} as AgentMessage);

	const productionConfig: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
		keepRecentCount: 0,
	};

	function expectNoOrphanedToolResults(messages: AgentMessage[]) {
		const toolCallIds = new Set<string>();
		for (const message of messages) {
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const part of message.content as any[]) {
				if (part?.type === "toolCall" && part.id) {
					toolCallIds.add(part.id);
				}
			}
		}

		for (const message of messages) {
			if (message.role !== "toolResult") continue;
			expect(toolCallIds.has((message as any).toolCallId)).toBe(true);
		}
	}

	test("production rule order preserves pi-mono tool pairing", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file" } as AgentMessage,
			assistantToolCall("call_read_1"),
			toolResult("call_read_1", "read", "contents"),
			assistantToolCall("call_read_2"),
			toolResult("call_read_2", "read", "contents again"),
			{ role: "assistant", content: "Summary complete." } as AgentMessage,
			{ role: "assistant", content: "Summary complete." } as AgentMessage,
		];

		const result = applyPruningWorkflow(messages, productionConfig);
		expectNoOrphanedToolResults(result);
		expect(result.length).toBeLessThan(messages.length);
	});

	test("deduplication does not collapse tool-bearing messages with same assistant text", () => {
		const config: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [deduplicationRule, toolPairingRule],
			keepRecentCount: 0,
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "Read twice" } as AgentMessage,
			assistantToolCall("call_1"),
			toolResult("call_1", "read", "one"),
			assistantToolCall("call_2"),
			toolResult("call_2", "read", "two"),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expectNoOrphanedToolResults(result);
	});

	test("file-backed errored tool results can be pruned without orphaning remaining results", () => {
		const config: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [errorPurgingRule, toolPairingRule],
			keepRecentCount: 0,
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "Write the file" } as AgentMessage,
			assistantToolCall("call_write_1", "write", { path: "out.txt", content: "old" }),
			toolResult("call_write_1", "write", "failed", {
				isError: true,
				details: { path: "out.txt" },
			}),
			assistantToolCall("call_write_2", "write", { path: "out.txt", content: "new" }),
			toolResult("call_write_2", "write", "ok", {
				isError: false,
				details: { path: "out.txt" },
			}),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(1);
		expect((survivingResults[0] as any).toolCallId).toBe("call_write_2");
		expectNoOrphanedToolResults(result);
	});

	test("superseded write results can be pruned without orphaning remaining results", () => {
		const config: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [supersededWritesRule, toolPairingRule],
			keepRecentCount: 0,
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "Write twice" } as AgentMessage,
			assistantToolCall("call_write_1", "write", { path: "out.txt", content: "old" }),
			toolResult("call_write_1", "write", "old written", {
				details: { path: "out.txt" },
			}),
			assistantToolCall("call_write_2", "write", { path: "out.txt", content: "new" }),
			toolResult("call_write_2", "write", "new written", {
				details: { path: "out.txt" },
			}),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(1);
		expect((survivingResults[0] as any).toolCallId).toBe("call_write_2");
		expectNoOrphanedToolResults(result);
	});

	test("recency preserves recent superseded tool results unless provider safety requires deletion", () => {
		const config: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [supersededWritesRule, toolPairingRule, recencyRule],
			keepRecentCount: 10,
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "Write twice" } as AgentMessage,
			assistantToolCall("call_write_1", "write", { path: "out.txt", content: "old" }),
			toolResult("call_write_1", "write", "old written", {
				details: { path: "out.txt" },
			}),
			assistantToolCall("call_write_2", "write", { path: "out.txt", content: "new" }),
			toolResult("call_write_2", "write", "new written", {
				details: { path: "out.txt" },
			}),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expect(survivingResults.map((message) => (message as any).toolCallId)).toEqual(["call_write_1", "call_write_2"]);
		expectNoOrphanedToolResults(result);
	});

	test("already-orphaned recent tool results are dropped even with recency enabled", () => {
		const config: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
			keepRecentCount: 10,
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "Continue" } as AgentMessage,
			toolResult("missing_call", "read", "orphaned output"),
		];

		const result = applyPruningWorkflow(messages, config);
		expect(result.some((message) => message.role === "toolResult")).toBe(false);
	});

	test("empty-content tool results still remain paired", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run screenshot tool" } as AgentMessage,
			assistantToolCall("call_img", "screenshot", { path: "shot.png" }),
			toolResult("call_img", "screenshot", ""),
		];

		const result = applyPruningWorkflow(messages, productionConfig);
		expectNoOrphanedToolResults(result);
		expect(result.some((message) => message.role === "toolResult")).toBe(true);
	});
});
