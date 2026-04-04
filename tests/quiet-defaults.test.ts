/// <reference path="./test-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piDcpExtension from "../index";
import { createSessionSwitchEventHandler } from "../src/events/sessionStart";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalDcpEnabled = process.env.DCP_ENABLED;
const originalDcpDebug = process.env.DCP_DEBUG;
const originalDcpKeepRecentCount = process.env.DCP_KEEP_RECENT_COUNT;
const originalDcpRules = process.env.DCP_RULES;

const tempPaths: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempPaths.push(dir);
	return dir;
}

afterEach(() => {
	process.chdir(originalCwd);

	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}

	if (originalDcpEnabled === undefined) {
		delete process.env.DCP_ENABLED;
	} else {
		process.env.DCP_ENABLED = originalDcpEnabled;
	}

	if (originalDcpDebug === undefined) {
		delete process.env.DCP_DEBUG;
	} else {
		process.env.DCP_DEBUG = originalDcpDebug;
	}

	if (originalDcpKeepRecentCount === undefined) {
		delete process.env.DCP_KEEP_RECENT_COUNT;
	} else {
		process.env.DCP_KEEP_RECENT_COUNT = originalDcpKeepRecentCount;
	}

	if (originalDcpRules === undefined) {
		delete process.env.DCP_RULES;
	} else {
		process.env.DCP_RULES = originalDcpRules;
	}

	while (tempPaths.length > 0) {
		const path = tempPaths.pop();
		if (!path) continue;
		rmSync(path, { recursive: true, force: true });
	}
});

describe("quiet defaults", () => {
	test("extension stays quiet on startup and pruning when no config enables debug", async () => {
		const tempHome = makeTempDir("pi-dcp-home-");
		const tempProject = makeTempDir("pi-dcp-project-");
		process.env.HOME = tempHome;
		delete process.env.DCP_ENABLED;
		delete process.env.DCP_DEBUG;
		delete process.env.DCP_KEEP_RECENT_COUNT;
		delete process.env.DCP_RULES;
		process.chdir(tempProject);

		const handlers: Record<string, Function> = {};
		const notifications: Array<{ msg: string; level?: string }> = [];
		const statuses: Array<{ id: string; text: string }> = [];
		const pi = {
			getFlag() {
				return undefined;
			},
			registerCommand() {},
			registerTool() {},
			on(name: string, handler: Function) {
				handlers[name] = handler;
			},
		};

		await piDcpExtension(pi as any);

		const ctx = {
			hasUI: true,
			ui: {
				notify(msg: string, level?: string) {
					notifications.push({ msg, level });
				},
				setStatus(id: string, text: string) {
					statuses.push({ id, text });
				},
			},
		};

		handlers.session_start?.({ reason: "new" }, ctx);

		expect(notifications).toHaveLength(0);
		expect(statuses).toEqual([{ id: "pi-dcp", text: "DCP active · 6 rules" }]);

		statuses.length = 0;
		const messages = [
			{ role: "user", content: "Start" },
			{ role: "assistant", content: "duplicate summary" },
			{ role: "assistant", content: "duplicate summary" },
			{ role: "assistant", content: "filler 1" },
			{ role: "assistant", content: "filler 2" },
			{ role: "assistant", content: "filler 3" },
			{ role: "assistant", content: "filler 4" },
			{ role: "assistant", content: "filler 5" },
			{ role: "assistant", content: "filler 6" },
			{ role: "assistant", content: "filler 7" },
			{ role: "assistant", content: "filler 8" },
			{ role: "assistant", content: "filler 9" },
			{ role: "assistant", content: "filler 10" },
		];

		const result = await handlers.context?.({ messages }, ctx);

		expect(result?.messages).toHaveLength(12);
		expect(notifications).toHaveLength(0);
		expect(statuses).toHaveLength(1);
		expect(statuses[0]?.id).toBe("pi-dcp");
		expect(statuses[0]?.text).toContain("DCP 1 pruned, 0 redacted");
		expect(statuses[0]?.text).toContain("13 msgs · 0 tool results");
	});

	test("session switch uses status instead of notifications", () => {
		const notifications: Array<{ msg: string; level?: string }> = [];
		const statuses: Array<{ id: string; text: string }> = [];
		const handler = createSessionSwitchEventHandler({
			config: {
				rules: [{ name: "deduplication" }, { name: "recency" }],
			},
		} as any);

		handler({ reason: "branch-shift" } as any, {
			hasUI: true,
			ui: {
				notify(msg: string, level?: string) {
					notifications.push({ msg, level });
				},
				setStatus(id: string, text: string) {
					statuses.push({ id, text });
				},
			},
		} as any);

		expect(notifications).toHaveLength(0);
		expect(statuses).toEqual([
			{ id: "pi-dcp", text: "DCP active · 2 rules · switched (branch-shift)" },
		]);
	});
});
