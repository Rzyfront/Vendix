import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { SessionsService } from '../../../domains/store/cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../domains/store/cash-registers/movements/movements.service';
import { CloseSessionDto } from '../../../domains/store/cash-registers/dto/close-session.dto';
import {
  buildDiscrepancySignal,
  DISCREPANCY_ACK_PARAMETERS,
  discrepancyPreviewMessage,
  DiscrepancySignal,
  exceedsTolerance,
  moneyTolerance,
  readDiscrepancyAck,
} from '../discrepancy-signal';

/**
 * Familia cash-register de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `SessionsService` y `MovementsService`; sin SQL
 * directo. El scope tenant lo resuelven los servicios (StorePrismaService).
 *
 * Cadena: get_active_cash_session/list_cash_sessions (lecturas
 * habilitantes) → open_cash_session → record_cash_movement →
 * close_cash_session. Análisis de un cierre (solo lectura):
 * list_cash_sessions → get_cash_session_close_report →
 * list_cash_session_movements. El cierre es irreversible en la práctica (la sesión
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

/**
 * Vocabulario de operación con el que la gente pide revisar un cierre
 * ("no me dio", "me faltó plata", "descuadre"). El router B es léxico sobre
 * nombre/descripción/sinónimos y los nombres de las tools están en inglés:
 * sin estos términos, "me ayudas a analizar un cierre de caja que no me
 * dio?" empataba con herramientas fiscales y de contabilidad y las lecturas
 * de caja podían quedar fuera del top-K12. Solo lecturas: la jerga de
 * análisis no debe empujar escrituras al working set.
 */
const CASH_ANALYSIS_SYNONYMS = [
  'analizar cierre de caja',
  'revisar cierre de caja',
  'arqueo de caja',
  'cuadre de caja',
  'descuadre de caja',
  'la caja no me dio',
  'no cuadra la caja',
  'faltante de caja',
  'sobrante de caja',
  'diferencia de caja',
  'plata del cajon',
  'efectivo esperado contado declarado',
  'turno de caja',
];

/** Techo de filas por lectura: el modelo pagina, no recibe la sesión entera. */
const MAX_OUTFLOWS = 50;

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
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function sessionLabel(s: Record<string, any>): string {
  const register =
    s.register?.name !== undefined ? ` — ${s.register.name}` : '';
  return `sesión #${s.id}${register}`;
}

/** Moneda de las cifras de caja: las sesiones no guardan moneda propia. */
const CASH_CURRENCY = 'COP';

const CASH_SHORTAGE_CAUSES = [
  'Órdenes canceladas o anuladas que no se registraron en la caja.',
  'Reembolsos o devoluciones en efectivo que no se registraron.',
  'Salidas de efectivo sin registrar: pagos a proveedores o domiciliarios, retiros o gastos menores.',
  'Pagos cobrados con tarjeta o transferencia que quedaron como efectivo, o al revés.',
  'Ventas hechas por fuera del sistema o sin registrar.',
  'Error de conteo: billetes, monedas o la base inicial.',
];

const CASH_SURPLUS_CAUSES = [
  'Ventas en efectivo que no se registraron en el sistema.',
  'Entradas de efectivo sin registrar (abonos, cambio que se trajo, préstamos).',
  'Pagos en efectivo que quedaron registrados como tarjeta o transferencia.',
  'Base inicial mal contada al abrir la caja.',
  'Cambio que no se le entregó a algún cliente.',
];

const CASH_SHORTAGE_QUESTIONS = [
  '¿Sabes a qué se debe la diferencia?',
  '¿Se pagó algo en efectivo desde la caja (proveedor, domiciliario, un gasto) sin registrarlo?',
  '¿Hubo alguna venta anulada, devolución o reembolso en efectivo durante el turno?',
  '¿Algún pago con tarjeta o transferencia pudo quedar como efectivo?',
];

const CASH_SURPLUS_QUESTIONS = [
  '¿Sabes a qué se debe la diferencia?',
  '¿Hubo alguna venta en efectivo que no se alcanzó a registrar?',
  '¿Entró dinero a la caja sin registrarlo, por ejemplo un abono o cambio?',
  '¿Algún pago en efectivo pudo quedar registrado como tarjeta o transferencia?',
];

const DISCREPANCY_MISSING_REASON =
  'Falta el motivo de la diferencia: pregúntale a la persona, con sus palabras, a qué se debe (o si decidió continuar sin saberlo) y pásalo en discrepancy_reason. No lo inventes.';

function formatCashAmount(value: number): string {
  return `$${(Math.round(Math.abs(value) * 100) / 100).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Línea que queda en las notas del cierre cuando hubo diferencia revisada. */
function discrepancyClosingLine(
  signal: DiscrepancySignal,
  reason: string,
): string {
  const kind = signal.direction === 'shortage' ? 'faltante' : 'sobrante';
  return `Diferencia de arqueo (${kind} de ${formatCashAmount(signal.difference)}): ${reason}`;
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

  /**
   * Pre-verificación guiada del arqueo. Fail-open: si el esperado no se puede
   * leer, el cierre sigue como siempre — la compuerta acompaña, no protege.
   */
  async function loadCashDiscrepancy(
    id: number,
    actual: number,
  ): Promise<DiscrepancySignal | null> {
    let expected: number;
    try {
      const summary = await deps.sessionsService.getCashSummary(id);
      expected = Number(summary?.expected_cash_total);
    } catch {
      return null;
    }
    if (!Number.isFinite(expected)) return null;
    const tolerance = moneyTolerance(expected);
    if (!exceedsTolerance(actual - expected, tolerance)) return null;
    const shortage = actual < expected;
    return buildDiscrepancySignal({
      process: 'cash_close',
      unit: CASH_CURRENCY,
      expected,
      actual,
      tolerance,
      subject: 'Arqueo de la caja',
      causes_to_check: shortage ? CASH_SHORTAGE_CAUSES : CASH_SURPLUS_CAUSES,
      reads_to_run: [
        'get_cash_session_close_report',
        'list_cash_session_movements',
        'list_orders',
      ],
      guide_questions: shortage
        ? CASH_SHORTAGE_QUESTIONS
        : CASH_SURPLUS_QUESTIONS,
    });
  }

  async function loadPendingOrdersBlock(sessionId: number) {
    const pending = await deps.sessionsService.getPendingOrders(sessionId, {
      limit: 100,
      page: 1,
    });
    const count = Number(pending.count ?? 0);
    if (count <= 0) return null;
    return {
      data: pending.data ?? [],
      count,
      fingerprint: pending.fingerprint,
      ...(count > 100
        ? {
            pagination: {
              page: Number(pending.page ?? 1),
              limit: Number(pending.limit ?? 100),
              total_pages: Math.ceil(count / 100),
            },
          }
        : {}),
    };
  }

  function pendingOrdersNextStep(): string {
    return 'Gestiona las órdenes pendientes para usar pending_decision="resolved", o elige explícitamente pending_decision="override" con un motivo y el fingerprint actual.';
  }

  function pendingOrdersMessage(
    pending: NonNullable<Awaited<ReturnType<typeof loadPendingOrdersBlock>>>,
  ): string {
    const orders = pending.data
      .map((order: Record<string, any>) =>
        order.order_number
          ? `${order.order_number} (#${order.id})`
          : `#${order.id}`,
      )
      .join(', ');
    return `No se puede cerrar la caja: hay ${pending.count} orden(es) pendiente(s)${orders ? ` (${orders})` : ''}. Fingerprint: ${pending.fingerprint}. ${pendingOrdersNextStep()}`;
  }

  function validatePendingDecision(args: Record<string, any>): string | null {
    const decision = args.pending_decision;
    if (decision === undefined) return null;
    if (decision !== 'resolved' && decision !== 'override') {
      return 'pending_decision inválida: elige "resolved" o "override".';
    }
    if (
      typeof args.pending_fingerprint !== 'string' ||
      !args.pending_fingerprint.trim()
    ) {
      return 'pending_fingerprint es obligatorio para una decisión explícita.';
    }
    if (
      decision === 'override' &&
      (typeof args.override_reason !== 'string' || !args.override_reason.trim())
    ) {
      return 'override_reason es obligatorio para elegir override.';
    }
    if (
      args.override_reason !== undefined &&
      typeof args.override_reason !== 'string'
    ) {
      return 'override_reason debe ser texto.';
    }
    return null;
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
      discovery: {
        synonyms: CASH_ANALYSIS_SYNONYMS,
        dependencies: ['get_cash_session_close_report'],
      },
      handler: guard(async (args) => {
        if (args.user_id !== undefined) {
          const user_id = toPositiveInt(args.user_id);
          if (user_id === null) {
            return {
              error: `user_id inválido: ${String(args.user_id)}.`,
              next_step: 'Pasa el ID numérico del usuario u omítelo.',
            };
          }
          const session = await deps.sessionsService.getActiveSession(user_id);
          return {
            session: (session ?? null) as unknown as Record<string, any> | null,
          };
        }
        const session = await deps.sessionsService.getActiveSession();
        return {
          session: (session ?? null) as unknown as Record<string, any> | null,
        };
      }),
    },

    // ─── list_cash_sessions (READ) ───────────────────────────────
    {
      name: 'list_cash_sessions',
      version: '1',
      domain: 'cash-register',
      readOnly: true,
      description:
        'Lista sesiones de caja con filtros opcionales (status, cash_register_id, date_from/date_to) y paginación (page, limit máx 100). Úsala para el historial de aperturas y cierres, o para ubicar el cierre de caja que la persona quiere revisar antes de leer su reporte con get_cash_session_close_report.',
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
      discovery: {
        synonyms: CASH_ANALYSIS_SYNONYMS,
        dependencies: [
          'get_cash_session_close_report',
          'list_cash_session_movements',
        ],
      },
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

    // ─── get_cash_session_close_report (READ) ────────────────────
    {
      name: 'get_cash_session_close_report',
      version: '1',
      domain: 'cash-register',
      readOnly: true,
      description:
        'Reporte de cierre (arqueo) de UNA sesión de caja, abierta o cerrada: efectivo esperado vs contado/declarado y su diferencia (faltante o sobrante), consolidado por método de pago, salidas de efectivo (reembolsos, anulaciones, retiros) con su motivo, resumen de ventas, devoluciones, descuentos, saldo por cobrar e integridad de ventas. Úsala para analizar un cierre de caja que no cuadró o "no le dio" a la persona. Las cifras son las del backend: no las recalcules. Si no sabes el session_id, ubícalo antes con list_cash_sessions.',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión de caja a revisar.',
          },
        },
        required: ['session_id'],
      },
      requiredPermissions: [PERM_READ],
      discovery: {
        synonyms: CASH_ANALYSIS_SYNONYMS,
        dependencies: ['list_cash_sessions', 'list_cash_session_movements'],
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args.session_id);
        if (id === null) {
          return {
            error: `session_id inválido: ${String(args.session_id)}.`,
            next_step:
              'Ubica la sesión con list_cash_sessions y pasa su ID numérico.',
          };
        }
        const report = (await deps.sessionsService.getCloseReport(
          id,
        )) as unknown as Record<string, any>;
        const outflows: unknown[] = Array.isArray(report?.outflows)
          ? report.outflows
          : [];
        return {
          ...report,
          outflows: outflows.slice(0, MAX_OUTFLOWS),
          ...(outflows.length > MAX_OUTFLOWS
            ? {
                outflows_total: outflows.length,
                outflows_truncated: true,
                next_step:
                  'Hay más salidas de efectivo: léelas por páginas con list_cash_session_movements.',
              }
            : {}),
        };
      }),
    },

    // ─── list_cash_session_movements (READ) ──────────────────────
    {
      name: 'list_cash_session_movements',
      version: '1',
      domain: 'cash-register',
      readOnly: true,
      description:
        'Lista, en orden cronológico y paginada (page, limit máx 100), los movimientos de UNA sesión de caja: ventas, ingresos y egresos manuales, reembolsos y anulaciones, con método de pago, monto, orden asociada y quién lo registró. Úsala para encontrar el movimiento que explica un faltante o sobrante del cierre de caja.',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión de caja.',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 20, máx 100).',
          },
        },
        required: ['session_id'],
      },
      requiredPermissions: [PERM_MOVEMENTS],
      discovery: {
        synonyms: CASH_ANALYSIS_SYNONYMS,
        dependencies: ['get_cash_session_close_report'],
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args.session_id);
        if (id === null) {
          return {
            error: `session_id inválido: ${String(args.session_id)}.`,
            next_step:
              'Ubica la sesión con list_cash_sessions y pasa su ID numérico.',
          };
        }
        const page = clampPage(args.page);
        const limit = clampLimit(args.limit, 20);
        const rows = (await deps.movementsService.findBySession(
          id,
        )) as unknown as Record<string, any>[];
        const all = Array.isArray(rows) ? rows : [];
        const total_pages = Math.max(1, Math.ceil(all.length / limit));
        return {
          session_id: id,
          data: all.slice((page - 1) * limit, page * limit),
          meta: { total: all.length, page, limit, total_pages },
          has_more: page < total_pages,
        };
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
        'Cierra una sesión de caja abierta con el arqueo (actual_closing_amount + closing_notes opcionales). IRREVERSIBLE: la sesión cerrada no se reabre y el descuadre queda registrado. Si el efectivo contado no coincide con lo esperado, el cierre no se propone hasta guiar a la persona a revisar la diferencia; después se reintenta con discrepancy_reviewed=true y el motivo en discrepancy_reason. Cadena: get_active_cash_session para confirmar cuál está abierta.',
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
          pending_decision: {
            type: 'string',
            enum: ['resolved', 'override'],
            description:
              'Decisión explícita del usuario sobre órdenes pendientes: resolved solo después de gestionarlas, u override para cerrar con excepción. No inventes ni elijas esta decisión por el usuario.',
          },
          pending_fingerprint: {
            type: 'string',
            description:
              'Fingerprint actual de las órdenes pendientes, requerido junto con una decisión explícita. No lo inventes; obténlo del resultado de pendientes.',
          },
          override_reason: {
            type: 'string',
            description:
              'Motivo escrito o confirmado por el usuario, requerido para pending_decision="override". No inventes el motivo.',
          },
          ...DISCREPANCY_ACK_PARAMETERS,
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
        const decisionError = validatePendingDecision(args ?? {});
        if (decisionError) return previewError('Cerrar caja', decisionError);
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
        if (
          session.pending_orders_tracking_enabled === true &&
          args?.pending_decision === undefined
        ) {
          const pending = await loadPendingOrdersBlock(id);
          if (pending) {
            return previewError(
              sessionLabel(session),
              pendingOrdersMessage(pending),
            );
          }
        }
        const discrepancy = await loadCashDiscrepancy(id, actual);
        const ack = readDiscrepancyAck(args);
        if (discrepancy && !ack.reviewed) {
          return {
            ...previewError(
              sessionLabel(session),
              discrepancyPreviewMessage(discrepancy),
            ),
            discrepancy,
          };
        }
        if (discrepancy && !ack.reason) {
          return {
            ...previewError(sessionLabel(session), DISCREPANCY_MISSING_REASON),
            discrepancy,
          };
        }
        const discrepancyChanges =
          discrepancy && ack.reason
            ? [
                {
                  field: 'difference',
                  label:
                    discrepancy.direction === 'shortage'
                      ? 'Faltante'
                      : 'Sobrante',
                  from: discrepancy.expected,
                  to: discrepancy.actual,
                },
                {
                  field: 'discrepancy_reason',
                  label: 'Motivo de la diferencia',
                  from: null,
                  to: ack.reason,
                },
              ]
            : [];
        const decisionChanges = [
          ...(args?.pending_decision !== undefined
            ? [
                {
                  field: 'pending_decision',
                  label: 'Decisión sobre órdenes pendientes',
                  from: null,
                  to: args.pending_decision,
                },
              ]
            : []),
          ...(args?.override_reason !== undefined
            ? [
                {
                  field: 'override_reason',
                  label: 'Motivo de excepción',
                  from: null,
                  to: args.override_reason,
                },
              ]
            : []),
        ];
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
            ...decisionChanges,
            ...discrepancyChanges,
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
        const decisionError = validatePendingDecision(args ?? {});
        if (decisionError) {
          return {
            error: decisionError,
            next_step:
              'Usa resolved u override con el fingerprint actual; override además requiere un motivo escrito por el usuario.',
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
        if (
          session.pending_orders_tracking_enabled === true &&
          args?.pending_decision === undefined
        ) {
          const pending = await loadPendingOrdersBlock(id);
          if (pending) {
            return {
              error: pendingOrdersMessage(pending),
              next_step: pendingOrdersNextStep(),
              pending_orders: pending.data,
              count: pending.count,
              fingerprint: pending.fingerprint,
              ...(pending.pagination ? { pagination: pending.pagination } : {}),
            };
          }
        }
        const discrepancy = await loadCashDiscrepancy(id, actual);
        const ack = readDiscrepancyAck(args);
        if (discrepancy && !ack.reviewed) {
          return {
            error: discrepancyPreviewMessage(discrepancy),
            discrepancy,
            next_step:
              'Acompaña a la persona a revisar la diferencia y reintenta con discrepancy_reviewed=true y el motivo en discrepancy_reason.',
          };
        }
        if (discrepancy && !ack.reason) {
          return {
            error: DISCREPANCY_MISSING_REASON,
            discrepancy,
            next_step:
              'Reintenta con discrepancy_reviewed=true y el motivo en discrepancy_reason.',
          };
        }
        const dto: CloseSessionDto = { actual_closing_amount: actual };
        const notes =
          typeof args?.closing_notes === 'string' && args.closing_notes.trim()
            ? args.closing_notes.trim()
            : null;
        const discrepancyLine =
          discrepancy && ack.reason
            ? discrepancyClosingLine(discrepancy, ack.reason)
            : null;
        const closingNotes = [notes, discrepancyLine]
          .filter(Boolean)
          .join('\n');
        if (closingNotes) {
          dto.closing_notes = closingNotes;
        }
        if (args.pending_decision !== undefined) {
          dto.pending_decision = args.pending_decision;
          dto.pending_fingerprint = args.pending_fingerprint.trim();
        }
        if (args.override_reason !== undefined) {
          dto.override_reason = args.override_reason.trim();
        }
        const closed = await deps.sessionsService.closeSession(id, dto);
        const row = closed as unknown as Record<string, any>;
        return {
          resumen: `${sessionLabel({ ...session, ...row })} cerrada con arqueo $${actual}.`,
          session_id: row.id ?? id,
          resultado: row,
          ...(row.success !== false &&
          !row.error &&
          toPositiveInt(row.id) === id &&
          row.status === 'closed' &&
          row.actual_closing_amount != null &&
          Number(row.actual_closing_amount) === actual &&
          row.expected_closing_amount != null &&
          Number.isFinite(Number(row.expected_closing_amount)) &&
          row.difference != null &&
          Number.isFinite(Number(row.difference)) &&
          Math.abs(
            Number(row.difference) -
              (actual - Number(row.expected_closing_amount)),
          ) < 0.001
            ? { applied: true, resource_ids: { session_id: id } }
            : {}),
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
        const movement = await deps.movementsService.createManualMovement(id, {
          type: args.type as 'cash_in' | 'cash_out',
          amount,
          ...(typeof args?.reference === 'string' && args.reference.trim()
            ? { reference: args.reference.trim() }
            : {}),
          ...(typeof args?.notes === 'string' && args.notes.trim()
            ? { notes: args.notes.trim() }
            : {}),
        });
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
