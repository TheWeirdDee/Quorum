import type { Delivery } from "@croo-network/sdk";

/**
 * Wraps a raw payload into a synthetic Delivery for hireAgent's simulate
 * path. Every field is labeled SIMULATED so it can never be mistaken for a
 * real settlement if it leaks into a log or UI.
 *
 * `raw` may be a plain string (e.g. VERIS's real deliverable — a formatted
 * text report, not JSON, per SDK_NOTES.md item 19) — used verbatim, not
 * re-stringified. Anything else (e.g. Repo Doctor's JSON object) is
 * JSON.stringify'd, matching how a real deliverableText/deliverableSchema
 * field carries JSON.
 */
export function buildSimulatedDelivery(raw: unknown, overrides: Partial<Delivery> = {}): Delivery {
  const now = new Date().toISOString();
  return {
    deliveryId: "SIMULATED",
    orderId: "SIMULATED",
    providerAgentId: "SIMULATED",
    deliverableType: "text",
    deliverableSchema: "",
    deliverableText: typeof raw === "string" ? raw : JSON.stringify(raw),
    contentHash: "SIMULATED",
    status: "accepted",
    submittedAt: now,
    verifiedAt: now,
    createdTime: now,
    updatedTime: now,
    ...overrides,
  };
}
