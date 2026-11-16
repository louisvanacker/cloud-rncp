'use strict';
const express = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { requireRole, isStaff } = require('../auth');
const { business } = require('../metrics');
const { ah, HttpError, idParam } = require('../util');

const year = z.number().int().min(0).max(2100);
const bookSchema = z.object({
  isbn: z
    .string()
    .regex(/^[0-9Xx-]{10,17}$/, 'isbn')
    .transform((s) => s.replace(/-/g, '').toUpperCase())
    .optional()
    .nullable(),
  title: z.string().min(1).max(255),
  author: z.string().min(1).max(255),
  category: z.string().min(1).max(60).default('Général'),
  published_year: year.optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  total_copies: z.number().int().min(0).max(500).default(1),
});
const updateSchema = bookSchema.partial().refine((o) => Object.keys(o).length > 0, 'empty_update');
const listSchema = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(60).optional(),
  available: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  offset: z.coerce.number().int().min(0).default(0),
});

const COLUMNS = `id, isbn, title, author, category, published_year, description, total_copies,
  available_copies, (cover_key IS NOT NULL) AS has_cover, created_at, updated_at`;

const isUnique = (err) => err.code === '23505' || /unique|duplicate/i.test(err.message);

// Lecture publique de la couverture : une balise <img> ne peut pas envoyer de jeton.
// Les couvertures ne sont pas des données sensibles (choix documenté dans SECURITY-ISO27001.md).
function publicCoverRoute({ db, storage, config }) {
  const router = express.Router();
  router.get(
    '/:id/cover',
    ah(async (req, res) => {
      const { rows } = await db.query('SELECT cover_key, cover_content_type FROM books WHERE id = $1', [
        idParam(req.params.id),
      ]);
      if (!rows[0] || !rows[0].cover_key) throw new HttpError(404, 'not_found');
      const stream = await storage.getStream(config.storage.attachmentsBucket, rows[0].cover_key);
      res.setHeader('Content-Type', rows[0].cover_content_type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }),
  );
  return router;
}

function bookRoutes({ db, storage, config, logger }) {
  const router = express.Router();
  const staffOnly = requireRole(logger, 'librarian', 'admin');

  const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.coverMaxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (config.upload.coverTypes.includes(file.mimetype)) cb(null, true);
      else cb(new HttpError(415, 'unsupported_file_type'));
    },
  });

  // Catalogue : recherche titre / auteur / ISBN, filtre catégorie et disponibilité
  router.get(
    '/',
    ah(async (req, res) => {
      const q = listSchema.parse(req.query);
      const params = [];
      const where = [];
      if (q.q) {
        params.push(`%${q.q.toLowerCase()}%`);
        const p = `$${params.length}`;
        where.push(`(LOWER(title) LIKE ${p} OR LOWER(author) LIKE ${p} OR LOWER(COALESCE(isbn, '')) LIKE ${p})`);
      }
      if (q.category) {
        params.push(q.category);
        where.push(`category = $${params.length}`);
      }
      if (q.available === 'true') where.push('available_copies > 0');
      params.push(q.limit, q.offset);
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM books ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY title, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json(rows);
    }),
  );

  router.get(
    '/categories',
    ah(async (_req, res) => {
      const { rows } = await db.query('SELECT DISTINCT category FROM books ORDER BY category');
      res.json(rows.map((r) => r.category));
    }),
  );

  // Fiche ouvrage + situation de l'utilisateur connecté (emprunt en cours, réservation, file d'attente)
  router.get(
    '/:id',
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM books WHERE id = $1`, [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      const [loan, resa, queue] = await Promise.all([
        db.query(
          'SELECT id, due_at, status FROM loans WHERE book_id = $1 AND user_id = $2 AND returned_at IS NULL',
          [id, req.user.id],
        ),
        db.query(
          `SELECT id, status, expires_at, created_at FROM reservations
           WHERE book_id = $1 AND user_id = $2 AND status IN ('waiting', 'available')`,
          [id, req.user.id],
        ),
        db.query("SELECT COUNT(*) AS n FROM reservations WHERE book_id = $1 AND status = 'waiting'", [id]),
      ]);
      const out = {
        ...rows[0],
        my_loan: loan.rows[0] || null,
        my_reservation: resa.rows[0] || null,
        waiting_count: Number(queue.rows[0].n),
      };
      if (isStaff(req.user)) {
        const active = await db.query(
          `SELECT l.id, l.due_at, l.status, u.name AS user_name FROM loans l JOIN users u ON u.id = l.user_id
           WHERE l.book_id = $1 AND l.returned_at IS NULL ORDER BY l.due_at`,
          [id],
        );
        out.active_loans = active.rows;
      }
      res.json(out);
    }),
  );

  router.post(
    '/',
    staffOnly,
    ah(async (req, res) => {
      const b = bookSchema.parse(req.body);
      try {
        const { rows } = await db.query(
          `INSERT INTO books (isbn, title, author, category, published_year, description, total_copies, available_copies)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING ${COLUMNS}`,
          [b.isbn || null, b.title, b.author, b.category, b.published_year ?? null, b.description ?? null, b.total_copies],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'isbn_taken');
        throw err;
      }
    }),
  );

  // Modification ; changer le nombre d'exemplaires ajuste les exemplaires disponibles du même écart.
  router.patch(
    '/:id',
    staffOnly,
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const patch = updateSchema.parse(req.body);
      const { rows } = await db.query('SELECT total_copies, available_copies FROM books WHERE id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      const fields = { ...patch };
      if (patch.total_copies !== undefined) {
        const available = rows[0].available_copies + (patch.total_copies - rows[0].total_copies);
        if (available < 0) throw new HttpError(409, 'copies_in_use'); // des exemplaires sont empruntés
        fields.available_copies = available;
      }
      const keys = Object.keys(fields);
      const values = keys.map((k) => fields[k]);
      values.push(id);
      try {
        const upd = await db.query(
          `UPDATE books SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now()
           WHERE id = $${values.length} RETURNING ${COLUMNS}`,
          values,
        );
        res.json(upd.rows[0]);
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'isbn_taken');
        throw err;
      }
    }),
  );

  router.delete(
    '/:id',
    staffOnly,
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const used = await db.query('SELECT COUNT(*) AS n FROM loans WHERE book_id = $1', [id]);
      if (Number(used.rows[0].n) > 0) throw new HttpError(409, 'book_has_loans'); // on garde l'historique
      const { rows } = await db.query('DELETE FROM books WHERE id = $1 RETURNING cover_key', [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      await db.query('DELETE FROM reservations WHERE book_id = $1', [id]);
      if (rows[0].cover_key) await storage.remove(config.storage.attachmentsBucket, rows[0].cover_key);
      res.status(204).end();
    }),
  );

  // Téléversement de la couverture -> stockage objet. Le fichier ne touche jamais le disque du pod.
  router.post(
    '/:id/cover',
    staffOnly,
    coverUpload.single('file'),
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      if (!req.file) throw new HttpError(400, 'file_required');
      const { rows } = await db.query('SELECT cover_key FROM books WHERE id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      const key = `covers/${id}/${randomUUID()}`;
      await storage.put(config.storage.attachmentsBucket, key, req.file.buffer, req.file.mimetype);
      await db.query('UPDATE books SET cover_key = $1, cover_content_type = $2, updated_at = now() WHERE id = $3', [
        key,
        req.file.mimetype,
        id,
      ]);
      if (rows[0].cover_key) await storage.remove(config.storage.attachmentsBucket, rows[0].cover_key);
      business.coversBytes.inc(req.file.size);
      res.status(201).json({ id, has_cover: true });
    }),
  );

  return router;
}

module.exports = { bookRoutes, publicCoverRoute };
