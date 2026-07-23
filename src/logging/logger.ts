import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  sessionId?: string;
  campaignId?: string;
  leadId?: string;
  agent?: string;
  [key: string]: unknown;
}

export interface LogRecord extends LogContext {
  timestamp: string;
  level: LogLevel;
  event: string;
  service: "trade-radar-flow";
  environment: string;
  processId: number;
  message?: string;
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const contextStorage = new AsyncLocalStorage<LogContext>();
const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const configuredLevel = (
  process.env.LOG_LEVEL?.toLowerCase() ?? "info"
) as LogLevel;
const minimumLevel = levelWeight[configuredLevel] ?? levelWeight.info;
const logDirectory =
  process.env.LOG_DIR?.trim() ||
  path.join(
    process.cwd(),
    "logs",
    process.env.NODE_TEST_CONTEXT ? "test" : "",
  );
mkdirSync(logDirectory, { recursive: true });

const SENSITIVE_KEY =
  /(?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|cookie|private[_-]?key)/i;
const EMAIL = /\b([A-Z0-9._%+-])[^@\s]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const PHONE = /(?<!\d)(\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const TOKEN =
  /\b(?:sk|pk|key|token)[-_][A-Za-z0-9._-]{10,}\b/gi;

function dailyLogPath(timestamp: string): string {
  return path.join(logDirectory, `trade-radar-${timestamp.slice(0, 10)}.jsonl`);
}

function sanitizeString(value: string): string {
  let result = value
    .replace(TOKEN, "[REDACTED_TOKEN]")
    .replace(EMAIL, "$1***@$2")
    .replace(PHONE, (phone) => {
      const digits = phone.replace(/\D/g, "");
      return digits.length >= 8 ? `***${digits.slice(-4)}` : phone;
    });
  if (result.length > 4_000) {
    result = `${result.slice(0, 4_000)}…[truncated:${result.length}]`;
  }
  return result;
}

export function sanitizeLogValue(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeLogValue(item, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([itemKey, item]) => [
          itemKey,
          sanitizeLogValue(item, itemKey, depth + 1),
        ]),
    );
  }
  return String(value);
}

function errorDetails(error: unknown): LogRecord["error"] | undefined {
  if (!error) return undefined;
  const normalized =
    error instanceof Error ? error : new Error(String(error));
  return {
    name: normalized.name,
    message: sanitizeString(normalized.message),
    stack: normalized.stack ? sanitizeString(normalized.stack) : undefined,
  };
}

function write(
  level: LogLevel,
  event: string,
  message?: string,
  data?: unknown,
  error?: unknown,
  extraContext?: LogContext,
): void {
  if (levelWeight[level] < minimumLevel) return;
  const timestamp = new Date().toISOString();
  const context = {
    ...(contextStorage.getStore() ?? {}),
    ...(extraContext ?? {}),
  };
  const safeContext = sanitizeLogValue(context) as LogContext;
  const record: LogRecord = {
    timestamp,
    level,
    event,
    service: "trade-radar-flow",
    environment:
      process.env.NODE_ENV ??
      (process.env.NODE_TEST_CONTEXT ? "test" : "development"),
    processId: process.pid,
    ...safeContext,
    ...(message ? { message: sanitizeString(message) } : {}),
    ...(data !== undefined ? { data: sanitizeLogValue(data) } : {}),
    ...(error ? { error: errorDetails(error) } : {}),
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    appendFileSync(dailyLogPath(timestamp), line, "utf8");
  } catch (writeError) {
    process.stderr.write(
      `[logger-write-failed] ${
        writeError instanceof Error ? writeError.message : String(writeError)
      }\n`,
    );
  }
  const consoleLine = `${timestamp} ${level.toUpperCase()} ${event}${
    message ? ` - ${sanitizeString(message)}` : ""
  }\n`;
  (level === "error" ? process.stderr : process.stdout).write(consoleLine);
}

export const logger = {
  debug(event: string, data?: unknown, context?: LogContext): void {
    write("debug", event, undefined, data, undefined, context);
  },
  info(
    event: string,
    message?: string,
    data?: unknown,
    context?: LogContext,
  ): void {
    write("info", event, message, data, undefined, context);
  },
  warn(
    event: string,
    message?: string,
    data?: unknown,
    context?: LogContext,
  ): void {
    write("warn", event, message, data, undefined, context);
  },
  error(
    event: string,
    error: unknown,
    data?: unknown,
    context?: LogContext,
  ): void {
    write(
      "error",
      event,
      error instanceof Error ? error.message : String(error),
      data,
      error,
      context,
    );
  },
  child(context: LogContext) {
    return {
      debug: (event: string, data?: unknown) =>
        logger.debug(event, data, context),
      info: (event: string, message?: string, data?: unknown) =>
        logger.info(event, message, data, context),
      warn: (event: string, message?: string, data?: unknown) =>
        logger.warn(event, message, data, context),
      error: (event: string, error: unknown, data?: unknown) =>
        logger.error(event, error, data, context),
    };
  },
};

export function runWithLogContext<T>(
  context: LogContext,
  callback: () => T,
): T {
  return contextStorage.run(
    { ...(contextStorage.getStore() ?? {}), ...context },
    callback,
  );
}

export function getLogDirectory(): string {
  return logDirectory;
}

export function getLogContext(): LogContext {
  return { ...(contextStorage.getStore() ?? {}) };
}
