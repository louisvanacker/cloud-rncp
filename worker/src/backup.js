'use strict';
// Sauvegarde de la base vers le stockage objet (ISO 27001 A.8.13).
// Lancé par un CronJob Kubernetes : pg_dump | gzip -> bucket "backups".
// La rétention est gérée côté stockage (règle de cycle de vie Azure / politique MinIO).
const { spawn } = require('node:child_process');
const zlib = require('node:zlib');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createStorage } = require('./storage');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, 'biblio-backup');
  const storage = createStorage(config.storage);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `postgres/biblio-${stamp}.sql.gz`;

  const dump = spawn(
    'pg_dump',
    ['-h', config.db.host, '-p', String(config.db.port), '-U', config.db.user, '-d', config.db.database, '--no-owner'],
    {
      env: {
        ...process.env,
        PGPASSWORD: config.db.password,
        PGSSLMODE: config.db.ssl === 'require' ? 'verify-full' : 'disable',
        PGSSLROOTCERT: config.db.sslCaFile || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  dump.stderr.on('data', (d) => logger.warn({ stderr: d.toString() }, 'pg_dump'));
  const exited = new Promise((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump a échoué (code ${code})`))));
  });

  try {
    await Promise.all([storage.put(config.storage.backupsBucket, key, dump.stdout.pipe(zlib.createGzip()), 'application/gzip'), exited]);
    logger.info({ security: true, event: 'backup.success', key }, 'sauvegarde terminée');
  } catch (err) {
    logger.error({ security: true, event: 'backup.failed', err }, 'sauvegarde en échec');
    process.exitCode = 1; // le CronJob passe en échec -> alerte Prometheus
  }
}

main();
