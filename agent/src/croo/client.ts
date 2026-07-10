import { AgentClient, isUnauthorized, type Config, type EventStream, type Logger } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Adapts our redacting logger to the SDK's Logger interface. Load-bearing:
 * the SDK itself logs the SDK-Key (embedded in the WebSocket URL as
 * `?key=...`) at info level on every connect (SDK_NOTES.md item 9) — never
 * pass `console` here, only this adapter, so every SDK-originated log line
 * is scrubbed the same way ours are.
 */
const crooLogger: Logger = {
  info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
  debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
};

export interface CrooClientOverrides {
  apiUrl?: string;
  wsUrl?: string;
  rpcUrl?: string;
  apiKey?: string;
}

/** Constructs the AgentClient from env (or explicit overrides, for tests). Makes no network call. */
export function createCrooClient(overrides: CrooClientOverrides = {}): AgentClient {
  const apiKey = overrides.apiKey ?? env.CROO_API_KEY;
  if (!apiKey) {
    throw new Error("CROO_API_KEY is not set; cannot construct a CROO client");
  }

  const config: Config = {
    baseURL: overrides.apiUrl ?? env.CROO_API_URL,
    wsURL: overrides.wsUrl ?? env.CROO_WS_URL,
    logger: crooLogger,
  };
  const rpcURL = overrides.rpcUrl ?? env.CROO_RPC_URL;
  if (rpcURL) config.rpcURL = rpcURL;

  return new AgentClient(config, apiKey);
}

/** Opens the shared WebSocket connection used for both served (M5) and bought (M3) order events. */
export async function connectCrooEventStream(client: AgentClient): Promise<EventStream> {
  return client.connectWebSocket();
}

/**
 * Confirms the SDK-Key authenticates, via a cheap read-only call
 * (listOrders with pageSize 1) rather than assuming success. Returns false
 * on 401, rethrows any other failure (network error, 5xx, etc).
 *
 * `role` is required by the real API (SDK_NOTES.md item 14 — confirmed via a
 * live 400 INVALID_PARAMETERS when omitted); `listOrders` specifically wants
 * 'buyer' | 'provider' (listNegotiations uses a different vocabulary,
 * 'requester' | 'provider', for the same concept — don't copy this value
 * elsewhere without checking which endpoint it's for).
 */
export async function confirmAuth(client: AgentClient): Promise<boolean> {
  try {
    await client.listOrders({ role: "buyer", pageSize: 1 });
    return true;
  } catch (err) {
    if (isUnauthorized(err)) return false;
    throw err;
  }
}
