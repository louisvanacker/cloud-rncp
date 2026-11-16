'use strict';
// Tests du worker : fonctions pures + tâches exécutées sur une base PostgreSQL en mémoire (pg-mem)
// créée avec le MÊME schéma que l'API (backend/migrations).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { newDb } = require('pg-mem');
const { buildEmail, emailJob } = require('../src/jobs/email');
const { renderLoanHistoryPdf } = require('../src/jobs/pdf');
const { dailyJob } = require('../src/jobs/daily');
const { importJob, parseCatalog } = require('../src/jobs/import');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'migrations', '001_init.sql'), 'utf8');
const DAY = 86_400_000;
const logger = { info() {}, warn() {}, error() {} };
const config = {
  appUrl: 'http://x',
  smtp: { from: 'noreply@x' },
  storage: { attachmentsBucket: 'attachments' },
  library: { reminderDaysBefore: 2, overdueRepeatDays: 7, holdDays: 3 },
};

let db;
let queued;
const queue = { add: async (name, data) => queued.push({ name, data }) };

beforeEach(async () => {
  const mem = newDb();
  mem.public.none(SCHEMA);
  db = new (mem.adapters.createPg().Pool)();
  queued = [];
  await db.query(
    `INSERT INTO users (email, name, password_hash) VALUES ('a@x', 'Alice', 'h'), ('b@x', 'Bob', 'h'), ('c@x', 'Carol', 'h')`,
  );
});

const book = async (copies = 1, available = copies) =>
  (await db.query(
    "INSERT INTO books (title, author, total_copies, available_copies) VALUES ('Dune', 'Herbert', $1, $2) RETURNING id",
    [copies, available],
  )).rows[0].id;
const loan = async (bookId, userId, dueInDays) =>
  (await db.query('INSERT INTO loans (book_id, user_id, due_at) VALUES ($1, $2, $3) RETURNING id', [
    bookId,
    userId,
    new Date(Date.now() + dueInDays * DAY),
  ])).rows[0].id;

test('modèles d’e-mail', () => {
  const ctx = { title: 'Dune', author: 'Herbert', user_name: 'Alice', due_at: new Date(), book_id: 1 };
  assert.match(buildEmail('loan.reminder', ctx, 'http://x').subject, /Rappel/);
  assert.match(buildEmail('loan.overdue', ctx, 'http://x').text, /ne pouvez plus emprunter/);
  assert.throws(() => buildEmail('inconnu', ctx, 'http://x'));
});

test('tâche e-mail : envoi au membre concerné', async () => {
  const b = await book();
  const l = await loan(b, 1, 21);
  const sent = [];
  const job = emailJob({ db, mailer: { sendMail: async (m) => sent.push(m) }, config, logger });
  await job({ data: { template: 'loan.confirmed', loanId: l } });
  assert.equal(sent[0].to, 'a@x');
  assert.match(sent[0].subject, /Emprunt confirmé : Dune/);
});

test('tâche quotidienne : rappel J-2, retard, idempotence', async () => {
  const b = await book(3, 0);
  const soon = await loan(b, 1, 1); // échéance dans 1 jour -> rappel
  const later = await loan(b, 2, 10); // rien
  const late = await loan(b, 3, -3); // en retard -> relance
  const run = dailyJob({ db, queue, config, logger });

  const r1 = await run();
  assert.deepEqual(r1, { reminders: 1, overdue: 1, expired: 0 });
  assert.deepEqual(queued.map((j) => [j.data.template, j.data.loanId]).sort(), [
    ['loan.overdue', late],
    ['loan.reminder', soon],
  ].sort());
  const st = (await db.query('SELECT status FROM loans WHERE id = $1', [late])).rows[0].status;
  assert.equal(st, 'overdue');

  // Relancée le même jour : aucun doublon
  const r2 = await run();
  assert.deepEqual(r2, { reminders: 0, overdue: 0, expired: 0 });
  assert.equal(queued.length, 2);
  assert.ok(later);
});

test('tâche quotidienne : relance d’un retard tous les 7 jours', async () => {
  const b = await book(1, 0);
  const l = await loan(b, 1, -20);
  await db.query("UPDATE loans SET status = 'overdue', overdue_notified_at = $1 WHERE id = $2", [
    new Date(Date.now() - 8 * DAY),
    l,
  ]);
  const r = await dailyJob({ db, queue, config, logger })();
  assert.equal(r.overdue, 1);
});

test('tâche quotidienne : réservation non retirée -> expirée, exemplaire au suivant', async () => {
  const b = await book(1, 0);
  const expiredHold = (await db.query(
    "INSERT INTO reservations (book_id, user_id, status, expires_at) VALUES ($1, 1, 'available', $2) RETURNING id",
    [b, new Date(Date.now() - DAY)],
  )).rows[0].id;
  const next = (await db.query("INSERT INTO reservations (book_id, user_id) VALUES ($1, 2) RETURNING id", [b])).rows[0].id;

  const r = await dailyJob({ db, queue, config, logger })();
  assert.equal(r.expired, 1);
  const statuses = (await db.query('SELECT id, status FROM reservations ORDER BY id')).rows;
  assert.deepEqual(statuses.map((s) => s.status), ['expired', 'available']);
  assert.ok(queued.some((j) => j.data.template === 'reservation.expired' && j.data.reservationId === expiredHold));
  assert.ok(queued.some((j) => j.data.template === 'reservation.available' && j.data.reservationId === next));
  // L'exemplaire reste réservé (pas remis en rayon)
  assert.equal((await db.query('SELECT available_copies FROM books WHERE id = $1', [b])).rows[0].available_copies, 0);
});

test('tâche quotidienne : sans file d’attente, l’exemplaire revient en rayon', async () => {
  const b = await book(1, 0);
  await db.query(
    "INSERT INTO reservations (book_id, user_id, status, expires_at) VALUES ($1, 1, 'available', $2)",
    [b, new Date(Date.now() - DAY)],
  );
  await dailyJob({ db, queue, config, logger })();
  assert.equal((await db.query('SELECT available_copies FROM books WHERE id = $1', [b])).rows[0].available_copies, 1);
});

test('analyse CSV : en-têtes français, point-virgule, erreurs par ligne', () => {
  const csv = '﻿ISBN;Titre;Auteur;Catégorie;Année;Exemplaires\n' +
    '978-2-07-061275-8;Le Petit Prince;Saint-Exupéry;Roman;1943;3\n' +
    ';Sans auteur;;Roman;;1\n' +
    'ABC;Mauvais ISBN;X;;;1\n' +
    ';Sans ISBN;Moi;;;\n';
  const { books, errors } = parseCatalog(csv);
  assert.equal(books.length, 2);
  assert.equal(books[0].isbn, '9782070612758');
  assert.equal(books[0].copies, 3);
  assert.equal(books[1].copies, 1);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /ligne 3/);
});

test('tâche d’import : création, ISBN déjà présent ignoré, e-mail de fin', async () => {
  await db.query("INSERT INTO books (isbn, title, author) VALUES ('9782070612758', 'Déjà là', 'X')");
  const csv = 'isbn,title,author,category,year,copies\n9782070612758,Le Petit Prince,Saint-Ex,Roman,1943,2\n,Nouveau,Moi,Essai,2024,4\n';
  const storage = { getStream: async () => Readable.from([Buffer.from(csv)]) };
  const imp = (await db.query(
    "INSERT INTO imports (uploaded_by, filename, object_key) VALUES (1, 'c.csv', 'imports/c.csv') RETURNING id",
  )).rows[0].id;

  const out = await importJob({ db, storage, queue, config, logger })({ data: { importId: imp }, attemptsMade: 0, opts: {} });
  assert.deepEqual(out, { created: 1, skipped: 1, errors: 0 });
  const row = (await db.query('SELECT status, created_count, skipped_count FROM imports WHERE id = $1', [imp])).rows[0];
  assert.deepEqual(row, { status: 'done', created_count: 1, skipped_count: 1 });
  const added = (await db.query("SELECT total_copies, available_copies FROM books WHERE title = 'Nouveau'")).rows[0];
  assert.deepEqual(added, { total_copies: 4, available_copies: 4 });
  assert.equal(queued[0].data.template, 'import.done');
});

test('génération du PDF d’historique', async () => {
  const pdf = await renderLoanHistoryPdf({ name: 'Alice', email: 'a@x' }, [
    { title: 'Dune', author: 'Herbert', borrowed_at: new Date(), due_at: new Date(), status: 'active' },
    { title: 'Ubik', author: 'Dick', borrowed_at: new Date(), due_at: new Date(), returned_at: new Date(), status: 'returned' },
  ]);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
