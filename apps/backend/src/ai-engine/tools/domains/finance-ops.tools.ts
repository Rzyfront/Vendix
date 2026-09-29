import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { FixedAssetsService } from '../../../domains/store/accounting/fixed-assets/fixed-assets.service';
import { BudgetVarianceService } from '../../../domains/store/accounting/budgets/budget-variance.service';
import { ReconciliationService } from '../../../domains/store/accounting/bank-reconciliation/reconciliation.service';
import { ReconciliationMatchingService } from '../../../domains/store/accounting/bank-reconciliation/reconciliation-matching.service';
import { ConsolidationService } from '../../../domains/store/accounting/consolidation/consolidation.service';

/**
 * Familia finance-ops de Vexi (paso 12, track B). 4 reads (`readOnly: true`)
 * + 2 writes con confirmación (F-96, F-99). Cubre activos fijos,
 * depreciación, variación presupuestal, conciliación bancaria y
 * consolidación multi-tienda.
 *
 * Contratos que respeta esta familia:
 * - Wrappers finos sobre los services del dominio contable; sin acceso
 *   directo a base de datos en tools. El scope tenant lo resuelve cada
 *   service (StorePrismaService).
 * - Cadenas read→write: run_depreciation←F-95 (activos activos),
 *   auto_match_bank←F-98 (conciliación no completada). Todo handler
 *   re-verifica sus precondiciones: el preview es proyección, no transacción.
 * - Permisos verificados en controllers: `store:accounting:fixed_assets:*`
 *   en `fixed-assets.controller.ts`, `store:accounting:budgets:read` en
 *   `budgets.controller.ts`, `store:accounting:bank_reconciliation:*` en
 *   `reconciliation.controller.ts` (`:id/auto-match` exige `:update`),
 *   `store:accounting:consolidation:read` en `consolidation.controller.ts`.
 */

export interface FinanceOpsToolDeps {
  fixedAssetsService: FixedAssetsService;
  budgetVarianceService: BudgetVarianceService;
  reconciliationService: ReconciliationService;
  reconciliationMatchingService: ReconciliationMatchingService;
  consolidationService: ConsolidationService;
}

const PERM_FIXED_ASSETS_READ = 'store:accounting:fixed_assets:read';
const PERM_FIXED_ASSETS_WRITE = 'store:accounting:fixed_assets:write';
const PERM_BUDGETS_READ = 'store:accounting:budgets:read';
const PERM_RECONCILIATION_READ = 'store:accounting:bank_reconciliation:read';
const PERM_RECONCILIATION_UPDATE =
  'store:accounting:bank_reconciliation:update';
const PERM_CONSOLIDATION_READ = 'store:accounting:consolidation:read';

const CONSOLIDATION_STATUSES = [
  'draft',
  'in_progress',
  'completed',
  'cancelled',
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
  domain: string,
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function isValidMonth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 12
  );
}

function isValidYear(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 2000 &&
    value <= 2100
  );
}

function isValidId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (value as number) > 0
  );
}

export function createFinanceOpsTools(
  deps: FinanceOpsToolDeps,
): RegisteredTool[] {
  return [
    // ─── F-95: list_fixed_assets ───────────────────────────────────
    {
      name: 'list_fixed_assets',
      version: '1',
      domain: 'finance-ops',
      readOnly: true,
      description:
        'Lista los activos fijos con filtros opcionales (search, status, category_id) y paginación (page, limit máx 100). Úsala para "qué activos tenemos", "valor en libros" o como lectura habilitante (F-95) antes de proponer run_depreciation.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Texto a buscar (código, nombre, placa).',
          },
          status: {
            type: 'string',
            description: 'Estado del activo, ej. active, retired, disposed.',
          },
          category_id: {
            type: 'number',
            description: 'ID de la categoría de activo.',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 20, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_FIXED_ASSETS_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        if (typeof args.status === 'string' && args.status.trim()) {
          query.status = args.status.trim();
        }
        if (isValidId(Number(args.category_id))) {
          query.category_id = Number(args.category_id);
        }
        const result = await deps.fixedAssetsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── F-96: run_depreciation (write) ──────────────────────────────
    {
      name: 'run_depreciation',
      version: '1',
      domain: 'finance-ops',
      description:
        'Corre la depreciación mensual de todos los activos activos para un año+mes: crea el asiento por activo y acumula depreciación (los periodos ya corridos se omiten sin duplicar). Cadena: list_fixed_assets (F-95) para confirmar activos depreciables. Irreversible en la práctica: exige confirmación.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Año del periodo, ej. 2026.',
          },
          month: {
            type: 'number',
            description: 'Mes del periodo (1-12).',
          },
        },
        required: ['year', 'month'],
      },
      requiredPermissions: [PERM_FIXED_ASSETS_WRITE],
      requiresConfirmation: true,
      preview: async (args) => {
        const year = Number(args?.year);
        const month = Number(args?.month);
        if (!isValidYear(year) || !isValidMonth(month)) {
          return previewError(
            'Depreciación mensual',
            'Periodo inválido: year entre 2000 y 2100, month entre 1 y 12.',
            'finance-ops',
          );
        }
        let active: Array<Record<string, any>>;
        try {
          const result = (await deps.fixedAssetsService.findAll({
            status: 'active',
            page: 1,
            limit: 100,
          } as any)) as unknown as Record<string, any>;
          active = (result?.data ?? result ?? []) as Array<
            Record<string, any>
          >;
          if (!Array.isArray(active)) active = [];
        } catch (error: any) {
          return previewError(
            `Depreciación ${year}-${String(month).padStart(2, '0')}`,
            `No se pudo leer los activos activos: ${describeError(error)}.`,
            'finance-ops',
          );
        }
        if (active.length === 0) {
          return previewError(
            `Depreciación ${year}-${String(month).padStart(2, '0')}`,
            'No hay activos activos que depreciar: nada que correr.',
            'finance-ops',
          );
        }
        const shown = active.slice(0, 10);
        return {
          status: 'warning',
          target: `Depreciación ${year}-${String(month).padStart(2, '0')} — ${active.length} activo(s)`,
          changes: [
            {
              field: 'period',
              label: 'Periodo',
              from: null,
              to: `${year}-${String(month).padStart(2, '0')}`,
            },
            {
              field: 'assets',
              label: 'Activos a depreciar',
              from: 0,
              to: active.length,
            },
          ],
          message: `Se deprecian: ${shown.map((a) => a.asset_number ?? a.name ?? `#${a.id}`).join(', ')}${active.length > 10 ? ` y ${active.length - 10} más` : ''}. Los periodos ya corridos se omiten sin duplicar.`,
          domain: 'finance-ops',
        };
      },
      handler: guard(async (args) => {
        const year = Number(args?.year);
        const month = Number(args?.month);
        if (!isValidYear(year) || !isValidMonth(month)) {
          return {
            error: 'Periodo inválido: year entre 2000 y 2100, month entre 1 y 12.',
            next_step: 'Reintenta con un periodo válido.',
          };
        }
        const result = await deps.fixedAssetsService.runMonthlyDepreciation({
          year,
          month,
        } as any);
        return { ...(result as Record<string, any>), period: { year, month } };
      }),
    },

    // ─── F-97: get_budget_variance ───────────────────────────────────
    {
      name: 'get_budget_variance',
      version: '1',
      domain: 'finance-ops',
      readOnly: true,
      description:
        'Lee el reporte de variación presupuestal de un presupuesto: por línea, presupuestado vs ejecutado real (de asientos contables) con varianza, en un mes (1-12) o acumulado anual si se omite month. Úsala para "cómo vamos contra el presupuesto".',
      parameters: {
        type: 'object',
        properties: {
          budget_id: {
            type: 'number',
            description: 'ID del presupuesto.',
          },
          month: {
            type: 'number',
            description:
              'Mes a evaluar (1-12). Omitido devuelve el acumulado anual.',
          },
        },
        required: ['budget_id'],
      },
      requiredPermissions: [PERM_BUDGETS_READ],
      handler: guard(async (args) => {
        const budget_id = Number(args?.budget_id);
        if (!Number.isInteger(budget_id) || budget_id <= 0) {
          return {
            error: `budget_id inválido: ${String(args?.budget_id)}.`,
            next_step: 'Pasa el ID numérico del presupuesto.',
          };
        }
        if (args?.month !== undefined && !isValidMonth(Number(args.month))) {
          return {
            error: `month inválido: ${String(args?.month)}.`,
            next_step: 'Usa un mes entre 1 y 12, u omítelo para el acumulado.',
          };
        }
        const report = await deps.budgetVarianceService.getVarianceReport(
          budget_id,
          args?.month !== undefined ? Number(args.month) : undefined,
        );
        return report as unknown as Record<string, any>;
      }),
    },

    // ─── F-98: list_reconciliations ──────────────────────────────────
    {
      name: 'list_reconciliations',
      version: '1',
      domain: 'finance-ops',
      readOnly: true,
      description:
        'Lista las conciliaciones bancarias con filtros opcionales (bank_account_id, status). Úsala para "qué conciliaciones hay pendientes" o como lectura habilitante (F-98) antes de proponer auto_match_bank.',
      parameters: {
        type: 'object',
        properties: {
          bank_account_id: {
            type: 'number',
            description: 'ID de la cuenta bancaria.',
          },
          status: {
            type: 'string',
            description: 'Estado de la conciliación, ej. draft, completed.',
          },
        },
      },
      requiredPermissions: [PERM_RECONCILIATION_READ],
      handler: guard(async (args) => {
        const query: { bank_account_id?: number; status?: string } = {};
        if (isValidId(Number(args?.bank_account_id))) {
          query.bank_account_id = Number(args.bank_account_id);
        }
        if (typeof args?.status === 'string' && args.status.trim()) {
          query.status = args.status.trim();
        }
        const result = await deps.reconciliationService.findAll(query);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── F-99: auto_match_bank (write) ───────────────────────────────
    {
      name: 'auto_match_bank',
      version: '1',
      domain: 'finance-ops',
      description:
        'Corre el cruce automático de una conciliación bancaria: empareja movimientos del extracto con asientos contables (exactos, por monto+fecha y aproximados). Cadena: list_reconciliations (F-98) para elegir una conciliación no completada. Una conciliación completed no se puede cruzar.',
      parameters: {
        type: 'object',
        properties: {
          reconciliation_id: {
            type: 'number',
            description: 'ID de la conciliación (ver F-98).',
          },
        },
        required: ['reconciliation_id'],
      },
      requiredPermissions: [PERM_RECONCILIATION_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const reconciliation_id = Number(args?.reconciliation_id);
        if (!Number.isInteger(reconciliation_id) || reconciliation_id <= 0) {
          return previewError(
            'Cruce bancario',
            'reconciliation_id inválido: consíguelo con list_reconciliations (F-98).',
            'finance-ops',
          );
        }
        let reconciliation: Record<string, any>;
        try {
          reconciliation = (await deps.reconciliationService.findOne(
            reconciliation_id,
          )) as unknown as Record<string, any>;
        } catch (error: any) {
          return previewError(
            `Conciliación #${reconciliation_id}`,
            `No se pudo leer la conciliación: ${describeError(error)}.`,
            'finance-ops',
          );
        }
        if (!reconciliation) {
          return previewError(
            `Conciliación #${reconciliation_id}`,
            'La conciliación no existe.',
            'finance-ops',
          );
        }
        if (reconciliation.status === 'completed') {
          return previewError(
            `Conciliación #${reconciliation_id}`,
            'La conciliación ya está completada: no se puede cruzar.',
            'finance-ops',
          );
        }
        const account =
          reconciliation.bank_account?.name ??
          (reconciliation.bank_account_id
            ? `cuenta #${reconciliation.bank_account_id}`
            : 'cuenta bancaria');
        return {
          status: 'ok',
          target: `Conciliación #${reconciliation_id} — ${account}`,
          changes: [
            {
              field: 'auto_match',
              label: 'Cruce automático',
              from: 'pendiente',
              to: 'ejecutado',
            },
          ],
          domain: 'finance-ops',
        };
      },
      handler: guard(async (args) => {
        const reconciliation_id = Number(args?.reconciliation_id);
        if (!Number.isInteger(reconciliation_id) || reconciliation_id <= 0) {
          return {
            error: 'reconciliation_id inválido.',
            next_step: 'Consíguelo con list_reconciliations (F-98).',
          };
        }
        const reconciliation = (await deps.reconciliationService.findOne(
          reconciliation_id,
        )) as unknown as Record<string, any>;
        if (!reconciliation) {
          return {
            error: `La conciliación #${reconciliation_id} no existe.`,
            next_step: 'Elige una conciliación existente con F-98.',
          };
        }
        if (reconciliation.status === 'completed') {
          return {
            error: `La conciliación #${reconciliation_id} ya está completada.`,
            next_step: 'Elige una conciliación pendiente con F-98.',
          };
        }
        const result =
          await deps.reconciliationMatchingService.autoMatch(reconciliation_id);
        return {
          matched: true,
          reconciliation_id,
          ...(result as unknown as Record<string, any>),
        };
      }),
    },

    // ─── F-100: get_consolidation_status ─────────────────────────────
    {
      name: 'get_consolidation_status',
      version: '1',
      domain: 'finance-ops',
      readOnly: true,
      description:
        'Lee el estado de la consolidación contable multi-tienda: con session_id devuelve el detalle de la sesión (periodo, estado, ajustes, intercompany); sin él lista las sesiones recientes con su estado. Solo aplica en organizaciones multi-tienda. Úsala para "en qué va la consolidación".',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description:
              'ID de la sesión a detallar. Omitido lista las recientes.',
          },
          status: {
            type: 'string',
            enum: [...CONSOLIDATION_STATUSES],
            description: 'Filtra el listado por estado (solo sin session_id).',
          },
          limit: {
            type: 'number',
            description:
              'Sesiones a listar (por defecto 5, máx 100; solo sin session_id).',
          },
        },
      },
      requiredPermissions: [PERM_CONSOLIDATION_READ],
      handler: guard(async (args) => {
        if (args?.session_id !== undefined && args.session_id !== null) {
          const session_id = Number(args.session_id);
          if (!Number.isInteger(session_id) || session_id <= 0) {
            return {
              error: `session_id inválido: ${String(args.session_id)}.`,
              next_step: 'Pasa el ID numérico de la sesión.',
            };
          }
          const session = (await deps.consolidationService.findOneSession(
            session_id,
          )) as unknown as Record<string, any>;
          return {
            session: {
              id: session.id,
              status: session.status,
              fiscal_period: session.fiscal_period ?? null,
              adjustments_count: session._count?.adjustments ?? null,
              intercompany_count: session._count?.intercompany_txns ?? null,
              adjustments: session.adjustments ?? [],
              created_at: session.created_at ?? null,
              created_by: session.created_by ?? null,
            },
          };
        }
        if (
          args?.status !== undefined &&
          !(CONSOLIDATION_STATUSES as readonly string[]).includes(args.status)
        ) {
          return {
            error: `status desconocido: ${String(args.status)}.`,
            next_step: `Usa uno válido: ${CONSOLIDATION_STATUSES.join(', ')}.`,
          };
        }
        const result = (await deps.consolidationService.findAllSessions({
          ...(args?.status ? { status: args.status } : {}),
          page: 1,
          limit: clampLimit(args?.limit, 5),
        } as any)) as unknown as Record<string, any>;
        const sessions = (result?.data ?? []) as Array<Record<string, any>>;
        return {
          sessions: sessions.map((s) => ({
            id: s.id,
            status: s.status,
            fiscal_period: s.fiscal_period ?? null,
            adjustments_count: s._count?.adjustments ?? null,
            intercompany_count: s._count?.intercompany_txns ?? null,
            created_at: s.created_at ?? null,
            created_by: s.created_by ?? null,
          })),
          meta: result?.meta ?? null,
        };
      }),
    },
  ];
}
