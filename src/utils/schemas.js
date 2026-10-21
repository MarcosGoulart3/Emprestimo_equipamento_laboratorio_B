const { z } = require('zod');

const EQUIPMENT_STATUS = ['available', 'loaned', 'maintenance', 'inactive'];
const LOAN_STATUS = ['pending', 'active', 'return_pending', 'returned', 'rejected', 'cancelled'];

const idParam = z.object({ id: z.coerce.number().int().positive() });

const register = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(150).transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(72),
});

const login = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(72),
});

const equipmentCreate = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(50),
  asset_tag: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500).optional(),
});

// 'loaned' só é definido pelo fluxo de empréstimo, não manualmente
const equipmentUpdate = equipmentCreate.partial().extend({
  status: z.enum(['available', 'maintenance', 'inactive']).optional(),
});

const equipmentQuery = z.object({
  status: z.enum(EQUIPMENT_STATUS).optional(),
  category: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
});

const loanCreate = z.object({
  equipment_id: z.number().int().positive(),
  due_date: z.iso.date(),
  purpose: z.string().trim().max(300).optional(),
  // Somente admin: registra o empréstimo em nome deste usuário
  user_id: z.number().int().positive().optional(),
  admin_notes: z.string().trim().max(300).optional(),
});

const loanQuery = z
  .object({
    status: z.enum(LOAN_STATUS).optional(),
    overdue: z.enum(['true', 'false']).optional(),
    user_id: z.coerce.number().int().positive().optional(),
    equipment_id: z.coerce.number().int().positive().optional(),
    // Período pela data da solicitação (inclusivo)
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" deve ser anterior a "to"', path: ['from'] });

const loanDecision = z.object({
  admin_notes: z.string().trim().max(300).optional(),
});

const returnRequest = z.object({
  return_notes: z.string().trim().max(300).optional(),
});

const roleUpdate = z.object({ role: z.enum(['user', 'admin']) });

module.exports = {
  idParam,
  register,
  login,
  equipmentCreate,
  equipmentUpdate,
  equipmentQuery,
  loanCreate,
  loanQuery,
  loanDecision,
  returnRequest,
  roleUpdate,
};
