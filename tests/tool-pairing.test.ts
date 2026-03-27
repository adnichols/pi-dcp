/**
 * Test suite for pi-mono/OpenAI-style tool pairing support.
 */

/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractToolUseIds, hasToolResult, hasToolUse, hashMessage } from "../src/metadata";
import { registerRule } from "../src/registry";
import { deduplicationRule } from "../src/rules/deduplication";
import { recencyRule } from "../src/rules/recency";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow } from "../src/workflow";

describe("Tool Pairing Protection (pi-mono shape)", () => {
	beforeAll(() => {
		registerRule(deduplicationRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

	const assistantWithToolCall = (id: string, text = "I'll read the file."): AgentMessage => ({
		role: "assistant",
		content: [
			{ type: "text", text },
			{ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } },
		],
	} as AgentMessage);

	const toolResult = (id: string, text: string): AgentMessage => ({
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	} as AgentMessage);

	const config: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [deduplicationRule, toolPairingRule, recencyRule],
		keepRecentCount: 1,
	};

	test("metadata helpers recognize pi-mono tool calls and results", () => {
		const assistant = assistantWithToolCall("call_1");
		const result = toolResult("call_1", "file contents");

		expect(hasToolUse(assistant)).toBe(true);
		expect(hasToolResult(assistant)).toBe(false);
		expect(extractToolUseIds(assistant)).toEqual(["call_1"]);

		expect(hasToolUse(result)).toBe(false);
		expect(hasToolResult(result)).toBe(true);
		expect(extractToolUseIds(result)).toEqual(["call_1"]);
	});

	test("hashMessage distinguishes tool-bearing pi-mono messages by call id", () => {
		const assistant1 = assistantWithToolCall("call_1");
		const assistant2 = assistantWithToolCall("call_2");
		const result1 = toolResult("call_1", "same content");
		const result2 = toolResult("call_2", "same content");

		expect(hashMessage(assistant1)).not.toBe(hashMessage(assistant2));
		expect(hashMessage(result1)).not.toBe(hashMessage(result2));
	});

	test("workflow never leaves surviving pi-mono tool results orphaned", () => {
		const testMessages: AgentMessage[] = [
			{ role: "user", content: "Please read two files" } as AgentMessage,
			assistantWithToolCall("call_1"),
			toolResult("call_1", "file one"),
			assistantWithToolCall("call_2"),
			toolResult("call_2", "file two"),
			{ role: "assistant", content: "Done." } as AgentMessage,
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const result = applyPruningWorkflow(testMessages, config);
		const toolCallIds = new Set<string>();

		for (const message of result) {
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const part of message.content as any[]) {
				if (part?.type === "toolCall" && part.id) {
					toolCallIds.add(part.id);
				}
			}
		}

		for (const message of result) {
			if (message.role !== "toolResult") continue;
			expect(toolCallIds.has((message as any).toolCallId)).toBe(true);
		}
	});

	test("multiple tool calls in one assistant message remain pairable", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read both files" } as AgentMessage,
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll read both." },
					{ type: "toolCall", id: "call_a", name: "read", arguments: { path: "a.txt" } },
					{ type: "toolCall", id: "call_b", name: "read", arguments: { path: "b.txt" } },
				],
			} as AgentMessage,
			toolResult("call_a", "A"),
			toolResult("call_b", "B"),
			{ role: "assistant", content: "Complete." } as AgentMessage,
			{ role: "assistant", content: "Complete." } as AgentMessage,
		];

		const result = applyPruningWorkflow(messages, config);
		const toolCallIds = new Set<string>();

		for (const message of result) {
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const part of message.content as any[]) {
				if (part?.type === "toolCall" && part.id) {
					toolCallIds.add(part.id);
				}
			}
		}

		expect(toolCallIds.has("call_a")).toBe(true);
		expect(toolCallIds.has("call_b")).toBe(true);

		for (const message of result) {
			if (message.role !== "toolResult") continue;
			expect(toolCallIds.has((message as any).toolCallId)).toBe(true);
		}
	});
});
