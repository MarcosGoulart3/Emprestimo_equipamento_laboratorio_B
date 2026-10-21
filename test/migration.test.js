const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-migration-'));
const dbPath = path.join(dir, 'antigo.db');
process.env.NODE_ENV = 'test';
process.env.DB_PATH = dbPath;

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('migração adiciona created_by em banco existente sem perder dados', () => {
  // Banco no formato anterior, sem a coluna created_by
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
                        created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE equipment (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
                            asset_tag TEXT NOT NULL UNIQUE, description TEXT,
                            status TEXT NOT NULL DEFAULT 'available',
                            created_at TEXT NOT NULL DEFAULT (datetime('now')),
                            updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE loans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, equipment_id INTEGER NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending', purpose TEXT, due_date TEXT NOT NULL,
                        requested_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (id, name, email, password_hash) VALUES (7, 'Aluno', 'a@lab.edu', 'x');
    INSERT INTO equipment (id, name, category, asset_tag) VALUES (1, 'Arduino', 'Arduino', 'A-1');
    INSERT INTO loans (user_id, equipment_id, due_date) VALUES (7, 1, '2026-01-10');
  `);
  old.close();

  const { getDb, closeDb } = require('../src/db');
  const db = getDb();
  const loan = db.prepare('SELECT * FROM loans').get();
  assert.equal(loan.user_id, 7);
  assert.equal(loan.created_by, 7);
  closeDb();

  // Rodar de novo não quebra (migração é idempotente)
  assert.doesNotThrow(() => getDb());
  closeDb();
});
