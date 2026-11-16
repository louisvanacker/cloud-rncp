'use strict';
const jwt = require('jsonwebtoken');
const { securityLog } = require('./logger');

const JWT_OPTS = { issuer: 'biblio-api', audience: 'biblio' };

// API stateless : l'identité voyage dans un JWT signé, aucune session côté serveur.
// N'importe quel réplica peut donc traiter n'importe quelle requête (prérequis à l'HPA).
function signToken(user, config) {
  return jwt.sign({ sub: String(user.id), role: user.role, email: user.email }, config.jwtSecret, {
    ...JWT_OPTS,
    algorithm: 'HS256',
    expiresIn: config.jwtTtl,
  });
}

function requireAuth(config, logger) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'unauthorized' });
    try {
      const p = jwt.verify(token, config.jwtSecret, { ...JWT_OPTS, algorithms: ['HS256'] });
      req.user = { id: Number(p.sub), role: p.role, email: p.email };
      return next();
    } catch {
      securityLog(logger, 'auth.invalid_token', { ip: req.ip, path: req.originalUrl });
      return res.status(401).json({ error: 'unauthorized' });
    }
  };
}

// Contrôle d'accès applicatif par rôle (ISO 27001 A.5.15 / A.8.3)
function requireRole(logger, ...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    securityLog(logger, 'authz.denied', { userId: req.user.id, role: req.user.role, path: req.originalUrl });
    return res.status(403).json({ error: 'forbidden' });
  };
}

const isStaff = (user) => user.role === 'librarian' || user.role === 'admin';

module.exports = { signToken, requireAuth, requireRole, isStaff };
