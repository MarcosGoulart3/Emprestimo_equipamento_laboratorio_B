const { Router } = require('express');
const validate = require('../middlewares/validate');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const schemas = require('../utils/schemas');
const loanService = require('../services/loanService');
const HttpError = require('../utils/httpError');

const router = Router();

router.use(authenticate);

// Usuário comum vê apenas os próprios empréstimos; admin vê todos
router.get('/', validate(schemas.loanQuery, 'query'), (req, res) => {
  res.json(loanService.list(req.user, req.query));
});

// Histórico do próprio usuário logado (útil também para o admin)
router.get('/me', validate(schemas.loanQuery, 'query'), (req, res) => {
  res.json(loanService.list(req.user, { ...req.query, user_id: req.user.id }));
});

router.get('/:id', validate(schemas.idParam, 'params'), (req, res) => {
  res.json(loanService.getById(req.params.id, req.user));
});

router.post('/', validate(schemas.loanCreate), (req, res, next) => {
  const { user_id, admin_notes, ...data } = req.body;

  if (user_id === undefined && admin_notes === undefined) {
    return res.status(201).json(loanService.request(req.user, data));
  }
  if (req.user.role !== 'admin') {
    return next(new HttpError(403, 'Apenas administradores registram empréstimos em nome de outro usuário'));
  }
  if (user_id === undefined) {
    return next(new HttpError(400, 'Informe user_id para registrar empréstimo em nome de outro usuário'));
  }
  res.status(201).json(loanService.createOnBehalf(req.user, { ...data, user_id, admin_notes }));
});

router.patch('/:id/cancel', validate(schemas.idParam, 'params'), (req, res) => {
  res.json(loanService.cancel(req.params.id, req.user));
});

// Usuário informa que devolveu; o admin ainda precisa confirmar em /return
router.patch(
  '/:id/return-request',
  validate(schemas.idParam, 'params'),
  validate(schemas.returnRequest),
  (req, res) => {
    res.json(loanService.requestReturn(req.params.id, req.user, req.body));
  },
);

const adminActions = {
  approve: loanService.approve,
  reject: loanService.reject,
  return: loanService.registerReturn,
};

for (const [action, handler] of Object.entries(adminActions)) {
  router.patch(
    `/:id/${action}`,
    requireAdmin,
    validate(schemas.idParam, 'params'),
    validate(schemas.loanDecision),
    (req, res) => {
      res.json(handler(req.params.id, req.user, req.body));
    },
  );
}

module.exports = router;
