'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { signToken } = require('../auth');
const { securityLog } = require('../logger');
const { business } = require('../metrics');
const { ah, HttpError } = require('../util');

const registerSchema = z.object({
  email: z.string().email().max(255).transform((s) => s.toLowerCase()),
  name: z.string().min(1).max(100),
  password: z.string().min(10).max(128),
});
const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

// Hash factice : on compare toujours un mot de passe, même si l'utilisateur n'existe pas,
// pour ne pas révéler l'existence d'un compte via le temps de réponse.
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

module.exports = function authRoutes({ db, config, logger }) {
  const router = express.Router();
  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

  // Limite par IP contre le brute force (ISO 27001 A.8.5). Compteur en mémoire par pod :
  // suffisant ici ; en production multi-réplicas on brancherait un store Redis.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      securityLog(logger, 'auth.rate_limited', { ip: req.ip });
      res.status(429).json({ error: 'too_many_requests' });
    },
  });

  router.post(
    '/register',
    ah(async (req, res) => {
      const body = registerSchema.parse(req.body);
      const hash = await bcrypt.hash(body.password, config.bcryptRounds);
      try {
        const { rows } = await db.query(
          'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
          [body.email, body.name, hash, 'member'],
        );
        securityLog(logger, 'auth.register', { userId: rows[0].id });
        res.status(201).json({ token: signToken(rows[0], config), user: publicUser(rows[0]) });
      } catch (err) {
        if (err.code === '23505' || /unique|duplicate/i.test(err.message)) throw new HttpError(409, 'email_taken');
        throw err;
      }
    }),
  );

  router.post(
    '/login',
    loginLimiter,
    ah(async (req, res) => {
      const body = loginSchema.parse(req.body);
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [body.email]);
      const user = rows[0];
      const ok = await bcrypt.compare(body.password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) {
        business.loginFailures.inc();
        securityLog(logger, 'auth.login_failed', { ip: req.ip });
        throw new HttpError(401, 'invalid_credentials');
      }
      securityLog(logger, 'auth.login_success', { userId: user.id, ip: req.ip });
      res.json({ token: signToken(user, config), user: publicUser(user) });
    }),
  );

  return router;
};

module.exports.publicUser = publicUser;
