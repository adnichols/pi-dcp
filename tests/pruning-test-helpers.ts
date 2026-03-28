/// <reference path="./test-shims.d.ts" />

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";

export const assistantToolCall = (id: string, name: string, args: Record<string, unknown>): AgentMessage =>
	({
		role: "assistant",
		content: [
			{ type: "text", text: `Running ${name}` },
			{ type: "toolCall", id, name, arguments: args },
		],
	} as AgentMessage);

export const toolResult = (
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

export const createBaseConfig = (
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
		staleFileReads: 0,
	},
	redaction: {
		supersededToolResults: false,
		resolvedErrors: false,
		staleFileReads: false,
	},
	...overrides,
});

export function getToolResultIds(messages: AgentMessage[]): string[] {
	return messages
		.filter((message) => message.role === "toolResult")
		.map((message) => (message as any).toolCallId);
}

export function getText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return (message.content as any[])
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}
