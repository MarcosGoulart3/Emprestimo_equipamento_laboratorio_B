const { getDb, transaction } = require('../db');
const HttpError = require('../utils/httpError');

function list() {
  return getDb().prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name').all();
}

function getById(id) {
  const user = getDb().prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(404, 'Usuário não encontrado');
  return user;
}

function updateRole(id, role) {
  transaction((db) => {
    const user = getById(id);
    if (user.role === 'admin' && role === 'user') {
      const { admins } = db.prepare("SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'").get();
      if (admins <= 1) throw new HttpError(409, 'Não é possível remover o último administrador');
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  });
  return getById(id);
}

module.exports = { list, getById, updateRole };
