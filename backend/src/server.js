'use strict';
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db');
const { createQueue } = require('./queue');
const { createStorage } = require('./storage');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createPool(config.db);
const queue = createQueue(config.redisUrl, config.redisPassword);
const storage = createStorage(config.storage);
const state = { shuttingDown: false };

const app = createApp({ db, queue, storage, config, logger, state });
let server;

// Au démarrage : s'assure que les buckets existent (MinIO en local / kind), avec nouvelles tentatives
// le temps que le stockage objet soit prêt. Après ~60 s sans succès, on quitte : Docker / Kubernetes redémarre.
async function start() {
  const buckets = [config.storage.attachmentsBucket, config.storage.backupsBucket];
  for (let attempt = 1; ; attempt += 1) {
    try {
      await storage.ensureBuckets(buckets);
      break;
    } catch (err) {
      if (attempt >= 30) {
        logger.error({ err }, 'stockage objet injoignable');
        process.exit(1);
      }
      logger.warn({ attempt, err: err.message }, 'stockage objet pas encore prêt, nouvel essai dans 2 s');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  server = app.listen(config.port, () => logger.info({ port: config.port }, 'biblio-backend démarré'));
}
start();

// Arrêt gracieux : Kubernetes envoie SIGTERM lors d'un rolling update / scale down.
// 1) readiness passe à 503 -> le pod sort des endpoints du Service
// 2) on finit les requêtes en cours, puis on ferme les connexions.
function shutdown(signal) {
  logger.info({ signal }, 'arrêt en cours');
  state.shuttingDown = true;
  setTimeout(() => {
    if (!server) process.exit(0);
    server.close(async () => {
      await Promise.allSettled([db.end(), queue.close()]);
      logger.info('arrêt terminé');
      process.exit(0);
    });
  }, Number(process.env.SHUTDOWN_DELAY_MS || 5000));
  setTimeout(() => process.exit(1), 25_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
