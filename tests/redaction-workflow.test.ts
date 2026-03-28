/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow } from "../src/workflow";

describe("Action-aware workflow redaction", () => {
	beforeAll(() => {
		registerRule(errorPurgingRule);
		registerRule(supersededToolResultsRule);
		registerRule(staleFileReadsRule);
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
		rules: [supersededToolResultsRule, errorPurgingRule, toolPairingRule, recencyRule],
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

	test("superseded tool results can be redacted instead of removed", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "very old read contents"),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "fresh read contents"),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				redaction: {
					supersededToolResults: true,
					resolvedErrors: false,
				},
			}),
		);

		const survivingResults = result.filter((message) => message.role === "toolResult");
		expect(survivingResults).toHaveLength(2);
		expect(getText(survivingResults[0] as AgentMessage)).toContain("redacted superseded tool result");
		expect(getText(survivingResults[0] as AgentMessage)).not.toContain("very old read contents");
		expect(getText(survivingResults[1] as AgentMessage)).toContain("fresh read contents");
	});

	test("redacted tool results preserve tool identity and pairing invariants", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run the same bash twice" } as AgentMessage,
			assistantToolCall("bash_1", "bash", { command: "echo hello" }),
			toolResult("bash_1", "bash", "first output"),
			assistantToolCall("bash_2", "bash", { command: "echo hello" }),
			toolResult("bash_2", "bash", "second output"),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				redaction: {
					supersededToolResults: true,
					resolvedErrors: false,
				},
			}),
		);

		const toolCallIds = new Set<string>();
		for (const message of result) {
			if (!Array.isArray((message as any).content)) continue;
			for (const part of (message as any).content) {
				if (part?.type === "toolCall" && part.id) {
					toolCallIds.add(part.id);
				}
			}
		}

		const redactedResult = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "bash_1") as any;
		expect(redactedResult?.toolCallId).toBe("bash_1");
		expect(redactedResult?.toolName).toBe("bash");
		expect(toolCallIds.has(redactedResult.toolCallId)).toBe(true);
	});

	test("recency clears redaction for recent tool results without breaking pairing", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read the file twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "very old read contents"),
			assistantToolCall("read_2", "read", { path: "README.md" }),
			toolResult("read_2", "read", "fresh read contents"),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				keepRecentCount: 10,
				redaction: {
					supersededToolResults: true,
					resolvedErrors: false,
				},
			}),
		);

		const survivingResults = result.filter((message) => message.role === "toolResult");
		expect(survivingResults).toHaveLength(2);
		expect(getText(survivingResults[0] as AgentMessage)).toContain("very old read contents");
		expect(getText(survivingResults[0] as AgentMessage)).not.toContain("redacted superseded tool result");
	});

	test("stale file reads can be redacted instead of removed", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read then write the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 10, limit: 20 }),
			toolResult("read_1", "read", "very old read contents"),
			assistantToolCall("write_1", "write", { path: "README.md", content: "fresh contents" }),
			toolResult("write_1", "write", "write ok", {
				details: { path: "README.md" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				rules: [staleFileReadsRule, toolPairingRule, recencyRule],
				redaction: {
					supersededToolResults: false,
					resolvedErrors: false,
					staleFileReads: true,
				},
			}),
		);

		const redactedResult = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "read_1") as any;
		expect(redactedResult).toBeTruthy();
		expect(getText(redactedResult)).toContain("redacted stale file read");
		expect(getText(redactedResult)).toContain("read");
		expect(getText(redactedResult)).toContain("README.md");
		expect(getText(redactedResult)).not.toContain("very old read contents");
		expect(redactedResult.toolCallId).toBe("read_1");
		expect(redactedResult.toolName).toBe("read");
	});

	test("recency clears stale-file-read redaction for recent messages", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read then write the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 10, limit: 20 }),
			toolResult("read_1", "read", "very old read contents"),
			assistantToolCall("write_1", "write", { path: "README.md", content: "fresh contents" }),
			toolResult("write_1", "write", "write ok", {
				details: { path: "README.md" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				rules: [staleFileReadsRule, toolPairingRule, recencyRule],
				keepRecentCount: 10,
				redaction: {
					supersededToolResults: false,
					resolvedErrors: false,
					staleFileReads: true,
				},
			}),
		);

		const staleRead = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "read_1") as AgentMessage;
		expect(staleRead).toBeTruthy();
		expect(getText(staleRead)).toContain("very old read contents");
		expect(getText(staleRead)).not.toContain("redacted stale file read");
	});

	test("resolved errors can be redacted while keeping a short error summary", () => {
		const largeError = `Write failed: ${"overflow ".repeat(80)}ENOENT for src/out.txt`;
		const messages: AgentMessage[] = [
			{ role: "user", content: "Write the file" } as AgentMessage,
			assistantToolCall("write_1", "write", { path: "src/out.txt", content: "old" }),
			toolResult("write_1", "write", largeError, {
				isError: true,
				details: { path: "src/out.txt" },
			}),
			assistantToolCall("write_2", "write", { path: "src/out.txt", content: "new" }),
			toolResult("write_2", "write", "write ok", {
				isError: false,
				details: { path: "src/out.txt" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			config({
				redaction: {
					supersededToolResults: false,
					resolvedErrors: true,
				},
			}),
		);

		const errorResult = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "write_1") as AgentMessage;
		expect(errorResult).toBeTruthy();
		expect(getText(errorResult)).toContain("redacted resolved error");
		expect(getText(errorResult)).toContain("write");
		expect(getText(errorResult)).toContain("src/out.txt");
		expect(getText(errorResult)).not.toContain("overflow overflow overflow overflow");
	});
});
