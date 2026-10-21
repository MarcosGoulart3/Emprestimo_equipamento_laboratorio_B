const { Router } = require('express');
const validate = require('../middlewares/validate');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const schemas = require('../utils/schemas');
const userService = require('../services/userService');
const loanService = require('../services/loanService');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', (req, res) => {
  res.json(userService.list());
});

router.get('/:id', validate(schemas.idParam, 'params'), (req, res) => {
  res.json(userService.getById(req.params.id));
});

// Histórico de empréstimos de um usuário específico
router.get('/:id/loans', validate(schemas.idParam, 'params'), validate(schemas.loanQuery, 'query'), (req, res) => {
  userService.getById(req.params.id);
  res.json(loanService.list(req.user, { ...req.query, user_id: req.params.id }));
});

router.patch('/:id/role', validate(schemas.idParam, 'params'), validate(schemas.roleUpdate), (req, res) => {
  res.json(userService.updateRole(req.params.id, req.body.role));
});

module.exports = router;
