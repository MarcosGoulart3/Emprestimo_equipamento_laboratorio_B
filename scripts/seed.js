// Cria o administrador inicial e alguns equipamentos de exemplo.
// Uso: npm run seed  (lê ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD do .env)
const { getDb, closeDb } = require('../src/db');
const { createUser } = require('../src/services/authService');

const { ADMIN_NAME = 'Administrador', ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('Defina ADMIN_EMAIL e ADMIN_PASSWORD (mín. 8 caracteres) no .env');
  process.exit(1);
}

const db = getDb();

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL.toLowerCase());
if (existing) {
  console.log(`Admin ${ADMIN_EMAIL} já existe`);
} else {
  createUser({ name: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), password: ADMIN_PASSWORD, role: 'admin' });
  console.log(`Admin ${ADMIN_EMAIL} criado`);
}

const samples = [
  ['Notebook Dell Latitude 3420', 'Notebook', 'LAB-NB-001', 'i5, 8GB RAM, 256GB SSD'],
  ['Notebook Dell Latitude 3420', 'Notebook', 'LAB-NB-002', 'i5, 8GB RAM, 256GB SSD'],
  ['Kit Arduino Uno R3', 'Arduino', 'LAB-ARD-001', 'Placa Uno, protoboard, jumpers, sensores básicos'],
  ['Kit Arduino Uno R3', 'Arduino', 'LAB-ARD-002', 'Placa Uno, protoboard, jumpers, sensores básicos'],
  ['Raspberry Pi 4 (4GB)', 'Raspberry Pi', 'LAB-RPI-001', 'Com fonte e cartão 32GB'],
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO equipment (name, category, asset_tag, description) VALUES (?, ?, ?, ?)',
);
let added = 0;
for (const s of samples) added += Number(insert.run(...s).changes);
console.log(`${added} equipamento(s) de exemplo inserido(s)`);

closeDb();
