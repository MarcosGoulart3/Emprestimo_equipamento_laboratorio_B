const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db');
const HttpError = require('../utils/httpError');

const SALT_ROUNDS = 10;
// Usado quando o e-mail não existe, para o tempo de resposta não revelar quais contas existem
const DUMMY_HASH = bcrypt.hashSync('dummy-password', SALT_ROUNDS);

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
}

function createUser({ name, email, password, role = 'user' }) {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'E-mail já cadastrado');

  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, role);

  return toPublicUser({ id: Number(lastInsertRowid), name, email, role });
}

// Cadastro público sempre cria usuário comum
function register(data) {
  const user = createUser({ ...data, role: 'user' });
  return { user, token: signToken(user) };
}

function login({ email, password }) {
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'E-mail ou senha inválidos');

  return { user: toPublicUser(user), token: signToken(user) };
}

module.exports = { register, login, createUser, toPublicUser };
