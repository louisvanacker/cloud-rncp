'use strict';
const express = require('express');
const { z } = require('zod');
const { requireRole } = require('../auth');
const { securityLog } = require('../logger');
const { ah, HttpError, idParam } = require('../util');

const roleSchema = z.object({ role: z.enum(['member', 'librarian', 'admin']) });

module.exports = function userRoutes({ db, logger }) {
  const router = express.Router();

  router.get(
    '/me',
    ah(async (req, res) => {
      const { rows } = await db.query('SELECT id, email, name, role FROM users WHERE id = $1', [req.user.id]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      res.json(rows[0]);
    }),
  );

  router.get(
    '/',
    requireRole(logger, 'admin'),
    ah(async (_req, res) => {
      const { rows } = await db.query('SELECT id, email, name, role, created_at FROM users ORDER BY id');
      res.json(rows);
    }),
  );

  // Changement de rôle : admin uniquement, tracé dans le journal de sécurité
  router.patch(
    '/:id/role',
    requireRole(logger, 'admin'),
    ah(async (req, res) => {
      const id = idParam(req.params.id);
      const { role } = roleSchema.parse(req.body);
      const { rows } = await db.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role', [
        role,
        id,
      ]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      securityLog(logger, 'authz.role_changed', { by: req.user.id, target: id, role });
      res.json(rows[0]);
    }),
  );

  return router;
};
