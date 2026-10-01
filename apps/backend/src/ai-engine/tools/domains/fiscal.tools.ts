import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import {
  FiscalContextResolverService,
  FiscalOperationsContext,
} from '../../../domains/fiscal-operations/services/fiscal-context-resolver.service';
import { FiscalObligationService } from '../../../domains/fiscal-operations/services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from '../../../domains/fiscal-operations/services/tax-declaration-draft.service';
import { FiscalFlowStateService } from '../../../domains/fiscal-operations/services/fiscal-flow-state.service';
import { FiscalCloseService } from '../../../domains/fiscal-operations/services/fiscal-close.service';
import { FiscalConfigChecklistService } from '../../../domains/fiscal-operations/services/fiscal-config-checklist.service';
import { InvoicingService } from '../../../domains/store/invoicing/invoicing.service';
import {
  CreateTaxDeclarationDraftDto,
  GenerateFiscalObligationsDto,
  MarkFiscalSubmittedDto,
} from '../../../domains/fiscal-operations/dto/fiscal-operations.dto';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

/**
 * Familia fiscal de Vexi (fiscal-ops): 7 reads + 7 writes.
 *
 * Los writes (obligaciones, borradores de declaración, cierres) exigen
 * `requiresConfirmation` + `preview` con sujeto humano, y cada uno cita su
 * read habilitante del paso 6 (F-16/F-18/F-23/F-26). El `handler` re-verifica
 * sus precondiciones porque el `preview` es proyección, no transacción. Toda
 * escritura pasa por el servicio dueño: ninguna lectura directa a la base
 * en este archivo.
 * `list_invoices` (F-27) vive en esta familia porque el lote la asignó al
 * track fiscal; se respalda en `InvoicingService`, no en queries propias.
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
  flowStateService: FiscalFlowStateService;
  closeService: FiscalCloseService;
  checklistService: FiscalConfigChecklistService;
  invoicesService: InvoicingService;
}

const PERM_DASHBOARD = 'store:fiscal:dashboard:read';
const PERM_OBLIGATIONS = 'store:fiscal:obligations:read';
const PERM_OBLIGATIONS_WRITE = 'store:fiscal:obligations:write';
const PERM_DECLARATIONS = 'store:fiscal:declarations:read';
const PERM_DECLARATIONS_WRITE = 'store:fiscal:declarations:write';
const PERM_CLOSE_READ = 'store:fiscal:close:read';
const PERM_CLOSE_WRITE = 'store:fiscal:close:write';
const PERM_INVOICES = 'invoicing:read';

/** `ToolPreview` de error: el registry aborta sin acuñar token. */
function writePreviewError(
  label: string,
  message: string,
  domain = 'fiscal',
): ToolPreview {
  return { status: 'error', target: label, changes: [], message, domain };
}

/**
 * Valida un DTO como el `ValidationPipe` global del HTTP (`whitelist` +
 * `forbidNonWhitelisted`). Misma doctrina que `writes.tools.ts`.
 */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

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

/** Valores de `tax_declaration_type_enum` (dispatcher IVA/INC/retención). */
const DECLARATION_TYPES = [
  'vat',
  'inc',
  'withholding',
  'reteiva',
  'reteica',
  'ica',
  'exogenous',
  'income_tax_precierre',
] as const;

const DECLARATION_TYPE_LABELS: Record<string, string> = {
  vat: 'Declaración de IVA',
  inc: 'Declaración de INC',
  withholding: 'Declaración de retención en la fuente',
  reteiva: 'Declaración de reteIVA',
  reteica: 'Declaración de reteICA',
  ica: 'Declaración de ICA',
  exogenous: 'Reporte exógeno',
  income_tax_precierre: 'Precierre de renta',
};

/** Estados que congelan un borrador: ni recalcular ni aprobar de nuevo. */
const LOCKED_DRAFT_STATUSES = ['approved', 'submitted', 'accepted', 'paid'];

const CLOSE_STATUSES = [
  'draft',
  'checking',
  'blocked',
  'ready',
  'approved',
  'closed',
  'reopened',
  'cancelled',
] as const;

const INVOICE_STATUSES = [
  'draft',
  'validated',
  'sent',
  'accepted',
  'rejected',
  'cancelled',
  'voided',
] as const;

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

  // ─── Resolutores compartidos preview ↔ handler (writes F-17..F-25) ───
  //
  // Corren DOS veces (proponer y aplicar) porque entre ambas el borrador pudo
  // aprobarse, la sesión cerrarse o el periodo moverse.

  function draftSubject(draft: any): string {
    const label =
      DECLARATION_TYPE_LABELS[draft.declaration_type] ??
      draft.declaration_type;
    const period = draft.period_month
      ? `${draft.period_year}-${String(draft.period_month).padStart(2, '0')}`
      : `${draft.period_year}`;
    return `${label} ${period} (#${draft.id}, ${draft.status})`;
  }

  function closeSubject(session: any): string {
    const period = session.period_month
      ? `${session.period_year}-${String(session.period_month).padStart(2, '0')}`
      : `${session.period_year}`;
    return `Cierre fiscal ${session.close_type} ${period} (#${session.id}, ${session.status})`;
  }

  /** Lee un borrador o devuelve el fallo guiado (base de F-20/F-21/F-22). */
  async function resolveDraft(
    fiscalCtx: FiscalOperationsContext,
    args: Record<string, any>,
    action: string,
  ): Promise<
    | { ok: true; draft: any }
    | { ok: false; message: string; nextStep: string }
  > {
    const draft_id = toPositiveInt(args.draft_id);
    if (!draft_id) {
      return {
        ok: false,
        message: 'draft_id inválido: pasa el ID numérico del borrador.',
        nextStep:
          'Resuelve el borrador desde list_fiscal_obligations (obligación → borradores) o get_declaration_draft (F-18).',
      };
    }
    let draft: any;
    try {
      draft = await deps.declarationsService.findOne([fiscalCtx], draft_id);
    } catch {
      draft = null;
    }
    if (!draft) {
      return {
        ok: false,
        message: `No existe el borrador ${draft_id} para este NIT. No se ${action}.`,
        nextStep: 'Verifica el ID con get_declaration_draft (F-18).',
      };
    }
    return { ok: true, draft };
  }

  /** Lee una sesión de cierre o devuelve el fallo guiado (F-24/F-25). */
  async function resolveCloseSession(
    fiscalCtx: FiscalOperationsContext,
    args: Record<string, any>,
    action: string,
  ): Promise<
    | { ok: true; session: any }
    | { ok: false; message: string; nextStep: string }
  > {
    const session_id = toPositiveInt(args.session_id);
    if (!session_id) {
      return {
        ok: false,
        message: 'session_id inválido: pasa el ID numérico de la sesión.',
        nextStep: 'Resuelve la sesión con list_close_sessions (F-23).',
      };
    }
    let session: any;
    try {
      session = await deps.closeService.findOne([fiscalCtx], session_id);
    } catch {
      session = null;
    }
    if (!session) {
      return {
        ok: false,
        message: `No existe la sesión de cierre ${session_id} para este NIT. No se ${action}.`,
        nextStep: 'Verifica el ID con list_close_sessions (F-23).',
      };
    }
    return { ok: true, session };
  }

  function summarizeChecks(session: any) {
    const checks = (session.checks ?? []) as any[];
    const failed_blocking = checks.filter(
      (c) => c.blocking && c.status === 'failed',
    );
    return {
      total: checks.length,
      passed: checks.filter((c) => c.status === 'passed').length,
      failed: checks.filter((c) => c.status === 'failed').length,
      warnings: checks.filter((c) => c.status === 'warning').length,
      overridden: checks.filter((c) => c.status === 'manually_overridden')
        .length,
      failed_blocking_keys: failed_blocking.map((c) => c.check_key),
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

    // ─── F-15: get_fiscal_flow_state (read) ──────────────────────────
    {
      name: 'get_fiscal_flow_state',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Estado por etapa de los 3 flujos fiscales del periodo (ventas, compras, nómina) más la convergencia contable (asientos, declaraciones, obligaciones y cierre con resumen de checks). Úsala para responder "en qué va el mes fiscal" o como mapa antes de proponer obligaciones, declaraciones o cierres. Solo lectura.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Año del periodo (ej. 2026).',
          },
          month: {
            type: 'number',
            description: 'Mes del periodo (1-12).',
          },
        },
        required: ['year', 'month'],
      },
      requiredPermissions: [PERM_DASHBOARD],
      handler: guard(async (args, context) => {
        const year = Number(args.year);
        const month = Number(args.month);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
          return {
            error: `year inválido: "${args.year}". Pasa el año del periodo (ej. 2026).`,
            next_step:
              'Repite con year y month del periodo que quieres revisar (ej. year=2026, month=7).',
          };
        }
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return {
            error: `month inválido: "${args.month}". Debe estar entre 1 y 12.`,
            next_step: 'Repite con el mes del periodo (1=enero … 12=diciembre).',
          };
        }

        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const state: any = await deps.flowStateService.getFlowState(
          [resolved.fiscalCtx],
          { year, month } as any,
        );

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          period: state.period,
          flows: state.flows,
          convergence: state.convergence,
        };
      }),
    },

    // ─── F-17: generate_fiscal_obligations (write) ───────────────────
    {
      name: 'generate_fiscal_obligations',
      version: '1',
      domain: 'fiscal',
      description:
        'Genera (o refresca) las obligaciones fiscales del NIT para un periodo: declaraciones de IVA/INC/retenciones/ICA, exógena y revisiones. Idempotente: las existentes se conservan salvo force_refresh. Cadena habilitante: list_fiscal_obligations (F-16).',
      parameters: {
        type: 'object',
        properties: {
          period_year: {
            type: 'number',
            description: 'Año del periodo gravable.',
          },
          period_month: {
            type: 'number',
            description: 'Mes del periodo gravable (1-12).',
          },
          period_quarter: {
            type: 'number',
            description: 'Trimestre del periodo gravable (1-4).',
          },
          types: {
            type: 'array',
            description:
              'Tipos a generar. Si se omite, el servicio deriva los que aplican al NIT.',
            items: { type: 'string', enum: OBLIGATION_TYPES },
          },
          force_refresh: {
            type: 'boolean',
            description:
              'true para refrescar fechas de las existentes no-finales. Por defecto false.',
          },
        },
        required: ['period_year'],
      },
      requiredPermissions: [PERM_OBLIGATIONS_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const label = `Obligaciones fiscales ${args?.period_year ?? '?'}${args?.period_month ? `-${String(args.period_month).padStart(2, '0')}` : ''}`;
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            label,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const payload: Record<string, unknown> = {};
        for (const f of [
          'period_year',
          'period_month',
          'period_quarter',
          'types',
          'force_refresh',
        ]) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(GenerateFiscalObligationsDto, payload);
        if (!validated.ok) {
          return writePreviewError(label, validated.message);
        }
        const types = validated.dto.types?.length
          ? validated.dto.types.join(', ')
          : 'las que apliquen al NIT (derivadas del servicio)';
        return {
          status: 'ok',
          target: label,
          changes: [
            {
              field: 'types',
              label: 'Tipos a generar',
              from: null,
              to: types,
            },
            {
              field: 'force_refresh',
              label: 'Refrescar existentes',
              from: null,
              to: validated.dto.force_refresh ? 'sí' : 'no (se conservan)',
            },
          ],
          message:
            'La generación es idempotente: no duplica obligaciones existentes. Verifica el resultado con list_fiscal_obligations (F-16).',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const payload: Record<string, unknown> = {};
        for (const f of [
          'period_year',
          'period_month',
          'period_quarter',
          'types',
          'force_refresh',
        ]) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(GenerateFiscalObligationsDto, payload);
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step: 'Corrige los campos del periodo y vuelve a proponer.',
          };
        }
        try {
          const created: any[] = await deps.obligationsService.generateForContext(
            resolved.fiscalCtx,
            validated.dto,
          );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            summary: `${created.length} obligación(es) generada(s)/verificada(s)`,
            obligations: created.map((o) => ({
              id: o.id,
              type: o.type,
              status: o.status,
              period_year: o.period_year,
              period_month: o.period_month ?? null,
              due_date: isoDate(o.due_date),
            })),
            next_step:
              'Revisa el detalle con list_fiscal_obligations (F-16).',
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'Las obligaciones no se generaron. Verifica el periodo y las responsabilidades del NIT.',
          };
        }
      }),
    },

    // ─── F-19: create_declaration_draft (write) ──────────────────────
    {
      name: 'create_declaration_draft',
      version: '1',
      domain: 'fiscal',
      description:
        'Crea (o refresca) un borrador de declaración tributaria para el NIT y periodo indicados, calculado por el dispatcher IVA/INC/retención desde los movimientos reales. El modelo NUNCA calcula impuestos: el servicio liquida. Cadena habilitante: list_fiscal_obligations (F-16) + get_declaration_draft (F-18).',
      parameters: {
        type: 'object',
        properties: {
          declaration_type: {
            type: 'string',
            enum: DECLARATION_TYPES,
            description: 'Tipo de declaración a liquidar.',
          },
          period_year: {
            type: 'number',
            description: 'Año del periodo gravable.',
          },
          period_month: {
            type: 'number',
            description: 'Mes del periodo gravable (1-12).',
          },
          period_quarter: {
            type: 'number',
            description: 'Trimestre del periodo gravable (1-4).',
          },
          obligation_id: {
            type: 'number',
            description:
              'ID de la obligación fiscal asociada (list_fiscal_obligations).',
          },
        },
        required: ['declaration_type', 'period_year'],
      },
      requiredPermissions: [PERM_DECLARATIONS_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const typeLabel =
          DECLARATION_TYPE_LABELS[String(args?.declaration_type)] ??
          String(args?.declaration_type ?? '?');
        const label = `${typeLabel} ${args?.period_year ?? '?'}`;
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            label,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const payload: Record<string, unknown> = {};
        for (const f of [
          'declaration_type',
          'period_year',
          'period_month',
          'period_quarter',
          'obligation_id',
        ]) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(CreateTaxDeclarationDraftDto, payload);
        if (!validated.ok) {
          return writePreviewError(label, validated.message);
        }
        let obligation: any = null;
        if (validated.dto.obligation_id) {
          try {
            obligation = await deps.obligationsService.findOne(
              [resolved.fiscalCtx],
              validated.dto.obligation_id,
            );
          } catch {
            obligation = null;
          }
          if (!obligation) {
            return writePreviewError(
              label,
              `La obligación ${validated.dto.obligation_id} no existe para este NIT. Resuélvela con list_fiscal_obligations (F-16).`,
            );
          }
        }
        return {
          status: 'ok',
          target: `${typeLabel} ${validated.dto.period_year}${validated.dto.period_month ? `-${String(validated.dto.period_month).padStart(2, '0')}` : ''}`,
          changes: [
            {
              field: 'draft',
              label: 'Borrador',
              from: null,
              to: 'liquidado desde los movimientos del periodo',
            },
            {
              field: 'obligation',
              label: 'Obligación asociada',
              from: null,
              to: obligation
                ? `#${obligation.id} ${obligation.type} (${obligation.status})`
                : 'sin asociar',
            },
          ],
          message:
            'El borrador nace en estado listo para revisión: no se aprueba ni se presenta solo. Revísalo con get_declaration_draft (F-18).',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const payload: Record<string, unknown> = {};
        for (const f of [
          'declaration_type',
          'period_year',
          'period_month',
          'period_quarter',
          'obligation_id',
        ]) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(CreateTaxDeclarationDraftDto, payload);
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step: 'Corrige los campos y vuelve a proponer.',
          };
        }
        try {
          const draft: any = await deps.declarationsService.createDraft(
            resolved.fiscalCtx,
            validated.dto,
          );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            created: {
              id: draft.id,
              declaration_type: draft.declaration_type,
              status: draft.status,
              obligation_id: draft.obligation_id ?? null,
              total_payable: money(draft.total_payable),
              balance_favor: money(draft.balance_favor),
              lines_count: (draft.lines ?? []).length,
            },
            next_step: `Revisa el borrador con get_declaration_draft (F-18) citando draft_id=${draft.id} antes de aprobar.`,
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El borrador no se creó. Verifica el periodo y que la obligación exista con list_fiscal_obligations (F-16).',
          };
        }
      }),
    },

    // ─── F-20: recalculate_declaration (write) ───────────────────────
    {
      name: 'recalculate_declaration',
      version: '1',
      domain: 'fiscal',
      description:
        'Recalcula un borrador de declaración desde los movimientos vigentes (útil cuando entraron asientos o documentos después de crearlo). Solo borradores no bloqueados: un borrador aprobado/presentado no se recalcula, se anula y se crea otro. Cadena habilitante: get_declaration_draft (F-18).',
      parameters: {
        type: 'object',
        properties: {
          draft_id: {
            type: 'number',
            description: 'ID del borrador a recalcular.',
          },
        },
        required: ['draft_id'],
      },
      requiredPermissions: [PERM_DECLARATIONS_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'recalcula',
        );
        if (!found.ok) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${found.message} ${found.nextStep}`,
          );
        }
        const draft = found.draft;
        if (LOCKED_DRAFT_STATUSES.includes(draft.status)) {
          return writePreviewError(
            draftSubject(draft),
            `El borrador está ${draft.status}: los borradores aprobados/presentados no se recalculan en sitio. Anúlalo y crea uno nuevo si los movimientos cambiaron.`,
          );
        }
        return {
          status: 'ok',
          target: draftSubject(draft),
          changes: [
            {
              field: 'lines',
              label: 'Líneas liquidadas',
              from: `${(draft.lines ?? []).length} línea(s), a pagar ${money(draft.total_payable)}`,
              to: 'reliquidadas desde los movimientos vigentes',
            },
          ],
          message:
            'El recálculo reescribe las líneas del borrador con los datos actuales del periodo.',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'recalcula',
        );
        if (!found.ok) {
          return { error: found.message, next_step: found.nextStep };
        }
        const draft = found.draft;
        if (LOCKED_DRAFT_STATUSES.includes(draft.status)) {
          return {
            error: `El borrador ${draft.id} pasó a ${draft.status} entre la propuesta y la aprobación: ya no se puede recalcular. No se cambió nada.`,
            next_step:
              'Revisa el estado vigente con get_declaration_draft (F-18).',
          };
        }
        try {
          const recalculated: any =
            await deps.declarationsService.recalculateDraft(
              [resolved.fiscalCtx],
              draft.id,
            );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            recalculated: {
              id: recalculated.id,
              declaration_type: recalculated.declaration_type,
              status: recalculated.status,
              total_payable: money(recalculated.total_payable),
              balance_favor: money(recalculated.balance_favor),
              lines_count: (recalculated.lines ?? []).length,
            },
            next_step: `Revisa el recálculo con get_declaration_draft (F-18) citando draft_id=${recalculated.id}.`,
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El borrador no se recalculó. Revisa su estado con get_declaration_draft (F-18).',
          };
        }
      }),
    },

    // ─── F-21: approve_declaration (write) ───────────────────────────
    {
      name: 'approve_declaration',
      version: '1',
      domain: 'fiscal',
      description:
        'Aprueba un borrador de declaración en estado listo: lo congela (ya no se recalcula) y, si es de IVA, dispara su liquidación contable. Requiere haberlo revisado con get_declaration_draft tras el último cambio. Cadena habilitante: get_declaration_draft (F-18) recalculada.',
      parameters: {
        type: 'object',
        properties: {
          draft_id: {
            type: 'number',
            description: 'ID del borrador listo a aprobar.',
          },
        },
        required: ['draft_id'],
      },
      requiredPermissions: [PERM_DECLARATIONS_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'aprueba',
        );
        if (!found.ok) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${found.message} ${found.nextStep}`,
          );
        }
        const draft = found.draft;
        if (draft.status === 'approved') {
          return writePreviewError(
            draftSubject(draft),
            'El borrador ya está aprobado: no hay nada que aprobar. Para presentarlo usa mark_declaration_submitted (F-22).',
          );
        }
        if (draft.status !== 'ready' && draft.status !== 'needs_review') {
          return writePreviewError(
            draftSubject(draft),
            `El borrador está ${draft.status}: solo se aprueban borradores listos (ready). Si los movimientos cambiaron, recalcúlalo primero con recalculate_declaration (F-20).`,
          );
        }
        return {
          status: 'warning',
          target: draftSubject(draft),
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: draft.status,
              to: 'approved',
            },
            {
              field: 'totals',
              label: 'A pagar / a favor',
              from: null,
              to: `${money(draft.total_payable)} / ${money(draft.balance_favor)}`,
            },
          ],
          message:
            'Aprobar congela el borrador: ya no se puede recalcular. Si es de IVA, además se dispara su liquidación contable (asiento de neteo).',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'aprueba',
        );
        if (!found.ok) {
          return { error: found.message, next_step: found.nextStep };
        }
        const draft = found.draft;
        if (draft.status === 'approved') {
          return {
            error: `El borrador ${draft.id} ya está aprobado. No se cambió nada.`,
            next_step:
              'Para presentarlo usa mark_declaration_submitted (F-22).',
          };
        }
        if (draft.status !== 'ready' && draft.status !== 'needs_review') {
          return {
            error: `El borrador ${draft.id} está ${draft.status}: solo se aprueban borradores listos. No se aprobó nada.`,
            next_step:
              'Si los movimientos cambiaron, recalcúlalo con recalculate_declaration (F-20) y vuelve a proponer.',
          };
        }
        try {
          const approved: any = await deps.declarationsService.approveDraft(
            [resolved.fiscalCtx],
            draft.id,
          );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            approved: {
              id: approved.id,
              declaration_type: approved.declaration_type,
              status: approved.status,
              total_payable: money(approved.total_payable),
              balance_favor: money(approved.balance_favor),
            },
            next_step:
              'Borrador aprobado y congelado. Para dejar constancia de su presentación usa mark_declaration_submitted (F-22).',
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El borrador no se aprobó. Revisa su estado con get_declaration_draft (F-18).',
          };
        }
      }),
    },

    // ─── F-22: mark_declaration_submitted (write) ────────────────────
    {
      name: 'mark_declaration_submitted',
      version: '1',
      domain: 'fiscal',
      description:
        'Deja constancia de que una declaración APROBADA ya se presentó ante la DIAN (fecha, referencia externa y notas). No presenta nada ante la DIAN: registra la presentación que el usuario hizo por su cuenta. Cadena habilitante: get_declaration_draft (F-18) aprobada.',
      parameters: {
        type: 'object',
        properties: {
          draft_id: {
            type: 'number',
            description: 'ID del borrador aprobado.',
          },
          submitted_at: {
            type: 'string',
            description: 'Fecha/hora de la presentación (ISO).',
          },
          external_reference: {
            type: 'string',
            description:
              'Referencia externa (ej. número de radicado DIAN).',
          },
          notes: {
            type: 'string',
            description: 'Notas de la presentación.',
          },
        },
        required: ['draft_id', 'submitted_at'],
      },
      requiredPermissions: [PERM_DECLARATIONS_WRITE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'marca como presentada',
        );
        if (!found.ok) {
          return writePreviewError(
            `Borrador #${args?.draft_id ?? '?'}`,
            `${found.message} ${found.nextStep}`,
          );
        }
        const draft = found.draft;
        if (draft.status !== 'approved' && draft.status !== 'rejected') {
          return writePreviewError(
            draftSubject(draft),
            `El borrador está ${draft.status}: solo se marca como presentada una declaración aprobada. Apruébala primero con approve_declaration (F-21).`,
          );
        }
        const payload: Record<string, unknown> = {};
        for (const f of ['submitted_at', 'external_reference', 'notes']) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(MarkFiscalSubmittedDto, payload);
        if (!validated.ok) {
          return writePreviewError(draftSubject(draft), validated.message);
        }
        return {
          status: 'ok',
          target: draftSubject(draft),
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: draft.status,
              to: 'submitted',
            },
            {
              field: 'submitted_at',
              label: 'Presentada el',
              from: null,
              to: validated.dto.submitted_at,
            },
            ...(validated.dto.external_reference
              ? [
                  {
                    field: 'external_reference',
                    label: 'Referencia',
                    from: null,
                    to: validated.dto.external_reference,
                  },
                ]
              : []),
          ],
          message:
            'Esto registra la presentación, no la hace: la declaración debe haberse presentado ante la DIAN por los canales oficiales.',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const found = await resolveDraft(
          resolved.fiscalCtx,
          args ?? {},
          'marca como presentada',
        );
        if (!found.ok) {
          return { error: found.message, next_step: found.nextStep };
        }
        const draft = found.draft;
        if (draft.status !== 'approved' && draft.status !== 'rejected') {
          return {
            error: `El borrador ${draft.id} está ${draft.status}: solo se marca como presentada una declaración aprobada. No se cambió nada.`,
            next_step: 'Apruébala primero con approve_declaration (F-21).',
          };
        }
        const payload: Record<string, unknown> = {};
        for (const f of ['submitted_at', 'external_reference', 'notes']) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        const validated = toValidatedDto(MarkFiscalSubmittedDto, payload);
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step:
              'Corrige submitted_at (ISO) y vuelve a proponer.',
          };
        }
        try {
          const submitted: any = await deps.declarationsService.markSubmitted(
            [resolved.fiscalCtx],
            draft.id,
            validated.dto,
          );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            submitted: {
              id: submitted.id,
              declaration_type: submitted.declaration_type,
              status: submitted.status,
              submitted_at: submitted.submitted_at,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'La declaración no se marcó como presentada. Si exige evidencia adjunta, súbela desde el módulo fiscal.',
          };
        }
      }),
    },

    // ─── F-23: list_close_sessions (read) ────────────────────────────
    {
      name: 'list_close_sessions',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Lista las sesiones de cierre fiscal del NIT con su estado, periodo y resumen de checks (pasados, fallidos, bloqueantes). Úsala para responder "cómo va el cierre" o para resolver el session_id que exigen run_close_checks (F-24) y close_fiscal_session (F-25).',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: CLOSE_STATUSES,
            description: 'Filtra por estado de la sesión.',
          },
          period_year: {
            type: 'number',
            description: 'Filtra por año del periodo.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de sesiones. Por defecto 20, tope 50.',
          },
        },
      },
      requiredPermissions: [PERM_CLOSE_READ],
      handler: guard(async (args, context) => {
        if (
          args.status !== undefined &&
          !(CLOSE_STATUSES as readonly string[]).includes(String(args.status))
        ) {
          return {
            error: `status "${args.status}" inválido. Valores válidos: ${CLOSE_STATUSES.join(', ')}.`,
            next_step:
              'Repite con uno de los estados listados, u omite el filtro para ver todas las sesiones.',
          };
        }

        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
        const sessions: any[] = await deps.closeService.list(
          [resolved.fiscalCtx],
          {
            ...(args.status && { status: String(args.status) }),
            ...(args.period_year && {
              period_year: Number(args.period_year),
            }),
          } as any,
        );

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          summary: `${sessions.length} sesión(es) de cierre del NIT`,
          filters: {
            status: args.status ?? null,
            period_year: args.period_year ?? null,
          },
          sessions: sessions.slice(0, limit).map((s) => ({
            id: s.id,
            close_type: s.close_type,
            status: s.status,
            period_year: s.period_year,
            period_month: s.period_month ?? null,
            period_start: isoDate(s.period_start),
            period_end: isoDate(s.period_end),
            fiscal_period_id: s.fiscal_period_id ?? null,
            store: s.store?.name ?? null,
            checks: summarizeChecks(s),
            closed_at: isoDate(s.closed_at),
          })),
          sessions_total: sessions.length,
          sessions_omitted: Math.max(0, sessions.length - limit),
        };
      }),
    },

    // ─── F-24: run_close_checks (write) ──────────────────────────────
    {
      name: 'run_close_checks',
      version: '1',
      domain: 'fiscal',
      description:
        'Re-ejecuta los checks de una sesión de cierre fiscal (asientos en borrador, documentos DIAN pendientes, conciliaciones…) y persiste sus resultados. No cierra nada: solo evalúa. Los overrides manuales auditados se preservan. Cadena habilitante: list_close_sessions (F-23) + get_fiscal_checklist (F-26).',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión de cierre.',
          },
        },
        required: ['session_id'],
      },
      requiredPermissions: [PERM_CLOSE_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            `Sesión de cierre #${args?.session_id ?? '?'}`,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const found = await resolveCloseSession(
          resolved.fiscalCtx,
          args ?? {},
          'evalúa',
        );
        if (!found.ok) {
          return writePreviewError(
            `Sesión de cierre #${args?.session_id ?? '?'}`,
            `${found.message} ${found.nextStep}`,
          );
        }
        const session = found.session;
        if (session.status === 'closed') {
          return writePreviewError(
            closeSubject(session),
            'La sesión ya está cerrada: no hay checks que re-evaluar.',
          );
        }
        return {
          status: 'ok',
          target: closeSubject(session),
          changes: [
            {
              field: 'checks',
              label: 'Checks a re-evaluar',
              from: `${(session.checks ?? []).length} registrado(s)`,
              to: 'resultados frescos persistidos',
            },
          ],
          message:
            'Solo evalúa y persiste: no cierra la sesión ni el periodo. Los overrides manuales se preservan.',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const found = await resolveCloseSession(
          resolved.fiscalCtx,
          args ?? {},
          'evalúa',
        );
        if (!found.ok) {
          return { error: found.message, next_step: found.nextStep };
        }
        if (found.session.status === 'closed') {
          return {
            error: `La sesión ${found.session.id} ya está cerrada. No se evaluó nada.`,
            next_step: 'Lista las sesiones abiertas con list_close_sessions (F-23).',
          };
        }
        try {
          const evaluated: any = await deps.closeService.runChecks(
            [resolved.fiscalCtx],
            found.session.id,
          );
          const checks = (evaluated.checks ?? []) as any[];
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            evaluated: {
              session_id: evaluated.id,
              status: evaluated.status,
              summary: summarizeChecks(evaluated),
              checks: checks.map((c) => ({
                check_key: c.check_key,
                title: c.title,
                status: c.status,
                blocking: c.blocking,
                result_summary: c.result_summary ?? null,
              })),
            },
            next_step:
              'Si no quedan fallos bloqueantes, la sesión puede aprobarse y cerrarse con close_fiscal_session (F-25).',
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'Los checks no se evaluaron. Revisa la sesión con list_close_sessions (F-23).',
          };
        }
      }),
    },

    // ─── F-25: close_fiscal_session (write) ──────────────────────────
    {
      name: 'close_fiscal_session',
      version: '1',
      domain: 'fiscal',
      description:
        'Cierra una sesión de cierre fiscal aprobada o lista: re-valida los checks en caliente y, si no hay fallos bloqueantes, cierra la sesión Y su periodo fiscal vinculado. Es la acción de control más fuerte del ciclo fiscal. Cadena habilitante: list_close_sessions (F-23) + get_fiscal_checklist (F-26) + run_close_checks (F-24).',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'number',
            description: 'ID de la sesión aprobada o lista.',
          },
        },
        required: ['session_id'],
      },
      requiredPermissions: [PERM_CLOSE_WRITE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) {
          return writePreviewError(
            `Sesión de cierre #${args?.session_id ?? '?'}`,
            `${resolved.error} ${resolved.next_step}`,
          );
        }
        const found = await resolveCloseSession(
          resolved.fiscalCtx,
          args ?? {},
          'cierra',
        );
        if (!found.ok) {
          return writePreviewError(
            `Sesión de cierre #${args?.session_id ?? '?'}`,
            `${found.message} ${found.nextStep}`,
          );
        }
        const session = found.session;
        if (session.status !== 'approved' && session.status !== 'ready') {
          return writePreviewError(
            closeSubject(session),
            `La sesión está ${session.status}: solo se cierran sesiones aprobadas o listas. Corre run_close_checks (F-24) y apruébala desde el módulo fiscal.`,
          );
        }
        const summary = summarizeChecks(session);
        if (summary.failed_blocking_keys.length) {
          return writePreviewError(
            closeSubject(session),
            `Tiene ${summary.failed_blocking_keys.length} check(s) bloqueante(s) fallido(s): ${summary.failed_blocking_keys.join(', ')}. Resuélvelos u obtén un override auditado antes de cerrar.`,
          );
        }
        return {
          status: 'warning',
          target: closeSubject(session),
          changes: [
            {
              field: 'status',
              label: 'Estado de la sesión',
              from: session.status,
              to: 'closed',
            },
            {
              field: 'fiscal_period',
              label: 'Periodo fiscal vinculado',
              from: 'open',
              to: session.fiscal_period_id
                ? `cerrado (periodo #${session.fiscal_period_id})`
                : 'sin periodo vinculado (solo se cierra la sesión)',
            },
          ],
          message:
            'Cerrar es irreversible en la práctica: la sesión y su periodo fiscal dejan de aceptar movimientos. Al aplicar se re-validan los checks en caliente.',
          domain: 'fiscal',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;
        const found = await resolveCloseSession(
          resolved.fiscalCtx,
          args ?? {},
          'cierra',
        );
        if (!found.ok) {
          return { error: found.message, next_step: found.nextStep };
        }
        const session = found.session;
        if (session.status !== 'approved' && session.status !== 'ready') {
          return {
            error: `La sesión ${session.id} está ${session.status}: solo se cierran sesiones aprobadas o listas. No se cerró nada.`,
            next_step:
              'Corre run_close_checks (F-24) y revisa list_close_sessions (F-23).',
          };
        }
        try {
          const closed: any = await deps.closeService.close(
            [resolved.fiscalCtx],
            session.id,
          );
          return {
            accounting_entity: entityTag(resolved.fiscalCtx),
            closed: {
              id: closed.id,
              close_type: closed.close_type,
              status: closed.status,
              period_year: closed.period_year,
              period_month: closed.period_month ?? null,
              closed_at: isoDate(closed.closed_at),
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'La sesión no se cerró. Si la re-validación en caliente encontró fallos bloqueantes, resuélvelos y repite run_close_checks (F-24).',
          };
        }
      }),
    },

    // ─── F-26: get_fiscal_checklist (read) ───────────────────────────
    {
      name: 'get_fiscal_checklist',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Checklist de configuración fiscal de la tienda: qué prerrequisitos están completos (identidad fiscal, DIAN, PUC, periodos, impuestos, mapeos, resoluciones) y cuáles bloquean la operación, cada uno con su ruta de solución. Úsala antes de proponer cualquier write fiscal: si algo falta, manda al usuario a configurarlo en vez de proponer a ciegas.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_DASHBOARD],
      handler: guard(async (_args, context) => {
        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const checklist: any = await deps.checklistService.build(
          resolved.fiscalCtx,
        );
        const items = (checklist.items ?? []) as any[];
        const blockers = items.filter(
          (i) => !i.complete && i.severity === 'blocker',
        );

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          completion_pct: checklist.completion_pct,
          summary:
            blockers.length === 0
              ? 'Configuración fiscal completa: ningún bloqueante pendiente.'
              : `${blockers.length} bloqueante(s) pendiente(s) de ${items.length} ítems.`,
          blockers: blockers.map((b) => ({
            key: b.key,
            label: b.label,
            detail: b.detail,
            action: b.action ?? null,
          })),
          items: items.map((i) => ({
            key: i.key,
            label: i.label,
            complete: i.complete,
            severity: i.severity,
            detail: i.detail,
            action: i.action ?? null,
          })),
        };
      }),
    },

    // ─── F-27: list_invoices (read) ──────────────────────────────────
    {
      name: 'list_invoices',
      version: '1',
      domain: 'fiscal',
      readOnly: true,
      description:
        'Lista las facturas y documentos electrónicos de la tienda con número, estado, adquiriente, totales y estado DIAN. Acepta filtros por estado y búsqueda por texto. Úsala para responder "qué facturas hay" o para resolver el documento que citará un write de facturación. Solo lectura.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: INVOICE_STATUSES,
            description: 'Filtra por estado del documento.',
          },
          search: {
            type: 'string',
            description:
              'Busca por número de documento o nombre del adquiriente.',
          },
          page: {
            type: 'number',
            description: 'Página de resultados. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Documentos por página. Por defecto 10, tope 50.',
          },
        },
      },
      requiredPermissions: [PERM_INVOICES],
      handler: guard(async (args, context) => {
        if (
          args.status !== undefined &&
          !(INVOICE_STATUSES as readonly string[]).includes(String(args.status))
        ) {
          return {
            error: `status "${args.status}" inválido. Valores válidos: ${INVOICE_STATUSES.join(', ')}.`,
            next_step:
              'Repite con uno de los estados listados, u omite el filtro para ver todos los documentos.',
          };
        }

        const resolved = await resolveGuardedContext(context);
        if ('error' in resolved) return resolved;

        const page = Math.max(Number(args.page) || 1, 1);
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

        const result: any = await deps.invoicesService.findAll({
          page,
          limit,
          sort_by: 'created_at',
          sort_order: 'desc',
          ...(args.status && { status: String(args.status) }),
          ...(args.search && { search: String(args.search) }),
        } as any);

        const data = (result.data ?? []) as any[];
        const total = result.meta?.total ?? data.length;

        return {
          accounting_entity: entityTag(resolved.fiscalCtx),
          summary: `${data.length} documento(s) de ${total} que coinciden con el filtro`,
          filters: {
            status: args.status ?? null,
            search: args.search ?? null,
          },
          invoices: data.map((inv) => ({
            id: inv.id,
            number: inv.invoice_number ?? inv.document_number ?? null,
            prefix: inv.prefix ?? null,
            invoice_type: inv.invoice_type ?? null,
            status: inv.status,
            issue_date: isoDate(inv.issue_date ?? inv.created_at),
            customer: inv.customer_name ?? inv.customer?.name ?? null,
            customer_tax_id:
              inv.customer_tax_id ?? inv.customer?.document_number ?? null,
            subtotal: money(inv.subtotal),
            tax_amount: money(inv.tax_amount ?? inv.total_tax),
            total: money(inv.total_amount ?? inv.total),
            dian_status: inv.dian_status ?? inv.send_status ?? null,
            cufe: inv.cufe ?? null,
          })),
          page,
          limit,
          total_matching: total,
        };
      }),
    },
  ];
}
