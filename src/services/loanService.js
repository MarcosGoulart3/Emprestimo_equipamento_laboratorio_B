const config = require('../config');
const { getDb, transaction } = require('../db');
const HttpError = require('../utils/httpError');

// Data local no formato YYYY-MM-DD
function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Status em que o equipamento ainda está com o usuário (até o admin conferir a devolução)
const IN_HANDS = "('active', 'return_pending')";

const SELECT_LOAN = `
  SELECT l.*,
         u.name  AS user_name,
         u.email AS user_email,
         e.name  AS equipment_name,
         e.asset_tag AS equipment_asset_tag,
         a.name  AS approved_by_name,
         c.name  AS created_by_name,
         CASE WHEN l.status IN ${IN_HANDS} AND l.due_date < ? THEN 1 ELSE 0 END AS overdue
    FROM loans l
    JOIN users u     ON u.id = l.user_id
    JOIN equipment e ON e.id = l.equipment_id
    LEFT JOIN users a ON a.id = l.approved_by
    LEFT JOIN users c ON c.id = l.created_by`;

function format(loan) {
  return loan && { ...loan, overdue: Boolean(loan.overdue) };
}

function findById(id) {
  return format(getDb().prepare(`${SELECT_LOAN} WHERE l.id = ?`).get(today(), id));
}

function getById(id, user) {
  const loan = findById(id);
  // Usuário comum não pode saber que empréstimos de outros existem
  if (!loan || (user.role !== 'admin' && loan.user_id !== user.id)) {
    throw new HttpError(404, 'Empréstimo não encontrado');
  }
  return loan;
}

// Histórico paginado: { data, pagination: { total, limit, offset } }
function list(user, { status, overdue, user_id, equipment_id, from, to, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  // Usuário comum só enxerga o próprio histórico, independente do filtro enviado
  const ownerId = user.role === 'admin' ? user_id : user.id;
  if (ownerId) {
    where.push('l.user_id = ?');
    params.push(ownerId);
  }
  if (equipment_id) {
    where.push('l.equipment_id = ?');
    params.push(equipment_id);
  }
  if (status) {
    where.push('l.status = ?');
    params.push(status);
  }
  if (overdue === 'true') {
    where.push(`l.status IN ${IN_HANDS} AND l.due_date < ?`);
    params.push(today());
  }
  // requested_at é gravado em UTC; from/to são datas locais
  if (from) {
    where.push("date(l.requested_at, 'localtime') >= ?");
    params.push(from);
  }
  if (to) {
    where.push("date(l.requested_at, 'localtime') <= ?");
    params.push(to);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM loans l ${whereSql}`).get(...params);
  const data = db
    .prepare(`${SELECT_LOAN} ${whereSql} ORDER BY l.requested_at DESC, l.id DESC LIMIT ? OFFSET ?`)
    .all(today(), ...params, limit, offset)
    .map(format);

  return { data, pagination: { total, limit, offset } };
}

function hasOverdueLoan(db, userId) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM loans WHERE user_id = ? AND status IN ${IN_HANDS} AND due_date < ? LIMIT 1`)
      .get(userId, today()),
  );
}

// Regras comuns a qualquer novo empréstimo; `self` ajusta as mensagens (você / o usuário)
function assertCanBorrow(db, borrowerId, { equipment_id, due_date }, self = true) {
  if (hasOverdueLoan(db, borrowerId)) {
    throw new HttpError(
      403,
      self
        ? 'Você possui empréstimo em atraso; devolva o equipamento para solicitar novos empréstimos'
        : 'Usuário possui empréstimo em atraso; é preciso devolver o equipamento antes de um novo empréstimo',
    );
  }

  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id);
  if (!equipment) throw new HttpError(404, 'Equipamento não encontrado');
  if (equipment.status !== 'available') {
    throw new HttpError(409, 'Equipamento indisponível para empréstimo');
  }

  if (due_date < today(1)) {
    throw new HttpError(400, 'A data de devolução deve ser posterior a hoje');
  }
  if (due_date > today(config.maxLoanDays)) {
    throw new HttpError(400, `O prazo máximo de empréstimo é de ${config.maxLoanDays} dias`);
  }

  const { open } = db
    .prepare("SELECT COUNT(*) AS open FROM loans WHERE user_id = ? AND status IN ('pending', 'active', 'return_pending')")
    .get(borrowerId);
  if (open >= config.maxActiveLoansPerUser) {
    throw new HttpError(409, `Limite de ${config.maxActiveLoansPerUser} empréstimos pendentes/ativos atingido`);
  }
}

function request(user, { equipment_id, due_date, purpose }) {
  const db = getDb();
  assertCanBorrow(db, user.id, { equipment_id, due_date });

  const duplicate = db
    .prepare("SELECT 1 FROM loans WHERE user_id = ? AND equipment_id = ? AND status = 'pending'")
    .get(user.id, equipment_id);
  if (duplicate) throw new HttpError(409, 'Você já possui uma solicitação pendente para este equipamento');

  const { lastInsertRowid } = db
    .prepare('INSERT INTO loans (user_id, equipment_id, due_date, purpose, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, equipment_id, due_date, purpose ?? null, user.id);

  return findById(Number(lastInsertRowid));
}

// Admin registra o empréstimo em nome de outro usuário (ex.: entrega no balcão).
// Como o admin já está entregando o equipamento, o empréstimo nasce ativo.
function createOnBehalf(admin, { user_id, equipment_id, due_date, purpose, admin_notes }) {
  const id = transaction((db) => {
    const borrower = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!borrower) throw new HttpError(404, 'Usuário não encontrado');

    assertCanBorrow(db, user_id, { equipment_id, due_date }, false);

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO loans (user_id, equipment_id, due_date, purpose, created_by,
                            status, approved_at, approved_by, admin_notes)
         VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), ?, ?)`,
      )
      .run(user_id, equipment_id, due_date, purpose ?? null, admin.id, admin.id, admin_notes ?? null);
    db.prepare("UPDATE equipment SET status = 'loaned', updated_at = datetime('now') WHERE id = ?").run(equipment_id);

    return Number(lastInsertRowid);
  });
  return findById(id);
}

function getPendingOrFail(db, id) {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
  if (loan.status !== 'pending') {
    throw new HttpError(409, `Empréstimo com status "${loan.status}" não pode ser alterado`);
  }
  return loan;
}

function approve(id, admin, { admin_notes } = {}) {
  transaction((db) => {
    const loan = getPendingOrFail(db, id);

    // Pedido feito antes do atraso também fica bloqueado
    if (hasOverdueLoan(db, loan.user_id)) {
      throw new HttpError(409, 'Solicitante possui empréstimo em atraso');
    }

    const equipment = db.prepare('SELECT status FROM equipment WHERE id = ?').get(loan.equipment_id);
    if (equipment.status !== 'available') {
      throw new HttpError(409, 'Equipamento não está mais disponível');
    }

    db.prepare(
      `UPDATE loans SET status = 'active', approved_at = datetime('now'), approved_by = ?, admin_notes = ?
        WHERE id = ?`,
    ).run(admin.id, admin_notes ?? null, id);
    db.prepare("UPDATE equipment SET status = 'loaned', updated_at = datetime('now') WHERE id = ?").run(
      loan.equipment_id,
    );
  });
  return findById(id);
}

function reject(id, admin, { admin_notes } = {}) {
  transaction((db) => {
    getPendingOrFail(db, id);
    db.prepare(
      "UPDATE loans SET status = 'rejected', rejected_at = datetime('now'), approved_by = ?, admin_notes = ? WHERE id = ?",
    ).run(
      admin.id,
      admin_notes ?? null,
      id,
    );
  });
  return findById(id);
}

function cancel(id, user) {
  transaction((db) => {
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    if (!loan || loan.user_id !== user.id) throw new HttpError(404, 'Empréstimo não encontrado');
    if (loan.status !== 'pending') throw new HttpError(409, 'Apenas solicitações pendentes podem ser canceladas');
    db.prepare("UPDATE loans SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(id);
  });
  return findById(id);
}

// Etapa 1: o próprio usuário avisa que devolveu; o equipamento segue "loaned" até a conferência
function requestReturn(id, user, { return_notes } = {}) {
  transaction((db) => {
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    if (!loan || loan.user_id !== user.id) throw new HttpError(404, 'Empréstimo não encontrado');
    if (loan.status !== 'active') {
      throw new HttpError(409, 'Apenas empréstimos ativos podem ter a devolução informada');
    }
    db.prepare(
      "UPDATE loans SET status = 'return_pending', return_requested_at = datetime('now'), return_notes = ? WHERE id = ?",
    ).run(return_notes ?? null, id);
  });
  return findById(id);
}

// Etapa 2: o admin confere o equipamento e encerra o empréstimo
function registerReturn(id, admin, { admin_notes } = {}) {
  transaction((db) => {
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
    if (!['active', 'return_pending'].includes(loan.status)) {
      throw new HttpError(409, 'Apenas empréstimos ativos podem ser devolvidos');
    }

    db.prepare(
      `UPDATE loans SET status = 'returned', returned_at = datetime('now'),
              admin_notes = COALESCE(?, admin_notes)
        WHERE id = ?`,
    ).run(admin_notes ?? null, id);
    db.prepare("UPDATE equipment SET status = 'available', updated_at = datetime('now') WHERE id = ?").run(
      loan.equipment_id,
    );
  });
  return findById(id);
}

module.exports = { list, getById, request, createOnBehalf, approve, reject, cancel, requestReturn, registerReturn, today };
