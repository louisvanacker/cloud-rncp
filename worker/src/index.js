'use strict';
const { Worker, Queue } = require('bullmq');
const nodemailer = require('nodemailer');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db');
const { createStorage } = require('./storage');
const { emailJob } = require('./jobs/email');
const { pdfJob } = require('./jobs/pdf');
const { cleanupJob } = require('./jobs/cleanup');
const { dailyJob } = require('./jobs/daily');
const { importJob } = require('./jobs/import');
const { jobsTotal, jobDuration, queueJobs, loansGauge, dailyLastSuccess, startMetricsServer } = require('./metrics');

const QUEUE_NAME = 'biblio';

const config = loadConfig();
const logger = createLogger(config.logLevel, 'biblio-worker');
const db = createPool(config.db);
const storage = createStorage(config.storage);
const mailer = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

const u = new URL(config.redisUrl);
const connection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  password: config.redisPassword || undefined,
  maxRetriesPerRequest: null,
};

// File utilisée par le worker lui-même pour publier des e-mails (tâche quotidienne, import)
const queue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
});

const deps = { db, storage, mailer, queue, config, logger };
const daily = dailyJob(deps);
const handlers = {
  email: emailJob(deps),
  'pdf-export': pdfJob(deps),
  'catalog-import': importJob(deps),
  cleanup: cleanupJob(deps),
  'daily-loans': async (job) => {
    const out = await daily(job);
    dailyLastSuccess.setToCurrentTime(); // alerte si la tâche ne tourne plus (voir PrometheusRule)
    return out;
  },
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`Tâche inconnue : ${job.name}`);
    const end = jobDuration.startTimer({ name: job.name });
    try {
      const result = await handler(job);
      jobsTotal.inc({ name: job.name, status: 'completed' });
      return result;
    } catch (err) {
      jobsTotal.inc({ name: job.name, status: 'failed' });
      logger.error({ err, job: job.name, id: job.id, attempt: job.attemptsMade + 1 }, 'échec de la tâche');
      throw err;
    } finally {
      end();
    }
  },
  { connection, concurrency: config.concurrency },
);

let redisReady = false;
worker.on('ready', () => {
  redisReady = true;
  logger.info({ concurrency: config.concurrency }, 'worker prêt');
});
worker.on('error', (err) => logger.error({ err }, 'erreur worker'));

// Tâches planifiées (idempotentes, un seul déclenchement même avec N réplicas du worker)
const TZ = 'Europe/Paris';
Promise.all([
  queue.upsertJobScheduler('daily-loans', { pattern: config.dailyCron, tz: TZ }, { name: 'daily-loans' }),
  queue.upsertJobScheduler('cleanup-daily', { pattern: '0 3 * * *', tz: TZ }, { name: 'cleanup' }),
]).catch((err) => logger.error({ err }, 'impossible de planifier les tâches'));

// Profondeur de file exposée à Prometheus (alerte "backlog" + piste d'autoscaling sur la file)
const gaugeTimer = setInterval(async () => {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    for (const [state, n] of Object.entries(counts)) queueJobs.set({ state }, n);
    // Indicateurs métier pour le dashboard : emprunts en cours / en retard, réservations en attente
    const { rows } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at >= now()) AS on_time,
         (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at < now()) AS overdue,
         (SELECT COUNT(*) FROM reservations WHERE status = 'waiting') AS waiting`,
    );
    loansGauge.set({ state: 'on_time' }, Number(rows[0].on_time));
    loansGauge.set({ state: 'overdue' }, Number(rows[0].overdue));
    loansGauge.set({ state: 'reservations_waiting' }, Number(rows[0].waiting));
  } catch (err) {
    logger.warn({ err }, 'lecture de la file impossible');
  }
}, 30_000);

const metricsServer = startMetricsServer(config.metricsPort, () => redisReady && !worker.closing);

async function shutdown(signal) {
  logger.info({ signal }, 'arrêt du worker : fin des tâches en cours');
  clearInterval(gaugeTimer);
  await worker.close(); // attend la fin des tâches actives
  await Promise.allSettled([queue.close(), db.end()]);
  metricsServer.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
