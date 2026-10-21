const { Router } = require('express');
const validate = require('../middlewares/validate');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const schemas = require('../utils/schemas');
const equipmentService = require('../services/equipmentService');
const loanService = require('../services/loanService');

const router = Router();

router.use(authenticate);

router.get('/', validate(schemas.equipmentQuery, 'query'), (req, res) => {
  res.json(equipmentService.list(req.query));
});

router.get('/:id', validate(schemas.idParam, 'params'), (req, res) => {
  res.json(equipmentService.getById(req.params.id));
});

// Histórico de empréstimos de um equipamento (quem usou e quando)
router.get(
  '/:id/loans',
  requireAdmin,
  validate(schemas.idParam, 'params'),
  validate(schemas.loanQuery, 'query'),
  (req, res) => {
    equipmentService.getById(req.params.id);
    res.json(loanService.list(req.user, { ...req.query, equipment_id: req.params.id }));
  },
);

router.post('/', requireAdmin, validate(schemas.equipmentCreate), (req, res) => {
  res.status(201).json(equipmentService.create(req.body));
});

router.patch(
  '/:id',
  requireAdmin,
  validate(schemas.idParam, 'params'),
  validate(schemas.equipmentUpdate),
  (req, res) => {
    res.json(equipmentService.update(req.params.id, req.body));
  },
);

router.delete('/:id', requireAdmin, validate(schemas.idParam, 'params'), (req, res) => {
  equipmentService.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
