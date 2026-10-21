// CA-072 e CA-073 — verificação direta no banco SQLite do Projeto B.
// Usa os usuários fx.hist.ana e fx.hist.bruno, criados pela carga inicial com a mesma senha.
//
// Uso: node --experimental-sqlite verificar_senhas_B.js <pasta-do-projeto-B>

const path = require('node:path');

const projeto = path.resolve(process.argv[2] || '.');
const { getDb, closeDb } = require(path.join(projeto, 'src', 'db'));

const SENHA = 'Senha@123';
// bcrypt, Argon2, scrypt e PBKDF2 nos formatos mais comuns
const HASH_DE_SENHA = /^(\$2[aby]\$\d{2}\$.{53}|\$argon2(id|i|d)\$.+|\$scrypt\$.+|scrypt:.+|\$pbkdf2(-sha\d+)?\$.+|pbkdf2(_sha\d+)?[:$].+)$/;

const db = getDb();
const ler = (email) => db.prepare('SELECT password_hash AS h FROM users WHERE email = ?').get(email)?.h;
const ana = ler('fx.hist.ana@teste.local');
const bruno = ler('fx.hist.bruno@teste.local');
closeDb();

if (!ana || !bruno) {
  console.error('Usuários da carga inicial não encontrados. Rode carga_inicial_B.js antes.');
  process.exit(1);
}

const resultados = [
  ['CA-072', 'Senha não é armazenada em texto puro', [
    ['valor armazenado diferente da senha', ana !== SENHA],
    ['valor armazenado não contém a senha', !ana.includes(SENHA)],
    ['formato de hash próprio para senhas', HASH_DE_SENHA.test(ana)],
  ]],
  ['CA-073', 'Senhas iguais geram hashes diferentes (salt)', [
    ['hashes de ana e bruno são diferentes', ana !== bruno],
  ]],
];

let falhou = false;
for (const [id, nome, checks] of resultados) {
  const ok = checks.every(([, v]) => v);
  falhou ||= !ok;
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${id}  ${nome}`);
  for (const [desc, v] of checks) console.log(`         ${v ? '✓' : '✗'} ${desc}`);
}
console.log(`\nFormato encontrado: ${ana.slice(0, 7)}… (${ana.length} caracteres)`);
process.exit(falhou ? 1 : 0);
