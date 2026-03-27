/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { recencyRule } from "../src/rules/recency";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow } from "../src/workflow";

describe("Repeated-operation exact signatures", () => {
	beforeAll(() => {
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

	const config = (overrides: Partial<DcpConfigWithPruneRuleObjects> = {}): DcpConfigWithPruneRuleObjects => ({
		enabled: true,
		debug: false,
		rules: [supersededToolResultsRule, toolPairingRule, recencyRule],
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

	function getText(message: AgentMessage): string {
		if (!("content" in message)) return "";
		if (typeof message.content === "string") return message.content;
		if (!Array.isArray(message.content)) return "";
		return (message.content as any[])
			.filter((part) => part?.type === "text")
			.map((part) => part.text)
			.join("\n");
	}

	test("normalized exact signatures match read and bash calls even when argument key order differs", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { offset: 1, path: "README.md", limit: 20 }),
			toolResult("read_1", "read", "old read"),
			assistantToolCall("bash_1", "bash", { timeout: 30, command: "rg -n foo -S ." }),
			toolResult("bash_1", "bash", "old bash"),
			assistantToolCall("read_2", "read", { limit: 20, path: "README.md", offset: 1 }),
			toolResult("read_2", "read", "new read"),
			assistantToolCall("bash_2", "bash", { command: "rg -n foo -S .", timeout: 30 }),
			toolResult("bash_2", "bash", "new bash"),
		];

		const result = applyPruningWorkflow(messages, config());
		const survivingResults = result.filter((message) => message.role === "toolResult");

		expect(survivingResults).toHaveLength(2);
		expect(survivingResults.map((message) => (message as any).toolCallId)).toEqual(["read_2", "bash_2"]);
	});

	test("redaction waits for the configured age threshold and keeps the latest observation intact", () => {
		const baseMessages: AgentMessage[] = [
			{ role: "user", content: "Read the file twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { limit: 10, path: "README.md", offset: 0 }),
			toolResult("read_1", "read", "old read"),
			assistantToolCall("read_2", "read", { offset: 0, path: "README.md", limit: 10 }),
			toolResult("read_2", "read", "new read"),
		];

		const beforeThreshold = applyPruningWorkflow(
			baseMessages,
			config({
				ageGates: {
					supersededToolResults: 1,
					errorPurging: 0,
					supersededWrites: 0,
				},
				redaction: {
					supersededToolResults: true,
					resolvedErrors: false,
				},
			}),
		);
		expect(beforeThreshold.filter((message) => message.role === "toolResult")).toHaveLength(2);
		expect(getText(beforeThreshold[2] as AgentMessage)).toContain("old read");

		const afterThreshold = applyPruningWorkflow(
			[
				...baseMessages,
				{ role: "user", content: "Thanks, one more thing" } as AgentMessage,
				{ role: "assistant", content: "Sure." } as AgentMessage,
			],
			config({
				ageGates: {
					supersededToolResults: 1,
					errorPurging: 0,
					supersededWrites: 0,
				},
				redaction: {
					supersededToolResults: true,
					resolvedErrors: false,
				},
			}),
		);
		const survivingResults = afterThreshold.filter((message) => message.role === "toolResult");
		expect(survivingResults).toHaveLength(2);
		expect(getText(survivingResults[0] as AgentMessage)).toContain("redacted superseded tool result");
		expect(getText(survivingResults[0] as AgentMessage)).not.toContain("old read");
		expect(getText(survivingResults[1] as AgentMessage)).toContain("new read");
	});

	test("different read/bash arguments do not over-match just because path or command is shared", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect with different slices" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 10 }),
			toolResult("read_1", "read", "first slice"),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 10, limit: 10 }),
			toolResult("read_2", "read", "second slice"),
			assistantToolCall("bash_1", "bash", { command: "rg -n foo -S .", timeout: 30 }),
			toolResult("bash_1", "bash", "fast run"),
			assistantToolCall("bash_2", "bash", { command: "rg -n foo -S .", timeout: 60 }),
			toolResult("bash_2", "bash", "slow run"),
		];

		const result = applyPruningWorkflow(messages, config());
		expect(result.filter((message) => message.role === "toolResult")).toHaveLength(4);
	});

	test("unsupported or protected tools are excluded from exact-signature cleanup", () => {
		const unsupportedMessages: AgentMessage[] = [
			{ role: "user", content: "Run grep twice" } as AgentMessage,
			assistantToolCall("grep_1", "grep", { pattern: "foo", path: "src" }),
			toolResult("grep_1", "grep", "old grep"),
			assistantToolCall("grep_2", "grep", { path: "src", pattern: "foo" }),
			toolResult("grep_2", "grep", "new grep"),
		];
		const protectedReadMessages: AgentMessage[] = [
			{ role: "user", content: "Read twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { offset: 0, path: "README.md", limit: 5 }),
			toolResult("read_1", "read", "first"),
			assistantToolCall("read_2", "read", { limit: 5, path: "README.md", offset: 0 }),
			toolResult("read_2", "read", "second"),
		];

		const unsupportedResult = applyPruningWorkflow(unsupportedMessages, config());
		expect(unsupportedResult.filter((message) => message.role === "toolResult")).toHaveLength(2);

		const protectedResult = applyPruningWorkflow(
			protectedReadMessages,
			config({
				protectedTools: ["read"],
			}),
		);
		expect(protectedResult.filter((message) => message.role === "toolResult")).toHaveLength(2);
	});
});
