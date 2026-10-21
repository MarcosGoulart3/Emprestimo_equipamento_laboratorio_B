// Carga inicial dos testes de aceitação — Projeto B
//
// Cria usuários, equipamentos e empréstimos com datas retroativas, que a API não
// permite criar (prazo vencido, histórico com datas passadas). Usada pelos cenários
// de atraso/bloqueio (CA-051 a CA-059), de histórico (CA-060 a CA-070) e de senha
// (CA-072 e CA-073).
//
// Uso (rodar ANTES de cada execução da collection, com o mesmo DB_PATH do servidor):
//   node --experimental-sqlite carga_inicial_B.js <pasta-do-projeto-B>
//
// É idempotente: apaga os dados "fx." e "FX-" de execuções anteriores e recria.

const path = require('node:path');

const projeto = path.resolve(process.argv[2] || '.');
const { getDb, closeDb } = require(path.join(projeto, 'src', 'db'));
const { createUser } = require(path.join(projeto, 'src', 'services', 'authService'));

const SENHA = 'Senha@123';
const DOMINIO = '@teste.local';

// Data local AAAA-MM-DD deslocada em dias (o Projeto B compara prazos com a data local)
function dia(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const ts = (offset) => `${dia(offset)} 12:00:00`;

const db = getDb();
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!admin) {
  console.error('Nenhum administrador encontrado. Rode "npm run seed" no projeto antes.');
  process.exit(1);
}

// ---- limpa execuções anteriores ----
db.exec('BEGIN');
db.prepare(
  `DELETE FROM loans WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'fx.%')
      OR equipment_id IN (SELECT id FROM equipment WHERE asset_tag LIKE 'FX-%')`,
).run();
db.prepare("DELETE FROM equipment WHERE asset_tag LIKE 'FX-%'").run();
db.prepare("DELETE FROM users WHERE email LIKE 'fx.%'").run();
db.exec('COMMIT');

// ---- usuários ----
const usuarios = {};
for (const nome of [
  'atraso3', 'prazohoje', 'bloqueado', 'informa', 'confirma', 'outro',
  'hist.ana', 'hist.bruno', 'hist.carla',
]) {
  usuarios[nome] = createUser({ name: `FX ${nome}`, email: `fx.${nome}${DOMINIO}`, password: SENHA }).id;
}

// ---- equipamentos ----
const equipamentos = {};
const insEquip = db.prepare('INSERT INTO equipment (name, category, asset_tag, description) VALUES (?, ?, ?, ?)');
for (const [tag, nome, cat] of [
  ['FX-ATR-01', 'Notebook carga inicial', 'Notebook'],
  ['FX-HOJE-01', 'Notebook carga inicial', 'Notebook'],
  ['FX-BLQ-01', 'Kit Arduino carga inicial', 'Arduino'],
  ['FX-BLQ-02', 'Kit Arduino carga inicial', 'Arduino'],
  ['FX-INF-01', 'Notebook carga inicial', 'Notebook'],
  ['FX-CNF-01', 'Notebook carga inicial', 'Notebook'],
  ['FX-OUT-01', 'Notebook carga inicial', 'Notebook'],
  ['FX-OUT-02', 'Kit Arduino carga inicial', 'Arduino'],
  ['FX-H-01', 'Notebook Dell 5420 (histórico)', 'Notebook'],
  ['FX-H-02', 'Notebook Lenovo E14 (histórico)', 'Notebook'],
  ['FX-H-03', 'Kit Arduino Uno (histórico)', 'Arduino'],
]) {
  equipamentos[tag] = Number(insEquip.run(nome, cat, tag, 'Criado pela carga inicial dos testes').lastInsertRowid);
}

// ---- empréstimos ----
// [marcador, usuário, equipamento, situação, solicitado, prazo, devolvido]
const emprestimos = [
  ['FX:ATR', 'atraso3', 'FX-ATR-01', 'active', -10, -3, null],
  ['FX:HOJE', 'prazohoje', 'FX-HOJE-01', 'active', -7, 0, null],
  ['FX:BLQ-ATRASO', 'bloqueado', 'FX-BLQ-01', 'active', -8, -1, null],
  ['FX:BLQ-PEND', 'bloqueado', 'FX-BLQ-02', 'pending', -2, 5, null],
  ['FX:INF', 'informa', 'FX-INF-01', 'active', -8, -1, null],
  ['FX:CNF', 'confirma', 'FX-CNF-01', 'return_pending', -8, -1, null],
  ['FX:OUT-ATRASO', 'outro', 'FX-OUT-01', 'active', -8, -1, null],
  ['FX:OUT-EMDIA', 'outro', 'FX-OUT-02', 'active', -2, 5, null],
  ['H1', 'hist.ana', 'FX-H-01', 'returned', -26, -19, -20],
  ['H2', 'hist.bruno', 'FX-H-01', 'returned', -17, -10, -7],
  ['H3', 'hist.ana', 'FX-H-03', 'returned', -12, -5, -5],
  ['H4', 'hist.ana', 'FX-H-01', 'active', -6, 1, null],
  ['H5', 'hist.bruno', 'FX-H-02', 'active', -9, -2, null],
];

const insLoan = db.prepare(
  `INSERT INTO loans (user_id, equipment_id, status, purpose, due_date, requested_at,
                      approved_at, approved_by, return_requested_at, returned_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const setEquip = db.prepare('UPDATE equipment SET status = ? WHERE id = ?');

for (const [marcador, usuario, tag, status, solicitado, prazo, devolvido] of emprestimos) {
  const aprovado = status === 'pending' ? null : ts(solicitado);
  insLoan.run(
    usuarios[usuario], equipamentos[tag], status, marcador, dia(prazo), ts(solicitado),
    aprovado, aprovado ? admin.id : null,
    status === 'return_pending' ? ts(prazo) : null,
    devolvido === null ? null : ts(devolvido),
  );
  if (status === 'active' || status === 'return_pending') setEquip.run('loaned', equipamentos[tag]);
}

closeDb();
console.log(`Carga inicial pronta: ${Object.keys(usuarios).length} usuários, ` +
  `${Object.keys(equipamentos).length} equipamentos, ${emprestimos.length} empréstimos (senha dos usuários: ${SENHA}).`);
