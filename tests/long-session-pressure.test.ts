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

describe("Long-session pressure pruning", () => {
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

	const config: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [supersededWritesRule, errorPurgingRule, supersededToolResultsRule, toolPairingRule, recencyRule],
		keepRecentCount: 0,
	};

	test("repeated read and bash results use normalized exact signatures and keep only the latest successful result", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the repo" } as AgentMessage,
			assistantToolCall("read_1", "read", { offset: 1, path: "README.md", limit: 20 }),
			toolResult("read_1", "read", "old read"),
			assistantToolCall("bash_1", "bash", { timeout: 30, command: "rg -n foo -S ." }),
			toolResult("bash_1", "bash", "old grep"),
			assistantToolCall("read_2", "read", { limit: 20, path: "README.md", offset: 1 }),
			toolResult("read_2", "read", "new read"),
			assistantToolCall("bash_2", "bash", { command: "rg -n foo -S .", timeout: 30 }),
			toolResult("bash_2", "bash", "new grep"),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expect((survivingResults[0] as any).toolCallId).toBe("read_2");
		expect((survivingResults[1] as any).toolCallId).toBe("bash_2");
	});

	test("superseded writes can recover file paths from tool call arguments when details omit them", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Edit the same file twice" } as AgentMessage,
			assistantToolCall("edit_1", "edit", { path: "plan.md", oldText: "A", newText: "B" }),
			toolResult("edit_1", "edit", "first edit applied", {
				details: { diff: "..." },
			}),
			assistantToolCall("edit_2", "edit", { path: "plan.md", oldText: "B", newText: "C" }),
			toolResult("edit_2", "edit", "second edit applied", {
				details: { diff: "..." },
			}),
		];

		const result = applyPruningWorkflow(messages, config);
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(1);
		expect((survivingResults[0] as any).toolCallId).toBe("edit_2");
	});
});
