/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerRule } from "../src/registry";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { toolPairingRule } from "../src/rules/tool-pairing";
import { applyPruningWorkflow } from "../src/workflow";
import { assistantToolCall, createBaseConfig, getToolResultIds, toolResult } from "./pruning-test-helpers";

describe("Stale file read invalidation", () => {
	beforeAll(() => {
		registerRule(staleFileReadsRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

	test("read slices are invalidated by a later edit on the same normalized path", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect and then edit the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "./src\\lib/../lib/example.ts", offset: 10, limit: 20 }),
			toolResult("read_1", "read", "old slice"),
			assistantToolCall("edit_1", "edit", { path: "src/lib/./example.ts", oldText: "before", newText: "after" }),
			toolResult("edit_1", "edit", "edit applied", {
				details: { path: "src/lib/example.ts" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			createBaseConfig([staleFileReadsRule, toolPairingRule]),
		);

		expect(getToolResultIds(result)).toEqual(["edit_1"]);
	});

	test("read results are invalidated by a later successful write on the same path", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read then write the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 40 }),
			toolResult("read_1", "read", "original contents"),
			assistantToolCall("write_1", "write", { path: "README.md", content: "updated contents" }),
			toolResult("write_1", "write", "write applied", {
				details: { path: "README.md" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			createBaseConfig([staleFileReadsRule, toolPairingRule]),
		);

		expect(getToolResultIds(result)).toEqual(["write_1"]);
	});

	test("writes to other files do not invalidate reads", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Read one file and write another" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md" }),
			toolResult("read_1", "read", "readme contents"),
			assistantToolCall("write_1", "write", { path: "docs/guide.md", content: "new guide" }),
			toolResult("write_1", "write", "write applied", {
				details: { path: "docs/guide.md" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			createBaseConfig([staleFileReadsRule, toolPairingRule]),
		);

		expect(getToolResultIds(result)).toEqual(["read_1", "write_1"]);
	});

	test("failed writes and edits do not invalidate earlier reads", () => {
		const writeFailure: AgentMessage[] = [
			{ role: "user", content: "Try to update the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "src/out.txt" }),
			toolResult("read_1", "read", "old contents"),
			assistantToolCall("write_1", "write", { path: "src/out.txt", content: "new contents" }),
			toolResult("write_1", "write", "write failed", {
				isError: true,
				details: { path: "src/out.txt" },
			}),
		];
		const editFailure: AgentMessage[] = [
			{ role: "user", content: "Try to patch the file" } as AgentMessage,
			assistantToolCall("read_2", "read", { path: "src/out.txt" }),
			toolResult("read_2", "read", "old contents"),
			assistantToolCall("edit_1", "edit", { path: "src/out.txt", oldText: "old", newText: "new" }),
			toolResult("edit_1", "edit", "edit failed", {
				isError: true,
				details: { path: "src/out.txt" },
			}),
		];

		expect(getToolResultIds(applyPruningWorkflow(writeFailure, createBaseConfig([staleFileReadsRule, toolPairingRule])))).toEqual([
			"read_1",
			"write_1",
		]);
		expect(getToolResultIds(applyPruningWorkflow(editFailure, createBaseConfig([staleFileReadsRule, toolPairingRule])))).toEqual([
			"read_2",
			"edit_1",
		]);
	});

	test("one read followed by multiple successful writes invalidates the read but keeps mutation history", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect and then update twice" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "src/out.txt" }),
			toolResult("read_1", "read", "old contents"),
			assistantToolCall("write_1", "write", { path: "src/out.txt", content: "v1" }),
			toolResult("write_1", "write", "write v1", {
				details: { path: "src/out.txt" },
			}),
			assistantToolCall("write_2", "write", { path: "src/out.txt", content: "v2" }),
			toolResult("write_2", "write", "write v2", {
				details: { path: "src/out.txt" },
			}),
		];

		const result = applyPruningWorkflow(
			messages,
			createBaseConfig([staleFileReadsRule, toolPairingRule, recencyRule]),
		);

		expect(getToolResultIds(result)).toEqual(["write_1", "write_2"]);
	});
});
