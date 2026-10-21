const path = require('node:path');
const fs = require('node:fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env.NODE_ENV || 'development';

if (env === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório em produção');
}

module.exports = {
  env,
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'laboratorio.db'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-troque-em-producao',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  maxLoanDays: Number(process.env.MAX_LOAN_DAYS) || 15,
  maxActiveLoansPerUser: Number(process.env.MAX_ACTIVE_LOANS) || 3,
};
