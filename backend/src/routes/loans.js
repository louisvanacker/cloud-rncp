'use strict';
const express = require('express');
const { z } = require('zod');
const { requireRole, isStaff } = require('../auth');
const { business } = require('../metrics');
const { releaseCopy } = require('../library');
const { ah, HttpError, idParam, withTx, addDays } = require('../util');

const borrowSchema = z.object({
  book_id: z.number().int().positive(),
  user_id: z.number().int().positive().optional(), // un bibliothécaire peut enregistrer un prêt au guichet
});
const listSchema = z.object({
  status: z.enum(['active', 'overdue', 'returned', 'current']).optional(), // current = active + overdue
  user_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = function loanRoutes({ db, queue, config, logger }) {
  const router = express.Router();
  const { loanDays, maxActiveLoans, holdDays } = config.library;

  const enqueue = async (name, data) => {
    await queue.add(name, data);
    business.jobsEnqueued.inc({ name });
  };

  // Un membre voit ses emprunts ; le personnel voit tout (filtre par statut / membre).
  router.get(
    '/',
    ah(async (req, res) => {
      const q = listSchema.parse(req.query);
      const params = [];
      const where = [];
      const userId = isStaff(req.user) ? q.user_id : req.user.id;
      if (userId) {
        params.push(userId);
        where.push(`l.user_id = $${params.length}`);
      }
      if (q.status === 'current') where.push('l.returned_at IS NULL');
      else if (q.status) {
        params.push(q.status);
        where.push(`l.status = $${params.length}`);
      }
      params.push(q.limit, q.offset);
      const { rows } = await db.query(
        `SELECT l.id, l.book_id, l.user_id, l.borrowed_at, l.due_at, l.returned_at, l.status,
                b.title, b.author, u.name AS user_name, u.email AS user_email
         FROM loans l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY (l.returned_at IS NULL) DESC, l.due_at, l.id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json(rows);
    }),
  );

  // Emprunt : règles métier vérifiées dans une transaction
  router.post(
    '/',
    ah(async (req, res) => {
      const body = borrowSchema.parse(req.body);
      if (body.user_id && !isStaff(req.user)) throw new HttpError(403, 'forbidden');
      const userId = body.user_id || req.user.id;

      const loan = await withTx(db, async (c) => {
        const book = await c.query('SELECT id FROM books WHERE id = $1', [body.book_id]);
        if (!book.rows[0]) throw new HttpError(404, 'not_found');

        const current = await c.query(
          `SELECT book_id, due_at FROM loans WHERE user_id = $1 AND returned_at IS NULL`,
          [userId],
        );
        if (current.rows.some((l) => l.book_id === body.book_id)) throw new HttpError(409, 'already_borrowed');
        if (current.rows.some((l) => new Date(l.due_at) < new Date())) throw new HttpError(409, 'has_overdue');
        if (current.rows.length >= maxActiveLoans) throw new HttpError(409, 'loan_limit');

        // Exemplaire mis de côté pour ce membre suite à sa réservation ?
        const held = await c.query(
          "SELECT id FROM reservations WHERE book_id = $1 AND user_id = $2 AND status = 'available'",
          [body.book_id, userId],
        );
        if (held.rows[0]) {
          await c.query("UPDATE reservations SET status = 'fulfilled' WHERE id = $1", [held.rows[0].id]);
        } else {
          // Décrément atomique : impossible d'emprunter le même dernier exemplaire deux fois
          const dec = await c.query(
            `UPDATE books SET available_copies = available_copies - 1, updated_at = now()
             WHERE id = $1 AND available_copies > 0 RETURNING id`,
            [body.book_id],
          );
          if (!dec.rows[0]) throw new HttpError(409, 'not_available');
        }
        const { rows } = await c.query(
          'INSERT INTO loans (book_id, user_id, due_at) VALUES ($1, $2, $3) RETURNING *',
          [body.book_id, userId, addDays(loanDays)],
        );
        return rows[0];
      });

      business.loansCreated.inc();
      await enqueue('email', { template: 'loan.confirmed', loanId: loan.id });
      res.status(201).json(loan);
    }),
  );

  // Retour : enregistré par le personnel (au guichet)
  router.post(
    '/:id/return',
    requireRole(logger, 'librarian', 'admin'),
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const result = await withTx(db, async (c) => {
        const { rows } = await c.query(
          `UPDATE loans SET returned_at = now(), status = 'returned'
           WHERE id = $1 AND returned_at IS NULL RETURNING *`,
          [id],
        );
        if (!rows[0]) throw new HttpError(409, 'not_active_loan');
        const reservationId = await releaseCopy(c, rows[0].book_id, holdDays);
        return { loan: rows[0], reservationId };
      });
      business.returns.inc();
      if (result.reservationId) {
        await enqueue('email', { template: 'reservation.available', reservationId: result.reservationId });
      }
      res.json(result.loan);
    }),
  );

  return router;
};
