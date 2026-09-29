import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import {
  FiscalContextResolverService,
  FiscalOperationsContext,
} from '../../../domains/fiscal-operations/services/fiscal-context-resolver.service';
import { FiscalObligationService } from '../../../domains/fiscal-operations/services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from '../../../domains/fiscal-operations/services/tax-declaration-draft.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

/**
 * Familia fiscal de Vexi (fiscal-ops). Todas las herramientas son de LECTURA:
 * ninguna genera obligaciones, ningún borrador de declaración se crea, aprueba
 * o presenta desde aquí.
 *
 * Contrato fiscal (ver skill `vendix-fiscal-scope`): los reportes por NIT
 * filtran por ENTIDAD CONTABLE (`accounting_entity_id`), nunca sólo por
 * `store_id`. Cada tool resuelve el `FiscalOperationsContext` vía
 * `FiscalContextResolverService` (el mismo que usa `StoreFiscalController`) y
 * ADEMÁS resuelve el `accounting_entity_id` vía
 * `FiscalScopeService.findFiscalAccountingEntityId` — lectura pura que nunca
 * materializa entidades. Si ambas resoluciones discrepan, la tool falla
 * cerrada en vez de arriesgar cifras del NIT equivocado.
 *
 * Los importes van crudos, sin formato y sin símbolo de moneda: quien presenta
 * al usuario es quien formatea (ver skill `vendix-currency-formatting`).
 */

export interface FiscalToolDeps {
  contextResolver: FiscalContextResolverService;
  obligationsService: FiscalObligationService;
  declarationsService: TaxDeclarationDraftService;
  fiscalScopeService: FiscalScopeService;
}

const PERM_DASHBOARD = 'store:fiscal:dashboard:read';
const PERM_OBLIGATIONS = 'store:fiscal:obligations:read';
const PERM_DECLARATIONS = 'store:fiscal:declarations:read';

const OBLIGATION_TYPES = [
  'vat_return',
  'inc_return',
  'withholding_return',
  'reteiva_return',
  'reteica_return',
  'ica_return',
  'exogenous_report',
  'income_tax_precierre',
  'electronic_invoice_review',
  'support_document_review',
  'payroll_electronic_review',
  'bank_reconciliation',
] as const;

const OBLIGATION_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'ready',
  'approved',
  'submitted',
  'accepted',
  'rejected',
  'paid',
  'overdue',
  'cancelled',
  'not_applicable',
] as const;

const TAX_FAMILIES = ['iva', 'inc', 'withholding', 'ica', 'other'] as const;
type TaxFamily = (typeof TAX_FAMILIES)[number];

/**
 * Las líneas de un borrador no portan columna `tax_type`: su clasificación
 * fiscal vive en el prefijo de `line_type` (`vat_generated`, `inc_generated`,
 * `withholding_practiced`, `ica_base`…), que es lo que el dispatcher
 * IVA/INC/retención escribe al calcular. Agrupar por prefijo es la lectura
 * honesta; inventar un `tax_type` por línea sería fabricar clasificación.
 */
function lineFamily(line_type: unknown): TaxFamily {
  const t = String(line_type ?? '');
  if (t.startsWith('vat')) return 'iva';
  if (t.startsWith('inc')) return 'inc';
  if (t.startsWith('withholding')) return 'withholding';
  if (t.startsWith('ica')) return 'ica';
  return 'other';
}

const money = (value: unknown) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

const isoDate = (value: unknown) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

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

export function createFiscalTools(deps: FiscalToolDeps): RegisteredTool[] {
  /**
   * Doble resolución fail-closed: el contexto operativo (store) y la entidad
   * fiscal (NIT) deben coincidir. Si `FiscalScopeService` no resuelve entidad
   * o discrepa del contexto, no hay lectura parcial: se devuelve error.
   */
  async function resolveGuardedContext(
    context: ToolExecutionContext,
  ): Promise<
    | { fiscalCtx: FiscalOperationsContext; accounting_entity_id: number }
    | { error: string; next_step: string }
  > {
    if (!context.organization_id || !context.store_id) {
      return {
        error:
          'Sin tienda en contexto: el estado fiscal se consulta siempre dentro de una tienda.',
        next_step:
          'Reintenta dentro de una sesión de tienda autenticada; el NIT se deriva de su entidad contable.',
      };
    }

    const fiscalCtx = await deps.contextResolver.resolveForStore();
    const accounting_entity_id =
      await deps.fiscalScopeService.findFiscalAccountingEntityId({
        organization_id: context.organization_id,
        store_id: context.store_id,
      });

    if (!accounting_entity_id) {
      return {
        error:
          'La tienda no tiene entidad contable fiscal: no hay NIT al cual atribuir cifras.',
        next_step:
          'Pide al usuario completar la configuración fiscal de la tienda (NIT y responsabilidades) antes de consultar reportes.',
      };
    }

    if (accounting_entity_id !== fiscalCtx.accounting_entity_id) {
      return {
        error:
          'La entidad fiscal resuelta no coincide con el contexto de la tienda; por seguridad no se muestran cifras.',
        next_step:
          'Reintenta la consulta; si persiste, revisa el alcance fiscal de la organización con un administrador.',
      };
    }

    return { fiscalCtx, accounting_entity_id };
  }

  function entityTag(fiscalCtx: FiscalOperationsContext) {
    const e = fiscalCtx.accounting_entity ?? {};
    return {
      id: fiscalCtx.accounting_entity_id,
      name: e.legal_name || e.name || null,
      tax_id: e.tax_id ?? null,
      fiscal_scope: fiscalCtx.fiscal_scope,
    };
  }

  return [
    // ─── F-14: get_fiscal_overview ───────────────────────────────────
    {
      name: 'get_fiscal_overview',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Foto del estado fiscal del NIT de la tienda: conteos de obligaciones próximas, vencidas y bloqueadas, borradores de declaración listos, documentos DIAN rechazados, sesiones de cierre abiertas y montos estimados vs definitivos, más las próximas 10 obligaciones por vencimiento. Úsala cuando pregunten "cómo vamos con impuestos", "qué se vence" o como punto de partida de cualquier diagnóstico fiscal.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_DASHBOARD],
      handler: guard(async (_args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const overview: any = await deps.obligationsService.getOverview([
          resolved.fiscalCtx,
        ]);

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          stats: {
            upcoming: overview.stats.upcoming,
            overdue: overview.stats.overdue,
            declarations_ready: overview.stats.declarations_ready,
            blocked: overview.stats.blocked,
            rejected_documents: overview.stats.rejected_documents,
            open_close_sessions: overview.stats.open_close_sessions,
            estimated_amount: money(overview.stats.estimated_amount),
            final_amount: money(overview.stats.final_amount),
          },
          next_obligations: (overview.next_obligations as any[]).map((o) => ({
            id: o.id,
            type: o.type,
            status: o.status,
            period_year: o.period_year,
            period_month: o.period_month ?? null,
            due_date: isoDate(o.due_date),
            estimated_amount: money(o.estimated_amount),
            final_amount: money(o.final_amount),
          })),
        };
      }),
    },

    // ─── F-16: list_fiscal_obligations ───────────────────────────────
    {
      name: 'list_fiscal_obligations',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Lista las obligaciones fiscales del NIT (declaraciones de IVA/INC/retenciones/ICA, exógena, revisiones) con tipo, estado, periodo, vencimiento y montos. Acepta filtros por tipo, estado y periodo. Úsala para responder "qué declaraciones tengo pendientes" o para resolver el obligation_id que exigen los writes de obligaciones (F-17). Filtra por entidad contable (NIT), nunca sólo por tienda.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: OBLIGATION_TYPES,
            description: 'Filtra por tipo de obligación.',
          },
          status: {
            type: 'string',
            enum: OBLIGATION_STATUSES,
            description: 'Filtra por estado de la obligación.',
          },
          period_year: {
            type: 'number',
            description: 'Filtra por año del periodo gravable.',
          },
          period_month: {
            type: 'number',
            description: 'Filtra por mes del periodo gravable (1-12).',
          },
          page: {
            type: 'number',
            description: 'Página de resultados. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Obligaciones por página. Por defecto 25, tope 50.',
          },
        },
      },
      requiredPermissions: [PERM_OBLIGATIONS],
      handler: guard(async (args, context) => {
        if (
          args.type !== undefined &&
          !(OBLIGATION_TYPES as readonly string[]).includes(String(args.type))
        ) {
          return {
            error: `type "${args.type}" inválido. Valores válidos: ${OBLIGATION_TYPES.join(', ')}.`,
            next_step:
              'Repite la consulta con uno de los tipos listados, u omite el filtro para ver todas las obligaciones.',
          };
        }
        if (
          args.status !== undefined &&
          !(OBLIGATION_STATUSES as readonly string[]).includes(
            String(args.status),
          )
        ) {
          return {
            error: `status "${args.status}" inválido. Valores válidos: ${OBLIGATION_STATUSES.join(', ')}.`,
            next_step:
              'Repite la consulta con uno de los estados listados, u omite el filtro para ver todas las obligaciones.',
          };
        }

        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const page = Math.max(Number(args.page) || 1, 1);
        const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 50);

        const result: any = await deps.obligationsService.list(
          [resolved.fiscalCtx],
          {
            page,
            limit,
            // Filtro fiscal/legal explícito: el NIT resuelto por
            // FiscalScopeService, no sólo la tienda del contexto.
            accounting_entity_id: resolved.accounting_entity_id,
            ...(args.type && { type: String(args.type) }),
            ...(args.status && { status: String(args.status) }),
            ...(args.period_year && {
              period_year: Number(args.period_year),
            }),
            ...(args.period_month && {
              period_month: Number(args.period_month),
            }),
          } as any,
        );

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          summary: `${result.total} obligación(es) fiscal(es) del NIT`,
          filters: {
            type: args.type ?? null,
            status: args.status ?? null,
            period_year: args.period_year ?? null,
            period_month: args.period_month ?? null,
          },
          obligations: (result.data as any[]).map((o) => ({
            id: o.id,
            type: o.type,
            status: o.status,
            period_year: o.period_year,
            period_month: o.period_month ?? null,
            period_start: isoDate(o.period_start),
            period_end: isoDate(o.period_end),
            due_date: isoDate(o.due_date),
            estimated_amount: money(o.estimated_amount),
            final_amount: money(o.final_amount),
            blocking_reason: o.blocking_reason ?? null,
          })),
          page: result.page,
          limit: result.limit,
          total_matching: result.total,
        };
      }),
    },

    // ─── F-18: get_declaration_draft ─────────────────────────────────
    {
      name: 'get_declaration_draft',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Detalle de un borrador de declaración tributaria por su ID: cabecera (tipo de declaración, estado, periodo, bases, impuestos generado/descontable, saldo a pagar o a favor) y sus líneas agrupadas por familia fiscal (iva, inc, withholding, ica). Úsala para explicar "qué va a declarar" antes de aprobar o presentar (F-21/F-22): esos writes exigen citar un borrador recalculado. Nunca presenta ni aprueba nada.',
      parameters: {
        type: 'object',
        properties: {
          draft_id: {
            type: 'number',
            description: 'ID del borrador de declaración.',
          },
        },
        required: ['draft_id'],
      },
      requiredPermissions: [PERM_DECLARATIONS],
      handler: guard(async (args, context) => {
        const draft_id = Number(args.draft_id);
        if (!Number.isInteger(draft_id) || draft_id <= 0) {
          return {
            error: `draft_id inválido: "${args.draft_id}". Pasa el ID numérico del borrador.`,
            next_step:
              'Resuelve el borrador desde list_fiscal_obligations (obligación → borradores) y repite con su ID.',
          };
        }

        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const draft: any = await deps.declarationsService.findOne(
          [resolved.fiscalCtx],
          draft_id,
        );
        const lines = (draft.lines ?? []) as any[];

        const byFamily: Record<
          TaxFamily,
          { count: number; base_amount: number; tax_amount: number }
        > = {
          iva: { count: 0, base_amount: 0, tax_amount: 0 },
          inc: { count: 0, base_amount: 0, tax_amount: 0 },
          withholding: { count: 0, base_amount: 0, tax_amount: 0 },
          ica: { count: 0, base_amount: 0, tax_amount: 0 },
          other: { count: 0, base_amount: 0, tax_amount: 0 },
        };
        for (const l of lines) {
          const bucket = byFamily[lineFamily(l.line_type)];
          bucket.count += 1;
          bucket.base_amount =
            Math.round((bucket.base_amount + Number(l.base_amount ?? 0)) * 100) /
            100;
          bucket.tax_amount =
            Math.round(
              (bucket.tax_amount +
                Number(l.tax_amount ?? 0) +
                Number(l.withholding_amount ?? 0)) *
                100,
            ) / 100;
        }

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          draft: {
            id: draft.id,
            declaration_type: draft.declaration_type,
            status: draft.status,
            obligation_id: draft.obligation_id ?? null,
            period_year: draft.period_year,
            period_month: draft.period_month ?? null,
            period_start: isoDate(draft.period_start),
            period_end: isoDate(draft.period_end),
            totals: {
              gross_base_amount: money(draft.gross_base_amount),
              taxable_base_amount: money(draft.taxable_base_amount),
              exempt_amount: money(draft.exempt_amount),
              excluded_amount: money(draft.excluded_amount),
              generated_tax_amount: money(draft.generated_tax_amount),
              deductible_tax_amount: money(draft.deductible_tax_amount),
              withholding_amount: money(draft.withholding_amount),
              balance_due: money(draft.balance_due),
              balance_favor: money(draft.balance_favor),
              total_payable: money(draft.total_payable),
            },
            lines_by_tax_type: byFamily,
            lines: lines.map((l) => ({
              id: l.id,
              line_type: l.line_type,
              tax_family: lineFamily(l.line_type),
              concept_code: l.concept_code ?? null,
              description: l.description,
              base_amount: money(l.base_amount),
              tax_amount: money(l.tax_amount),
              withholding_amount: money(l.withholding_amount),
              third_party: l.third_party_name ?? null,
              third_party_tax_id: l.third_party_tax_id ?? null,
            })),
            lines_count: lines.length,
          },
        };
      }),
    },
  ];
}
