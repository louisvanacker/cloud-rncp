'use strict';
// Tests d'intégration de l'API sur une base PostgreSQL en mémoire (pg-mem) :
// aucune infrastructure requise, exécutés à chaque push par la CI.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const request = require('supertest');
const { newDb } = require('pg-mem');
const pino = require('pino');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const config = loadConfig({
  JWT_SECRET: 'test-secret-only-for-tests',
  DB_PASSWORD: 'x',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
  BCRYPT_ROUNDS: '4',
  MAX_ACTIVE_LOANS: '2',
});

const jobs = [];
const objects = new Map();
const fakeQueue = { add: async (name, data) => jobs.push({ name, data }), ping: async () => 'PONG' };
const fakeStorage = {
  put: async (b, k, body) => objects.set(`${b}/${k}`, body),
  getStream: async (b, k) => Readable.from([objects.get(`${b}/${k}`)]),
  remove: async (b, k) => objects.delete(`${b}/${k}`),
};

let app;
let db;
let alice; // membre
let bob; // membre
let libToken; // bibliothécaire

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const lastJob = (name) => [...jobs].reverse().find((j) => j.name === name);

async function register(email) {
  const res = await request(app).post('/api/auth/register').send({ email, name: email, password: 'motdepasse-solide' });
  assert.equal(res.status, 201);
  return res.body;
}

async function createBook(fields) {
  const res = await request(app)
    .post('/api/books')
    .set(auth(libToken))
    .send({ title: 'Livre', author: 'Auteur', total_copies: 1, ...fields });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  const mem = newDb();
  mem.public.none(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8'));
  const { Pool } = mem.adapters.createPg();
  db = new Pool();
  app = createApp({ db, queue: fakeQueue, storage: fakeStorage, config, logger: pino({ level: 'silent' }) });

  alice = await register('alice@example.com');
  bob = await register('bob@example.com');
  const hash = await bcrypt.hash('motdepasse-biblio', 4);
  await db.query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ('lib@example.com', 'Bibliothécaire', $1, 'librarian')",
    [hash],
  );
  const login = await request(app).post('/api/auth/login').send({ email: 'lib@example.com', password: 'motdepasse-biblio' });
  libToken = login.body.token;
});

test('sondes de santé et métriques', async () => {
  assert.equal((await request(app).get('/healthz')).status, 200);
  assert.equal((await request(app).get('/readyz')).status, 200);
  assert.match((await request(app).get('/metrics')).text, /http_requests_total/);
});

test('authentification : jeton requis, mauvais mot de passe, email déjà pris', async () => {
  assert.equal((await request(app).get('/api/books')).status, 401);
  assert.equal((await request(app).get('/api/books').set(auth('faux'))).status, 401);
  const bad = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'nope' });
  assert.equal(bad.status, 401);
  const dup = await request(app)
    .post('/api/auth/register')
    .send({ email: 'alice@example.com', name: 'A', password: 'motdepasse-solide' });
  assert.equal(dup.status, 409);
});

test('RBAC : un membre ne peut pas gérer le catalogue ni les utilisateurs', async () => {
  const res = await request(app).post('/api/books').set(auth(alice.token)).send({ title: 'X', author: 'Y' });
  assert.equal(res.status, 403);
  assert.equal((await request(app).get('/api/users').set(auth(libToken))).status, 403);
  assert.equal((await request(app).get('/api/imports').set(auth(alice.token))).status, 403);
});

test('catalogue : création, ISBN unique, recherche, validation', async () => {
  await createBook({ title: 'Le Petit Prince', author: 'Saint-Exupéry', isbn: '978-2070612758', category: 'Roman' });
  const dup = await request(app)
    .post('/api/books')
    .set(auth(libToken))
    .send({ title: 'Doublon', author: 'X', isbn: '9782070612758' });
  assert.equal(dup.status, 409);
  const bad = await request(app).post('/api/books').set(auth(libToken)).send({ title: '' });
  assert.equal(bad.status, 400);

  const found = await request(app).get('/api/books?q=petit').set(auth(alice.token));
  assert.equal(found.status, 200);
  assert.equal(found.body.length, 1);
  assert.equal(found.body[0].available_copies, 1);
  const cats = await request(app).get('/api/books/categories').set(auth(alice.token));
  assert.ok(cats.body.includes('Roman'));
});

test('couverture : téléversement vers le stockage objet, lecture publique, type refusé', async () => {
  const book = await createBook({ title: 'Avec couverture' });
  const up = await request(app)
    .post(`/api/books/${book.id}/cover`)
    .set(auth(libToken))
    .attach('file', Buffer.from('fake-png'), { filename: 'c.png', contentType: 'image/png' });
  assert.equal(up.status, 201);
  assert.ok([...objects.keys()].some((k) => k.includes(`covers/${book.id}/`)));

  const img = await request(app).get(`/api/books/${book.id}/cover`); // sans jeton
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-type'], 'image/png');

  const exe = await request(app)
    .post(`/api/books/${book.id}/cover`)
    .set(auth(libToken))
    .attach('file', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
  assert.equal(exe.status, 415);
});

test('emprunt / réservation / retour : cycle complet avec file d’attente', async () => {
  const book = await createBook({ title: 'Dune', author: 'Herbert', total_copies: 1 });

  // Alice emprunte le seul exemplaire -> e-mail de confirmation en file
  const loan = await request(app).post('/api/loans').set(auth(alice.token)).send({ book_id: book.id });
  assert.equal(loan.status, 201);
  assert.equal(lastJob('email').data.template, 'loan.confirmed');
  const due = new Date(loan.body.due_at) - Date.now();
  assert.ok(due > 20 * 86_400_000 && due < 22 * 86_400_000, 'retour prévu à 21 jours');

  // Plus d'exemplaire : Bob ne peut pas emprunter, mais peut réserver
  assert.equal((await request(app).post('/api/loans').set(auth(bob.token)).send({ book_id: book.id })).status, 409);
  const resa = await request(app).post('/api/reservations').set(auth(bob.token)).send({ book_id: book.id });
  assert.equal(resa.status, 201);
  assert.equal(resa.body.position, 1);
  // Alice ne peut pas réserver un livre qu'elle a déjà
  assert.equal((await request(app).post('/api/reservations').set(auth(alice.token)).send({ book_id: book.id })).status, 409);

  // Seul le personnel enregistre un retour
  assert.equal((await request(app).post(`/api/loans/${loan.body.id}/return`).set(auth(alice.token))).status, 403);
  const ret = await request(app).post(`/api/loans/${loan.body.id}/return`).set(auth(libToken));
  assert.equal(ret.status, 200);
  assert.equal(ret.body.status, 'returned');

  // L'exemplaire est mis de côté pour Bob (pas remis en rayon) et Bob est prévenu
  assert.equal(lastJob('email').data.template, 'reservation.available');
  const detail = await request(app).get(`/api/books/${book.id}`).set(auth(bob.token));
  assert.equal(detail.body.available_copies, 0);
  assert.equal(detail.body.my_reservation.status, 'available');

  // Alice ne peut pas le reprendre, Bob oui
  assert.equal((await request(app).post('/api/loans').set(auth(alice.token)).send({ book_id: book.id })).status, 409);
  const bobLoan = await request(app).post('/api/loans').set(auth(bob.token)).send({ book_id: book.id });
  assert.equal(bobLoan.status, 201);
  const mine = await request(app).get('/api/reservations').set(auth(bob.token));
  assert.equal(mine.body.find((r) => r.book_id === book.id).status, 'fulfilled');
});

test('réserver un livre disponible est refusé, annulation d’une réservation', async () => {
  const free = await createBook({ title: 'Disponible', total_copies: 2 });
  assert.equal((await request(app).post('/api/reservations').set(auth(alice.token)).send({ book_id: free.id })).status, 409);

  const rare = await createBook({ title: 'Rare', total_copies: 1 });
  await request(app).post('/api/loans').set(auth(bob.token)).send({ book_id: rare.id });
  const r = await request(app).post('/api/reservations').set(auth(alice.token)).send({ book_id: rare.id });
  assert.equal((await request(app).delete(`/api/reservations/${r.body.id}`).set(auth(bob.token))).status, 404);
  assert.equal((await request(app).delete(`/api/reservations/${r.body.id}`).set(auth(alice.token))).status, 204);
});

test('limite d’emprunts simultanés', async () => {
  // MAX_ACTIVE_LOANS = 2 dans ce test ; Bob a déjà 2 emprunts en cours (Dune, Rare)
  const extra = await createBook({ title: 'Un de trop' });
  const res = await request(app).post('/api/loans').set(auth(bob.token)).send({ book_id: extra.id });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'loan_limit');
});

test('un membre en retard ne peut plus emprunter', async () => {
  const carol = await register('carol@example.com');
  const b1 = await createBook({ title: 'En retard' });
  const b2 = await createBook({ title: 'Suivant' });
  const loan = await request(app).post('/api/loans').set(auth(carol.token)).send({ book_id: b1.id });
  await db.query('UPDATE loans SET due_at = $1 WHERE id = $2', [new Date(Date.now() - 86_400_000), loan.body.id]);
  const res = await request(app).post('/api/loans').set(auth(carol.token)).send({ book_id: b2.id });
  assert.equal(res.body.error, 'has_overdue');
});

test('isolation : un membre ne voit que ses emprunts, le personnel voit tout', async () => {
  const mine = await request(app).get('/api/loans').set(auth(alice.token));
  assert.ok(mine.body.every((l) => l.user_id === alice.user.id));
  const all = await request(app).get('/api/loans?status=current').set(auth(libToken));
  assert.ok(new Set(all.body.map((l) => l.user_id)).size > 1);
});

test('import CSV du catalogue : fichier stocké, 202, tâche en file', async () => {
  const csv = 'isbn,title,author,category,year,copies\n9780000000001,Test,Moi,Essai,2020,2\n';
  const res = await request(app)
    .post('/api/imports')
    .set(auth(libToken))
    .attach('file', Buffer.from(csv), { filename: 'catalogue.csv', contentType: 'text/csv' });
  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'pending');
  assert.equal(lastJob('catalog-import').data.importId, res.body.id);
  assert.ok(objects.has(`${config.storage.attachmentsBucket}/${res.body.object_key}`));
});

test('export PDF de l’historique : 202 puis statut pending', async () => {
  const res = await request(app).post('/api/exports').set(auth(alice.token));
  assert.equal(res.status, 202);
  assert.equal(lastJob('pdf-export').data.exportId, res.body.id);
  assert.equal((await request(app).get(`/api/exports/${res.body.id}`).set(auth(alice.token))).body.status, 'pending');
  assert.equal((await request(app).get(`/api/exports/${res.body.id}`).set(auth(bob.token))).status, 404);
  assert.equal((await request(app).get(`/api/exports/${res.body.id}/download`).set(auth(alice.token))).status, 409);
});
