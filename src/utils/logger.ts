// Simple logger utility

import { EnvConfig } from './env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static level: LogLevel = EnvConfig.getLogLevel() as LogLevel;
  private static levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private static shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  static debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }

  static info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.error(`[INFO] ${message}`, ...args);
    }
  }

  static warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.error(`[WARN] ${message}`, ...args);
    }
  }

  static error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
}