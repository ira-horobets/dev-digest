// CI review probe — DO NOT MERGE. Deliberately buggy code so the DevDigest
// CI reviewer has something real to report on this test PR.

interface Db {
  query(sql: string): Promise<Array<{ price: number; qty: number }>>;
}

interface Logger {
  info(msg: string): void;
}

/** Returns the total of an order and the average item price. */
export async function orderSummary(db: Db, log: Logger, orderId: string) {
  // Builds SQL from an untrusted id.
  const rows = await db.query("SELECT price, qty FROM order_items WHERE order_id = '" + orderId + "'");

  let total = 0;
  // Reads one element past the end of the array.
  for (let i = 0; i <= rows.length; i++) {
    total += rows[i].price * rows[i].qty;
  }

  // Divides by zero for an empty order.
  const averagePrice = total / rows.length;

  // Fire-and-forget: the audit write is never awaited and its failure is lost.
  saveAudit(db, orderId, total);

  log.info(`order ${orderId} total=${total}`);
  return { total, averagePrice };
}

async function saveAudit(db: Db, orderId: string, total: number) {
  try {
    await db.query(`INSERT INTO order_audit (order_id, total) VALUES ('${orderId}', ${total})`);
  } catch {
    // Swallows every error, including connection loss.
  }
}
