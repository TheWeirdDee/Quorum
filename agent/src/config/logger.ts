import { env, SECRET_ENV_KEYS } from "./env.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const REDACTED = "[REDACTED]";

function secretValues(source: NodeJS.ProcessEnv = process.env): string[] {
  return SECRET_ENV_KEYS.map((key) => source[key]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** Replaces every occurrence of a known secret value inside a string. */
export function redact(input: string, secrets: string[] = secretValues()): string {
  let out = input;
  for (const secret of secrets) {
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

function redactArg(arg: unknown, secrets: string[]): unknown {
  if (typeof arg === "string") return redact(arg, secrets);
  if (arg instanceof Error) {
    return redact(`${arg.name}: ${arg.message}\n${arg.stack ?? ""}`, secrets);
  }
  if (Array.isArray(arg)) return arg.map((item) => redactArg(item, secrets));
  if (arg && typeof arg === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(arg as Record<string, unknown>)) {
      out[key] = redactArg(value, secrets);
    }
    return out;
  }
  return arg;
}

function shouldLog(level: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(env.LOG_LEVEL);
}

function write(level: Level, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const secrets = secretValues();
  const redacted = args.map((arg) => redactArg(arg, secrets));
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  const method = level === "debug" ? "log" : level;
  // eslint-disable-next-line no-console
  (console[method] as (...a: unknown[]) => void)(line, ...redacted);
}

export const logger = {
  debug: (...args: unknown[]) => write("debug", args),
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warn", args),
  error: (...args: unknown[]) => write("error", args),
};
