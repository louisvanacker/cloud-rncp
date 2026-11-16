'use strict';
// Migrations SQL versionnées, exécutées par un initContainer avant le démarrage de l'API.
// Un verrou consultatif PostgreSQL évite que 2 réplicas migrent en même temps.
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db');

const LOCK_ID = 727272;

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, 'biblio-migrate');
  const pool = createPool(config.db);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) continue;
      logger.info({ file }, 'application de la migration');
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    }

    // Compte administrateur initial, uniquement si fourni via Secret (jamais en dur)
    const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
    if (email && password) {
      const hash = await bcrypt.hash(password, config.bcryptRounds);
      await client.query(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Administrateur', $2, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [email.toLowerCase(), hash],
      );
    }
    logger.info('migrations à jour');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err }, 'échec des migrations');
    process.exitCode = 1;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main();
