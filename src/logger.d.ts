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
export declare enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}
export interface LoggerConfig {
    /** Directory where log files will be stored */
    logDir?: string;
    /** Base name for log file (without extension) */
    logFileName?: string;
    /** Maximum size of log file in bytes before rotation (default: 10MB) */
    maxFileSize?: number;
    /** Number of rotated log files to keep (default: 5) */
    maxBackups?: number;
    /** Minimum log level to write (default: INFO) */
    minLevel?: LogLevel;
    /** Enable console output as well (default: false) */
    enableConsole?: boolean;
}
export declare class Logger {
    private logDir;
    private logFileName;
    private logFilePath;
    private maxFileSize;
    private maxBackups;
    private minLevel;
    private enableConsole;
    constructor(config?: LoggerConfig);
    private ensureLogDirectory;
    private shouldRotate;
    private rotateLogs;
    private formatMessage;
    private write;
    error(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
    /**
     * Get the path to the current log file
     */
    getLogPath(): string;
    /**
     * Get list of all log files (current + backups)
     */
    getAllLogFiles(): string[];
    /**
     * Update the minimum log level dynamically
     */
    setMinLevel(level: LogLevel): void;
}
/**
 * Get or create the logger instance
 */
export declare function getLogger(config?: LoggerConfig): Logger;
/**
 * Reset the logger instance (useful for testing)
 */
export declare function resetLogger(): void;
//# sourceMappingURL=logger.d.ts.map