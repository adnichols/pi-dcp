/// <reference path="./test-shims.d.ts" />

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createExplicitCompactionState } from "../src/compaction";
import { createDcpCompactTool } from "../src/tools/dcp-compact";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { assistantToolCall, toolResult } from "./pruning-test-helpers";

const config: DcpConfigWithPruneRuleObjects = {
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
};

describe("dcp_compact tool", () => {
	test("triggers ctx.compact when recommendation allows it and includes focus instructions", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect repeatedly" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
		];
		const compactCalls: any[] = [];

		const result = await tool.execute("call_compact_1", { focus: "preserve the active README investigation" }, undefined, undefined, {
			hasUI: true,
			ui: { notify: () => undefined },
			sessionManager: {
				getBranch: () => messages.map((message) => ({ type: "message", message })),
			},
			getContextUsage: () => ({ percent: 85, tokens: 120000 }),
			compact: (options: any) => compactCalls.push(options),
		} as any);

		expect(compactCalls).toHaveLength(1);
		expect(compactCalls[0].customInstructions).toContain("preserve the active README investigation");
		expect(compactCalls[0].customInstructions).toContain("Current pressure snapshot");
		expect(state.inFlight).toBe(true);
		expect(result.details.status).toBe("started");
		expect((result.content as any[])[0].text).toContain("started asynchronously");
	});

	test("skips compaction when recommendation is negative and force is false", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);
		let compactCalled = false;

		const result = await tool.execute("call_compact_2", {}, undefined, undefined, {
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Hello" } }],
			},
			getContextUsage: () => ({ percent: 30, tokens: 7000 }),
			compact: () => {
				compactCalled = true;
			},
		} as any);

		expect(compactCalled).toBe(false);
		expect(state.inFlight).toBe(false);
		expect(result.details.status).toBe("skipped");
		expect((result.content as any[])[0].text).toContain("skipped");
	});

	test("suppresses repeated immediate calls while compaction is already in flight", async () => {
		const state = createExplicitCompactionState();
		state.inFlight = true;
		state.lastStartedMessageCount = 12;
		const tool = createDcpCompactTool(config, state);
		let compactCalled = false;

		const result = await tool.execute("call_compact_3", { force: true }, undefined, undefined, {
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Still busy" } }],
			},
			getContextUsage: () => ({ percent: 90, tokens: 130000 }),
			compact: () => {
				compactCalled = true;
			},
		} as any);

		expect(compactCalled).toBe(false);
		expect(result.details.status).toBe("already-in-flight");
		expect((result.content as any[])[0].text).toContain("already in flight");
	});

	test("completion and error callbacks update compaction state predictably", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);
		const notifications: string[] = [];
		let compactOptions: any;
		const ctx = {
			hasUI: true,
			ui: { notify: (message: string) => notifications.push(message) },
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Need compaction" } }],
			},
			getContextUsage: () => ({ percent: 85, tokens: 120000 }),
			compact: (options: any) => {
				compactOptions = options;
			},
		};

		await tool.execute("call_compact_4", { force: true }, undefined, undefined, ctx as any);
		expect(state.inFlight).toBe(true);

		compactOptions.onComplete?.({ ok: true });
		expect(state.inFlight).toBe(false);
		expect(state.lastOutcome).toBe("completed");
		expect(notifications.some((message) => message.includes("completed"))).toBe(true);

		await tool.execute("call_compact_5", { force: true }, undefined, undefined, ctx as any);
		expect(state.inFlight).toBe(true);
		compactOptions.onError?.(new Error("boom"));
		expect(state.inFlight).toBe(false);
		expect(state.lastOutcome).toBe("failed");
		expect(notifications.some((message) => message.includes("failed"))).toBe(true);
	});

	test("falls back to getEntries and fails cleanly when ctx.compact is unavailable", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);

		const result = await tool.execute("call_compact_6", { force: true }, undefined, undefined, {
			sessionManager: {
				getEntries: () => [{ type: "message", message: { role: "user", content: "Need compaction" } }],
			},
			getContextUsage: () => ({ percent: 85, tokens: 120000 }),
		} as any);

		expect(result.details.status).toBe("failed");
		expect(state.inFlight).toBe(false);
		expect((result.content as any[])[0].text).toContain("ctx.compact() is not available");
	});

	test("recovers from stale in-flight state before allowing a new compaction attempt", async () => {
		const originalNow = Date.now;
		Date.now = () => 1_000_000;
		try {
			const state = createExplicitCompactionState();
			state.inFlight = true;
			state.lastStartedAt = 1_000_000 - 180_000;
			state.lastStartedMessageCount = 7;
			state.lastOutcome = "started";
			const tool = createDcpCompactTool(config, state);
			let compactCalled = false;

			const result = await tool.execute("call_compact_7", { force: true }, undefined, undefined, {
				sessionManager: {
					getBranch: () => [{ type: "message", message: { role: "user", content: "Retry compaction" } }],
				},
				getContextUsage: () => ({ percent: 90, tokens: 140000 }),
				compact: () => {
					compactCalled = true;
				},
			} as any);

			expect(compactCalled).toBe(true);
			expect(result.details.status).toBe("started");
			expect(result.details.recoveredStaleInFlight).toBe(true);
			expect(state.inFlight).toBe(true);
		} finally {
			Date.now = originalNow;
		}
	});

	test("recovers state when ctx.compact throws synchronously", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);
		const notifications: string[] = [];

		const result = await tool.execute("call_compact_8", { force: true }, undefined, undefined, {
			hasUI: true,
			ui: { notify: (message: string) => notifications.push(message) },
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Need compaction" } }],
			},
			getContextUsage: () => ({ percent: 85, tokens: 120000 }),
			compact: () => {
				throw new Error("sync boom");
			},
		} as any);

		expect(result.details.status).toBe("failed");
		expect(state.inFlight).toBe(false);
		expect(state.lastOutcome).toBe("failed");
		expect(notifications.some((message) => message.includes("sync boom"))).toBe(true);
	});

	test("recovers state when ctx.compact returns a rejected promise", async () => {
		const state = createExplicitCompactionState();
		const tool = createDcpCompactTool(config, state);
		const notifications: string[] = [];

		const result = await tool.execute("call_compact_9", { force: true }, undefined, undefined, {
			hasUI: true,
			ui: { notify: (message: string) => notifications.push(message) },
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Need compaction" } }],
			},
			getContextUsage: () => ({ percent: 85, tokens: 120000 }),
			compact: () => Promise.reject(new Error("async boom")),
		} as any);

		expect(result.details.status).toBe("started");
		await Promise.resolve();
		await Promise.resolve();
		expect(state.inFlight).toBe(false);
		expect(state.lastOutcome).toBe("failed");
		expect(notifications.some((message) => message.includes("async boom"))).toBe(true);
	});
});
