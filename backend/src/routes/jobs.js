'use strict';
// Traitements asynchrones déclenchés par l'utilisateur : l'API stocke, enregistre, publie
// dans la file et répond 202 immédiatement ; le worker fait le travail.
//  - import CSV du catalogue (bibliothécaire) : fichier -> stockage objet -> worker
//  - export PDF de l'historique d'emprunts (membre)
const express = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const { requireRole, isStaff } = require('../auth');
const { business } = require('../metrics');
const { ah, HttpError, idParam } = require('../util');

const CSV_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'];

function importRoutes({ db, queue, storage, config, logger }) {
  const router = express.Router();
  router.use(requireRole(logger, 'librarian', 'admin'));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.csvMaxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (CSV_TYPES.includes(file.mimetype) && /\.csv$/i.test(file.originalname)) cb(null, true);
      else cb(new HttpError(415, 'unsupported_file_type'));
    },
  });

  router.post(
    '/',
    upload.single('file'),
    ah(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'file_required');
      const key = `imports/${randomUUID()}.csv`;
      const filename = req.file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 255);
      await storage.put(config.storage.attachmentsBucket, key, req.file.buffer, 'text/csv');
      const { rows } = await db.query(
        'INSERT INTO imports (uploaded_by, filename, object_key) VALUES ($1, $2, $3) RETURNING *',
        [req.user.id, filename, key],
      );
      await queue.add('catalog-import', { importId: rows[0].id });
      business.importsUploaded.inc();
      business.jobsEnqueued.inc({ name: 'catalog-import' });
      res.status(202).json(rows[0]);
    }),
  );

  router.get(
    '/',
    ah(async (_req, res) => {
      const { rows } = await db.query(
        `SELECT i.*, u.name AS uploaded_by_name FROM imports i JOIN users u ON u.id = i.uploaded_by
         ORDER BY i.id DESC LIMIT 50`,
      );
      res.json(rows);
    }),
  );

  router.get(
    '/:id',
    ah(async (req, res) => {
      const { rows } = await db.query('SELECT * FROM imports WHERE id = $1', [idParam(req.params.id)]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      res.json(rows[0]);
    }),
  );

  return router;
}

function exportRoutes({ db, queue, storage, config }) {
  const router = express.Router();

  const load = async (req) => {
    const { rows } = await db.query('SELECT * FROM exports WHERE id = $1', [idParam(req.params.id)]);
    const e = rows[0];
    if (!e || (e.user_id !== req.user.id && !isStaff(req.user))) throw new HttpError(404, 'not_found');
    return e;
  };

  router.post(
    '/',
    ah(async (req, res) => {
      const { rows } = await db.query(
        'INSERT INTO exports (user_id) VALUES ($1) RETURNING id, status, created_at',
        [req.user.id],
      );
      await queue.add('pdf-export', { exportId: rows[0].id });
      business.jobsEnqueued.inc({ name: 'pdf-export' });
      res.status(202).json(rows[0]);
    }),
  );

  router.get(
    '/:id',
    ah(async (req, res) => {
      const e = await load(req);
      res.json({ id: e.id, status: e.status, error: e.error, finished_at: e.finished_at });
    }),
  );

  router.get(
    '/:id/download',
    ah(async (req, res) => {
      const e = await load(req);
      if (e.status !== 'done') throw new HttpError(409, 'export_not_ready');
      const stream = await storage.getStream(config.storage.attachmentsBucket, e.object_key);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="historique-emprunts-${e.id}.pdf"`);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }),
  );

  return router;
}

module.exports = { importRoutes, exportRoutes };
