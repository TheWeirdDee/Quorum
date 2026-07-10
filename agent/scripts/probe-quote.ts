/**
 * $0 QUOTE PROBE: negotiates one service, waits for the provider to accept
 * (order created), reads the ACTUAL quoted cost via the same
 * quotedCostUsdc() path the price guard uses — and reports it WITHOUT
 * paying. There is no payOrder call anywhere in this script; the unpaid
 * order simply expires at its payDeadline (~30 min), charging nothing.
 *
 * Built to watch VERIS's quote over time after it repriced Project Due
 * Diligence from $0.10 to $20 overnight (SDK_NOTES.md items 22–24).
 *
 * Requires CROO_SIMULATE=false (it probes the real marketplace) but NOT
 * --confirm-real-spend — because it cannot spend.
 *
 * Usage:
 *   npm run probe:quote                       probe VERIS (default)
 *   npm run probe:quote -- --service=repo-doctor
 *   npm run probe:quote -- --service=escalation
 *   npm run probe:quote -- --package=<name> --repo=<github-url>
 */
import type { EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { quotedCostUsdc } from "../src/croo/hireAgent.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { pollUntil, raceEventAndPoll } from "../src/croo/pollFallback.js";
import { buildThemisPrompt } from "../src/hire/escalation.js";

type ProbeService = "veris" | "repo-doctor" | "escalation";

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

interface ProbeTarget {
  serviceId: string;
  capUsdc: number;
  requirements: Record<string, unknown>;
  label: string;
}

function buildTarget(service: ProbeService, packageName: string, repoUrl: string): ProbeTarget {
  const website = `https://www.npmjs.com/package/${packageName}`;
  switch (service) {
    case "veris":
      return {
        serviceId: env.VERIS_SERVICE_ID,
        capUsdc: env.VERIS_MAX_COST_USDC,
        // Same shape hireVeris sends (SDK_NOTES.md item 18) so the quote reflects a realistic request.
        requirements: {
          text: JSON.stringify({ type: "project", name: packageName, website, github: repoUrl, docs: website }),
        },
        label: "VERIS Project Due Diligence",
      };
    case "repo-doctor": {
      const match = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repoUrl);
      return {
        serviceId: env.REPO_DOCTOR_SERVICE_ID,
        capUsdc: env.REPO_DOCTOR_MAX_COST_USDC,
        requirements: { owner: match?.[1] ?? "expressjs", repo: match?.[2] ?? "express" },
        label: "Repo Doctor Repo Health Check",
      };
    }
    case "escalation":
      return {
        serviceId: env.ESCALATION_AGENT_SERVICE_ID,
        capUsdc: env.ESCALATION_MAX_COST_USDC,
        requirements: {
          text: buildThemisPrompt({
            packageName,
            healthVerdict: "healthy",
            trustVerdict: "high_risk",
            trustConcern: "probe: checking quoted price only — this order will not be paid",
            sources: [],
          }),
        },
        label: "Themis Fact-Check",
      };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const service = (argValue(args, "service") ?? "veris") as ProbeService;
  if (!["veris", "repo-doctor", "escalation"].includes(service)) {
    logger.error(`--service must be veris|repo-doctor|escalation, got "${service}"`);
    process.exitCode = 1;
    return;
  }
  const packageName = argValue(args, "package") ?? "node-ipc";
  const repoUrl = argValue(args, "repo") ?? "https://github.com/RIAEvangelist/node-ipc";

  if (env.CROO_SIMULATE) {
    logger.error(
      "probe:quote reads REAL marketplace quotes and needs CROO_SIMULATE=false. " +
        "It cannot spend (no payOrder call exists in this script) — the created order expires unpaid.",
    );
    process.exitCode = 1;
    return;
  }
  if (!env.CROO_API_KEY) {
    logger.error("CROO_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const target = buildTarget(service, packageName, repoUrl);
  if (!target.serviceId) {
    logger.error(`Service id for "${service}" is not configured in .env`);
    process.exitCode = 1;
    return;
  }

  const client = createCrooClient();
  const authed = await confirmAuth(client);
  if (!authed) {
    logger.error("Auth check failed.");
    process.exitCode = 1;
    return;
  }
  const stream = await connectCrooEventStream(client);
  const correlator = new OrderEventCorrelator(stream);

  try {
    logger.info(`QUOTE PROBE (${target.label}) — negotiating; the resulting order will NOT be paid.`);
    const negotiation = await client.negotiateOrder({
      serviceId: target.serviceId,
      requirements: JSON.stringify(target.requirements),
    });
    logger.info(`negotiation created: ${negotiation.negotiationId}`);

    const timeoutMs = env.CROO_ORDER_CREATED_TIMEOUT_MS;
    const orderId = await raceEventAndPoll({
      event: correlator.waitForOrderCreated(negotiation.negotiationId, timeoutMs).then((e) => {
        if (!e.order_id) throw new Error("order_created event carried no order_id");
        return e.order_id;
      }),
      poll: async () => {
        const orders = await client.listOrders({ role: "buyer", pageSize: 20 });
        return orders.find((o) => o.negotiationId === negotiation.negotiationId)?.orderId;
      },
      timeoutMs,
      pollIntervalMs: env.CROO_POLL_INTERVAL_MS,
      timeoutMessage: `Timed out waiting for the provider to accept (negotiationId=${negotiation.negotiationId})`,
    });

    // Wait for full price fields (an order in 'creating' can have them empty).
    const order = await pollUntil({
      poll: async () => {
        const o = await client.getOrder(orderId);
        return o.status === "created" ? o : undefined;
      },
      timeoutMs,
      pollIntervalMs: env.CROO_POLL_INTERVAL_MS,
      timeoutMessage: `Order ${orderId} never reached 'created' status`,
    });

    const quoted = quotedCostUsdc(order);
    const verdict = quoted > target.capUsdc ? "OVER CAP — the price guard would refuse this" : "within cap — the price guard would allow this";
    logger.info(`─────────────────────────────────────────────`);
    logger.info(`QUOTE RESULT for ${target.label}:`);
    logger.info(`  quoted (effective, fee-first): $${quoted.toFixed(2)}`);
    logger.info(`  raw price=${order.price} feeAmount=${order.feeAmount ?? "(absent)"}`);
    logger.info(`  per-hire cap: $${target.capUsdc.toFixed(2)} -> ${verdict}`);
    logger.info(`  orderId=${orderId} — left UNPAID, expires ${order.payDeadline}`);
    logger.info(`─────────────────────────────────────────────`);
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  logger.error("probe-quote failed:", err);
  process.exitCode = 1;
});
