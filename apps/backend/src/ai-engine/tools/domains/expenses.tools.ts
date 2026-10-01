import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { ExpensesService } from '../../../domains/store/expenses/expenses.service';
import { ExpenseFlowService } from '../../../domains/store/expenses/expense-flow/expense-flow.service';

/**
 * Familia expenses de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `ExpensesService` (lecturas y registro) y
 * `ExpenseFlowService.approve` (aprobación, igual que el endpoint
 * `POST store/expenses/:id/approve`); sin SQL directo. El scope tenant lo
 * resuelven los servicios (StorePrismaService).
 *
 * Cadena: list_expenses/get_expense (lecturas habilitantes) →
 * approve_expense (solo desde `pending`). El handler re-verifica el estado:
 * el preview es proyección, no transacción.
 *
 * Permisos verificados en `expenses.controller.ts`.
 */

export interface ExpenseToolDeps {
  expensesService: ExpensesService;
  expenseFlowService: ExpenseFlowService;
}

const PERM_READ = 'store:expenses:read';
const PERM_CREATE = 'store:expenses:create';
const PERM_APPROVE = 'store:expenses:approve';

const EXPENSE_STATES = [
  'pending',
  'approved',
  'rejected',
  'paid',
  'cancelled',
  'refunded',
] as const;

function describeError(error: any): string {
  const detail = error?.response?.message ?? error?.message ?? String(error);
  return Array.isArray(detail) ? detail.join('; ') : String(detail);
}

const guard =
  (
    fn: (
      args: Record<string, any>,
      context: ToolExecutionContext,
    ) => Promise<Record<string, any>>,
  ) =>
  async (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<string> => {
    try {
      return JSON.stringify(await fn(args ?? {}, context));
    } catch (error: any) {
      return JSON.stringify({ error: describeError(error) });
    }
  };

function previewError(
  target: string,
  message: string,
  domain = 'expenses',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function expenseLabel(e: Record<string, any>): string {
  const desc = typeof e.description === 'string' && e.description.trim()
    ? ` — ${e.description.trim().slice(0, 60)}`
    : '';
  return `gasto #${e.id}${desc}`;
}

function isDateOnly(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  );
}

export function createExpenseTools(deps: ExpenseToolDeps): RegisteredTool[] {
  async function loadExpense(id: number): Promise<Record<string, any> | null> {
    try {
      const found = await deps.expensesService.findOne(id);
      return (found ?? null) as unknown as Record<string, any> | null;
    } catch {
      return null;
    }
  }

  return [
    // ─── list_expenses (READ) ────────────────────────────────────
    {
      name: 'list_expenses',
      version: '1',
      domain: 'expenses',
      readOnly: true,
      description:
        'Lista gastos con filtros opcionales (search, state, category_id, date_from/date_to) y paginación (page, limit máx 100). Úsala para "qué gastos hay pendientes" o como lectura habilitante antes de proponer approve_expense.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a buscar.' },
          state: {
            type: 'string',
            enum: [...EXPENSE_STATES],
            description: 'Estado del gasto.',
          },
          category_id: {
            type: 'number',
            description: 'ID de la categoría de gasto.',
          },
          date_from: { type: 'string', description: 'Desde (YYYY-MM-DD).' },
          date_to: { type: 'string', description: 'Hasta (YYYY-MM-DD).' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        if (
          typeof args.state === 'string' &&
          (EXPENSE_STATES as readonly string[]).includes(args.state)
        ) {
          query.state = args.state;
        }
        if (args.category_id !== undefined) {
          const category_id = toPositiveInt(args.category_id);
          if (category_id === null) {
            return {
              error: `category_id inválido: ${String(args.category_id)}.`,
              next_step: 'Pasa el ID numérico de la categoría.',
            };
          }
          query.category_id = category_id;
        }
        if (args.date_from !== undefined) {
          if (!isDateOnly(args.date_from)) {
            return {
              error: `date_from inválido: ${String(args.date_from)}.`,
              next_step: 'Usa formato YYYY-MM-DD.',
            };
          }
          query.date_from = args.date_from;
        }
        if (args.date_to !== undefined) {
          if (!isDateOnly(args.date_to)) {
            return {
              error: `date_to inválido: ${String(args.date_to)}.`,
              next_step: 'Usa formato YYYY-MM-DD.',
            };
          }
          query.date_to = args.date_to;
        }
        const result = await deps.expensesService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_expense (READ) ──────────────────────────────────────
    {
      name: 'get_expense',
      version: '1',
      domain: 'expenses',
      readOnly: true,
      description:
        'Lee el detalle de un gasto: estado, monto, categoría, fecha y comprobante. Cadena obligatoria antes de approve_expense.',
      parameters: {
        type: 'object',
        properties: {
          expense_id: { type: 'number', description: 'ID del gasto.' },
        },
        required: ['expense_id'],
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.expense_id);
        if (id === null) {
          return {
            error: `expense_id inválido: ${String(args.expense_id)}.`,
            next_step: 'Pasa el ID numérico del gasto.',
          };
        }
        const found = await deps.expensesService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── create_expense (WRITE) ──────────────────────────────────
    {
      name: 'create_expense',
      version: '1',
      domain: 'expenses',
      description:
        'Registra un gasto en estado pending (monto mayor que cero, expense_date YYYY-MM-DD, description y category_id opcionales). Nace pendiente; se aprueba con approve_expense.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Monto del gasto (mayor que cero).',
          },
          expense_date: {
            type: 'string',
            description: 'Fecha del gasto (YYYY-MM-DD).',
          },
          description: {
            type: 'string',
            description: 'Descripción del gasto (opcional).',
          },
          category_id: {
            type: 'number',
            description: 'ID de la categoría (opcional).',
          },
          currency: {
            type: 'string',
            description: 'Moneda ISO (opcional).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['amount', 'expense_date'],
      },
      requiredPermissions: [PERM_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return previewError(
            'Nuevo gasto',
            'amount debe ser un número mayor que cero.',
          );
        }
        if (!isDateOnly(args?.expense_date)) {
          return previewError(
            'Nuevo gasto',
            'expense_date debe tener formato YYYY-MM-DD.',
          );
        }
        const subject =
          typeof args?.description === 'string' && args.description.trim()
            ? args.description.trim().slice(0, 60)
            : 'gasto';
        return {
          status: 'ok',
          target: `Nuevo gasto — ${subject} ($${amount})`,
          changes: [
            { field: 'amount', label: 'Monto', from: null, to: amount },
            {
              field: 'expense_date',
              label: 'Fecha',
              from: null,
              to: args.expense_date,
            },
            {
              field: 'description',
              label: 'Descripción',
              from: null,
              to: args?.description ?? '—',
            },
          ],
          message: 'El gasto nace en pending; otro paso lo aprueba.',
          domain: 'expenses',
        };
      },
      handler: guard(async (args) => {
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            error: 'amount debe ser un número mayor que cero.',
            next_step: 'Pasa el monto del gasto.',
          };
        }
        if (!isDateOnly(args?.expense_date)) {
          return {
            error: `expense_date inválido: ${String(args?.expense_date)}.`,
            next_step: 'Usa formato YYYY-MM-DD.',
          };
        }
        const dto: Record<string, any> = {
          amount,
          expense_date: args.expense_date,
        };
        if (args?.category_id !== undefined) {
          const category_id = toPositiveInt(args.category_id);
          if (category_id === null) {
            return {
              error: `category_id inválido: ${String(args.category_id)}.`,
              next_step: 'Pasa el ID numérico de la categoría u omítelo.',
            };
          }
          dto.category_id = category_id;
        }
        for (const key of ['description', 'currency', 'notes']) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] = args[key];
          }
        }
        const created = await deps.expensesService.create(dto as any);
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `${expenseLabel(row)} registrado por $${amount}.`,
          expense_id: row.id,
          resultado: row,
        };
      }),
    },

    // ─── approve_expense (WRITE) ─────────────────────────────────
    {
      name: 'approve_expense',
      version: '1',
      domain: 'expenses',
      description:
        'Aprueba un gasto en pending (pending→approved). Dispara el asiento contable expense.approved. Cadena: get_expense para confirmar que está en pending.',
      parameters: {
        type: 'object',
        properties: {
          expense_id: {
            type: 'number',
            description: 'ID del gasto en pending.',
          },
        },
        required: ['expense_id'],
      },
      requiredPermissions: [PERM_APPROVE],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.expense_id);
        if (id === null) {
          return previewError(
            'Aprobar gasto',
            'expense_id inválido: consíguelo con list_expenses.',
          );
        }
        const expense = await loadExpense(id);
        if (!expense) {
          return previewError(
            `Gasto #${id}`,
            'El gasto no existe o no es visible en esta tienda.',
          );
        }
        if (expense.state !== 'pending') {
          return previewError(
            expenseLabel(expense),
            `Solo se puede aprobar desde pending; está en "${expense.state}".`,
          );
        }
        return {
          status: 'ok',
          target: `Aprobar ${expenseLabel(expense)} ($${expense.amount})`,
          changes: [
            {
              field: 'state',
              label: 'Estado',
              from: 'pending',
              to: 'approved',
            },
          ],
          domain: 'expenses',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.expense_id);
        if (id === null) {
          return {
            error: 'expense_id inválido.',
            next_step: 'Consíguelo con list_expenses.',
          };
        }
        const expense = await loadExpense(id);
        if (!expense) {
          return {
            error: `El gasto #${id} no existe.`,
            next_step: 'Elige un gasto existente con list_expenses.',
          };
        }
        if (expense.state !== 'pending') {
          return {
            error: `${expenseLabel(expense)} ya no está en pending (está en "${expense.state}").`,
            next_step: 'Lee el estado actual con get_expense.',
          };
        }
        const approved = await deps.expenseFlowService.approve(id);
        const row = approved as unknown as Record<string, any>;
        return {
          resumen: `${expenseLabel(row)} aprobado.`,
          expense_id: row.id ?? id,
          estado: row.state ?? 'approved',
        };
      }),
    },
  ];
}
