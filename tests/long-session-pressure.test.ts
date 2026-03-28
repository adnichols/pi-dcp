/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { applyPruningWorkflow, applyPruningWorkflowDetailed } from "../src/workflow";

describe("Long-session pressure pruning", () => {
	beforeAll(() => {
		registerRule(deduplicationRule);
		registerRule(supersededWritesRule);
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

	const config: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, supersededToolResultsRule, staleFileReadsRule, toolPairingRule, recencyRule],
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

	function expectNoOrphanedToolResults(messages: AgentMessage[]) {
		const toolCallIds = new Set<string>();
		for (const message of messages) {
			if (!Array.isArray((message as any).content)) continue;
			for (const part of (message as any).content) {
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

	function getPrunedToolResultIds(withMetadata: Array<{ message: AgentMessage; metadata: any }>) {
		return withMetadata
			.filter((entry) => entry.metadata.action === "prune" && entry.message.role === "toolResult")
			.map((entry) => (entry.message as any).toolCallId);
	}

	function getPrunedAssistantTexts(withMetadata: Array<{ message: AgentMessage; metadata: any }>) {
		return withMetadata
			.filter((entry) => entry.metadata.action === "prune" && entry.message.role === "assistant" && !Array.isArray((entry.message as any).content))
			.map((entry) => (entry.message as any).content);
	}

	function getToolResultIds(messages: AgentMessage[]) {
		return messages.filter((message) => message.role === "toolResult").map((message) => (message as any).toolCallId);
	}

	function getText(message: AgentMessage) {
		if (!Array.isArray((message as any).content)) return typeof (message as any).content === "string" ? (message as any).content : "";
		return ((message as any).content as any[])
			.filter((part) => part?.type === "text")
			.map((part) => part.text)
			.join("\n");
	}

	function countReason(stats: Record<string, number>, prefix: string) {
		return Object.entries(stats)
			.filter(([reason]) => reason.startsWith(prefix))
			.reduce((sum, [, count]) => sum + count, 0);
	}

	function countExactReason(stats: Record<string, number>, reason: string) {
		return stats[reason] ?? 0;
	}

	test("long-horizon mixed session exercises all major prune paths without breaking tool history", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Please inspect the repo and make the requested updates." } as AgentMessage,
			{ role: "assistant", content: "Starting sweep." } as AgentMessage,
			{ role: "assistant", content: "Starting sweep." } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old README slice"),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_1", "bash", "old grep output"),
			assistantToolCall("write_1", "write", { path: "notes/todo.md", content: "draft v1" }),
			toolResult("write_1", "write", "draft v1 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("bash_err_1", "bash", { command: "npm test", timeout: 30 }),
			toolResult("bash_err_1", "bash", "npm test failed", {
				isError: true,
			}),
			assistantToolCall("read_2", "read", { path: "src/app.ts", offset: 10, limit: 20 }),
			toolResult("read_2", "read", "pre-edit app slice"),
			{ role: "user", content: "Continue with the fixes." } as AgentMessage,
			assistantToolCall("edit_1", "edit", { path: "src/app.ts", oldText: "before", newText: "after" }),
			toolResult("edit_1", "edit", "app edit applied", {
				details: { path: "src/app.ts" },
			}),
			assistantToolCall("read_3", "read", { limit: 20, path: "README.md", offset: 0 }),
			toolResult("read_3", "read", "new README slice"),
			assistantToolCall("bash_2", "bash", { timeout: 30, command: "rg -n TODO src" }),
			toolResult("bash_2", "bash", "new grep output"),
			assistantToolCall("write_2", "write", { path: "notes/todo.md", content: "draft v2" }),
			toolResult("write_2", "write", "draft v2 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("bash_3", "bash", { timeout: 30, command: "npm test" }),
			toolResult("bash_3", "bash", "npm test passed"),
			{ role: "assistant", content: "All caught up." } as AgentMessage,
		];

		const detailed = applyPruningWorkflowDetailed(messages, config);
		const result = detailed.messages;

		expect(detailed.stats.prunedCount).toBe(6);
		expect(detailed.stats.redactedCount).toBe(0);
		expect(getPrunedAssistantTexts(detailed.withMetadata)).toEqual(["Starting sweep."]);
		expect(getPrunedToolResultIds(detailed.withMetadata)).toEqual([
			"read_1",
			"bash_1",
			"write_1",
			"bash_err_1",
			"read_2",
		]);
		expect(countExactReason(detailed.stats.pruneReasons, "duplicate content")).toBe(1);
		expect(countExactReason(detailed.stats.pruneReasons, "superseded by later successful read")).toBe(1);
		expect(countExactReason(detailed.stats.pruneReasons, "superseded by later successful bash")).toBe(1);
		expect(countReason(detailed.stats.pruneReasons, "superseded by later successful write to ")).toBe(1);
		expect(countExactReason(detailed.stats.pruneReasons, "error resolved by later success")).toBe(1);
		expect(countReason(detailed.stats.pruneReasons, "stale read invalidated by later successful write/edit to ")).toBe(1);
		expect(getToolResultIds(result)).toEqual(["edit_1", "read_3", "bash_2", "write_2", "bash_3"]);
		expectNoOrphanedToolResults(result);
	});

	test("long-horizon safety overrides keep otherwise-prunable content when protections apply", () => {
		const guardedConfig: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, supersededToolResultsRule, staleFileReadsRule, toolPairingRule, recencyRule],
			keepRecentCount: 2,
			protectedTools: ["read"],
			protectedFilePatterns: ["notes/**"],
			ageGates: {
				supersededToolResults: 2,
				errorPurging: 2,
				supersededWrites: 0,
				staleFileReads: 0,
			},
			redaction: {
				supersededToolResults: false,
				resolvedErrors: false,
				staleFileReads: false,
			},
		};
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect and stage the changes." } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read slice"),
			assistantToolCall("read_2", "read", { limit: 20, path: "README.md", offset: 0 }),
			toolResult("read_2", "read", "new read slice"),
			assistantToolCall("read_3", "read", { path: "src/app.ts", offset: 10, limit: 20 }),
			toolResult("read_3", "read", "pre-edit app slice"),
			assistantToolCall("edit_1", "edit", { path: "src/app.ts", oldText: "before", newText: "after" }),
			toolResult("edit_1", "edit", "app edit applied", {
				details: { path: "src/app.ts" },
			}),
			assistantToolCall("write_1", "write", { path: "notes/todo.md", content: "draft v1" }),
			toolResult("write_1", "write", "draft v1 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("write_2", "write", { path: "notes/todo.md", content: "draft v2" }),
			toolResult("write_2", "write", "draft v2 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_1", "bash", "old grep output"),
			assistantToolCall("bash_2", "bash", { timeout: 30, command: "rg -n TODO src" }),
			toolResult("bash_2", "bash", "new grep output"),
			assistantToolCall("bash_err_1", "bash", { command: "npm test", timeout: 30 }),
			toolResult("bash_err_1", "bash", "npm test failed", {
				isError: true,
			}),
			assistantToolCall("bash_3", "bash", { timeout: 30, command: "npm test" }),
			toolResult("bash_3", "bash", "npm test passed"),
			{ role: "user", content: "Wrap it up." } as AgentMessage,
			{ role: "assistant", content: "Recent summary." } as AgentMessage,
			{ role: "assistant", content: "Recent summary." } as AgentMessage,
		];

		const detailed = applyPruningWorkflowDetailed(messages, guardedConfig);
		const result = detailed.messages;

		expect(detailed.stats.prunedCount).toBe(0);
		expect(detailed.stats.redactedCount).toBe(0);
		expect(detailed.stats.pruneReasons).toEqual({});
		expect(getToolResultIds(result)).toEqual([
			"read_1",
			"read_2",
			"read_3",
			"edit_1",
			"write_1",
			"write_2",
			"bash_1",
			"bash_2",
			"bash_err_1",
			"bash_3",
		]);
		const protectedRead = detailed.withMetadata.find((entry) => (entry.message as any).toolCallId === "read_1");
		const staleProtectedRead = detailed.withMetadata.find((entry) => (entry.message as any).toolCallId === "read_3");
		const protectedWrite = detailed.withMetadata.find((entry) => (entry.message as any).toolCallId === "write_1");
		const ageGatedBash = detailed.withMetadata.find((entry) => (entry.message as any).toolCallId === "bash_1");
		const ageGatedError = detailed.withMetadata.find((entry) => (entry.message as any).toolCallId === "bash_err_1");
		const recentDuplicate = detailed.withMetadata[detailed.withMetadata.length - 1];

		expect(protectedRead?.metadata.destructiveActionBlockedReason).toBe("protected tool: read");
		expect(staleProtectedRead?.metadata.destructiveActionBlockedReason).toBe("protected tool: read");
		expect(protectedWrite?.metadata.destructiveActionBlockedReason).toBe("protected file: notes/todo.md");
		expect(ageGatedBash?.metadata.destructiveActionBlockedReason).toBe("age gate not met: 1/2 completed user turns");
		expect(ageGatedError?.metadata.destructiveActionBlockedReason).toBe("age gate not met: 1/2 completed user turns");
		expect(recentDuplicate.metadata.protectedByRecency).toBe(true);
		expectNoOrphanedToolResults(result);
	});

	test("long-horizon redaction mode preserves tool shells while compacting stale and resolved payloads", () => {
		const redactionConfig: DcpConfigWithPruneRuleObjects = {
			enabled: true,
			debug: false,
			rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, supersededToolResultsRule, staleFileReadsRule, toolPairingRule, recencyRule],
			keepRecentCount: 0,
			redaction: {
				supersededToolResults: true,
				resolvedErrors: true,
				staleFileReads: true,
			},
		};
		const messages: AgentMessage[] = [
			{ role: "user", content: "Please inspect, modify, and validate the repo." } as AgentMessage,
			{ role: "assistant", content: "Starting sweep." } as AgentMessage,
			{ role: "assistant", content: "Starting sweep." } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old README slice with lots of detail"),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_1", "bash", "old grep output with lots of lines"),
			assistantToolCall("write_1", "write", { path: "notes/todo.md", content: "draft v1" }),
			toolResult("write_1", "write", "draft v1 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("bash_err_1", "bash", { command: "npm test", timeout: 30 }),
			toolResult("bash_err_1", "bash", `npm test failed: ${"overflow ".repeat(40)}ETIMEDOUT`, {
				isError: true,
			}),
			assistantToolCall("read_2", "read", { path: "src/app.ts", offset: 10, limit: 20 }),
			toolResult("read_2", "read", "pre-edit app slice with stale details"),
			assistantToolCall("edit_1", "edit", { path: "src/app.ts", oldText: "before", newText: "after" }),
			toolResult("edit_1", "edit", "app edit applied", {
				details: { path: "src/app.ts" },
			}),
			assistantToolCall("read_3", "read", { limit: 20, path: "README.md", offset: 0 }),
			toolResult("read_3", "read", "new README slice"),
			assistantToolCall("bash_2", "bash", { timeout: 30, command: "rg -n TODO src" }),
			toolResult("bash_2", "bash", "new grep output"),
			assistantToolCall("write_2", "write", { path: "notes/todo.md", content: "draft v2" }),
			toolResult("write_2", "write", "draft v2 saved", {
				details: { path: "notes/todo.md" },
			}),
			assistantToolCall("bash_3", "bash", { timeout: 30, command: "npm test" }),
			toolResult("bash_3", "bash", "npm test passed"),
		];

		const detailed = applyPruningWorkflowDetailed(messages, redactionConfig);
		const result = detailed.messages;
		const survivingToolResultIds = getToolResultIds(result);
		const redactedEntries = detailed.withMetadata.filter((entry) => entry.metadata.action === "redact");
		const prunedEntries = detailed.withMetadata.filter((entry) => entry.metadata.action === "prune");
		const read1 = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "read_1") as AgentMessage;
		const bash1 = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "bash_1") as AgentMessage;
		const bashErr1 = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "bash_err_1") as AgentMessage;
		const read2 = result.find((message) => message.role === "toolResult" && (message as any).toolCallId === "read_2") as AgentMessage;

		expect(detailed.stats.prunedCount).toBe(2);
		expect(detailed.stats.redactedCount).toBe(4);
		expect(prunedEntries.map((entry) => (entry.message as any).toolCallId ?? entry.message.content)).toEqual([
			"Starting sweep.",
			"write_1",
		]);
		expect(redactedEntries.map((entry) => (entry.message as any).toolCallId)).toEqual([
			"read_1",
			"bash_1",
			"bash_err_1",
			"read_2",
		]);
		expect(countExactReason(detailed.stats.pruneReasons, "duplicate content")).toBe(1);
		expect(countReason(detailed.stats.pruneReasons, "superseded by later successful write to ")).toBe(1);
		expect(countExactReason(detailed.stats.redactionReasons, "superseded by later successful read")).toBe(1);
		expect(countExactReason(detailed.stats.redactionReasons, "superseded by later successful bash")).toBe(1);
		expect(countExactReason(detailed.stats.redactionReasons, "error resolved by later success")).toBe(1);
		expect(countReason(detailed.stats.redactionReasons, "stale read invalidated by later successful write/edit to ")).toBe(1);
		expect(survivingToolResultIds).toEqual([
			"read_1",
			"bash_1",
			"bash_err_1",
			"read_2",
			"edit_1",
			"read_3",
			"bash_2",
			"write_2",
			"bash_3",
		]);
		expect(getText(read1)).toContain("redacted superseded tool result");
		expect(getText(read1)).toContain("README.md");
		expect(getText(read1)).not.toContain("old README slice with lots of detail");
		expect(getText(bash1)).toContain("redacted superseded tool result");
		expect(getText(bash1)).toContain("rg -n TODO src");
		expect(getText(bashErr1)).toContain("redacted resolved error");
		expect(getText(bashErr1)).toContain("bash");
		expect(getText(bashErr1)).toContain("ETIMEDOUT");
		expect(getText(bashErr1)).not.toContain("overflow overflow overflow overflow");
		expect(getText(read2)).toContain("redacted stale file read");
		expect(getText(read2)).toContain("src/app.ts");
		expect(getText(read2)).not.toContain("pre-edit app slice with stale details");
		expectNoOrphanedToolResults(result);
	});
});
