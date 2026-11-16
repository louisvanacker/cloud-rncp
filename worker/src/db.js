'use strict';
const fs = require('node:fs');
const { Pool } = require('pg');

// Chiffrement en transit vers PostgreSQL (ISO 27001 A.8.24) quand DB_SSL=require :
// le certificat serveur est émis par la CA interne cert-manager et vérifié ici.
function createPool(dbConfig) {
  let ssl = false;
  if (dbConfig.ssl === 'require') {
    ssl = { rejectUnauthorized: true };
    if (dbConfig.sslCaFile) ssl.ca = fs.readFileSync(dbConfig.sslCaFile, 'utf8');
  }
  return new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.max,
    ssl,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

module.exports = { createPool };
