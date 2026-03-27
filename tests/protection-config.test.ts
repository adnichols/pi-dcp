/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow } from "../src/workflow";

describe("Config-driven pruning protections", () => {
	beforeAll(() => {
		registerRule(supersededWritesRule);
		registerRule(errorPurgingRule);
		registerRule(supersededToolResultsRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

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

	const baseConfig = (
		rules: DcpConfigWithPruneRuleObjects["rules"],
		overrides: Partial<DcpConfigWithPruneRuleObjects> = {},
	): DcpConfigWithPruneRuleObjects => ({
		enabled: true,
		debug: false,
		rules,
		keepRecentCount: 0,
		protectedTools: [],
		protectedFilePatterns: [],
		ageGates: {
			supersededToolResults: 0,
			errorPurging: 0,
			supersededWrites: 0,
		},
		redaction: {
			supersededToolResults: false,
			resolvedErrors: false,
		},
		...overrides,
	});

	test("protected tools prevent superseded-result pruning", () => {
		const config = baseConfig([supersededToolResultsRule, toolPairingRule], {
			protectedTools: ["read"],
		});
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "old read"),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "new read"),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expect(survivingResults.map((message) => (message as any).toolCallId)).toEqual(["read_1", "read_2"]);
	});

	test("protected file patterns prevent superseded write pruning", () => {
		const config = baseConfig([supersededWritesRule, toolPairingRule], {
			protectedFilePatterns: ["src/**/*.ts"],
		});
		const messages: AgentMessage[] = [
			{ role: "user", content: "Edit the protected file twice" } as AgentMessage,
			assistantToolCall("edit_1", "edit", { path: "src/lib/example.ts", oldText: "A", newText: "B" }),
			toolResult("edit_1", "edit", "first edit applied", {
				details: { diff: "..." },
			}),
			assistantToolCall("edit_2", "edit", { path: "src/lib/example.ts", oldText: "B", newText: "C" }),
			toolResult("edit_2", "edit", "second edit applied", {
				details: { diff: "..." },
			}),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expect(survivingResults.map((message) => (message as any).toolCallId)).toEqual(["edit_1", "edit_2"]);
	});

	test("age gates delay superseded-result pruning until enough later user turns complete", () => {
		const rules = [supersededToolResultsRule, toolPairingRule, recencyRule];
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "old read"),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "new read"),
			{ role: "user", content: "Thanks, now inspect docs" } as AgentMessage,
			{ role: "assistant", content: "Looking at docs." } as AgentMessage,
		];

		const beforeThreshold = applyPruningWorkflow(
			messages,
			baseConfig(rules, {
				ageGates: {
					supersededToolResults: 2,
					errorPurging: 0,
					supersededWrites: 0,
				},
			}),
		);
		expect(beforeThreshold.filter((message) => message.role === "toolResult")).toHaveLength(2);

		const afterThreshold = applyPruningWorkflow(
			[
				...messages,
				{ role: "user", content: "One more follow-up" } as AgentMessage,
				{ role: "assistant", content: "Done." } as AgentMessage,
			],
			baseConfig(rules, {
				ageGates: {
					supersededToolResults: 2,
					errorPurging: 0,
					supersededWrites: 0,
				},
			}),
		);
		expect(afterThreshold.filter((message) => message.role === "toolResult")).toHaveLength(1);
		expect((afterThreshold.find((message) => message.role === "toolResult") as any)?.toolCallId).toBe("read_2");
	});
});
