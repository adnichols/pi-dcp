/// <reference path="./test-shims.d.ts" />

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createDcpPressureTool } from "../src/tools/dcp-pressure";
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

describe("dcp_pressure tool", () => {
	test("exposes the expected tool definition and empty parameter schema", () => {
		const tool = createDcpPressureTool(config);

		expect(tool.name).toBe("dcp_pressure");
		expect(tool.label).toBe("DCP Pressure");
		expect(tool.description).toContain("context pressure");
		expect(tool.promptSnippet).toContain("context pressure");
		expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
		expect((tool.parameters as any).type).toBe("object");
		expect(Object.keys((tool.parameters as any).properties ?? {})).toEqual([]);
	});

	test("uses current branch messages from sessionManager and returns recommendation details", async () => {
		const branchMessages: AgentMessage[] = [
			{ role: "user", content: "Inspect repeatedly" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
		];
		const allEntries = [
			{ type: "message", message: { role: "user", content: "older unrelated message" } },
			...branchMessages.map((message) => ({ type: "message", message })),
		];
		const tool = createDcpPressureTool(config);

		const result = await tool.execute("call_pressure_1", {}, undefined, undefined, {
			sessionManager: {
				getBranch: () => allEntries.slice(1),
				getEntries: () => allEntries,
			},
			getContextUsage: () => ({ percent: 83, tokens: 111000 }),
		} as any);

		const text = (result.content as any[]).map((part) => part.text).join("\n");
		expect(text).toContain("compact now");
		expect(text).toContain("83%");
		expect(result.details.recommendation).toBe("compact-now");
		expect(result.details.analysis.originalMessageCount).toBe(5);
		expect(result.details.predicted.prunedCount).toBe(1);
	});

	test("ignores prior dcp tool traffic in its recommendation path", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Check pressure" } as AgentMessage,
			assistantToolCall("dcp_1", "dcp_pressure", {}),
			toolResult("dcp_1", "dcp_pressure", "pressure snapshot"),
			assistantToolCall("dcp_2", "dcp_compact", { force: true }),
			toolResult("dcp_2", "dcp_compact", "compaction started"),
		];
		const tool = createDcpPressureTool(config);

		const result = await tool.execute("call_pressure_2", {}, undefined, undefined, {
			sessionManager: {
				getBranch: () => messages.map((message) => ({ type: "message", message })),
			},
			getContextUsage: () => ({ percent: 35, tokens: 9000 }),
		} as any);

		expect(result.details.analysis.filteredMessageCount).toBe(1);
		expect(result.details.analysis.roleCounts.toolResult).toBe(0);
		expect(result.details.recommendation).toBe("wait");
	});

	test("falls back to getEntries when getBranch is unavailable", async () => {
		const tool = createDcpPressureTool(config);
		const result = await tool.execute("call_pressure_3", {}, undefined, undefined, {
			sessionManager: {
				getEntries: () => [{ type: "message", message: { role: "user", content: "Hello from entries" } }],
			},
			getContextUsage: () => ({ percent: 25, tokens: 5000 }),
		} as any);

		expect(result.details.analysis.originalMessageCount).toBe(1);
		expect(result.details.recommendation).toBe("wait");
	});

	test("remains safe when context usage is unavailable", async () => {
		const tool = createDcpPressureTool(config);
		const result = await tool.execute("call_pressure_4", {}, undefined, undefined, {
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "user", content: "Hello" } }],
			},
		} as any);

		expect(result.details.usage).toBeNull();
		expect(result.details.recommendation).toBe("wait");
		expect((result.content as any[])[0].text).toContain("wait");
	});
});
