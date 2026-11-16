'use strict';
// TÂCHE PLANIFIÉE QUOTIDIENNE (08:00, heure de Paris) — cœur asynchrone de la bibliothèque :
//  1. rappel J-2 pour les emprunts qui arrivent à échéance
//  2. passage en retard + relance (puis relance tous les 7 jours tant que le livre n'est pas rendu)
//  3. réservations non retirées à temps : expirées, exemplaire passé au suivant ou remis en rayon
// Chaque e-mail est une tâche séparée dans la file : un SMTP en panne n'empêche pas le reste,
// et BullMQ réessaie chaque envoi individuellement.
// Idempotente : la relancer le même jour n'envoie pas de doublon (colonnes *_sent_at / *_notified_at).
const { releaseCopy, withTx, addDays } = require('../library');

function dailyJob({ db, queue, config, logger }) {
  const { reminderDaysBefore, overdueRepeatDays, holdDays } = config.library;
  const mail = (template, data) => queue.add('email', { template, ...data });

  return async () => {
    const now = new Date();

    // 1. Rappels avant échéance
    const reminders = await db.query(
      `UPDATE loans SET reminder_sent_at = $1
       WHERE returned_at IS NULL AND reminder_sent_at IS NULL AND due_at > $1 AND due_at <= $2
       RETURNING id`,
      [now, addDays(reminderDaysBefore, now)],
    );
    for (const l of reminders.rows) await mail('loan.reminder', { loanId: l.id });

    // 2. Retards (première relance, puis tous les N jours)
    const overdue = await db.query(
      `UPDATE loans SET status = 'overdue', overdue_notified_at = $1
       WHERE returned_at IS NULL AND due_at < $1
         AND (overdue_notified_at IS NULL OR overdue_notified_at < $2)
       RETURNING id`,
      [now, addDays(-overdueRepeatDays, now)],
    );
    for (const l of overdue.rows) await mail('loan.overdue', { loanId: l.id });

    // 3. Réservations mises de côté mais pas retirées à temps
    const expired = await db.query(
      "SELECT id, book_id FROM reservations WHERE status = 'available' AND expires_at < $1",
      [now],
    );
    for (const r of expired.rows) {
      const nextId = await withTx(db, async (c) => {
        await c.query("UPDATE reservations SET status = 'expired' WHERE id = $1", [r.id]);
        return releaseCopy(c, r.book_id, holdDays);
      });
      await mail('reservation.expired', { reservationId: r.id });
      if (nextId) await mail('reservation.available', { reservationId: nextId });
    }

    const summary = { reminders: reminders.rows.length, overdue: overdue.rows.length, expired: expired.rows.length };
    logger.info(summary, 'tâche quotidienne terminée');
    return summary;
  };
}

module.exports = { dailyJob };
