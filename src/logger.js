/**
 * Rotated file logger for pi-dcp extension
 *
 * Provides structured logging to rotating log files with:
 * - Automatic log rotation when size limit reached
 * - Configurable number of backup files
 * - Multiple log levels (ERROR, WARN, INFO, DEBUG)
 * - Async writes to avoid blocking
 * - Timestamps and contextual information
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["ERROR"] = 0] = "ERROR";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
})(LogLevel || (LogLevel = {}));
export class Logger {
    logDir;
    logFileName;
    logFilePath;
    maxFileSize;
    maxBackups;
    minLevel;
    enableConsole;
    constructor(config = {}) {
        // Default to ~/.pi/logs/pi-dcp
        this.logDir = config.logDir || join(homedir(), ".pi", "logs");
        this.logFileName = config.logFileName || "pi-dcp.log";
        this.logFilePath = join(this.logDir, this.logFileName);
        this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB
        this.maxBackups = config.maxBackups || 5;
        this.minLevel = config.minLevel ?? LogLevel.INFO;
        this.enableConsole = config.enableConsole || false;
        // Ensure log directory exists
        this.ensureLogDirectory();
    }
    ensureLogDirectory() {
        if (!existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true });
        }
    }
    shouldRotate() {
        if (!existsSync(this.logFilePath)) {
            return false;
        }
        try {
            const stats = statSync(this.logFilePath);
            return stats.size >= this.maxFileSize;
        }
        catch (error) {
            return false;
        }
    }
    rotateLogs() {
        try {
            // Delete oldest backup if we're at the limit
            const oldestBackup = join(this.logDir, `${this.logFileName}.${this.maxBackups}`);
            if (existsSync(oldestBackup)) {
                unlinkSync(oldestBackup);
            }
            // Shift all existing backups up by one
            for (let i = this.maxBackups - 1; i >= 1; i--) {
                const oldPath = join(this.logDir, `${this.logFileName}.${i}`);
                const newPath = join(this.logDir, `${this.logFileName}.${i + 1}`);
                if (existsSync(oldPath)) {
                    renameSync(oldPath, newPath);
                }
            }
            // Move current log to .1
            const backupPath = join(this.logDir, `${this.logFileName}.1`);
            renameSync(this.logFilePath, backupPath);
        }
        catch (error) {
            // If rotation fails, try to continue with current log
            console.error("[pi-dcp] Failed to rotate logs:", error);
        }
    }
    formatMessage(level, message, context) {
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level].padEnd(5);
        const contextStr = context ? ` ${JSON.stringify(context)}` : "";
        return `${timestamp} [${levelStr}] ${message}${contextStr}\n`;
    }
    write(level, message, context) {
        // Skip if below minimum level
        if (level > this.minLevel) {
            return;
        }
        const formatted = this.formatMessage(level, message, context);
        // Write to console if enabled
        if (this.enableConsole) {
            const consoleMethod = level === LogLevel.ERROR ? console.error : console.log;
            consoleMethod(`[pi-dcp] ${message}`, context || "");
        }
        try {
            // Check if rotation is needed
            if (this.shouldRotate()) {
                this.rotateLogs();
            }
            // Append to log file (synchronous for simplicity)
            appendFileSync(this.logFilePath, formatted, "utf8");
        }
        catch (error) {
            // Fallback to console if file write fails
            console.error("[pi-dcp] Failed to write to log file:", error);
            console.log(formatted);
        }
    }
    error(message, context) {
        this.write(LogLevel.ERROR, message, context);
    }
    warn(message, context) {
        this.write(LogLevel.WARN, message, context);
    }
    info(message, context) {
        this.write(LogLevel.INFO, message, context);
    }
    debug(message, context) {
        this.write(LogLevel.DEBUG, message, context);
    }
    /**
     * Get the path to the current log file
     */
    getLogPath() {
        return this.logFilePath;
    }
    /**
     * Get list of all log files (current + backups)
     */
    getAllLogFiles() {
        const files = [];
        if (existsSync(this.logFilePath)) {
            files.push(this.logFilePath);
        }
        for (let i = 1; i <= this.maxBackups; i++) {
            const backupPath = join(this.logDir, `${this.logFileName}.${i}`);
            if (existsSync(backupPath)) {
                files.push(backupPath);
            }
        }
        return files;
    }
    /**
     * Update the minimum log level dynamically
     */
    setMinLevel(level) {
        this.minLevel = level;
    }
}
// Singleton instance
let loggerInstance = null;
/**
 * Get or create the logger instance
 */
export function getLogger(config) {
    if (!loggerInstance) {
        loggerInstance = new Logger(config);
    }
    return loggerInstance;
}
/**
 * Reset the logger instance (useful for testing)
 */
export function resetLogger() {
    loggerInstance = null;
}
//# sourceMappingURL=logger.js.map