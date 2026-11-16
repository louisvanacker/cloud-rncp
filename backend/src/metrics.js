'use strict';
const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ app: 'biblio-backend' });
client.collectDefaultMetrics({ register });

// SLI disponibilité = requêtes non 5xx / total ; SLI latence = histogramme ci-dessous.
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre de requêtes HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const counter = (name, help, labelNames = []) =>
  new client.Counter({ name, help, labelNames, registers: [register] });

const business = {
  loansCreated: counter('biblio_loans_created_total', 'Emprunts enregistrés'),
  returns: counter('biblio_returns_total', 'Retours enregistrés'),
  reservationsCreated: counter('biblio_reservations_created_total', 'Réservations créées'),
  coversBytes: counter('biblio_covers_uploaded_bytes_total', 'Octets de couvertures téléversés vers le stockage objet'),
  importsUploaded: counter('biblio_imports_uploaded_total', 'Fichiers CSV de catalogue téléversés'),
  loginFailures: counter('biblio_login_failures_total', 'Échecs de connexion (indicateur de brute force)'),
  jobsEnqueued: counter('biblio_jobs_enqueued_total', 'Tâches envoyées dans la file', ['name']),
};

const IGNORED = new Set(['/metrics', '/healthz', '/readyz']);

function metricsMiddleware(req, res, next) {
  if (IGNORED.has(req.path)) return next();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Route "template" (ex : /api/books/:id) pour éviter l'explosion de cardinalité
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
}

module.exports = { register, metricsMiddleware, business };
