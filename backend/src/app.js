'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { ZodError } = require('zod');
const { MulterError } = require('multer');
const { register, metricsMiddleware } = require('./metrics');
const { requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const { bookRoutes, publicCoverRoute } = require('./routes/books');
const loanRoutes = require('./routes/loans');
const reservationRoutes = require('./routes/reservations');
const { importRoutes, exportRoutes } = require('./routes/jobs');

// Les dépendances (db, queue, storage) sont injectées : l'app est testable sans infrastructure.
function createApp(deps) {
  const { db, queue, config, logger } = deps;
  const state = deps.state || { shuttingDown: false };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // derrière l'Ingress
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => ['/healthz', '/readyz', '/metrics'].includes(req.url) },
    }),
  );
  app.use(metricsMiddleware);

  // Sondes Kubernetes : liveness = le process répond ; readiness = dépendances joignables.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (req, res) => {
    if (state.shuttingDown) return res.status(503).json({ status: 'shutting_down' });
    try {
      await db.query('SELECT 1');
      await queue.ping();
      return res.json({ status: 'ready' });
    } catch (err) {
      req.log.warn({ err }, 'readiness failed');
      return res.status(503).json({ status: 'not_ready' });
    }
  });
  // /metrics n'est PAS routé par l'Ingress : seul Prometheus (NetworkPolicy) y accède.
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  const api = express.Router();
  api.use('/auth', authRoutes(deps));
  api.use('/books', publicCoverRoute(deps)); // seule route publique : images de couverture
  api.use(requireAuth(config, logger));
  api.use('/users', userRoutes(deps));
  api.use('/books', bookRoutes(deps));
  api.use('/loans', loanRoutes(deps));
  api.use('/reservations', reservationRoutes(deps));
  api.use('/imports', importRoutes(deps));
  api.use('/exports', exportRoutes(deps));
  app.use('/api', api);

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'validation_error', details: err.issues });
    if (err instanceof MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.code.toLowerCase() });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.code || 'error' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    req.log.error({ err }, 'unhandled error');
    return res.status(500).json({ error: 'internal_error' }); // jamais de stack trace au client
  });

  return app;
}

module.exports = { createApp };
