const { getDb } = require('../db');
const HttpError = require('../utils/httpError');

function list({ status, category, search } = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (category) {
    where.push('category = ? COLLATE NOCASE');
    params.push(category);
  }
  if (search) {
    where.push('(name LIKE ? OR asset_tag LIKE ? OR description LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const sql = `SELECT * FROM equipment ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name`;
  return getDb().prepare(sql).all(...params);
}

function getById(id) {
  const item = getDb().prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  if (!item) throw new HttpError(404, 'Equipamento não encontrado');
  return item;
}

function create({ name, category, asset_tag, description }) {
  const { lastInsertRowid } = getDb()
    .prepare('INSERT INTO equipment (name, category, asset_tag, description) VALUES (?, ?, ?, ?)')
    .run(name, category, asset_tag, description ?? null);
  return getById(Number(lastInsertRowid));
}

const UPDATABLE = ['name', 'category', 'asset_tag', 'description', 'status'];

function update(id, data) {
  const current = getById(id);

  if (data.status && current.status === 'loaned') {
    throw new HttpError(409, 'Equipamento emprestado: registre a devolução antes de alterar o status');
  }

  const fields = UPDATABLE.filter((f) => data[f] !== undefined);
  if (!fields.length) return current;

  const sets = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => data[f]);
  getDb()
    .prepare(`UPDATE equipment SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, id);

  return getById(id);
}

function remove(id) {
  getById(id);
  const hasLoans = getDb().prepare('SELECT 1 FROM loans WHERE equipment_id = ? LIMIT 1').get(id);
  if (hasLoans) {
    throw new HttpError(409, 'Equipamento possui histórico de empréstimos; altere o status para "inactive"');
  }
  getDb().prepare('DELETE FROM equipment WHERE id = ?').run(id);
}

module.exports = { list, getById, create, update, remove };
