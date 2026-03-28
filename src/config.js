/**
 * Configuration management without external runtime dependencies.
 *
 * Pi loads local extensions directly from source, which means npm dependencies
 * are not guaranteed to be installed inside ~/.pi/agent/extensions/<name>.
 *
 * This loader keeps the same user-facing config behavior for the common cases
 * (project config, home config, package.json config, CLI/env overrides) without
 * requiring any local package installation.
 */
import { createRequire } from "node:module";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isPruneRuleObject } from "./types.js";
import { getRule, getRuleNames } from "./registry.js";
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    enabled: true,
    debug: true,
    rules: ["deduplication", "superseded-writes", "error-purging", "superseded-tool-results", "tool-pairing", "recency"],
    keepRecentCount: 10,
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
    nudge: {
        enabled: true,
        minMessages: 60,
        minToolResults: 30,
        minRepeatCount: 3,
        minContextPercent: 70,
        notify: true,
        maxSummaryItems: 2,
    },
};
const CONFIG_FILE_NAMES = [
    "dcp.config.ts",
    "dcp.config.mts",
    "dcp.config.cts",
    "dcp.config.js",
    "dcp.config.mjs",
    "dcp.config.cjs",
    "dcp.config.json",
    "dcp.config.toml",
    "dcp.config.yaml",
    "dcp.config.yml",
    ".dcprc",
    ".dcprc.json",
    ".dcprc.toml",
    ".dcprc.yaml",
    ".dcprc.yml",
];
const require = createRequire(import.meta.url);
/**
 * Load configuration from extension settings, files, or defaults
 * Priority (highest to lowest):
 * 1. CLI flags (--dcp-enabled, --dcp-debug)
 * 2. Environment variables (DCP_ENABLED, DCP_DEBUG, DCP_KEEP_RECENT_COUNT, DCP_RULES)
 * 3. Config file in current directory (dcp.config.ts, etc.)
 * 4. Config file in home directory (~/.dcprc)
 * 5. package.json key ("pi-dcp" or "dcp") in cwd/home
 * 6. Default configuration
 */
export async function loadConfig(pi) {
    let loadedConfig = {};
    let source = undefined;
    let attemptedSource = undefined;
    try {
        const discovered = await discoverConfigSource();
        if (discovered) {
            attemptedSource = discovered.path;
            loadedConfig = await loadConfigSource(discovered);
            source = discovered.path;
        }
    }
    catch (error) {
        console.warn(`[pi-dcp] Failed to load configuration${attemptedSource ? ` from ${attemptedSource}` : ""}: ${error?.message || error}. Falling back to defaults.`);
    }
    const config = normalizeConfig({
        ...DEFAULT_CONFIG,
        ...loadedConfig,
    });
    applyEnvironmentOverrides(config);
    // Apply flag overrides (highest priority)
    const enabled = pi.getFlag("--dcp-enabled");
    const debug = pi.getFlag("--dcp-debug");
    if (enabled !== undefined) {
        config.enabled = enabled;
    }
    if (debug !== undefined) {
        config.debug = debug;
    }
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
    // Log invalid rules if debug is enabled
    if (config.debug) {
        if (source) {
            console.info(`[pi-dcp] Loaded config from ${source}`);
        }
        if (invalidRuleNames.length > 0) {
            console.warn(`[pi-dcp] Warning: The following configured rules are invalid and will be ignored: ${invalidRuleNames.join(", ")}`);
        }
    }
    return {
        ...config,
        rules,
    };
}
async function discoverConfigSource() {
    const searchDirs = [process.cwd(), homedir()];
    for (const dir of searchDirs) {
        for (const fileName of CONFIG_FILE_NAMES) {
            const filePath = resolve(dir, fileName);
            if (await pathExists(filePath)) {
                return { kind: "file", path: filePath };
            }
        }
        const packageJsonPath = resolve(dir, "package.json");
        if (await pathExists(packageJsonPath)) {
            const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
            const packageConfig = packageJson["pi-dcp"] ?? packageJson.dcp;
            if (packageConfig && typeof packageConfig === "object") {
                return {
                    kind: "package-json",
                    path: `${packageJsonPath}#${packageJson["pi-dcp"] ? "pi-dcp" : "dcp"}`,
                    value: packageConfig,
                };
            }
        }
    }
    return null;
}
async function loadConfigSource(source) {
    if (source.kind === "package-json") {
        return source.value;
    }
    const filePath = source.path;
    const extension = extname(filePath).toLowerCase();
    if (extension === ".toml") {
        return parseToml(await readFile(filePath, "utf8"));
    }
    if (extension === ".yaml" || extension === ".yml") {
        return parseYaml(await readFile(filePath, "utf8"));
    }
    if (extension === ".cjs") {
        return normalizeModuleValue(require(filePath));
    }
    if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
        return loadTypeScriptConfig(filePath);
    }
    if (extension === ".json") {
        return JSON.parse(await readFile(filePath, "utf8"));
    }
    if (filePath.endsWith(".dcprc")) {
        const sourceText = await readFile(filePath, "utf8");
        const trimmed = sourceText.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return JSON.parse(sourceText);
        }
        if (/\bmodule\.exports\s*=/.test(sourceText) || /\bexports\./.test(sourceText)) {
            return normalizeModuleValue(require(filePath));
        }
        if (looksLikeTypeScriptModule(sourceText)) {
            return loadTypeScriptConfig(filePath);
        }
        return loadJavaScriptConfig(filePath);
    }
    return loadJavaScriptConfig(filePath);
}
async function loadJavaScriptConfig(filePath) {
    const href = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
    const moduleValue = await import(href);
    return normalizeModuleValue(moduleValue);
}
async function loadTypeScriptConfig(filePath) {
    const source = await readFile(filePath, "utf8");
    const compiled = transpileConfigTypeScript(source);
    const tempPath = resolve(dirname(filePath), `.pi-dcp-config-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
    await writeFile(tempPath, compiled, "utf8");
    try {
        return await loadJavaScriptConfig(tempPath);
    }
    finally {
        await unlink(tempPath).catch(() => undefined);
    }
}
function normalizeModuleValue(moduleValue) {
    if (moduleValue && typeof moduleValue === "object" && "default" in moduleValue) {
        return moduleValue.default ?? {};
    }
    return moduleValue ?? {};
}
function normalizeConfig(config) {
    const configObject = config && typeof config === "object" ? config : {};
    const normalized = {
        ...DEFAULT_CONFIG,
        ...configObject,
        protectedTools: Array.isArray(configObject.protectedTools)
            ? configObject.protectedTools.filter((tool) => typeof tool === "string" && tool.length > 0)
            : [...DEFAULT_CONFIG.protectedTools],
        protectedFilePatterns: Array.isArray(configObject.protectedFilePatterns)
            ? configObject.protectedFilePatterns.filter((pattern) => typeof pattern === "string" && pattern.length > 0)
            : [...DEFAULT_CONFIG.protectedFilePatterns],
        ageGates: {
            ...DEFAULT_CONFIG.ageGates,
            ...(configObject.ageGates && typeof configObject.ageGates === "object" ? configObject.ageGates : {}),
        },
        redaction: {
            ...DEFAULT_CONFIG.redaction,
            ...(configObject.redaction && typeof configObject.redaction === "object" ? configObject.redaction : {}),
        },
        nudge: {
            ...DEFAULT_CONFIG.nudge,
            ...(configObject.nudge && typeof configObject.nudge === "object" ? configObject.nudge : {}),
        },
    };
    if (!Array.isArray(normalized.rules)) {
        normalized.rules = [...DEFAULT_CONFIG.rules];
    }
    if (typeof normalized.enabled !== "boolean") {
        normalized.enabled = DEFAULT_CONFIG.enabled;
    }
    if (typeof normalized.debug !== "boolean") {
        normalized.debug = DEFAULT_CONFIG.debug;
    }
    if (!Number.isFinite(normalized.keepRecentCount) || normalized.keepRecentCount < 0) {
        normalized.keepRecentCount = DEFAULT_CONFIG.keepRecentCount;
    }
    for (const key of Object.keys(DEFAULT_CONFIG.ageGates)) {
        const value = normalized.ageGates[key];
        if (!Number.isFinite(value) || value < 0) {
            normalized.ageGates[key] = DEFAULT_CONFIG.ageGates[key];
        }
    }
    for (const key of Object.keys(DEFAULT_CONFIG.redaction)) {
        if (typeof normalized.redaction[key] !== "boolean") {
            normalized.redaction[key] = DEFAULT_CONFIG.redaction[key];
        }
    }
    if (!normalized.nudge || typeof normalized.nudge !== "object") {
        normalized.nudge = { ...DEFAULT_CONFIG.nudge };
    }
    return normalized;
}
function applyEnvironmentOverrides(config) {
    const enabled = parseBoolean(process.env.DCP_ENABLED);
    const debug = parseBoolean(process.env.DCP_DEBUG);
    const keepRecentCount = parseNumber(process.env.DCP_KEEP_RECENT_COUNT);
    const rules = parseRules(process.env.DCP_RULES);
    if (enabled !== undefined) {
        config.enabled = enabled;
    }
    if (debug !== undefined) {
        config.debug = debug;
    }
    if (keepRecentCount !== undefined) {
        config.keepRecentCount = keepRecentCount;
    }
    if (rules !== undefined) {
        config.rules = rules;
    }
}
function parseBoolean(value) {
    if (value == null) {
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
    if (value == null || value.trim() === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseRules(value) {
    if (value == null || value.trim() === "") {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    }
    return trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
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
function looksLikeTypeScriptModule(source) {
    return /\bimport\s+type\b/.test(source)
        || /\bsatisfies\s+[A-Za-z_$]/.test(source)
        || /\bexport\s+default\b/.test(source);
}
function transpileConfigTypeScript(source) {
    return source
        .replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, "")
        .replace(/^\s*export\s+type\s+[^;]+;\s*$/gm, "")
        .replace(/\s+satisfies\s+[A-Za-z_$][A-Za-z0-9_$\.<>\[\]\{\},\s|&]*/g, "")
        .replace(/\s+as\s+const\b/g, "");
}
function parseToml(source) {
    const result = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        if (!line || line.startsWith("[")) {
            continue;
        }
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        result[key] = parseScalar(value);
    }
    return result;
}
function parseYaml(source) {
    const result = {};
    let activeArrayKey = null;
    for (const rawLine of source.split(/\r?\n/)) {
        const lineWithoutComment = stripYamlComment(rawLine);
        const trimmed = lineWithoutComment.trim();
        if (!trimmed) {
            continue;
        }
        const arrayMatch = rawLine.match(/^\s*-\s*(.+)$/);
        if (arrayMatch && activeArrayKey) {
            result[activeArrayKey].push(parseScalar(arrayMatch[1].trim()));
            continue;
        }
        const keyMatch = lineWithoutComment.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!keyMatch) {
            activeArrayKey = null;
            continue;
        }
        const [, key, rawValue] = keyMatch;
        const value = rawValue.trim();
        if (value === "") {
            result[key] = [];
            activeArrayKey = key;
            continue;
        }
        result[key] = parseScalar(value);
        activeArrayKey = null;
    }
    return result;
}
function stripYamlComment(line) {
    let inSingle = false;
    let inDouble = false;
    let result = "";
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (char === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        if (char === "#" && !inSingle && !inDouble) {
            break;
        }
        result += char;
    }
    return result;
}
function parseScalar(value) {
    const trimmed = value.trim();
    if (trimmed === "true") {
        return true;
    }
    if (trimmed === "false") {
        return false;
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const inner = trimmed.slice(1, -1).trim();
        if (!inner) {
            return [];
        }
        return splitInlineArray(inner).map((part) => parseScalar(part));
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && trimmed !== "") {
        return numeric;
    }
    return trimmed;
}
function splitInlineArray(value) {
    const parts = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (char === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        if (char === "," && !inSingle && !inDouble) {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}
/**
 * Get default configuration (useful for testing or displaying defaults)
 */
export function getDefaultConfig() {
    return {
        ...DEFAULT_CONFIG,
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
        protectedFilePatterns: [...DEFAULT_CONFIG.protectedFilePatterns],
        ageGates: { ...DEFAULT_CONFIG.ageGates },
        redaction: { ...DEFAULT_CONFIG.redaction },
        nudge: { ...DEFAULT_CONFIG.nudge },
    };
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
	rules: ["deduplication", "superseded-writes", "error-purging", "superseded-tool-results", "tool-pairing", "recency"],
	keepRecentCount: 10,
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
	nudge: {
		enabled: true,
	},
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
	// - "superseded-tool-results": Remove older repeated read/bash results
	// - "stale-file-reads": Remove reads invalidated by later successful writes/edits (opt-in)
	// - "tool-pairing": Preserve tool_use/tool_result pairing (CRITICAL)
	// - "recency": Always keep recent messages
	rules: [
		"deduplication",
		"superseded-writes",
		"error-purging",
		"superseded-tool-results",
		"tool-pairing",
		"recency",
	],

	// Number of recent messages to always keep (for recency rule)
	keepRecentCount: 10,

	// Tool names that normal cleanup rules must never prune or redact
	protectedTools: [],

	// File paths/globs that normal cleanup rules must never prune or redact
	protectedFilePatterns: [],

	// Minimum completed later user turns required before destructive cleanup runs.
	// A later user turn counts only after some later non-user reply/tool activity exists.
	ageGates: {
		supersededToolResults: 0,
		errorPurging: 0,
		supersededWrites: 0,
		staleFileReads: 0,
	},

	// Redaction toggles are available for newer workflow stages.
	// Defaults remain delete-only for backwards compatibility.
	redaction: {
		supersededToolResults: false,
		resolvedErrors: false,
		staleFileReads: false,
	},

	// Long-session nudging configuration
	nudge: {
		enabled: true,
		minMessages: 60,
		minToolResults: 30,
		minRepeatCount: 3,
		minContextPercent: 70,
		notify: true,
	},
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
//# sourceMappingURL=config.js.map
