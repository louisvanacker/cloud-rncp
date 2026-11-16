'use strict';
const express = require('express');
const { z } = require('zod');
const { isStaff } = require('../auth');
const { business } = require('../metrics');
const { releaseCopy } = require('../library');
const { ah, HttpError, idParam, withTx } = require('../util');

const createSchema = z.object({ book_id: z.number().int().positive() });
const listSchema = z.object({
  status: z.enum(['waiting', 'available', 'fulfilled', 'cancelled', 'expired', 'open']).optional(), // open = waiting + available
});

module.exports = function reservationRoutes({ db, queue, config }) {
  const router = express.Router();

  router.get(
    '/',
    ah(async (req, res) => {
      const q = listSchema.parse(req.query);
      const params = [];
      const where = [];
      if (!isStaff(req.user)) {
        params.push(req.user.id);
        where.push(`r.user_id = $${params.length}`);
      }
      if (q.status === 'open') where.push("r.status IN ('waiting', 'available')");
      else if (q.status) {
        params.push(q.status);
        where.push(`r.status = $${params.length}`);
      }
      const { rows } = await db.query(
        `SELECT r.id, r.book_id, r.user_id, r.status, r.created_at, r.expires_at,
                b.title, b.author, u.name AS user_name
         FROM reservations r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY r.created_at DESC, r.id DESC LIMIT 200`,
        params,
      );
      // Position dans la file d'attente de chaque ouvrage concerné
      const bookIds = [...new Set(rows.filter((r) => r.status === 'waiting').map((r) => r.book_id))];
      const rank = new Map();
      if (bookIds.length) {
        const ph = bookIds.map((_, i) => `$${i + 1}`).join(', ');
        const waiting = await db.query(
          `SELECT id, book_id FROM reservations WHERE status = 'waiting' AND book_id IN (${ph})
           ORDER BY created_at, id`,
          bookIds,
        );
        const seen = new Map();
        for (const w of waiting.rows) {
          const n = (seen.get(w.book_id) || 0) + 1;
          seen.set(w.book_id, n);
          rank.set(w.id, n);
        }
      }
      res.json(rows.map((r) => ({ ...r, position: rank.get(r.id) ?? null })));
    }),
  );

  // Réserver n'a de sens que si aucun exemplaire n'est disponible (sinon : emprunter directement)
  router.post(
    '/',
    ah(async (req, res) => {
      const { book_id: bookId } = createSchema.parse(req.body);
      const { rows: books } = await db.query('SELECT available_copies FROM books WHERE id = $1', [bookId]);
      if (!books[0]) throw new HttpError(404, 'not_found');
      if (books[0].available_copies > 0) throw new HttpError(409, 'book_available');
      const dup = await db.query(
        `SELECT 1 FROM reservations WHERE book_id = $1 AND user_id = $2 AND status IN ('waiting', 'available')
         UNION ALL
         SELECT 1 FROM loans WHERE book_id = $1 AND user_id = $2 AND returned_at IS NULL`,
        [bookId, req.user.id],
      );
      if (dup.rows.length) throw new HttpError(409, 'already_reserved_or_borrowed');
      const { rows } = await db.query(
        'INSERT INTO reservations (book_id, user_id) VALUES ($1, $2) RETURNING *',
        [bookId, req.user.id],
      );
      const pos = await db.query(
        "SELECT COUNT(*) AS n FROM reservations WHERE book_id = $1 AND status = 'waiting'",
        [bookId],
      );
      business.reservationsCreated.inc();
      res.status(201).json({ ...rows[0], position: Number(pos.rows[0].n) });
    }),
  );

  // Annulation par le membre (ou le personnel). Si un exemplaire était mis de côté, il passe au suivant.
  router.delete(
    '/:id',
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const nextId = await withTx(db, async (c) => {
        const { rows } = await c.query('SELECT * FROM reservations WHERE id = $1', [id]);
        const r = rows[0];
        if (!r || (!isStaff(req.user) && r.user_id !== req.user.id)) throw new HttpError(404, 'not_found');
        if (!['waiting', 'available'].includes(r.status)) throw new HttpError(409, 'not_open');
        await c.query("UPDATE reservations SET status = 'cancelled' WHERE id = $1", [id]);
        return r.status === 'available' ? releaseCopy(c, r.book_id, config.library.holdDays) : null;
      });
      if (nextId) {
        await queue.add('email', { template: 'reservation.available', reservationId: nextId });
        business.jobsEnqueued.inc({ name: 'email' });
      }
      res.status(204).end();
    }),
  );

  return router;
};
