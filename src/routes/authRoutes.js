const { Router } = require('express');
const rateLimit = require('express-rate-limit').default;
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const schemas = require('../utils/schemas');
const authService = require('../services/authService');
const config = require('../config');

const router = Router();

// Limita tentativas de login/cadastro para dificultar força bruta
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas, tente novamente mais tarde' },
});

router.post('/register', authLimiter, validate(schemas.register), (req, res) => {
  res.status(201).json(authService.register(req.body));
});

router.post('/login', authLimiter, validate(schemas.login), (req, res) => {
  res.json(authService.login(req.body));
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

module.exports = router;
