import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { SessionsService } from '../../../domains/store/cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../domains/store/cash-registers/movements/movements.service';

/**
 * Familia cash-register de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `SessionsService` y `MovementsService`; sin SQL
 * directo. El scope tenant lo resuelven los servicios (StorePrismaService).
 *
 * Cadena: get_active_cash_session/list_cash_sessions (lecturas
 * habilitantes) → open_cash_session → record_cash_movement →
 * close_cash_session. El cierre es irreversible en la práctica (la sesión
 * cerrada no se reabre): el preview lo marca como `warning` y el flag
 * `irreversible: true` le da su confirmación propia dentro de planes
 * aprobados.
 *
 * Permisos verificados en `sessions.controller.ts`.
 */

export interface CashRegisterToolDeps {
  sessionsService: SessionsService;
  movementsService: MovementsService;
}

const PERM_READ = 'store:cash_registers:read';
const PERM_OPEN = 'store:cash_registers:open_session';
const PERM_CLOSE = 'store:cash_registers:close_session';
const PERM_MOVEMENTS = 'store:cash_registers:movements';

const SESSION_STATUSES = ['open', 'closed', 'suspended'] as const;
const MOVEMENT_TYPES = ['cash_in', 'cash_out'] as const;

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
  domain = 'cash-register',
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

function isDateOnly(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  );
}

function sessionLabel(s: Record<string, any>): string {
  const register =
    s.register?.name !== undefined ? ` — ${s.register.name}` : '';
  return `sesión #${s.id}${register}`;
}

export function createCashRegisterTools(
  deps: CashRegisterToolDeps,
): RegisteredTool[] {
  async function loadSession(id: number): Promise<Record<string, any> | null> {
    try {
      const found = await deps.sessionsService.findOne(id);
      return (found ?? null) as unknown as Record<string, any> | null;
    } catch {
      return null;
    }
  }

  return [
    // ─── get_active_cash_session (READ) ──────────────────────────
    {
      name: 'get_active_cash_session',
      version: '1',
      domain: 'cash-register',
      readOnly: true,
      description:
        'Lee la sesión de caja abierta de la tienda (opcionalmente filtrada por user_id, que es quien la abrió). Úsala para "hay caja abierta" o como lectura habilitante antes de proponer record_cash_movement o close_cash_session.',
      parameters: {
        type: 'object',
        properties: {
          user_id: {
            type: 'number',
            description:
              'Filtra por el usuario que abrió la sesión (opcional).',
          },
        },
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        if (args.user_id !== undefined) {
          const user_id = toPositiveInt(args.user_id);
          if (user_id === null) {
            return {
              error: `user_id inválido: ${String(args.user_id)}.`,
              next_step: 'Pasa el ID numérico del usuario u omítelo.',
            };
          }
          const session =
            await deps.sessionsService.getActiveSession(user_id);
          return { session: (session ?? null) as unknown as Record<string, any> | null };
        }
        const session = await deps.sessionsService.getActiveSession();
        return { session: (session ?? null) as unknown as Record<string, any> | null };
      }),
    },

    // ─── list_cash_sessions (READ) ───────────────────────────────
    {
      name: 'list_cash_sessions',
      version: '1',
      domain: 'cash-register',
      readOnly: true,
      description:
        'Lista sesiones de caja con filtros opcionales (status, cash_register_id, date_from/date_to) y paginación (page, limit máx 100). Úsala para el historial de aperturas y cierres.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [...SESSION_STATUSES],
            description: 'Estado de la sesión.',
          },
          cash_register_id: {
            type: 'number',
            description: 'ID de la caja.',
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
        if (
          typeof args.status === 'string' &&
          (SESSION_STATUSES as readonly string[]).includes(args.status)
        ) {
          query.status = args.status;
        }
        if (args.cash_register_id !== undefined) {
          const register_id = toPositiveInt(args.cash_register_id);
          if (register_id === null) {
            return {
              error: `cash_register_id inválido: ${String(args.cash_register_id)}.`,
              next_step: 'Pasa el ID numérico de la caja.',
            };
          }
          query.cash_register_id = register_id;
        }
        for (const key of ['date_from', 'date_to']) {
          if (args[key] !== undefined) {
            if (!isDateOnly(args[key])) {
              return {
                error: `${key} inválido: ${String(args[key])}.`,
                next_step: 'Usa formato YYYY-MM-DD.',
              };
            }
            query[key] = args[key];
          }
        }
        const result = await deps.sessionsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── open_cash_session (WRITE) ───────────────────────────────
    {
      name: 'open_cash_session',
      version: '1',
      domain: 'cash-register',
      description:
        'Abre una sesión de caja con su base inicial (cash_register_id + opening_amount mayor o igual que cero). Falla si ya hay una sesión abierta para la caja.',
      parameters: {
        type: 'object',
        properties: {
          cash_register_id: { type: 'number', description: 'ID de la caja.' },
          opening_amount: {
            type: 'number',
            description: 'Base inicial en efectivo (>= 0).',
          },
        },
        required: ['cash_register_id', 'opening_amount'],
      },
      requiredPermissions: [PERM_OPEN],
      requiresConfirmation: true,
      preview: async (args) => {
        const register_id = toPositiveInt(args?.cash_register_id);
        if (register_id === null) {
          return previewError(
            'Abrir caja',
            'cash_register_id inválido: consigue las cajas con list_cash_sessions o el módulo de caja.',
          );
        }
        const opening = Number(args?.opening_amount);
        if (!Number.isFinite(opening) || opening < 0) {
          return previewError(
            'Abrir caja',
            'opening_amount debe ser un número mayor o igual que cero.',
          );
        }
        return {
          status: 'ok',
          target: `Abrir caja #${register_id} con base $${opening}`,
          changes: [
            {
              field: 'cash_register_id',
              label: 'Caja',
              from: null,
              to: `#${register_id}`,
            },
            {
              field: 'opening_amount',
              label: 'Base inicial',
              from: null,
              to: opening,
            },
          ],
          domain: 'cash-register',
        };
      },
      handler: guard(async (args) => {
        const register_id = toPositiveInt(args?.cash_register_id);
        if (register_id === null) {
          return {
            error: 'cash_register_id inválido.',
            next_step: 'Pasa el ID numérico de la caja.',
          };
        }
        const opening = Number(args?.opening_amount);
        if (!Number.isFinite(opening) || opening < 0) {
          return {
            error: 'opening_amount debe ser mayor o igual que cero.',
            next_step: 'Pasa la base inicial en efectivo.',
          };
        }
        const opened = await deps.sessionsService.openSession({
          cash_register_id: register_id,
          opening_amount: opening,
        } as any);
        const row = opened as unknown as Record<string, any>;
        return {
          resumen: `${sessionLabel(row)} abierta con base $${opening}.`,
          session_id: row.id,
          resultado: row,
        };
      }),
    },

    // ─── close_cash_session (WRITE, irreversible) ────────────────
    {
      name: 'close_cash_session',
      version: '1',
      domain: 'cash-register',
      description:
        'Cierra una sesión de caja abierta con el arqueo (actual_closing_amount + closing_notes opcionales). IRREVERSIBLE: la sesión cerrada no se reabre y el descuadre queda registrado. Cadena: get_active_cash_session para confirmar cuál está abierta.',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión abierta.',
          },
          actual_closing_amount: {
            type: 'number',
            description: 'Efectivo contado en el arqueo.',
          },
          closing_notes: {
            type: 'string',
            description: 'Notas del cierre (opcional).',
          },
        },
        required: ['session_id', 'actual_closing_amount'],
      },
      requiredPermissions: [PERM_CLOSE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.session_id);
        if (id === null) {
          return previewError(
            'Cerrar caja',
            'session_id inválido: consíguelo con get_active_cash_session.',
          );
        }
        const actual = Number(args?.actual_closing_amount);
        if (!Number.isFinite(actual) || actual < 0) {
          return previewError(
            'Cerrar caja',
            'actual_closing_amount debe ser un número mayor o igual que cero.',
          );
        }
        const session = await loadSession(id);
        if (!session) {
          return previewError(
            `Sesión #${id}`,
            'La sesión no existe o no es visible en esta tienda.',
          );
        }
        if (session.status !== 'open') {
          return previewError(
            sessionLabel(session),
            `Solo se puede cerrar desde open; está en "${session.status}".`,
          );
        }
        return {
          status: 'warning',
          target: `Cerrar ${sessionLabel(session)} con arqueo $${actual}`,
          changes: [
            { field: 'status', label: 'Estado', from: 'open', to: 'closed' },
            {
              field: 'actual_closing_amount',
              label: 'Arqueo',
              from: null,
              to: actual,
            },
          ],
          message:
            'Irreversible: la sesión cerrada no se reabre y el descuadre queda registrado.',
          domain: 'cash-register',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.session_id);
        if (id === null) {
          return {
            error: 'session_id inválido.',
            next_step: 'Consíguelo con get_active_cash_session.',
          };
        }
        const actual = Number(args?.actual_closing_amount);
        if (!Number.isFinite(actual) || actual < 0) {
          return {
            error: 'actual_closing_amount debe ser mayor o igual que cero.',
            next_step: 'Pasa el efectivo contado en el arqueo.',
          };
        }
        const session = await loadSession(id);
        if (!session) {
          return {
            error: `La sesión #${id} no existe.`,
            next_step: 'Elige una sesión existente con list_cash_sessions.',
          };
        }
        if (session.status !== 'open') {
          return {
            error: `${sessionLabel(session)} ya no está abierta (está en "${session.status}").`,
            next_step: 'Lee la sesión activa con get_active_cash_session.',
          };
        }
        const dto: Record<string, any> = { actual_closing_amount: actual };
        if (
          typeof args?.closing_notes === 'string' &&
          args.closing_notes.trim()
        ) {
          dto.closing_notes = args.closing_notes.trim();
        }
        const closed = await deps.sessionsService.closeSession(
          id,
          dto as any,
        );
        const row = closed as unknown as Record<string, any>;
        return {
          resumen: `${sessionLabel({ ...session, ...row })} cerrada con arqueo $${actual}.`,
          session_id: row.id ?? id,
          resultado: row,
        };
      }),
    },

    // ─── record_cash_movement (WRITE) ────────────────────────────
    {
      name: 'record_cash_movement',
      version: '1',
      domain: 'cash-register',
      irreversible: true,
      description:
        'Registra un movimiento manual de efectivo en una sesión abierta: cash_in (ingreso) o cash_out (egreso) con monto, reference y notes opcionales. Cadena: get_active_cash_session para la sesión.',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión abierta.',
          },
          type: {
            type: 'string',
            enum: [...MOVEMENT_TYPES],
            description: 'cash_in para ingreso, cash_out para egreso.',
          },
          amount: {
            type: 'number',
            description: 'Monto del movimiento (mayor que cero).',
          },
          reference: {
            type: 'string',
            description: 'Referencia (opcional).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['session_id', 'type', 'amount'],
      },
      requiredPermissions: [PERM_MOVEMENTS],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.session_id);
        if (id === null) {
          return previewError(
            'Movimiento de caja',
            'session_id inválido: consíguelo con get_active_cash_session.',
          );
        }
        if (
          typeof args?.type !== 'string' ||
          !(MOVEMENT_TYPES as readonly string[]).includes(args.type)
        ) {
          return previewError(
            'Movimiento de caja',
            'type debe ser cash_in (ingreso) o cash_out (egreso).',
          );
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return previewError(
            'Movimiento de caja',
            'amount debe ser un número mayor que cero.',
          );
        }
        const session = await loadSession(id);
        if (!session) {
          return previewError(
            `Sesión #${id}`,
            'La sesión no existe o no es visible en esta tienda.',
          );
        }
        if (session.status !== 'open') {
          return previewError(
            sessionLabel(session),
            `Solo se mueve en sesiones open; está en "${session.status}".`,
          );
        }
        const kind = args.type === 'cash_in' ? 'Ingreso' : 'Egreso';
        return {
          status: 'ok',
          target: `${kind} $${amount} en ${sessionLabel(session)}`,
          changes: [
            {
              field: 'type',
              label: 'Tipo',
              from: null,
              to: args.type === 'cash_in' ? 'ingreso' : 'egreso',
            },
            { field: 'amount', label: 'Monto', from: null, to: amount },
          ],
          domain: 'cash-register',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.session_id);
        if (id === null) {
          return {
            error: 'session_id inválido.',
            next_step: 'Consíguelo con get_active_cash_session.',
          };
        }
        if (
          typeof args?.type !== 'string' ||
          !(MOVEMENT_TYPES as readonly string[]).includes(args.type)
        ) {
          return {
            error: 'type debe ser cash_in o cash_out.',
            next_step: 'cash_in para ingreso, cash_out para egreso.',
          };
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            error: 'amount debe ser mayor que cero.',
            next_step: 'Pasa el monto del movimiento.',
          };
        }
        const session = await loadSession(id);
        if (!session) {
          return {
            error: `La sesión #${id} no existe.`,
            next_step: 'Elige una sesión existente con list_cash_sessions.',
          };
        }
        if (session.status !== 'open') {
          return {
            error: `${sessionLabel(session)} ya no está abierta (está en "${session.status}").`,
            next_step: 'Lee la sesión activa con get_active_cash_session.',
          };
        }
        const movement = await deps.movementsService.createManualMovement(
          id,
          {
            type: args.type as 'cash_in' | 'cash_out',
            amount,
            ...(typeof args?.reference === 'string' && args.reference.trim()
              ? { reference: args.reference.trim() }
              : {}),
            ...(typeof args?.notes === 'string' && args.notes.trim()
              ? { notes: args.notes.trim() }
              : {}),
          },
        );
        const row = movement as unknown as Record<string, any>;
        const kind = args.type === 'cash_in' ? 'Ingreso' : 'Egreso';
        return {
          resumen: `${kind} $${amount} registrado en ${sessionLabel(session)}.`,
          movement_id: row.id,
          session_id: id,
        };
      }),
    },
  ];
}
