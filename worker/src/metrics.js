'use strict';
const http = require('node:http');
const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ app: 'biblio-worker' });
client.collectDefaultMetrics({ register });

const jobsTotal = new client.Counter({
  name: 'biblio_jobs_processed_total',
  help: 'Tâches traitées par le worker',
  labelNames: ['name', 'status'],
  registers: [register],
});
const jobDuration = new client.Histogram({
  name: 'biblio_job_duration_seconds',
  help: 'Durée de traitement des tâches',
  labelNames: ['name'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});
const queueJobs = new client.Gauge({
  name: 'biblio_queue_jobs',
  help: 'Tâches dans la file par état (waiting, active, failed, delayed)',
  labelNames: ['state'],
  registers: [register],
});

const loansGauge = new client.Gauge({
  name: 'biblio_loans_current',
  help: 'Emprunts en cours (on_time / overdue) et réservations en attente',
  labelNames: ['state'],
  registers: [register],
});
const dailyLastSuccess = new client.Gauge({
  name: 'biblio_daily_job_last_success_timestamp_seconds',
  help: 'Horodatage du dernier succès de la tâche quotidienne (rappels, retards, réservations)',
  registers: [register],
});

// Serveur HTTP minimal : /metrics pour Prometheus, /healthz pour la liveness probe.
function startMetricsServer(port, isHealthy) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      return res.end(await register.metrics());
    }
    if (req.url === '/healthz') {
      const ok = isHealthy();
      res.statusCode = ok ? 200 : 503;
      return res.end(ok ? 'ok' : 'unhealthy');
    }
    res.statusCode = 404;
    return res.end();
  });
  server.listen(port);
  return server;
}

module.exports = { register, jobsTotal, jobDuration, queueJobs, loansGauge, dailyLastSuccess, startMetricsServer };
