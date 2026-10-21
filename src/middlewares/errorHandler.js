const HttpError = require('../utils/httpError');

function notFound(req, res, next) {
  next(new HttpError(404, 'Rota não encontrada'));
}

// O Express identifica o handler de erro pelos 4 parâmetros
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON malformado' });
  }

  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(err.message)) {
    return res.status(409).json({ error: 'Registro duplicado' });
  }

  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}

module.exports = { notFound, errorHandler };
