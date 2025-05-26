export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>): void {
    if (level <= this.level) {
      const entry: LogEntry = {
        level,
        message,
        timestamp: new Date(),
        context
      };

      const levelName = LogLevel[level];
      const timestamp = entry.timestamp.toISOString();
      const contextStr = context ? ` ${JSON.stringify(context)}` : '';
      
      console.log(`[${timestamp}] ${levelName}: ${message}${contextStr}`);
    }
  }

  error(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger(
  process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO
);
