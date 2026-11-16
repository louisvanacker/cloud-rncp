'use strict';

// Express 4 ne propage pas les rejets de promesses : on les renvoie vers le handler d'erreurs.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const idParam = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'invalid_id');
  return id;
};

// Exécute fn dans une transaction : un emprunt ou un retour modifie plusieurs tables,
// tout doit réussir ou tout être annulé.
async function withTx(db, fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 86_400_000);

module.exports = { ah, HttpError, idParam, withTx, addDays };
