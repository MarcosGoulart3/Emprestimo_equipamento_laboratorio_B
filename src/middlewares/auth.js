const jwt = require('jsonwebtoken');
const config = require('../config');
const HttpError = require('../utils/httpError');
const { getDb } = require('../db');

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Token de autenticação ausente'));
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return next(new HttpError(401, 'Token inválido ou expirado'));
  }

  // Busca o papel atual no banco: rebaixar um admin vale imediatamente
  const user = getDb()
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(Number(payload.sub));
  if (!user) return next(new HttpError(401, 'Usuário não encontrado'));

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(new HttpError(403, 'Acesso restrito'));
    }
    next();
  };
}

module.exports = { authenticate, requireRole, requireAdmin: requireRole('admin') };
