process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
// Fixa as regras para os testes não dependerem de um .env local
process.env.MAX_LOAN_DAYS = '15';
process.env.MAX_ACTIVE_LOANS = '3';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { getDb, closeDb } = require('../src/db');
const { createUser } = require('../src/services/authService');
const { today } = require('../src/services/loanService');

let server;
let baseUrl;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ctx = {};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;

  createUser({ name: 'Admin', email: 'admin@lab.edu', password: 'admin12345', role: 'admin' });
  ctx.admin = (await api('POST', '/auth/login', { body: { email: 'admin@lab.edu', password: 'admin12345' } })).body.token;
});

after(() => {
  server.close();
  closeDb();
});

test('cadastro público cria usuário comum, mesmo se pedir admin', async () => {
  const res = await api('POST', '/auth/register', {
    body: { name: 'Aluno', email: 'aluno@lab.edu', password: 'senha12345', role: 'admin' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'user');
  ctx.user = res.body.token;
  ctx.userId = res.body.user.id;

  const other = await api('POST', '/auth/register', {
    body: { name: 'Outro', email: 'outro@lab.edu', password: 'senha12345' },
  });
  ctx.other = other.body.token;
});

test('login com senha errada retorna 401', async () => {
  const res = await api('POST', '/auth/login', { body: { email: 'aluno@lab.edu', password: 'errada123' } });
  assert.equal(res.status, 401);
});

test('rotas exigem autenticação', async () => {
  assert.equal((await api('GET', '/equipment')).status, 401);
  assert.equal((await api('GET', '/equipment', { token: 'invalido' })).status, 401);
});

test('validação rejeita dados inválidos', async () => {
  const res = await api('POST', '/auth/register', { body: { name: 'x', email: 'nao-email', password: '1' } });
  assert.equal(res.status, 400);
  assert.ok(res.body.details.length >= 3);
});

test('somente admin cadastra equipamentos', async () => {
  const body = { name: 'Kit Arduino Uno', category: 'Arduino', asset_tag: 'ARD-01' };
  assert.equal((await api('POST', '/equipment', { token: ctx.user, body })).status, 403);

  const res = await api('POST', '/equipment', { token: ctx.admin, body });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'available');
  ctx.equipmentId = res.body.id;

  const dup = await api('POST', '/equipment', { token: ctx.admin, body });
  assert.equal(dup.status, 409);

  // Usuário comum também não edita nem remove
  const edit = await api('PATCH', `/equipment/${ctx.equipmentId}`, { token: ctx.user, body: { name: 'Hack' } });
  assert.equal(edit.status, 403);
  assert.equal((await api('DELETE', `/equipment/${ctx.equipmentId}`, { token: ctx.user })).status, 403);
  assert.equal((await api('GET', `/equipment/${ctx.equipmentId}`, { token: ctx.user })).body.name, body.name);
});

test('usuário lista e filtra equipamentos', async () => {
  const res = await api('GET', '/equipment?category=arduino', { token: ctx.user });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});

test('solicitação de empréstimo valida prazo', async () => {
  const past = await api('POST', '/loans', {
    token: ctx.user,
    body: { equipment_id: ctx.equipmentId, due_date: today(0) },
  });
  assert.equal(past.status, 400);

  const tooLong = await api('POST', '/loans', {
    token: ctx.user,
    body: { equipment_id: ctx.equipmentId, due_date: today(60) },
  });
  assert.equal(tooLong.status, 400);
});

test('fluxo completo: solicitar, aprovar e devolver', async () => {
  const req = await api('POST', '/loans', {
    token: ctx.user,
    body: { equipment_id: ctx.equipmentId, due_date: today(7), purpose: 'Projeto integrador' },
  });
  assert.equal(req.status, 201);
  assert.equal(req.body.status, 'pending');
  const loanId = req.body.id;

  // Outro usuário também solicita o mesmo equipamento
  const otherReq = await api('POST', '/loans', {
    token: ctx.other,
    body: { equipment_id: ctx.equipmentId, due_date: today(3) },
  });
  assert.equal(otherReq.status, 201);

  // Usuário comum não aprova nem enxerga empréstimo alheio
  assert.equal((await api('PATCH', `/loans/${loanId}/approve`, { token: ctx.user })).status, 403);
  assert.equal((await api('GET', `/loans/${loanId}`, { token: ctx.other })).status, 404);

  const approved = await api('PATCH', `/loans/${loanId}/approve`, { token: ctx.admin });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'active');

  const equip = await api('GET', `/equipment/${ctx.equipmentId}`, { token: ctx.user });
  assert.equal(equip.body.status, 'loaned');

  // Segunda solicitação não pode ser aprovada com o equipamento emprestado
  const conflict = await api('PATCH', `/loans/${otherReq.body.id}/approve`, { token: ctx.admin });
  assert.equal(conflict.status, 409);

  // Nem é possível solicitar um equipamento já emprestado
  const blocked = await api('POST', '/loans', {
    token: ctx.other,
    body: { equipment_id: ctx.equipmentId, due_date: today(2) },
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /indisponível/);

  // Admin também não consegue liberar o equipamento manualmente enquanto emprestado
  const forceAvailable = await api('PATCH', `/equipment/${ctx.equipmentId}`, {
    token: ctx.admin,
    body: { status: 'available' },
  });
  assert.equal(forceAvailable.status, 409);

  // O próprio banco rejeita um segundo empréstimo ativo do mesmo equipamento
  assert.throws(
    () =>
      getDb()
        .prepare("INSERT INTO loans (user_id, equipment_id, due_date, status) VALUES (?, ?, ?, 'active')")
        .run(ctx.userId, ctx.equipmentId, today(2)),
    /UNIQUE constraint failed/,
  );

  const mine = await api('GET', '/loans', { token: ctx.user });
  assert.equal(mine.body.data.length, 1);
  const all = await api('GET', '/loans', { token: ctx.admin });
  assert.equal(all.body.pagination.total, 2);

  const returned = await api('PATCH', `/loans/${loanId}/return`, {
    token: ctx.admin,
    body: { admin_notes: 'Devolvido sem avarias' },
  });
  assert.equal(returned.status, 200);
  assert.equal(returned.body.status, 'returned');
  assert.ok(returned.body.returned_at);

  const equipAfter = await api('GET', `/equipment/${ctx.equipmentId}`, { token: ctx.user });
  assert.equal(equipAfter.body.status, 'available');

  // Equipamento com histórico não pode ser excluído
  assert.equal((await api('DELETE', `/equipment/${ctx.equipmentId}`, { token: ctx.admin })).status, 409);
});

test('usuário cancela a própria solicitação pendente', async () => {
  const req = await api('POST', '/loans', {
    token: ctx.user,
    body: { equipment_id: ctx.equipmentId, due_date: today(2) },
  });
  assert.equal((await api('PATCH', `/loans/${req.body.id}/cancel`, { token: ctx.other })).status, 404);

  const res = await api('PATCH', `/loans/${req.body.id}/cancel`, { token: ctx.user });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
});

test('usuário com empréstimo em atraso fica bloqueado até devolver', async () => {
  const create = (asset_tag) =>
    api('POST', '/equipment', { token: ctx.admin, body: { name: 'Notebook', category: 'Notebook', asset_tag } });
  const nb1 = (await create('NB-ATR-1')).body.id;
  const nb2 = (await create('NB-ATR-2')).body.id;

  const loan = await api('POST', '/loans', { token: ctx.other, body: { equipment_id: nb1, due_date: today(3) } });
  // Pedido feito antes do atraso
  const earlier = await api('POST', '/loans', { token: ctx.other, body: { equipment_id: nb2, due_date: today(3) } });
  await api('PATCH', `/loans/${loan.body.id}/approve`, { token: ctx.admin });

  // Simula o prazo vencido
  getDb().prepare('UPDATE loans SET due_date = ? WHERE id = ?').run(today(-1), loan.body.id);

  const overdue = await api('GET', '/loans?overdue=true', { token: ctx.admin });
  assert.ok(overdue.body.data.some((l) => l.id === loan.body.id && l.overdue));

  const blocked = await api('POST', '/loans', { token: ctx.other, body: { equipment_id: ctx.equipmentId, due_date: today(2) } });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /atraso/);

  const approveEarlier = await api('PATCH', `/loans/${earlier.body.id}/approve`, { token: ctx.admin });
  assert.equal(approveEarlier.status, 409);

  // Após devolver, o bloqueio é removido
  await api('PATCH', `/loans/${loan.body.id}/return`, { token: ctx.admin });
  const unblocked = await api('PATCH', `/loans/${earlier.body.id}/approve`, { token: ctx.admin });
  assert.equal(unblocked.status, 200);
  await api('PATCH', `/loans/${earlier.body.id}/return`, { token: ctx.admin });
});

test('histórico de empréstimos: próprio, por usuário, por equipamento e geral', async () => {
  // Usuário comum: /loans/me e /loans trazem só o dele, mesmo forçando user_id de outro
  const mine = await api('GET', '/loans/me', { token: ctx.user });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.length >= 2);
  assert.ok(mine.body.data.every((l) => l.user_id === ctx.userId));
  const me = (await api('GET', '/auth/me', { token: ctx.other })).body;
  const forced = await api('GET', `/loans?user_id=${ctx.userId}`, { token: ctx.other });
  assert.ok(forced.body.data.every((l) => l.user_id === me.id));

  // Histórico guarda as datas de cada etapa
  const returned = mine.body.data.find((l) => l.status === 'returned');
  assert.ok(returned.approved_at && returned.returned_at);
  assert.equal(returned.approved_by_name, 'Admin');
  const cancelled = mine.body.data.find((l) => l.status === 'cancelled');
  assert.ok(cancelled.cancelled_at);

  // Admin: o próprio histórico é separado do geral
  const adminOwn = await api('GET', '/loans/me', { token: ctx.admin });
  assert.equal(adminOwn.body.pagination.total, 0);

  // Admin: histórico geral, por usuário e por equipamento
  const all = await api('GET', '/loans', { token: ctx.admin });
  assert.ok(all.body.pagination.total > mine.body.pagination.total);
  const byUser = await api('GET', `/users/${ctx.userId}/loans`, { token: ctx.admin });
  assert.equal(byUser.body.pagination.total, mine.body.pagination.total);
  const byEquip = await api('GET', `/equipment/${ctx.equipmentId}/loans`, { token: ctx.admin });
  assert.ok(byEquip.body.data.every((l) => l.equipment_id === ctx.equipmentId));
  assert.equal((await api('GET', `/equipment/${ctx.equipmentId}/loans`, { token: ctx.user })).status, 403);
  assert.equal((await api('GET', `/users/${ctx.userId}/loans`, { token: ctx.user })).status, 403);
  assert.equal((await api('GET', '/users/9999/loans', { token: ctx.admin })).status, 404);

  // Paginação e filtro de período
  const page = await api('GET', '/loans?limit=2&offset=1', { token: ctx.admin });
  assert.equal(page.body.data.length, 2);
  assert.equal(page.body.data[0].id, all.body.data[1].id);
  const future = await api('GET', `/loans?from=${today(1)}`, { token: ctx.admin });
  assert.equal(future.body.pagination.total, 0);
  const todayOnly = await api('GET', `/loans?from=${today(-1)}&to=${today(1)}`, { token: ctx.admin });
  assert.equal(todayOnly.body.pagination.total, all.body.pagination.total);
  assert.equal((await api('GET', `/loans?from=${today(1)}&to=${today()}`, { token: ctx.admin })).status, 400);
});

test('devolução em duas etapas: usuário informa, admin confirma', async () => {
  const equip = await api('POST', '/equipment', {
    token: ctx.admin,
    body: { name: 'Kit Arduino Mega', category: 'Arduino', asset_tag: 'ARD-DEV-1' },
  });
  const loan = await api('POST', '/loans', { token: ctx.other, body: { equipment_id: equip.body.id, due_date: today(5) } });
  const loanId = loan.body.id;

  // Não pode informar devolução de pedido ainda não aprovado
  assert.equal((await api('PATCH', `/loans/${loanId}/return-request`, { token: ctx.other })).status, 409);
  await api('PATCH', `/loans/${loanId}/approve`, { token: ctx.admin });

  // Só o dono informa a devolução
  assert.equal((await api('PATCH', `/loans/${loanId}/return-request`, { token: ctx.user })).status, 404);

  const informed = await api('PATCH', `/loans/${loanId}/return-request`, {
    token: ctx.other,
    body: { return_notes: 'Deixei na bancada 3' },
  });
  assert.equal(informed.status, 200);
  assert.equal(informed.body.status, 'return_pending');
  assert.equal(informed.body.return_notes, 'Deixei na bancada 3');
  assert.ok(informed.body.return_requested_at);

  // Não pode informar duas vezes
  assert.equal((await api('PATCH', `/loans/${loanId}/return-request`, { token: ctx.other })).status, 409);

  // Até a conferência o equipamento continua emprestado e indisponível
  assert.equal((await api('GET', `/equipment/${equip.body.id}`, { token: ctx.user })).body.status, 'loaned');
  const blocked = await api('POST', '/loans', { token: ctx.user, body: { equipment_id: equip.body.id, due_date: today(2) } });
  assert.equal(blocked.status, 409);

  // Atraso continua valendo enquanto o admin não confere
  getDb().prepare('UPDATE loans SET due_date = ? WHERE id = ?').run(today(-1), loanId);
  const stillBlocked = await api('POST', '/loans', {
    token: ctx.other,
    body: { equipment_id: ctx.equipmentId, due_date: today(2) },
  });
  assert.equal(stillBlocked.status, 403);

  // Admin vê o que aguarda conferência e confirma
  const waiting = await api('GET', '/loans?status=return_pending', { token: ctx.admin });
  assert.ok(waiting.body.data.some((l) => l.id === loanId));

  const confirmed = await api('PATCH', `/loans/${loanId}/return`, {
    token: ctx.admin,
    body: { admin_notes: 'Conferido, completo' },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'returned');
  assert.equal(confirmed.body.overdue, false);
  assert.equal((await api('GET', `/equipment/${equip.body.id}`, { token: ctx.user })).body.status, 'available');
});

test('admin registra empréstimo em nome de outro usuário', async () => {
  const equip = await api('POST', '/equipment', {
    token: ctx.admin,
    body: { name: 'Notebook Lenovo', category: 'Notebook', asset_tag: 'NB-BALCAO-1' },
  });
  const body = { equipment_id: equip.body.id, due_date: today(4), user_id: ctx.userId, admin_notes: 'Retirado no balcão' };

  // Usuário comum não pode usar user_id nem admin_notes
  assert.equal((await api('POST', '/loans', { token: ctx.other, body })).status, 403);
  const notesOnly = await api('POST', '/loans', {
    token: ctx.other,
    body: { equipment_id: equip.body.id, due_date: today(4), admin_notes: 'x' },
  });
  assert.equal(notesOnly.status, 403);

  // Usuário inexistente
  const ghost = await api('POST', '/loans', { token: ctx.admin, body: { ...body, user_id: 9999 } });
  assert.equal(ghost.status, 404);

  const res = await api('POST', '/loans', { token: ctx.admin, body });
  assert.equal(res.status, 201);
  assert.equal(res.body.user_id, ctx.userId);
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.created_by_name, 'Admin');
  assert.equal(res.body.approved_by_name, 'Admin');
  assert.ok(res.body.approved_at);
  assert.equal((await api('GET', `/equipment/${equip.body.id}`, { token: ctx.user })).body.status, 'loaned');

  // Aparece no histórico do usuário, não no do admin
  const mine = await api('GET', '/loans/me', { token: ctx.user });
  assert.ok(mine.body.data.some((l) => l.id === res.body.id));
  const adminOwn = await api('GET', '/loans/me', { token: ctx.admin });
  assert.ok(!adminOwn.body.data.some((l) => l.id === res.body.id));

  // Pedido feito pelo próprio usuário registra ele mesmo como autor
  const otherLoans = await api('GET', '/loans/me', { token: ctx.other });
  assert.ok(otherLoans.body.data.length > 0);
  assert.ok(otherLoans.body.data.every((l) => l.created_by_name === 'Outro'));

  // As regras valem para o usuário de destino: equipamento já emprestado e atraso
  assert.equal((await api('POST', '/loans', { token: ctx.admin, body })).status, 409);
  getDb().prepare('UPDATE loans SET due_date = ? WHERE id = ?').run(today(-1), res.body.id);
  const overdue = await api('POST', '/loans', {
    token: ctx.admin,
    body: { ...body, equipment_id: ctx.equipmentId },
  });
  assert.equal(overdue.status, 403);
  assert.match(overdue.body.error, /^Usuário possui empréstimo em atraso/);

  await api('PATCH', `/loans/${res.body.id}/return`, { token: ctx.admin });
});

test('admin gerencia papéis, mas não remove o último admin', async () => {
  assert.equal((await api('GET', '/users', { token: ctx.user })).status, 403);

  const me = await api('GET', '/auth/me', { token: ctx.admin });
  const demote = await api('PATCH', `/users/${me.body.id}/role`, { token: ctx.admin, body: { role: 'user' } });
  assert.equal(demote.status, 409);

  const promote = await api('PATCH', `/users/${ctx.userId}/role`, { token: ctx.admin, body: { role: 'admin' } });
  assert.equal(promote.body.role, 'admin');

  // Mudança de papel vale imediatamente, mesmo com o token antigo
  assert.equal((await api('GET', '/users', { token: ctx.user })).status, 200);
});
