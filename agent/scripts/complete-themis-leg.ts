/**
 * One-off: completes the authorized Themis leg of run bos76vquz (order
 * 893abeed-..., created by the real pipeline, stuck in 'creating' past the
 * 30s payable wait). Applies the same price guard before paying. Parses the
 * delivery with the REAL parseThemisDeliverable so the first real Themis
 * deliverable exercises the actual adapter.
 */
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { createCrooClient } from "../src/croo/client.js";
import { quotedCostUsdc } from "../src/croo/hireAgent.js";
import { pollUntil } from "../src/croo/pollFallback.js";
import { parseThemisDeliverable } from "../src/hire/escalation.js";

const ORDER_ID = "893abeed-80d7-41fd-a99b-08f4b57e70cc";

async function main() {
  const client = createCrooClient();

  logger.info("Waiting (up to 3 min) for the Themis order to become payable...");
  const order = await pollUntil({
    poll: async () => {
      const o = await client.getOrder(ORDER_ID);
      logger.info(`  status=${o.status}`);
      return o.status === "created" ? o : undefined;
    },
    timeoutMs: 180_000,
    pollIntervalMs: 10_000,
    timeoutMessage: `Themis order ${ORDER_ID} still not payable after 3 minutes — giving up, order will expire unpaid`,
  });

  const quoted = quotedCostUsdc(order);
  if (quoted > env.ESCALATION_MAX_COST_USDC) {
    logger.error(`price guard refused: quoted $${quoted.toFixed(2)} > cap $${env.ESCALATION_MAX_COST_USDC.toFixed(2)}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`price guard OK: quoted $${quoted.toFixed(2)} <= cap $${env.ESCALATION_MAX_COST_USDC.toFixed(2)} — paying.`);

  const paid = await client.payOrder(ORDER_ID);
  logger.info(`paid: tx ${paid.txHash}`);

  await pollUntil({
    poll: async () => {
      const o = await client.getOrder(ORDER_ID);
      logger.info(`  status=${o.status}`);
      return o.status === "completed" ? (true as const) : undefined;
    },
    timeoutMs: 300_000,
    pollIntervalMs: 10_000,
    timeoutMessage: `Themis order ${ORDER_ID} not completed within 5 minutes of payment`,
  });

  const delivery = await client.getDelivery(ORDER_ID);
  logger.info("─── THEMIS RAW DELIVERABLE (first real one ever) ───");
  logger.info(`deliverableType=${delivery.deliverableType}`);
  logger.info("TEXT:\n" + (delivery.deliverableText || delivery.deliverableSchema));
  logger.info("─── PARSER RESULT ───");
  try {
    const parsed = parseThemisDeliverable(delivery);
    logger.info(`score=${parsed.score} review="${parsed.review.slice(0, 300)}..."`);
  } catch (err) {
    logger.error("parseThemisDeliverable FAILED on the real shape (adapter needs bending):", err);
  }
}

main().catch((err) => {
  logger.error("complete-themis-leg failed:", err);
  process.exitCode = 1;
});
