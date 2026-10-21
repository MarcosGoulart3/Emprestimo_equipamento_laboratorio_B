const HttpError = require('../utils/httpError');

// Valida req[source] com um schema zod e substitui pelo valor tratado
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(new HttpError(400, 'Dados inválidos', details));
    }
    // req.query é somente leitura no Express 5
    if (source === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    } else {
      req[source] = result.data;
    }
    next();
  };
}

module.exports = validate;
