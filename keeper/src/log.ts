/** JSON-lines logger. Bigints are written as decimal strings. */
export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export function serialize(level: LogLevel, msg: string, ctx: Record<string, unknown> = {}): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx }, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/** Error details for logs: message plus cause chain, never swallowed. */
export function errorContext(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? err.cause.message : undefined;
    return { error: err.message, errorName: err.name, ...(cause === undefined ? {} : { cause }) };
  }
  return { error: String(err) };
}

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line + "\n")): Logger {
  return {
    info: (msg, ctx) => {
      write(serialize("info", msg, ctx));
    },
    warn: (msg, ctx) => {
      write(serialize("warn", msg, ctx));
    },
    error: (msg, ctx) => {
      write(serialize("error", msg, ctx));
    },
  };
}
