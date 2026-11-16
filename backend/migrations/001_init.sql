-- Schéma Bibliothèque : 4 entités métier (users, books, loans, reservations)
-- + 2 tables techniques suivies par le worker asynchrone (imports CSV, exports PDF).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'librarian', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Un ouvrage = une notice du catalogue, avec N exemplaires.
-- available_copies = exemplaires en rayon (ni empruntés, ni mis de côté pour une réservation).
CREATE TABLE IF NOT EXISTS books (
  id                 SERIAL PRIMARY KEY,
  isbn               VARCHAR(20)  UNIQUE,
  title              VARCHAR(255) NOT NULL,
  author             VARCHAR(255) NOT NULL,
  category           VARCHAR(60)  NOT NULL DEFAULT 'Général',
  published_year     INTEGER,
  description        TEXT,
  total_copies       INTEGER      NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
  available_copies   INTEGER      NOT NULL DEFAULT 1 CHECK (available_copies >= 0),
  cover_key          VARCHAR(400),
  cover_content_type VARCHAR(100),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);

CREATE TABLE IF NOT EXISTS loans (
  id                  SERIAL PRIMARY KEY,
  book_id             INTEGER     NOT NULL REFERENCES books(id),
  user_id             INTEGER     NOT NULL REFERENCES users(id),
  borrowed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at              TIMESTAMPTZ NOT NULL,
  returned_at         TIMESTAMPTZ,
  status              VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'overdue', 'returned')),
  reminder_sent_at    TIMESTAMPTZ, -- rappel J-2 envoyé (tâche planifiée)
  overdue_notified_at TIMESTAMPTZ  -- dernière relance de retard
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_book ON loans(book_id);
CREATE INDEX IF NOT EXISTS idx_loans_status_due ON loans(status, due_at);

-- File d'attente par ouvrage. waiting -> available (exemplaire mis de côté) -> fulfilled (emprunté)
-- ou cancelled / expired.
CREATE TABLE IF NOT EXISTS reservations (
  id          SERIAL PRIMARY KEY,
  book_id     INTEGER     NOT NULL REFERENCES books(id),
  user_id     INTEGER     NOT NULL REFERENCES users(id),
  status      VARCHAR(10) NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting', 'available', 'fulfilled', 'cancelled', 'expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reservations_book_status ON reservations(book_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);

CREATE TABLE IF NOT EXISTS imports (
  id            SERIAL PRIMARY KEY,
  uploaded_by   INTEGER      NOT NULL REFERENCES users(id),
  filename      VARCHAR(255) NOT NULL,
  object_key    VARCHAR(400) NOT NULL,
  status        VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_count INTEGER      NOT NULL DEFAULT 0,
  skipped_count INTEGER      NOT NULL DEFAULT 0,
  errors        TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS exports (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id),
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  object_key   VARCHAR(400),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
