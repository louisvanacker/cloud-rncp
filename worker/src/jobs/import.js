'use strict';
// Import du catalogue : le CSV téléversé par un bibliothécaire est lu depuis le stockage objet,
// validé ligne par ligne et inséré. Les ISBN déjà présents sont ignorés (pas de doublon).
// Colonnes (en-tête obligatoire, français ou anglais) :
//   isbn | titre/title | auteur/author | categorie/category | annee/year | exemplaires/copies
const { parse } = require('csv-parse/sync');

const ALIASES = {
  isbn: 'isbn',
  title: 'title', titre: 'title',
  author: 'author', auteur: 'author',
  category: 'category', categorie: 'category', 'catégorie': 'category',
  year: 'year', annee: 'year', 'année': 'year',
  copies: 'copies', exemplaires: 'copies',
};

const streamToString = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
};

// Analyse + validation, sans base de données. Fonction pure -> testable.
function parseCatalog(text) {
  const delimiter = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const records = parse(text, {
    columns: (header) => header.map((h) => ALIASES[h.trim().toLowerCase()] || h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    delimiter,
    relax_column_count: true,
  });
  const books = [];
  const errors = [];
  records.forEach((r, i) => {
    const line = i + 2; // +1 en-tête, +1 base 1
    const isbn = r.isbn ? r.isbn.replace(/-/g, '').toUpperCase() : null;
    const copies = r.copies === undefined || r.copies === '' ? 1 : Number(r.copies);
    const year = r.year ? Number(r.year) : null;
    if (!r.title || !r.author) return errors.push(`ligne ${line} : titre et auteur obligatoires`);
    if (isbn && !/^[0-9X]{10,13}$/.test(isbn)) return errors.push(`ligne ${line} : ISBN invalide`);
    if (!Number.isInteger(copies) || copies < 0 || copies > 500) return errors.push(`ligne ${line} : nombre d'exemplaires invalide`);
    if (year !== null && (!Number.isInteger(year) || year > 2100)) return errors.push(`ligne ${line} : année invalide`);
    books.push({
      isbn,
      title: r.title.slice(0, 255),
      author: r.author.slice(0, 255),
      category: (r.category || 'Général').slice(0, 60),
      year,
      copies,
    });
  });
  return { books, errors };
}

function importJob({ db, storage, queue, config, logger }) {
  return async (job) => {
    const { importId } = job.data;
    const { rows } = await db.query('SELECT * FROM imports WHERE id = $1', [importId]);
    const imp = rows[0];
    if (!imp || imp.status !== 'pending') return { skipped: 'not_pending' };
    try {
      const text = await streamToString(await storage.getStream(config.storage.attachmentsBucket, imp.object_key));
      const { books, errors } = parseCatalog(text);
      let created = 0;
      let skipped = 0;
      for (const b of books) {
        if (b.isbn) {
          const exists = await db.query('SELECT 1 FROM books WHERE isbn = $1', [b.isbn]);
          if (exists.rows.length) {
            skipped += 1;
            continue;
          }
        }
        await db.query(
          `INSERT INTO books (isbn, title, author, category, published_year, total_copies, available_copies)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [b.isbn, b.title, b.author, b.category, b.year, b.copies],
        );
        created += 1;
      }
      await db.query(
        `UPDATE imports SET status = 'done', created_count = $1, skipped_count = $2, errors = $3, finished_at = now()
         WHERE id = $4`,
        [created, skipped, errors.slice(0, 50).join('\n') || null, importId],
      );
      await queue.add('email', { template: 'import.done', importId });
      logger.info({ importId, created, skipped, errors: errors.length }, 'import du catalogue terminé');
      return { created, skipped, errors: errors.length };
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
        await db.query("UPDATE imports SET status = 'failed', errors = $1, finished_at = now() WHERE id = $2", [
          String(err.message).slice(0, 500),
          importId,
        ]);
      }
      throw err;
    }
  };
}

module.exports = { importJob, parseCatalog };
