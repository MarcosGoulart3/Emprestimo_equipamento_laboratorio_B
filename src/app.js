const express = require('express');
const helmet = require('helmet');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', require('./routes/authRoutes'));
app.use('/equipment', require('./routes/equipmentRoutes'));
app.use('/loans', require('./routes/loanRoutes'));
app.use('/users', require('./routes/userRoutes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
