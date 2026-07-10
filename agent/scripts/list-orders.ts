/**
 * Read-only diagnostic: lists this agent's recent orders via the real SDK,
 * so a serviceId can be read straight off a real Order record instead of
 * hand-copying from the dashboard UI (see SDK_NOTES.md item 13 — there is
 * no address->serviceId lookup, but a requester's own order history has
 * serviceId on every Order it returns).
 *
 * Usage: npm run list-orders
 */
import { logger } from "../src/config/logger.js";
import { createCrooClient } from "../src/croo/client.js";

async function main(): Promise<void> {
  const client = createCrooClient();
  for (const role of ["buyer", "provider"] as const) {
    const orders = await client.listOrders({ role, pageSize: 20 });
    logger.info(`orders role=${role} -> ${orders.length}`);
    for (const o of orders) {
      logger.info(
        `  orderId=${o.orderId} serviceId=${o.serviceId} providerAgentId=${o.providerAgentId} requesterAgentId=${o.requesterAgentId} status=${o.status} price=${o.price} createdAt=${o.createdAt}`,
      );
    }
  }

  // listNegotiations uses a DIFFERENT role vocabulary than listOrders:
  // 'requester'/'provider' here, vs. 'buyer'/'provider' above. Confirmed by
  // the API rejecting "buyer" here with the reverse error message.
  for (const role of ["requester", "provider"] as const) {
    const negs = await client.listNegotiations({ role, pageSize: 20 });
    logger.info(`negotiations role=${role} -> ${negs.length}`);
    for (const n of negs) {
      logger.info(
        `  negotiationId=${n.negotiationId} serviceId=${n.serviceId} providerAgentId=${n.providerAgentId} requesterAgentId=${n.requesterAgentId} status=${n.status}`,
      );
    }
  }
}

main().catch((err) => {
  logger.error("list-orders failed:", err);
  process.exitCode = 1;
});
