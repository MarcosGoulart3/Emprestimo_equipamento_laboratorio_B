const config = require('./config');
const { getDb } = require('./db');
const app = require('./app');

getDb();

app.listen(config.port, () => {
  console.log(`API de empréstimos rodando em http://localhost:${config.port}`);
});
