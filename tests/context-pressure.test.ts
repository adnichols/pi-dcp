/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getContextPressureSnapshot } from "../src/context-pressure";
import { registerRule } from "../src/registry";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { assistantToolCall, toolResult } from "./pruning-test-helpers";

describe("Context pressure recommendation", () => {
	beforeAll(() => {
		registerRule(deduplicationRule);
		registerRule(supersededWritesRule);
		registerRule(errorPurgingRule);
		registerRule(supersededToolResultsRule);
		registerRule(staleFileReadsRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

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

	test("recommends wait when pressure and predicted savings are low", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "single read result"),
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 32,
			tokens: 8000,
		});

		expect(snapshot.recommendation).toBe("wait");
		expect(snapshot.predicted.prunedCount).toBe(0);
		expect(snapshot.predicted.estimatedTokensSaved).toBe(0);
		expect(snapshot.rationale.length).toBeGreaterThan(0);
	});

	test("recommends compaction when context usage is high even if predicted savings are small", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "single read result"),
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 86,
			tokens: 118000,
		});

		expect(snapshot.recommendation).toBe("compact-now");
		expect(snapshot.rationale.some((reason) => reason.includes("context usage"))).toBe(true);
	});

	test("recommends compaction when tool-result pressure is high and predicted savings are meaningful", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Deep inspection" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_1", "bash", "old grep ".repeat(100)),
			assistantToolCall("bash_2", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_2", "bash", "new grep"),
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 64,
			tokens: 54000,
		});

		expect(snapshot.recommendation).toBe("compact-now");
		expect(snapshot.predicted.prunedCount).toBe(2);
		expect(snapshot.predicted.estimatedTokensSaved).toBeGreaterThan(400);
		expect(snapshot.analysis.repeatedReads[0]?.count).toBe(2);
		expect(snapshot.analysis.repeatedBashCommands[0]?.count).toBe(2);
	});

	test("ignores dcp inspection and compaction tool traffic in recommendation calculations", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Check whether we should compact" } as AgentMessage,
			assistantToolCall("dcp_1", "dcp_pressure", {}),
			toolResult("dcp_1", "dcp_pressure", "pressure snapshot"),
			assistantToolCall("dcp_2", "dcp_compact", { focus: "keep active task" }),
			toolResult("dcp_2", "dcp_compact", "compaction started"),
			assistantToolCall("dcp_3", "dcp_pressure", {}),
			toolResult("dcp_3", "dcp_pressure", "pressure snapshot again"),
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 38,
			tokens: 12000,
		});

		expect(snapshot.recommendation).toBe("wait");
		expect(snapshot.analysis.totalMessages).toBe(1);
		expect(snapshot.analysis.roleCounts.toolResult).toBe(0);
		expect(snapshot.predicted.prunedCount).toBe(0);
		expect(snapshot.predicted.estimatedTokensSaved).toBe(0);
	});
});
