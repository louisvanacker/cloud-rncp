'use strict';
// Même règle que backend/src/library.js : un exemplaire qui revient est mis de côté pour le
// premier réservataire, sinon remis en rayon. (Dupliqué volontairement : l'API et le worker
// sont deux images indépendantes, sans paquet partagé à publier.)
const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 86_400_000);

async function releaseCopy(client, bookId, holdDays) {
  const { rows } = await client.query(
    `SELECT id FROM reservations WHERE book_id = $1 AND status = 'waiting'
     ORDER BY created_at, id LIMIT 1`,
    [bookId],
  );
  if (rows[0]) {
    await client.query(
      "UPDATE reservations SET status = 'available', notified_at = $1, expires_at = $2 WHERE id = $3",
      [new Date(), addDays(holdDays), rows[0].id],
    );
    return rows[0].id;
  }
  await client.query('UPDATE books SET available_copies = available_copies + 1, updated_at = now() WHERE id = $1', [
    bookId,
  ]);
  return null;
}

async function withTx(db, fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { releaseCopy, withTx, addDays };
