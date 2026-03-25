/**
 * Configuration management with zero-install fallbacks.
 *
 * Pi loads local extensions directly from source, which means npm dependencies
 * are not guaranteed to be installed inside ~/.pi/agent/extensions/<name>.
 *
 * The original implementation imported `bunfig` at module load time, which made
 * the entire extension fail to load when node_modules was absent.
 *
 * This loader keeps the same user-facing config behavior for the common cases
 * (project config, home config, CLI/env overrides) without requiring any local
 * package installation.
 */
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isPruneRuleObject } from "./types.js";
import { getRule, getRuleNames } from "./registry.js";
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    enabled: true,
    debug: true,
    rules: ["deduplication", "superseded-writes", "error-purging", "tool-pairing", "recency"],
    keepRecentCount: 10,
};
const PROJECT_CONFIG_CANDIDATES = [
    "dcp.config.ts",
    "dcp.config.js",
    "dcp.config.mts",
    "dcp.config.mjs",
    "dcp.config.cts",
    "dcp.config.cjs",
    "dcp.config.json",
    ".dcprc",
    ".dcprc.json",
    "package.json",
];
const HOME_CONFIG_CANDIDATES = [
    ".dcprc",
    ".dcprc.json",
    "dcp.config.ts",
    "dcp.config.js",
    "dcp.config.mts",
    "dcp.config.mjs",
    "dcp.config.cts",
    "dcp.config.cjs",
    "dcp.config.json",
    "package.json",
];
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }
    return undefined;
}
function parseNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function looksLikeJson(raw) {
    const trimmed = raw.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
}
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function importConfigModule(path, raw) {
    const extension = extname(path);
    if (extension) {
        const imported = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
        return imported.default ?? imported;
    }
    const tempPath = join(dirname(path), `.${basename(path)}.pi-dcp-load-${process.pid}-${Date.now()}.ts`);
    await writeFile(tempPath, raw, "utf-8");
    try {
        const imported = await import(`${pathToFileURL(tempPath).href}?t=${Date.now()}`);
        return imported.default ?? imported;
    }
    finally {
        await rm(tempPath, { force: true });
    }
}
async function loadConfigObject(path) {
    const raw = await readFile(path, "utf-8");
    const fileName = basename(path);
    if (fileName === "package.json") {
        const parsed = JSON.parse(raw);
        return parsed.dcp ?? parsed["pi-dcp"] ?? null;
    }
    if (looksLikeJson(raw)) {
        return JSON.parse(raw);
    }
    return importConfigModule(path, raw);
}
async function findConfigFile(cwd) {
    for (const candidate of PROJECT_CONFIG_CANDIDATES) {
        const path = join(cwd, candidate);
        if (!await pathExists(path)) {
            continue;
        }
        if (candidate === "package.json") {
            try {
                const packageConfig = await loadConfigObject(path);
                if (packageConfig) {
                    return { path, config: packageConfig };
                }
            }
            catch (error) {
                throw new Error(`Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
            continue;
        }
        return { path, config: await loadConfigObject(path) };
    }
    for (const candidate of HOME_CONFIG_CANDIDATES) {
        const path = join(homedir(), candidate);
        if (!await pathExists(path)) {
            continue;
        }
        if (candidate === "package.json") {
            try {
                const packageConfig = await loadConfigObject(path);
                if (packageConfig) {
                    return { path, config: packageConfig };
                }
            }
            catch (error) {
                throw new Error(`Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
            continue;
        }
        return { path, config: await loadConfigObject(path) };
    }
    return null;
}
function loadEnvOverrides() {
    const enabled = parseBoolean(process.env.DCP_ENABLED);
    const debug = parseBoolean(process.env.DCP_DEBUG);
    const keepRecentCount = parseNumber(process.env.DCP_KEEP_RECENT_COUNT);
    const rules = typeof process.env.DCP_RULES === "string"
        ? process.env.DCP_RULES
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
    return {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(debug !== undefined ? { debug } : {}),
        ...(keepRecentCount !== undefined ? { keepRecentCount } : {}),
        ...(rules !== undefined ? { rules } : {}),
    };
}
function normalizeBaseConfig(value) {
    if (!isPlainObject(value)) {
        return { ...DEFAULT_CONFIG };
    }
    const merged = {
        ...DEFAULT_CONFIG,
        ...value,
    };
    if (!Array.isArray(merged.rules)) {
        merged.rules = [...DEFAULT_CONFIG.rules];
    }
    if (typeof merged.enabled !== "boolean") {
        merged.enabled = DEFAULT_CONFIG.enabled;
    }
    if (typeof merged.debug !== "boolean") {
        merged.debug = DEFAULT_CONFIG.debug;
    }
    if (!Number.isInteger(merged.keepRecentCount) || merged.keepRecentCount < 0) {
        merged.keepRecentCount = DEFAULT_CONFIG.keepRecentCount;
    }
    return merged;
}
/**
 * Load configuration from extension settings, files, or defaults
 * Priority (highest to lowest):
 * 1. CLI flags (--dcp-enabled, --dcp-debug)
 * 2. Environment variables (DCP_ENABLED, DCP_DEBUG, DCP_KEEP_RECENT_COUNT, DCP_RULES)
 * 3. Config file in current directory (dcp.config.ts, etc.)
 * 4. Config file in home directory (~/.dcprc)
 * 5. Default configuration
 */
export async function loadConfig(pi) {
    let discoveredConfig = null;
    try {
        discoveredConfig = await findConfigFile(process.cwd());
    }
    catch (error) {
        console.warn(`[pi-dcp] Warning: ${error instanceof Error ? error.message : String(error)}. Falling back to defaults.`);
    }
    const config = normalizeBaseConfig({
        ...(discoveredConfig?.config ?? {}),
        ...loadEnvOverrides(),
    });
    // Apply flag overrides (highest priority)
    const enabled = pi.getFlag("--dcp-enabled");
    const debug = pi.getFlag("--dcp-debug");
    // Filter out invalid rules
    const availableRuleNames = getRuleNames();
    const invalidRuleNames = [];
    const rules = config.rules
        .filter((rule) => {
        if (isPruneRuleObject(rule)) {
            return true; // Keep non-string rules (custom rule objects)
        }
        if (typeof rule === "string" && availableRuleNames.includes(rule)) {
            return true; // Valid rule name
        }
        invalidRuleNames.push(typeof rule === "string" ? rule : JSON.stringify(rule));
        return false; // Remove invalid rule names
    })
        .map((rule) => {
        if (typeof rule === "string") {
            return getRule(rule); // Non-null due to filtering above
        }
        return rule;
    });
    if (enabled !== undefined) {
        config.enabled = enabled;
    }
    if (debug !== undefined) {
        config.debug = debug;
    }
    // Log config discovery and invalid rules if debug is enabled
    if (config.debug && discoveredConfig?.path) {
        console.warn(`[pi-dcp] Loaded config from ${discoveredConfig.path}`);
    }
    if (config.debug && invalidRuleNames.length > 0) {
        console.warn(`[pi-dcp] Warning: The following configured rules are invalid and will be ignored: ${invalidRuleNames.join(", ")}`);
    }
    return {
        ...config,
        rules,
    };
}
/**
 * Get default configuration (useful for testing or displaying defaults)
 */
export function getDefaultConfig() {
    return { ...DEFAULT_CONFIG };
}
/**
 * Generate sample configuration file content
 * Used by the init command to create dcp.config.ts
 */
export function generateConfigFileContent(options) {
    const simplified = options?.simplified ?? false;
    if (simplified) {
        return `/**
 * DCP (Dynamic Context Pruning) Configuration
 * 
 * Place this file as:
 * - ./dcp.config.ts (project-specific)
 * - ~/.dcprc (user-wide)
 */

import type { DcpConfig } from "~/.pi/agent/extensions/pi-dcp/src/types";

export default {
	enabled: true,
	debug: false,
	rules: ["deduplication", "superseded-writes", "error-purging", "tool-pairing", "recency"],
	keepRecentCount: 10,
} satisfies DcpConfig;
`;
    }
    return `/**
 * DCP (Dynamic Context Pruning) Configuration
 * 
 * This file configures the pi-dcp extension for intelligent context pruning.
 * 
 * Place this file as:
 * - ./dcp.config.ts (project-specific configuration)
 * - ~/.dcprc (user-wide configuration)
 * 
 * All fields are optional - defaults will be used for missing values.
 */

import type { DcpConfig } from "~/.pi/agent/extensions/pi-dcp/src/types";

export default {
	// Enable/disable DCP entirely
	enabled: true,

	// Enable debug logging to see what gets pruned
	debug: false,

	// Rules to apply (in order of execution)
	// Available built-in rules:
	// - "deduplication": Remove duplicate tool outputs
	// - "superseded-writes": Remove older file versions
	// - "error-purging": Remove resolved errors
	// - "tool-pairing": Preserve tool_use/tool_result pairing (CRITICAL)
	// - "recency": Always keep recent messages
	rules: [
		"deduplication",
		"superseded-writes",
		"error-purging",
		"tool-pairing",
		"recency",
	],

	// Number of recent messages to always keep (for recency rule)
	keepRecentCount: 10,
} satisfies DcpConfig;
`;
}
/**
 * Write configuration file to the specified path
 *
 * @param path - Full path where to write the config file
 * @param options - Options for file generation
 * @returns Promise that resolves when file is written
 */
export async function writeConfigFile(path, options) {
    const force = options?.force ?? false;
    // Check if file already exists
    if (!force) {
        try {
            await access(path);
            throw new Error("Config file already exists. Use force option to overwrite.");
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
            // File doesn't exist, proceed
        }
    }
    const content = generateConfigFileContent(options);
    await writeFile(path, content, "utf-8");
}
