PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  asset_tag    TEXT    NOT NULL UNIQUE,
  description  TEXT,
  status       TEXT    NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'loaned', 'maintenance', 'inactive')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id),
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'return_pending', 'returned', 'rejected', 'cancelled')),
  purpose       TEXT,
  -- Quem registrou: o próprio usuário ou um admin (empréstimo em nome de outro)
  created_by    INTEGER REFERENCES users(id),
  due_date      TEXT    NOT NULL,
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at   TEXT,
  approved_by   INTEGER REFERENCES users(id),
  return_requested_at TEXT,
  return_notes  TEXT,
  returned_at   TEXT,
  rejected_at   TEXT,
  cancelled_at  TEXT,
  admin_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_loans_user      ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_equipment ON loans(equipment_id);
CREATE INDEX IF NOT EXISTS idx_loans_status    ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_requested ON loans(requested_at);

-- Garante no banco que um equipamento não esteja com dois usuários ao mesmo tempo
-- (return_pending: usuário avisou a devolução, mas o admin ainda não conferiu)
CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_active_equipment
  ON loans(equipment_id) WHERE status IN ('active', 'return_pending');
