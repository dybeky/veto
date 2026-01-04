import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PATHS } from '../config/constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

class Logger {
  private logFilePath: string;
  private logStream: fs.WriteStream | null = null;
  private logLevel: LogLevel = 'info';
  private consoleEnabled: boolean = true;
  private fileEnabled: boolean = true;
  private maxFileSize: number = 5 * 1024 * 1024; // 5MB

  constructor() {
    this.logFilePath = path.join(os.tmpdir(), PATHS.LOG_FILE);
  }

  /**
   * Initialize logger
   */
  init(options?: { level?: LogLevel; console?: boolean; file?: boolean }): void {
    if (options?.level) this.logLevel = options.level;
    if (options?.console !== undefined) this.consoleEnabled = options.console;
    if (options?.file !== undefined) this.fileEnabled = options.file;

    if (this.fileEnabled) {
      this.rotateLogIfNeeded();
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    }
  }

  /**
   * Rotate log file if it's too large
   */
  private rotateLogIfNeeded(): void {
    try {
      const stats = fs.statSync(this.logFilePath);
      if (stats.size > this.maxFileSize) {
        const backupPath = this.logFilePath + '.old';
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(this.logFilePath, backupPath);
      }
    } catch {
      // File doesn't exist, that's fine
    }
  }

  /**
   * Get log level priority
   */
  private getLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    return priorities[level];
  }

  /**
   * Format log entry
   */
  private formatEntry(entry: LogEntry): string {
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.level.toUpperCase()}]`,
      entry.message
    ];
    if (entry.data) {
      parts.push(JSON.stringify(entry.data));
    }
    return parts.join(' ');
  }

  /**
   * Write log entry
   */
  private write(level: LogLevel, message: string, data?: any): void {
    if (this.getLevelPriority(level) < this.getLevelPriority(this.logLevel)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };

    const formatted = this.formatEntry(entry);

    // Write to console
    if (this.consoleEnabled) {
      const colors: Record<LogLevel, string> = {
        debug: '\x1b[90m',  // Gray
        info: '\x1b[36m',   // Cyan
        warn: '\x1b[33m',   // Yellow
        error: '\x1b[31m'   // Red
      };
      const reset = '\x1b[0m';
      console.log(`${colors[level]}${formatted}${reset}`);
    }

    // Write to file
    if (this.fileEnabled && this.logStream) {
      this.logStream.write(formatted + '\n');
    }
  }

  debug(message: string, data?: any): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.write('error', message, data);
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Close logger
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Read recent log entries
   */
  async readRecentLogs(lines: number = 50): Promise<string[]> {
    try {
      const content = fs.readFileSync(this.logFilePath, 'utf8');
      const allLines = content.split('\n').filter(l => l.trim());
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }
}

// Global logger instance
export const logger = new Logger();
