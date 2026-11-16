'use strict';
// Règles métier partagées entre routes (emprunt, retour, réservation).
const { addDays } = require('./util');

// Un exemplaire revient en rayon (retour, réservation annulée ou expirée) :
//  - s'il y a une file d'attente, il est mis de côté pour le premier réservataire (prévenu par e-mail)
//  - sinon il redevient disponible pour tout le monde.
// Retourne l'id de la réservation servie, ou null.
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

module.exports = { releaseCopy };
