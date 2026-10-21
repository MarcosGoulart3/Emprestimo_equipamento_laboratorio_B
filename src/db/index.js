const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db;

function getDb() {
  if (db) return db;

  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }

  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

// schema.sql só cria tabelas novas; colunas adicionadas depois entram aqui
function addColumnIfMissing(conn, table, column, definition, backfillSql) {
  const exists = conn
    .prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column);
  if (exists) return;
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  if (backfillSql) conn.exec(backfillSql);
}

function migrate(conn) {
  addColumnIfMissing(
    conn,
    'loans',
    'created_by',
    'INTEGER REFERENCES users(id)',
    'UPDATE loans SET created_by = user_id WHERE created_by IS NULL',
  );
}

// Executa fn dentro de uma transação; desfaz tudo se lançar erro
function transaction(fn) {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = { getDb, transaction, closeDb };
