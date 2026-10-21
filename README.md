# API de Empréstimo de Equipamentos de Laboratório

API REST em Node.js + SQLite para controlar empréstimos de equipamentos do laboratório do campus (notebooks, kits Arduino etc.), com dois papéis: **usuário comum** e **administrador**.

## Tecnologias

- Node.js ≥ 22.12 com `node:sqlite` (SQLite embutido, sem compilação nativa)
- Express 5, JWT (`jsonwebtoken`), `bcryptjs`, validação com `zod`
- Segurança: `helmet`, rate limit em login/cadastro, consultas parametrizadas

> No Node 22.12 o `node:sqlite` exige a flag `--experimental-sqlite`, que já está nos scripts do `package.json`.

## Como rodar

```bash
npm install
cp .env.example .env      # edite JWT_SECRET e os dados do admin
npm run seed              # cria o admin inicial e equipamentos de exemplo
npm run dev               # http://localhost:3000
npm test                  # testes de integração (banco em memória)
```

## Papéis

| Ação | Usuário | Admin |
|---|:-:|:-:|
| Ver equipamentos | ✅ | ✅ |
| Solicitar / cancelar empréstimo próprio | ✅ | ✅ |
| Informar devolução do próprio empréstimo | ✅ | ✅ |
| Ver empréstimos | só os seus | todos |
| Cadastrar / editar / remover equipamento | ❌ | ✅ |
| Aprovar, recusar e confirmar devolução | ❌ | ✅ |
| Registrar empréstimo em nome de outro usuário | ❌ | ✅ |
| Gerenciar usuários e papéis | ❌ | ✅ |

O cadastro público sempre cria usuário comum. Admins são criados pelo `npm run seed` ou promovidos por outro admin.

## Fluxo do empréstimo

```
pending ──approve──▶ active ──return-request──▶ return_pending ──return──▶ returned
   │      (admin)  (equip. loaned)  (usuário)    (equip. loaned)   (admin)  (equip. available)
   │                  │                                             ▲
   │                  └────────────────return (admin)───────────────┘
   ├──reject──▶ rejected    (admin)
   └──cancel──▶ cancelled   (pelo próprio usuário)
```

Quando o admin registra um empréstimo em nome de outro usuário (ex.: retirada no balcão), ele já nasce `active`, com o admin como aprovador. As regras de prazo, limite, disponibilidade e bloqueio por atraso valem para o usuário de destino. O campo `created_by_name` indica quem registrou cada empréstimo.

A devolução é feita em duas etapas: o usuário informa que devolveu (`return-request`, com observação opcional) e o admin confere o equipamento e confirma (`return`). Enquanto não há confirmação, o equipamento segue indisponível e o atraso continua contando. O admin também pode confirmar direto de `active`, quando recebe o equipamento no balcão.

Regras: equipamento precisa estar `available`; devolução prevista entre amanhã e `MAX_LOAN_DAYS` dias; no máximo `MAX_ACTIVE_LOANS` solicitações pendentes/ativas por usuário; usuário com empréstimo em atraso fica bloqueado (não solicita nem tem pedidos aprovados) até devolver o equipamento. Um índice único no banco impede dois empréstimos ativos do mesmo equipamento.

## Endpoints

Todas as rotas (exceto `/health`, `/auth/register` e `/auth/login`) exigem `Authorization: Bearer <token>`.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/auth/register` | público | `{ name, email, password }` |
| POST | `/auth/login` | público | `{ email, password }` → `{ user, token }` |
| GET | `/auth/me` | logado | Dados do usuário atual |
| GET | `/equipment` | logado | Filtros: `?status=&category=&search=` |
| GET | `/equipment/:id` | logado | |
| GET | `/equipment/:id/loans` | admin | Histórico de empréstimos do equipamento |
| POST | `/equipment` | admin | `{ name, category, asset_tag, description? }` |
| PATCH | `/equipment/:id` | admin | Campos parciais; `status`: `available`, `maintenance`, `inactive` |
| DELETE | `/equipment/:id` | admin | Só sem histórico de empréstimos |
| GET | `/loans` | logado | Histórico: usuário vê o seu, admin vê todos (aceita `user_id`) |
| GET | `/loans/me` | logado | Histórico do próprio usuário (inclusive admin) |
| GET | `/loans/:id` | dono/admin | |
| POST | `/loans` | logado | `{ equipment_id, due_date: "AAAA-MM-DD", purpose? }` → `pending` |
| POST | `/loans` | admin | Em nome de outro usuário: `{ user_id, equipment_id, due_date, purpose?, admin_notes? }` → já nasce `active` |
| PATCH | `/loans/:id/cancel` | dono | Cancela solicitação pendente |
| PATCH | `/loans/:id/return-request` | dono | Informa a devolução `{ return_notes? }` → `return_pending` |
| PATCH | `/loans/:id/approve` | admin | `{ admin_notes? }` |
| PATCH | `/loans/:id/reject` | admin | `{ admin_notes? }` |
| PATCH | `/loans/:id/return` | admin | Confirma o recebimento `{ admin_notes? }` → `returned` |
| GET | `/users` | admin | |
| GET | `/users/:id` | admin | |
| GET | `/users/:id/loans` | admin | Histórico de empréstimos do usuário |
| PATCH | `/users/:id/role` | admin | `{ role: "user" \| "admin" }` (não remove o último admin) |

### Histórico de empréstimos

Todas as rotas de histórico (`/loans`, `/loans/me`, `/users/:id/loans`, `/equipment/:id/loans`) aceitam os mesmos filtros:

| Parâmetro | Descrição |
|---|---|
| `status` | `pending`, `active`, `return_pending`, `returned`, `rejected`, `cancelled` |
| `overdue=true` | Apenas `active`/`return_pending` com prazo vencido |
| `equipment_id`, `user_id` | Filtra por equipamento / usuário (`user_id` só para admin) |
| `from`, `to` | Período pela data da solicitação (`AAAA-MM-DD`, inclusivo) |
| `limit`, `offset` | Paginação (padrão 50, máximo 200) |

Resposta:

```json
{
  "data": [
    {
      "id": 1, "status": "returned", "user_name": "Aluno", "equipment_name": "Kit Arduino Uno",
      "requested_at": "...", "approved_at": "...", "approved_by_name": "Admin",
      "returned_at": "...", "rejected_at": null, "cancelled_at": null, "overdue": false
    }
  ],
  "pagination": { "total": 1, "limit": 50, "offset": 0 }
}
```

Datas de registro (`requested_at`, `approved_at` etc.) são gravadas em UTC; os filtros `from`/`to` usam a data local do servidor.

## Banco de dados e migrações

`src/db/schema.sql` cria as tabelas em um banco novo. Colunas adicionadas depois que o banco já existe são aplicadas automaticamente ao iniciar a API, pela função `migrate` em `src/db/index.js`, sem apagar dados.

## Estrutura

```
src/
  app.js, server.js, config.js
  db/            conexão, schema.sql e helper de transação
  middlewares/   autenticação/papéis, validação, tratamento de erros
  routes/        definição dos endpoints
  services/      regras de negócio e SQL
  utils/         schemas zod, HttpError
scripts/seed.js  admin inicial + equipamentos de exemplo
test/            testes de integração (node:test)
```
