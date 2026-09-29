import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { AccountingReportsService } from '../../../domains/store/accounting/reports/accounting-reports.service';
import { FiscalPeriodsService } from '../../../domains/store/accounting/fiscal-periods/fiscal-periods.service';
import { JournalEntriesService } from '../../../domains/store/accounting/journal-entries/journal-entries.service';
import { JournalEntryFlowService } from '../../../domains/store/accounting/journal-entries/journal-entry-flow.service';
import { ChartOfAccountsService } from '../../../domains/store/accounting/chart-of-accounts/chart-of-accounts.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccountMappingService } from '../../../domains/store/accounting/account-mappings/account-mapping.service';
import { AccountingEntryFailureService } from '../../../domains/store/accounting/auto-entries/accounting-entry-failure.service';
import { CreateJournalEntryDto } from '../../../domains/store/accounting/journal-entries/dto/create-journal-entry.dto';
import { CreateFiscalPeriodDto } from '../../../domains/store/accounting/fiscal-periods/dto/create-fiscal-period.dto';
import { CreateAccountDto } from '../../../domains/store/accounting/chart-of-accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../../../domains/store/accounting/chart-of-accounts/dto/update-account.dto';

/**
 * Familia contable de Vexi: 11 reads + 10 writes (F-2..F-13).
 *
 * Los writes (asientos, periodos, PUC, mapeos, reintentos) exigen
 * `requiresConfirmation` + `preview` con sujeto humano, y cada uno cita su
 * read habilitante del paso 6 (F-1/F-9/F-12, `list_fiscal_periods`,
 * `find_puc_account`). El `handler` re-verifica sus precondiciones porque el
 * `preview` es proyección, no transacción. Toda escritura pasa por el servicio
 * dueño (`JournalEntriesService`, `JournalEntryFlowService`,
 * `FiscalPeriodsService`, `ChartOfAccountsService`, `AccountMappingService`,
 * `AccountingEntryFailureService`): cero `prisma.` nuevo en este archivo.
 *
 * Contrato fiscal (ver skill `vendix-fiscal-scope`): la contabilidad de Vendix
 * vive por ENTIDAD CONTABLE (`accounting_entity_id`), no por tienda. Aquí no se
 * resuelve la entidad a mano: se delega en los servicios del dominio, que ya la
 * derivan del `RequestContextService` — `FiscalPeriodsService` y
 * `ChartOfAccountsService` vía `FiscalScopeService.resolveAccountingEntityForFiscal`,
 * y `AccountingReportsService` / `JournalEntriesService` vía el auto-scoping de
 * `StorePrismaService` (`chart_of_accounts`, `fiscal_periods`,
 * `accounting_entries` y `accounting_entry_lines` están registrados como
 * `fiscal_entity_scoped_models`). Reimplementar la resolución aquí sería la
 * forma más rápida de que Vexi afirme cifras del NIT equivocado.
 *
 * Por esa misma razón toda respuesta viaja etiquetada con `accounting_entity`
 * (nombre + NIT + alcance fiscal): si el modelo va a decir un número fiscal,
 * que pueda decir también de quién es.
 *
 * Los importes van crudos, sin formato y sin símbolo de moneda: la contabilidad
 * se lleva en la moneda funcional del tenant y quien presenta al usuario es
 * quien formatea (ver skill `vendix-currency-formatting`).
 */

export interface AccountingToolDeps {
  reportsService: AccountingReportsService;
  fiscalPeriodsService: FiscalPeriodsService;
  journalEntriesService: JournalEntriesService;
  /** Dueño de post/void: único que mueve `accounting_entries.status`. */
  entryFlowService: JournalEntryFlowService;
  chartOfAccountsService: ChartOfAccountsService;
  fiscalScopeService: FiscalScopeService;
  prisma: StorePrismaService;
  accountMappingService: AccountMappingService;
  entryFailureService: AccountingEntryFailureService;
}

const PERM_REPORTS = 'store:accounting:reports:read';
const PERM_PERIODS = 'store:accounting:fiscal_periods:read';
const PERM_PERIODS_CREATE = 'store:accounting:fiscal_periods:create';
const PERM_PERIODS_UPDATE = 'store:accounting:fiscal_periods:update';
const PERM_JOURNAL = 'store:accounting:journal_entries:read';
const PERM_JOURNAL_CREATE = 'store:accounting:journal_entries:create';
const PERM_JOURNAL_POST = 'store:accounting:journal_entries:post';
const PERM_JOURNAL_VOID = 'store:accounting:journal_entries:void';
const PERM_JOURNAL_UPDATE = 'store:accounting:journal_entries:update';
const PERM_CHART = 'store:accounting:chart_of_accounts:read';
const PERM_CHART_CREATE = 'store:accounting:chart_of_accounts:create';
const PERM_CHART_UPDATE = 'store:accounting:chart_of_accounts:update';
const PERM_MAPPINGS = 'store:accounting:account_mappings:read';
const PERM_MAPPINGS_UPDATE = 'store:accounting:account_mappings:update';
const PERM_MAPPINGS_RESET = 'store:accounting:account_mappings:create';

/** Tolerancia de balance débito=crédito, igual que el servicio dueño. */
const BALANCE_TOLERANCE = 0.001;

/** Resultado uniforme de una resolución previa a escribir. */
type WriteResolution<T> =
  | { ok: true; value: T }
  | { ok: false; label: string; message: string; nextStep?: string };

function writeFailure(
  label: string,
  message: string,
  nextStep?: string,
): { ok: false; label: string; message: string; nextStep?: string } {
  return { ok: false, label, message, nextStep };
}

/** `ToolPreview` de error: el registry aborta sin acuñar token. */
function writePreviewError(
  label: string,
  message: string,
  domain = 'accounting',
): ToolPreview {
  return { status: 'error', target: label, changes: [], message, domain };
}

/**
 * Valida un DTO ya construido como lo haría el `ValidationPipe` global del
 * HTTP (`whitelist` + `forbidNonWhitelisted`): las tools llaman a los
 * servicios directo, sin pasar por el pipe. Misma doctrina que
 * `writes.tools.ts`.
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

const ENTRY_TYPES = [
  'manual',
  'auto_invoice',
  'auto_payment',
  'auto_expense',
  'auto_payroll',
  'auto_inventory',
  'auto_purchase',
  'auto_return',
  'adjustment',
  'auto_installment_payment',
  'auto_depreciation',
] as const;

const ENTRY_STATUSES = ['draft', 'posted', 'voided'] as const;

const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
] as const;

/**
 * Signo por naturaleza. NO es lógica contable nueva: es exactamente el
 * criterio que `AccountingReportsService` ya usa para totalizar el estado de
 * resultados y el balance (`signedBalance`, commit 7739c9ba). Se replica aquí
 * sólo para que el detalle por cuenta que devolvemos sea coherente con los
 * totales que devuelve el servicio; nunca `Math.abs`.
 */
const signedByNature = (nature: string, balance: number) =>
  nature === 'credit' ? -balance : balance;

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

/**
 * El bucle del agente le entrega el resultado de la herramienta al modelo tal
 * cual. Un throw se convierte en un error opaco; un `{error}` explicativo el
 * modelo sí sabe traducirlo al usuario ("no tienes periodos fiscales abiertos"
 * en vez de "Tool failed").
 */
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

export function createAccountingTools(
  deps: AccountingToolDeps,
): RegisteredTool[] {
  /**
   * Lectura pura de la entidad contable vigente. Usa
   * `findFiscalAccountingEntityId`, que NUNCA crea filas (a diferencia de
   * `resolveAccountingEntityForFiscal`), porque una herramienta de sólo lectura
   * no debe materializar una entidad fiscal como efecto colateral.
   */
  async function describeFiscalEntity(context: ToolExecutionContext) {
    if (!context.organization_id) return null;
    const entity_id = await deps.fiscalScopeService.findFiscalAccountingEntityId(
      {
        organization_id: context.organization_id,
        store_id: context.store_id ?? null,
      },
    );
    if (!entity_id) return null;

    const entity: any = await deps.prisma.accounting_entities.findFirst({
      where: { id: entity_id },
      select: {
        id: true,
        name: true,
        legal_name: true,
        tax_id: true,
        scope: true,
        fiscal_scope: true,
        store_id: true,
      },
    });
    if (!entity) return null;

    return {
      id: entity.id,
      name: entity.legal_name || entity.name,
      tax_id: entity.tax_id,
      fiscal_scope: entity.fiscal_scope,
      operating_scope: entity.scope,
      store_id: entity.store_id,
    };
  }

  function parseAnchorDate(raw: unknown): Date | null {
    if (!raw) {
      // Medianoche UTC del día vigente: `accounting_entries.entry_date` se
      // persiste normalizada a medianoche UTC del día local de la tienda
      // (AutoEntryService.resolveEntryDate), así que comparar contra un
      // instante con hora produce falsos negativos en el último día del mes.
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
    }
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Los reportes contables se piden por periodo fiscal, pero el usuario habla
   * en fechas ("julio", "este mes"). Esto sólo elige el periodo; no calcula
   * nada contable.
   */
  async function resolveFiscalPeriod(args: Record<string, any>) {
    const periods: any[] = (await deps.fiscalPeriodsService.findAll()) as any[];

    if (!periods.length) {
      return {
        error:
          'La entidad contable no tiene periodos fiscales creados todavía, así que no hay nada que reportar. Se crean en Contabilidad → Periodos fiscales.',
      };
    }

    if (args.fiscal_period_id !== undefined && args.fiscal_period_id !== null) {
      const wanted = Number(args.fiscal_period_id);
      const found = periods.find((p) => p.id === wanted);
      if (!found) {
        return {
          error: `No existe el periodo fiscal ${wanted} para esta entidad contable. Periodos disponibles: ${periods
            .slice(0, 12)
            .map((p) => `${p.id}=${p.name}`)
            .join(', ')}.`,
        };
      }
      return { period: found, selection: 'explícito por fiscal_period_id' };
    }

    const anchor = parseAnchorDate(args.date_to ?? args.date_from);
    if (!anchor) {
      return {
        error: `Fecha inválida: "${args.date_to ?? args.date_from}". Usa el formato YYYY-MM-DD.`,
      };
    }

    const containing = periods.find(
      (p) => new Date(p.start_date) <= anchor && new Date(p.end_date) >= anchor,
    );
    if (containing) {
      return {
        period: containing,
        selection: `periodo que contiene ${anchor.toISOString().slice(0, 10)}`,
      };
    }

    // findAll() ordena por start_date desc.
    return {
      period: periods[0],
      selection: `ningún periodo cubre ${anchor
        .toISOString()
        .slice(0, 10)}; se usó el más reciente`,
    };
  }

  function periodSummary(period: any) {
    return {
      id: period.id,
      name: period.name,
      start_date: isoDate(period.start_date),
      end_date: isoDate(period.end_date),
      status: period.status,
    };
  }

  /** Recorta una sección del reporte a las N cuentas de mayor magnitud. */
  function topAccounts(accounts: any[], max: number) {
    const mapped = accounts.map((a) => ({
      code: a.account_code,
      name: a.account_name,
      nature: a.nature,
      total_debit: money(a.total_debit),
      total_credit: money(a.total_credit),
      balance: money(signedByNature(a.nature, Number(a.balance ?? 0))),
    }));
    const sorted = [...mapped].sort(
      (a, b) => Math.abs(b.balance) - Math.abs(a.balance),
    );
    return {
      accounts: sorted.slice(0, max),
      accounts_omitted: Math.max(0, sorted.length - max),
      accounts_total: sorted.length,
    };
  }

  const SIGN_NOTE =
    'Saldos con signo por naturaleza (las cuentas de naturaleza crédito se muestran CR-DR). Un valor negativo significa saldo contrario a la naturaleza de la cuenta.';

  // ─── Resolutores compartidos preview ↔ handler (writes F-2..F-13) ───
  //
  // Cada resolutor corre DOS veces: en el `preview` para proponer y en el
  // `handler` para aplicar. Son dos lecturas distintas del mundo a propósito:
  // entre la propuesta y la aprobación el periodo pudo cerrarse, la cuenta
  // desactivarse o el asiento cambiar de estado.

  interface DraftLineInput {
    account_code: string;
    debit: number;
    credit: number;
    description?: string;
  }

  interface ResolvedDraftLine extends DraftLineInput {
    account_id: number;
    account_name: string;
  }

  interface ResolvedJournalDraft {
    dto: CreateJournalEntryDto;
    period: any;
    lines: ResolvedDraftLine[];
    total_debit: number;
    total_credit: number;
    label: string;
  }

  function parseDraftLines(raw: unknown): DraftLineInput[] | null {
    if (!Array.isArray(raw)) return null;
    const parsed: DraftLineInput[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') return null;
      const account_code = cleanString((row as any).account_code);
      const debit = Number((row as any).debit ?? 0);
      const credit = Number((row as any).credit ?? 0);
      if (!account_code || !Number.isFinite(debit) || !Number.isFinite(credit))
        return null;
      parsed.push({
        account_code,
        debit,
        credit,
        description: cleanString((row as any).description),
      });
    }
    return parsed;
  }

  /**
   * Resuelve y valida un borrador de asiento manual.
   * Cadena habilitante: F-9 (`list_account_mappings`, qué cuenta toca cada
   * evento) + periodo abierto (`list_fiscal_periods`).
   */
  async function resolveJournalDraft(
    args: Record<string, any>,
  ): Promise<WriteResolution<ResolvedJournalDraft>> {
    const label = 'Asiento manual en borrador';

    const fiscal_period_id = toPositiveInt(args.fiscal_period_id);
    if (!fiscal_period_id) {
      return writeFailure(
        label,
        'fiscal_period_id inválido: indica el periodo fiscal donde va el asiento.',
        'Resuelve el periodo con list_fiscal_periods y repite con su ID.',
      );
    }

    const lines = parseDraftLines(args.lines);
    if (!lines || lines.length < 2) {
      return writeFailure(
        label,
        'El asiento necesita al menos 2 líneas con account_code, debit y credit.',
        'Pide al usuario las cuentas (códigos PUC) y los valores de cada lado del asiento.',
      );
    }

    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        return writeFailure(
          label,
          `La línea de la cuenta ${line.account_code} trae valores negativos: usa débitos y créditos positivos.`,
        );
      }
      const has_debit = line.debit > 0;
      const has_credit = line.credit > 0;
      if (has_debit && has_credit) {
        return writeFailure(
          label,
          `La línea de la cuenta ${line.account_code} trae débito Y crédito: cada línea va por un solo lado.`,
        );
      }
      if (!has_debit && !has_credit) {
        return writeFailure(
          label,
          `La línea de la cuenta ${line.account_code} está en ceros: cada línea debe mover algún valor.`,
        );
      }
    }

    const total_debit = lines.reduce((sum, l) => sum + l.debit, 0);
    const total_credit = lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(total_debit - total_credit) > BALANCE_TOLERANCE) {
      return writeFailure(
        label,
        `Asiento desbalanceado: débitos ${total_debit} vs créditos ${total_credit} (diferencia ${Math.abs(total_debit - total_credit)}).`,
        'Ajusta las líneas para que débito total = crédito total (±0.001) y vuelve a proponer.',
      );
    }

    let period: any;
    try {
      period = await deps.fiscalPeriodsService.findOne(fiscal_period_id);
    } catch {
      period = null;
    }
    if (!period) {
      return writeFailure(
        label,
        `No existe el periodo fiscal ${fiscal_period_id} para esta entidad contable.`,
        'Lista los periodos con list_fiscal_periods y usa un ID existente.',
      );
    }
    if (period.status !== 'open') {
      return writeFailure(
        label,
        `El periodo "${period.name}" está ${period.status}: los asientos nuevos solo entran en un periodo abierto.`,
        'Elige un periodo abierto con list_fiscal_periods (filtro status=open).',
      );
    }

    const resolved_lines: ResolvedDraftLine[] = [];
    for (const line of lines) {
      const account: any = await deps.chartOfAccountsService.findByCode(
        line.account_code,
      );
      if (!account) {
        return writeFailure(
          label,
          `La cuenta PUC ${line.account_code} no existe en el plan de cuentas de esta entidad.`,
          'Busca el código correcto con find_puc_account antes de proponer el asiento.',
        );
      }
      if (!account.accepts_entries) {
        return writeFailure(
          label,
          `La cuenta ${account.code} ${account.name} es agrupadora: no acepta movimientos directos.`,
          'Usa una subcuenta hoja (find_puc_account con only_postable=true).',
        );
      }
      resolved_lines.push({
        ...line,
        account_id: account.id,
        account_name: account.name,
      });
    }

    const entry_date = cleanString(args.entry_date);
    const validated = toValidatedDto(CreateJournalEntryDto, {
      entry_type: 'manual',
      fiscal_period_id,
      ...(entry_date && { entry_date }),
      ...(cleanString(args.description) && {
        description: cleanString(args.description),
      }),
      lines: resolved_lines.map((l) => ({
        account_id: l.account_id,
        debit_amount: l.debit,
        credit_amount: l.credit,
        ...(l.description && { description: l.description }),
      })),
    });
    if (!validated.ok) {
      return writeFailure(label, validated.message);
    }

    const subject =
      cleanString(args.description) ??
      `Asiento manual del ${entry_date ?? 'día de hoy'}`;
    return {
      ok: true,
      value: {
        dto: validated.dto,
        period,
        lines: resolved_lines,
        total_debit,
        total_credit,
        label: subject,
      },
    };
  }

  /** Lee un asiento o devuelve el fallo guiado (base de F-3/F-4). */
  async function resolveEntryForFlow(
    args: Record<string, any>,
    action: string,
  ): Promise<WriteResolution<any>> {
    const label = `Asiento #${args.entry_id ?? '?'}`;
    const entry_id = toPositiveInt(args.entry_id);
    if (!entry_id) {
      return writeFailure(
        label,
        'entry_id inválido: pasa el ID numérico del asiento.',
        'Resuelve el asiento con get_recent_journal_entries o get_journal_entry (F-1) y repite con su ID.',
      );
    }
    let entry: any;
    try {
      entry = await deps.journalEntriesService.findOne(entry_id);
    } catch {
      entry = null;
    }
    if (!entry) {
      return writeFailure(
        `Asiento #${entry_id}`,
        `No existe el asiento ${entry_id} para esta entidad contable. No se ${action}.`,
        'Verifica el ID con get_recent_journal_entries.',
      );
    }
    return { ok: true, value: entry };
  }

  function entrySubject(entry: any): string {
    const head = entry.entry_number ?? `asiento #${entry.id}`;
    return entry.description ? `${head} — ${entry.description}` : head;
  }

  return [
    // ─── 1. list_fiscal_periods ──────────────────────────────────────
    {
      name: 'list_fiscal_periods',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Lista los periodos fiscales de la entidad contable (nombre, rango de fechas, si está abierto o cerrado y cuántos asientos tiene). Úsala cuando el usuario pregunte por periodos o cierres contables, o como paso previo cuando necesites el fiscal_period_id exacto para un reporte y el usuario mencionó un periodo por su nombre ("el cierre de junio").',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'closing', 'closed'],
            description: 'Filtra por estado del periodo.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de periodos a devolver. Por defecto 12, tope 36.',
          },
        },
      },
      requiredPermissions: [PERM_PERIODS],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);
        const all: any[] = (await deps.fiscalPeriodsService.findAll()) as any[];
        const filtered = args.status
          ? all.filter((p) => p.status === String(args.status))
          : all;
        const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 36);

        return {
          accounting_entity: entity,
          summary: `${filtered.length} periodo(s) fiscal(es)${
            args.status ? ` en estado ${args.status}` : ''
          }`,
          periods: filtered.slice(0, limit).map((p) => ({
            ...periodSummary(p),
            entries_count: p._count?.accounting_entries ?? null,
            closed_at: isoDate(p.closed_at),
          })),
          periods_omitted: Math.max(0, filtered.length - limit),
        };
      }),
    },

    // ─── 2. get_income_statement ─────────────────────────────────────
    {
      name: 'get_income_statement',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Estado de resultados (P&G) del periodo: ingresos totales, gastos totales, utilidad neta y las cuentas PUC que más pesan en cada bloque. Úsala cuando pregunten por rentabilidad, utilidad, pérdidas, "cómo me fue este mes" o cuáles son sus mayores gastos. Si no indicas periodo, se resuelve el que contiene la fecha dada o el día de hoy.',
      parameters: {
        type: 'object',
        properties: {
          fiscal_period_id: {
            type: 'number',
            description:
              'ID del periodo fiscal. Si lo omites se infiere por fecha; usa list_fiscal_periods para conocerlos.',
          },
          date_from: {
            type: 'string',
            description:
              'Acota el reporte desde esta fecha (YYYY-MM-DD) dentro del periodo.',
          },
          date_to: {
            type: 'string',
            description:
              'Acota el reporte hasta esta fecha (YYYY-MM-DD) dentro del periodo.',
          },
          max_accounts: {
            type: 'number',
            description:
              'Cuántas cuentas detallar por bloque (ingresos / gastos). Por defecto 10, tope 40.',
          },
        },
      },
      requiredPermissions: [PERM_REPORTS],
      handler: guard(async (args, context) => {
        const resolved = await resolveFiscalPeriod(args);
        if ('error' in resolved) return resolved;

        const entity = await describeFiscalEntity(context);
        const max = Math.min(Math.max(Number(args.max_accounts) || 10, 1), 40);

        const report: any = await deps.reportsService.getIncomeStatement({
          fiscal_period_id: resolved.period.id,
          ...(args.date_from && { date_from: String(args.date_from) }),
          ...(args.date_to && { date_to: String(args.date_to) }),
        } as any);

        const total_revenue = money(report.revenue.total);
        const total_expenses = money(report.expenses.total);

        return {
          accounting_entity: entity,
          fiscal_period: periodSummary(report.fiscal_period),
          period_selection: resolved.selection,
          date_filter: {
            from: args.date_from ?? null,
            to: args.date_to ?? null,
          },
          totals: {
            total_revenue,
            total_expenses,
            net_income: money(report.net_income),
            margin_pct:
              total_revenue !== 0
                ? Math.round((report.net_income / total_revenue) * 10000) / 100
                : null,
          },
          revenue: topAccounts(report.revenue.accounts, max),
          expenses: topAccounts(report.expenses.accounts, max),
          notes: SIGN_NOTE,
        };
      }),
    },

    // ─── 3. get_balance_sheet ────────────────────────────────────────
    {
      name: 'get_balance_sheet',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Balance general del periodo: total de activos, pasivos y patrimonio, la verificación de que la ecuación contable cuadra, y las cuentas PUC de mayor peso en cada bloque. Úsala cuando pregunten qué tienen, qué deben, su patrimonio, o si la contabilidad está descuadrada.',
      parameters: {
        type: 'object',
        properties: {
          fiscal_period_id: {
            type: 'number',
            description:
              'ID del periodo fiscal. Si lo omites se infiere por fecha.',
          },
          date_from: {
            type: 'string',
            description: 'Acota desde esta fecha (YYYY-MM-DD).',
          },
          date_to: {
            type: 'string',
            description: 'Acota hasta esta fecha (YYYY-MM-DD).',
          },
          max_accounts: {
            type: 'number',
            description:
              'Cuántas cuentas detallar por bloque (activo / pasivo / patrimonio). Por defecto 10, tope 40.',
          },
        },
      },
      requiredPermissions: [PERM_REPORTS],
      handler: guard(async (args, context) => {
        const resolved = await resolveFiscalPeriod(args);
        if ('error' in resolved) return resolved;

        const entity = await describeFiscalEntity(context);
        const max = Math.min(Math.max(Number(args.max_accounts) || 10, 1), 40);

        const report: any = await deps.reportsService.getBalanceSheet({
          fiscal_period_id: resolved.period.id,
          ...(args.date_from && { date_from: String(args.date_from) }),
          ...(args.date_to && { date_to: String(args.date_to) }),
        } as any);

        return {
          accounting_entity: entity,
          fiscal_period: periodSummary(report.fiscal_period),
          period_selection: resolved.selection,
          totals: {
            total_assets: money(report.assets.total),
            total_liabilities: money(report.liabilities.total),
            total_equity: money(report.equity.total),
          },
          balance_check: {
            total_assets: money(report.balance_check.total_assets),
            total_liabilities_and_equity: money(
              report.balance_check.total_liabilities_and_equity,
            ),
            is_balanced: report.balance_check.is_balanced,
            difference: money(
              report.balance_check.total_assets -
                report.balance_check.total_liabilities_and_equity,
            ),
          },
          assets: topAccounts(report.assets.accounts, max),
          liabilities: topAccounts(report.liabilities.accounts, max),
          equity: topAccounts(report.equity.accounts, max),
          notes: SIGN_NOTE,
        };
      }),
    },

    // ─── 4. get_trial_balance ────────────────────────────────────────
    {
      name: 'get_trial_balance',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Balance de prueba: débitos, créditos y saldo de cada cuenta PUC con movimiento en el periodo. Úsala cuando pidan "saldos por cuenta", el balance de comprobación, o cuando quieras revisar un grupo del PUC completo filtrando por prefijo de código (por ejemplo "11" para disponible, "13" para cartera, "5" para gastos).',
      parameters: {
        type: 'object',
        properties: {
          fiscal_period_id: {
            type: 'number',
            description:
              'ID del periodo fiscal. Si lo omites se infiere por fecha.',
          },
          date_from: {
            type: 'string',
            description: 'Acota desde esta fecha (YYYY-MM-DD).',
          },
          date_to: {
            type: 'string',
            description: 'Acota hasta esta fecha (YYYY-MM-DD).',
          },
          account_code_prefix: {
            type: 'string',
            description:
              'Deja sólo las cuentas cuyo código PUC empieza por este prefijo (ej. "1105", "24", "6").',
          },
          account_type: {
            type: 'string',
            enum: ACCOUNT_TYPES,
            description: 'Deja sólo las cuentas de este tipo.',
          },
          limit: {
            type: 'number',
            description:
              'Máximo de cuentas a devolver, ordenadas por magnitud del saldo. Por defecto 25, tope 100.',
          },
        },
      },
      requiredPermissions: [PERM_REPORTS],
      handler: guard(async (args, context) => {
        const resolved = await resolveFiscalPeriod(args);
        if ('error' in resolved) return resolved;

        const entity = await describeFiscalEntity(context);
        const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

        const report: any = await deps.reportsService.getTrialBalance({
          fiscal_period_id: resolved.period.id,
          ...(args.date_from && { date_from: String(args.date_from) }),
          ...(args.date_to && { date_to: String(args.date_to) }),
        } as any);

        const prefix = args.account_code_prefix
          ? String(args.account_code_prefix)
          : null;

        const filtered = report.accounts.filter((a: any) => {
          if (prefix && !String(a.account_code).startsWith(prefix)) return false;
          if (args.account_type && a.account_type !== args.account_type)
            return false;
          return true;
        });

        const sorted = [...filtered].sort(
          (a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance)),
        );

        return {
          accounting_entity: entity,
          fiscal_period: periodSummary(report.fiscal_period),
          period_selection: resolved.selection,
          filters: {
            account_code_prefix: prefix,
            account_type: args.account_type ?? null,
            date_from: args.date_from ?? null,
            date_to: args.date_to ?? null,
          },
          period_totals: {
            total_debit: money(report.totals.total_debit),
            total_credit: money(report.totals.total_credit),
            is_balanced:
              Math.abs(
                Number(report.totals.total_debit) -
                  Number(report.totals.total_credit),
              ) < 0.01,
          },
          accounts: sorted.slice(0, limit).map((a: any) => ({
            account_id: a.account_id,
            code: a.account_code,
            name: a.account_name,
            account_type: a.account_type,
            nature: a.nature,
            total_debit: money(a.total_debit),
            total_credit: money(a.total_credit),
            balance_debit_minus_credit: money(a.balance),
          })),
          accounts_returned: Math.min(sorted.length, limit),
          accounts_omitted: Math.max(0, sorted.length - limit),
          notes:
            'balance_debit_minus_credit es débitos menos créditos (convención del balance de prueba, sin signo por naturaleza). Para una cuenta de naturaleza crédito, un valor negativo es su saldo normal.',
        };
      }),
    },

    // ─── 5. get_account_ledger ───────────────────────────────────────
    {
      name: 'get_account_ledger',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Libro auxiliar de una cuenta PUC y sus subcuentas directas: saldo de cierre por cuenta y los movimientos más recientes con su tercero. Úsala cuando pregunten por el saldo o los movimientos de una cuenta concreta ("cuánto tengo en bancos", "qué movió la 1435", "quién me debe en la 1305"). Si no conoces el código PUC exacto, búscalo antes con find_puc_account.',
      parameters: {
        type: 'object',
        properties: {
          account_code: {
            type: 'string',
            description:
              'Código PUC de la cuenta padre (ej. "1110", "1435", "2205"). Se agregan también sus subcuentas directas.',
          },
          date_from: {
            type: 'string',
            description:
              'Desde esta fecha (YYYY-MM-DD). Sin fechas se acumula todo el histórico posteado.',
          },
          date_to: { type: 'string', description: 'Hasta esta fecha (YYYY-MM-DD).' },
          max_movements: {
            type: 'number',
            description:
              'Cuántos movimientos recientes devolver. Por defecto 15, tope 50.',
          },
        },
        required: ['account_code'],
      },
      requiredPermissions: [PERM_REPORTS],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);
        const max = Math.min(Math.max(Number(args.max_movements) || 15, 1), 50);

        const report: any =
          await deps.reportsService.getSubsidiaryLedgerByAccountRange({
            account_code: String(args.account_code),
            ...(args.date_from && { date_from: String(args.date_from) }),
            ...(args.date_to && { date_to: String(args.date_to) }),
          });

        const accounts = (report.accounts as any[]).map((a) => ({
          code: a.account_code,
          name: a.account_name,
          account_type: a.account_type,
          nature: a.nature,
          is_parent: a.is_parent,
          total_debit: money(a.total_debit),
          total_credit: money(a.total_credit),
          closing_balance: money(a.closing_balance),
          movements_count: (a.lines ?? []).length,
        }));

        // El libro auxiliar completo revienta la ventana de contexto: se
        // devuelven saldos por cuenta siempre, y sólo los N movimientos más
        // recientes aplanados de todas las subcuentas.
        const flattened = (report.accounts as any[]).flatMap((a) =>
          (a.lines ?? []).map((l: any) => ({
            entry_date: isoDate(l.entry_date),
            entry_number: l.entry_number,
            entry_type: l.entry_type,
            account_code: a.account_code,
            description: l.line_description || l.entry_description,
            debit: money(l.debit_amount),
            credit: money(l.credit_amount),
            third_party: l.third_party_name ?? null,
            third_party_tax_id: l.third_party_tax_id ?? null,
          })),
        );
        flattened.sort((a, b) =>
          String(b.entry_date ?? '').localeCompare(String(a.entry_date ?? '')),
        );

        return {
          accounting_entity: entity,
          parent_account: report.parent_account,
          date_filter: {
            from: args.date_from ?? null,
            to: args.date_to ?? null,
          },
          grand_total: {
            total_debit: money(report.grand_total.total_debit),
            total_credit: money(report.grand_total.total_credit),
            closing_balance: money(report.grand_total.closing_balance),
          },
          accounts,
          recent_movements: flattened.slice(0, max),
          movements_total: flattened.length,
          movements_omitted: Math.max(0, flattened.length - max),
          notes: SIGN_NOTE,
        };
      }),
    },

    // ─── 6. get_vat_summary ──────────────────────────────────────────
    {
      name: 'get_vat_summary',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Resumen del IVA del periodo desde la cuenta PUC 2408: IVA generado en ventas (240802), IVA descontable en compras (240804) y el saldo neto del grupo, que indica si queda por pagar a la DIAN o a favor. Úsala cuando pregunten cuánto IVA deben, cuánto IVA pagaron en compras, o para preparar la declaración bimestral. No liquida ni declara nada: sólo lee los saldos ya contabilizados.',
      parameters: {
        type: 'object',
        properties: {
          date_from: {
            type: 'string',
            description:
              'Inicio del periodo gravable (YYYY-MM-DD). Recomendado: sin fechas se acumula todo el histórico.',
          },
          date_to: {
            type: 'string',
            description: 'Fin del periodo gravable (YYYY-MM-DD).',
          },
        },
      },
      requiredPermissions: [PERM_REPORTS],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);

        const report: any =
          await deps.reportsService.getSubsidiaryLedgerByAccountRange({
            account_code: '2408',
            ...(args.date_from && { date_from: String(args.date_from) }),
            ...(args.date_to && { date_to: String(args.date_to) }),
          });

        const compact = (a: any) => ({
          code: a.account_code,
          name: a.account_name,
          total_debit: money(a.total_debit),
          total_credit: money(a.total_credit),
          closing_balance: money(a.closing_balance),
          movements_count: (a.lines ?? []).length,
        });

        const rows = (report.accounts as any[]).filter((a) => !a.is_parent);
        const parentRow = (report.accounts as any[]).find((a) => a.is_parent);

        // Códigos según el contrato de mapeos ya vigente en
        // `AccountMappingService` / `default-account-mappings.seed.ts`:
        // 240802 = IVA generado por ventas, 240804 = IVA descontable en
        // compras, 240810 = IVA por pagar tras la liquidación.
        const byCode = (code: string) =>
          rows.find((a) => String(a.account_code) === code);

        const generado = byCode('240802');
        const descontable = byCode('240804');
        const porPagar = byCode('240810');
        const known = new Set(['240802', '240804', '240810']);

        const net = money(report.grand_total.closing_balance);

        return {
          accounting_entity: entity,
          date_filter: {
            from: args.date_from ?? null,
            to: args.date_to ?? null,
          },
          iva_generado_ventas: generado ? compact(generado) : null,
          iva_descontable_compras: descontable ? compact(descontable) : null,
          iva_por_pagar_liquidado: porPagar ? compact(porPagar) : null,
          other_2408_accounts: rows
            .filter((a) => !known.has(String(a.account_code)))
            .map(compact),
          account_2408_direct: parentRow ? compact(parentRow) : null,
          net_balance_2408: net,
          net_interpretation:
            net > 0
              ? 'Saldo crédito: queda IVA por pagar a la DIAN.'
              : net < 0
                ? 'Saldo débito: hay saldo a favor en IVA.'
                : 'El grupo 2408 está en cero para el rango consultado.',
          notes:
            !generado && !descontable
              ? 'No se encontraron las subcuentas 240802/240804 en el plan de cuentas de esta entidad; se listan las subcuentas de 2408 que sí existen.'
              : SIGN_NOTE,
        };
      }),
    },

    // ─── 7. get_recent_journal_entries ───────────────────────────────
    {
      name: 'get_recent_journal_entries',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Lista asientos contables recientes con su número, fecha, tipo (manual o automático por venta, compra, nómina, inventario…), estado, totales y sus primeras líneas débito/crédito. Úsala para auditar de dónde salió un movimiento, revisar si un asiento quedó en borrador, o rastrear qué contabilizó una venta o una compra concreta.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Desde esta fecha (YYYY-MM-DD).' },
          date_to: { type: 'string', description: 'Hasta esta fecha (YYYY-MM-DD).' },
          entry_type: {
            type: 'string',
            enum: ENTRY_TYPES,
            description:
              'Filtra por origen del asiento. Los auto_* los genera el sistema desde el evento de negocio.',
          },
          status: {
            type: 'string',
            enum: ENTRY_STATUSES,
            description:
              'posted = contabilizado y afecta los reportes; draft = borrador; voided = anulado.',
          },
          fiscal_period_id: {
            type: 'number',
            description: 'Restringe a un periodo fiscal concreto.',
          },
          search: {
            type: 'string',
            description: 'Busca en el número de asiento o en su descripción.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de asientos. Por defecto 10, tope 25.',
          },
          max_lines_per_entry: {
            type: 'number',
            description:
              'Cuántas líneas mostrar por asiento. Por defecto 6, tope 20.',
          },
        },
      },
      requiredPermissions: [PERM_JOURNAL],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
        const maxLines = Math.min(
          Math.max(Number(args.max_lines_per_entry) || 6, 1),
          20,
        );

        const result: any = await deps.journalEntriesService.findAll({
          page: 1,
          limit,
          sort_by: 'entry_date',
          sort_order: 'desc',
          ...(args.search && { search: String(args.search) }),
          ...(args.entry_type && { entry_type: String(args.entry_type) }),
          ...(args.status && { status: String(args.status) }),
          ...(args.fiscal_period_id && {
            fiscal_period_id: Number(args.fiscal_period_id),
          }),
          ...(args.date_from && { date_from: String(args.date_from) }),
          ...(args.date_to && { date_to: String(args.date_to) }),
        } as any);

        const entries = (result.data as any[]).map((e) => {
          const lines = e.accounting_entry_lines ?? [];
          return {
            id: e.id,
            entry_number: e.entry_number,
            entry_date: isoDate(e.entry_date),
            entry_type: e.entry_type,
            status: e.status,
            description: e.description,
            source: e.source_type
              ? { type: e.source_type, id: e.source_id }
              : null,
            store: e.store?.name ?? null,
            fiscal_period: e.fiscal_period?.name ?? null,
            total_debit: money(e.total_debit),
            total_credit: money(e.total_credit),
            lines: lines.slice(0, maxLines).map((l: any) => ({
              account_code: l.account?.code,
              account_name: l.account?.name,
              debit: money(l.debit_amount),
              credit: money(l.credit_amount),
              description: l.description ?? null,
              third_party: l.third_party_name ?? null,
            })),
            lines_total: lines.length,
            lines_omitted: Math.max(0, lines.length - maxLines),
          };
        });

        return {
          accounting_entity: entity,
          summary: `${entries.length} asiento(s) devuelto(s) de ${result.meta.total} que coinciden con el filtro`,
          filters: {
            date_from: args.date_from ?? null,
            date_to: args.date_to ?? null,
            entry_type: args.entry_type ?? null,
            status: args.status ?? null,
            search: args.search ?? null,
          },
          entries,
          total_matching: result.meta.total,
        };
      }),
    },

    // ─── 8. find_puc_account ─────────────────────────────────────────
    {
      name: 'find_puc_account',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Busca cuentas en el plan único de cuentas (PUC) de la entidad por código o por nombre, y devuelve su código, naturaleza y si acepta movimientos. Úsala como paso previo cuando el usuario nombra una cuenta en lenguaje natural ("caja", "proveedores", "retención en la fuente") y necesitas el código PUC exacto para get_account_ledger o get_trial_balance.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description:
              'Texto a buscar en el código o en el nombre de la cuenta (ej. "caja", "1105", "iva").',
          },
          account_type: {
            type: 'string',
            enum: ACCOUNT_TYPES,
            description: 'Filtra por tipo de cuenta.',
          },
          only_postable: {
            type: 'boolean',
            description:
              'Deja sólo las cuentas que aceptan movimientos directos (hojas del PUC). Por defecto false.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de cuentas. Por defecto 20, tope 50.',
          },
        },
        required: ['search'],
      },
      requiredPermissions: [PERM_CHART],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);

        const accounts: any[] = (await deps.chartOfAccountsService.findAll({
          search: String(args.search),
          is_active: true,
          limit,
          ...(args.account_type && { account_type: String(args.account_type) }),
          ...(args.only_postable === true && { accepts_entries: true }),
        } as any)) as any[];

        return {
          accounting_entity: entity,
          summary: `${accounts.length} cuenta(s) PUC coinciden con "${args.search}"`,
          accounts: accounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            account_type: a.account_type,
            nature: a.nature,
            level: a.level,
            accepts_entries: a.accepts_entries,
            parent: a.parent ? `${a.parent.code} ${a.parent.name}` : null,
          })),
        };
      }),
    },

    // ─── 9. get_journal_entry (F-1) ──────────────────────────────────
    {
      name: 'get_journal_entry',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Detalle completo de un asiento contable por su ID: cabecera (número, fecha, tipo, estado, periodo, origen del evento de negocio), totales débito/crédito con verificación de balance, y todas sus líneas con cuenta PUC, débito, crédito y tercero. Úsala cuando necesites auditar un asiento concreto que apareció en get_recent_journal_entries o en un libro auxiliar. Es el read habilitante de post/void (F-3/F-4): el preview de esos writes siempre cita este detalle.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: {
            type: 'number',
            description: 'ID del asiento contable.',
          },
        },
        required: ['entry_id'],
      },
      requiredPermissions: [PERM_JOURNAL],
      handler: guard(async (args, context) => {
        const entry_id = Number(args.entry_id);
        if (!Number.isInteger(entry_id) || entry_id <= 0) {
          return {
            error: `entry_id inválido: "${args.entry_id}". Pasa el ID numérico del asiento (lo obtienes de get_recent_journal_entries).`,
            next_step:
              'Pide al usuario el número o la fecha del asiento y resuélvelo primero con get_recent_journal_entries.',
          };
        }

        const entity = await describeFiscalEntity(context);
        const e: any = await deps.journalEntriesService.findOne(entry_id);
        const lines = e.accounting_entry_lines ?? [];
        const total_debit = money(e.total_debit);
        const total_credit = money(e.total_credit);

        return {
          accounting_entity: entity,
          entry: {
            id: e.id,
            entry_number: e.entry_number,
            entry_date: isoDate(e.entry_date),
            entry_type: e.entry_type,
            status: e.status,
            description: e.description,
            source: e.source_type
              ? { type: e.source_type, id: e.source_id }
              : null,
            store: e.store?.name ?? null,
            fiscal_period: e.fiscal_period?.name ?? null,
            total_debit,
            total_credit,
            is_balanced: Math.abs(total_debit - total_credit) < 0.01,
            lines: lines.map((l: any) => ({
              account_code: l.account?.code,
              account_name: l.account?.name,
              account_type: l.account?.account_type ?? null,
              nature: l.account?.nature ?? null,
              debit: money(l.debit_amount),
              credit: money(l.credit_amount),
              description: l.description ?? null,
              third_party: l.third_party_name ?? null,
              third_party_tax_id: l.third_party_tax_id ?? null,
            })),
            lines_count: lines.length,
          },
        };
      }),
    },

    // ─── 10. list_account_mappings (F-9) ─────────────────────────────
    {
      name: 'list_account_mappings',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Lista el mapeo efectivo evento→cuenta PUC que usa la contabilización automática (qué cuenta se debita/acredita cuando se vende, se compra, se paga nómina, etc.), indicando por cada clave si el valor viene de un override de tienda, de la base de organización o del default del sistema. Úsala cuando pregunten "a qué cuenta va X" o para diagnosticar un asiento automático inesperado. Es el read habilitante de los writes de mapeos (F-10/F-11), que sólo tocan overrides.',
      parameters: {
        type: 'object',
        properties: {
          prefix: {
            type: 'string',
            description:
              'Filtra por prefijo de clave de evento (ej. "invoice.", "payment.", "withholding."). Sin prefijo lista todo el catálogo.',
          },
          limit: {
            type: 'number',
            description:
              'Máximo de mapeos a devolver. Por defecto 50, tope 200.',
          },
        },
      },
      requiredPermissions: [PERM_MAPPINGS],
      handler: guard(async (args, context) => {
        if (!context.organization_id) {
          return {
            error:
              'Sin organización en contexto: los mapeos contables se resuelven por organización y tienda.',
            next_step:
              'Reintenta dentro de una sesión de tienda u organización autenticada.',
          };
        }

        const entity = await describeFiscalEntity(context);
        const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
        const prefix = args.prefix ? String(args.prefix) : undefined;

        const mappings = await deps.accountMappingService.getMappings(
          context.organization_id,
          prefix,
          context.store_id ?? undefined,
        );

        return {
          accounting_entity: entity,
          summary: `${mappings.length} mapeo(s) efectivo(s)${prefix ? ` con prefijo "${prefix}"` : ''}`,
          filters: { prefix: prefix ?? null },
          mappings: mappings.slice(0, limit).map((m) => ({
            mapping_key: m.mapping_key,
            account_code: m.account_code,
            account_id: m.account_id ?? null,
            description: m.description,
            source: m.source,
          })),
          mappings_total: mappings.length,
          mappings_omitted: Math.max(0, mappings.length - limit),
          notes:
            'source indica la cascada: store = override de tienda, organization = base de organización, default = default del sistema.',
        };
      }),
    },

    // ─── 11. list_entry_failures (F-12) ──────────────────────────────
    {
      name: 'list_entry_failures',
      version: '1',
      domain: 'accounting',
      readOnly: true,
      description:
        'Lista los fallos de contabilización automática sin resolver: eventos de negocio (ventas, pagos, recepciones) cuyo asiento no pudo crearse y quedaron pendientes de reintento. Cada fallo cita el evento origen, el mensaje de error y cuántos intentos lleva. Úsala cuando la contabilidad parezca incompleta o antes de proponer un reintento (F-13): el reintento siempre cita un fallo visible de esta lista.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'number',
            description: 'Página de resultados. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Fallos por página. Por defecto 20, tope 50.',
          },
        },
      },
      requiredPermissions: [PERM_JOURNAL],
      handler: guard(async (args, context) => {
        const entity = await describeFiscalEntity(context);
        const page = Math.max(Number(args.page) || 1, 1);
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);

        const result = await deps.entryFailureService.listUnresolved(
          page,
          limit,
        );

        return {
          accounting_entity: entity,
          summary:
            result.total === 0
              ? 'No hay fallos de contabilización pendientes: todos los eventos generaron su asiento.'
              : `${result.total} fallo(s) de contabilización sin resolver`,
          failures: (result.data as any[]).map((f) => ({
            id: f.id,
            handler_key: f.handler_key,
            source: f.source_type
              ? { type: f.source_type, id: f.source_id ?? null }
              : null,
            store_id: f.store_id ?? null,
            error_message: f.error_message,
            attempt_count: f.attempt_count,
            created_at: isoDate(f.created_at),
          })),
          page: result.page,
          limit: result.limit,
          total_unresolved: result.total,
          next_step:
            result.total === 0
              ? undefined
              : 'Para reintentar un fallo usa retry_entry_failure (F-13) citando su id; si el error menciona periodo cerrado o cuenta inexistente, resuelve eso primero.',
        };
      }),
    },

    // ─── 12. create_journal_entry (F-2, write) ───────────────────────
    {
      name: 'create_journal_entry',
      version: '1',
      domain: 'accounting',
      description:
        'Crea un asiento contable MANUAL en estado borrador (no contabiliza: para afectar los reportes hay que postearlo después con post_journal_entry). Las líneas se dan por código PUC con débito y crédito; el asiento debe balancear (±0.001), el periodo debe estar abierto y las cuentas deben existir y aceptar movimientos. Cadena habilitante: list_account_mappings (F-9) + list_fiscal_periods + find_puc_account.',
      parameters: {
        type: 'object',
        properties: {
          fiscal_period_id: {
            type: 'number',
            description:
              'ID del periodo fiscal abierto donde va el asiento (list_fiscal_periods).',
          },
          entry_date: {
            type: 'string',
            description:
              'Fecha del asiento (YYYY-MM-DD). Debe caer dentro del periodo.',
          },
          description: {
            type: 'string',
            description:
              'Descripción humana del asiento (ej. "Ajuste de caja enero").',
          },
          lines: {
            type: 'array',
            description:
              'Mínimo 2 líneas. Cada una: account_code (PUC hoja), debit, credit (solo un lado > 0 por línea), description opcional. Débito total debe igualar crédito total.',
            items: {
              type: 'object',
              properties: {
                account_code: { type: 'string' },
                debit: { type: 'number' },
                credit: { type: 'number' },
                description: { type: 'string' },
              },
              required: ['account_code', 'debit', 'credit'],
            },
          },
        },
        required: ['fiscal_period_id', 'lines'],
      },
      requiredPermissions: [PERM_JOURNAL_CREATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const resolved = await resolveJournalDraft(args ?? {});
        if (!resolved.ok) {
          return writePreviewError(
            resolved.label,
            `${resolved.message}${resolved.nextStep ? ` ${resolved.nextStep}` : ''}`,
          );
        }
        const draft = resolved.value;
        return {
          status: 'ok',
          target: draft.label,
          changes: [
            ...draft.lines.map((l) => ({
              field: `line.${l.account_code}`,
              label: `${l.account_code} ${l.account_name}`,
              from: null,
              to:
                l.debit > 0
                  ? `Débito ${l.debit}`
                  : `Crédito ${l.credit}`,
            })),
            {
              field: 'totals',
              label: 'Totales débito = crédito',
              from: null,
              to: `${draft.total_debit} (periodo ${draft.period.name})`,
            },
          ],
          message:
            'Se creará en estado borrador: no afecta reportes hasta que se postee con post_journal_entry.',
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveJournalDraft(args ?? {});
        if (!resolved.ok) {
          return {
            error: resolved.message,
            ...(resolved.nextStep && { next_step: resolved.nextStep }),
          };
        }
        try {
          const created: any = await deps.journalEntriesService.create(
            resolved.value.dto,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            created: {
              id: created.id,
              entry_number: created.entry_number,
              entry_date: isoDate(created.entry_date),
              status: created.status,
              description: created.description,
              total_debit: money(created.total_debit),
              total_credit: money(created.total_credit),
            },
            next_step:
              'Asiento creado en borrador. Para contabilizarlo usa post_journal_entry citando este ID.',
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El asiento no se creó. Verifica que el periodo siga abierto y las cuentas existan (get_journal_entry no aplica: el asiento no existe todavía).',
          };
        }
      }),
    },

    // ─── 13. post_journal_entry (F-3, write) ─────────────────────────
    {
      name: 'post_journal_entry',
      version: '1',
      domain: 'accounting',
      description:
        'Postea (contabiliza) un asiento en borrador: desde ese momento afecta todos los reportes. Solo asientos draft con periodo abierto y balance intacto. Cadena habilitante: get_journal_entry (F-1) en estado draft.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: {
            type: 'number',
            description: 'ID del asiento en borrador (get_journal_entry).',
          },
        },
        required: ['entry_id'],
      },
      requiredPermissions: [PERM_JOURNAL_POST],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const resolved = await resolveEntryForFlow(args ?? {}, 'postea');
        if (!resolved.ok) {
          return writePreviewError(
            resolved.label,
            `${resolved.message}${resolved.nextStep ? ` ${resolved.nextStep}` : ''}`,
          );
        }
        const entry = resolved.value;
        if (entry.status !== 'draft') {
          return writePreviewError(
            entrySubject(entry),
            `El asiento está ${entry.status}: solo se postean borradores (draft → posted). Revisa su estado con get_journal_entry (F-1).`,
          );
        }
        return {
          status: 'ok',
          target: entrySubject(entry),
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: 'draft',
              to: 'posted',
            },
            {
              field: 'totals',
              label: 'Totales débito = crédito',
              from: null,
              to: `${money(entry.total_debit)} (${entry.fiscal_period?.name ?? 'periodo ?'})`,
            },
          ],
          message:
            'Al postear, el asiento empieza a afectar balance, P&G y auxiliares. Solo procede si el periodo sigue abierto.',
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveEntryForFlow(args ?? {}, 'postea');
        if (!resolved.ok) {
          return {
            error: resolved.message,
            ...(resolved.nextStep && { next_step: resolved.nextStep }),
          };
        }
        const entry = resolved.value;
        if (entry.status !== 'draft') {
          return {
            error: `El asiento ${entry.entry_number ?? entry.id} ya no está en borrador (estado actual: ${entry.status}). No se posteó nada.`,
            next_step:
              'Revisa el estado vigente con get_journal_entry (F-1) antes de proponer de nuevo.',
          };
        }
        try {
          const posted: any = await deps.entryFlowService.post(entry.id);
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            posted: {
              id: posted.id,
              entry_number: posted.entry_number,
              status: posted.status,
              total_debit: money(posted.total_debit),
              total_credit: money(posted.total_credit),
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El asiento no se posteó. Si el periodo se cerró entre la propuesta y la aprobación, mueve el asiento a un periodo abierto.',
          };
        }
      }),
    },

    // ─── 14. void_journal_entry (F-4, write) ─────────────────────────
    {
      name: 'void_journal_entry',
      version: '1',
      domain: 'accounting',
      description:
        'Anula un asiento POSTEADO creando su asiento de reversión (débito↔crédito invertidos): el original queda voided y el efecto neto en libros es cero, con trazabilidad completa. Cadena habilitante: get_journal_entry (F-1) en estado posted.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: {
            type: 'number',
            description: 'ID del asiento posteado a anular (get_journal_entry).',
          },
        },
        required: ['entry_id'],
      },
      requiredPermissions: [PERM_JOURNAL_VOID],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const resolved = await resolveEntryForFlow(args ?? {}, 'anula');
        if (!resolved.ok) {
          return writePreviewError(
            resolved.label,
            `${resolved.message}${resolved.nextStep ? ` ${resolved.nextStep}` : ''}`,
          );
        }
        const entry = resolved.value;
        if (entry.status !== 'posted') {
          return writePreviewError(
            entrySubject(entry),
            `El asiento está ${entry.status}: solo se anulan asientos posteados (posted → voided). Un borrador se elimina desde el módulo, no se anula.`,
          );
        }
        return {
          status: 'warning',
          target: entrySubject(entry),
          changes: [
            {
              field: 'status',
              label: 'Estado del original',
              from: 'posted',
              to: 'voided',
            },
            {
              field: 'reversal',
              label: 'Asiento de reversión',
              from: null,
              to: `Se crea invertido por ${money(entry.total_debit)} (efecto neto cero)`,
            },
          ],
          message:
            'La anulación no borra: crea un asiento espejo. Ambos quedan en libros para auditoría.',
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const resolved = await resolveEntryForFlow(args ?? {}, 'anula');
        if (!resolved.ok) {
          return {
            error: resolved.message,
            ...(resolved.nextStep && { next_step: resolved.nextStep }),
          };
        }
        const entry = resolved.value;
        if (entry.status !== 'posted') {
          return {
            error: `El asiento ${entry.entry_number ?? entry.id} ya no está posteado (estado actual: ${entry.status}). No se anuló nada.`,
            next_step:
              'Revisa el estado vigente con get_journal_entry (F-1) antes de proponer de nuevo.',
          };
        }
        try {
          const result: any = await deps.entryFlowService.void(entry.id);
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            voided: {
              id: result?.voided_entry?.id ?? entry.id,
              entry_number:
                result?.voided_entry?.entry_number ?? entry.entry_number,
              status: 'voided',
              reversal_entry_number:
                result?.reversal_entry?.entry_number ?? null,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El asiento no se anuló. Revisa su estado con get_journal_entry (F-1).',
          };
        }
      }),
    },

    // ─── 15. create_fiscal_period (F-5, write) ───────────────────────
    {
      name: 'create_fiscal_period',
      version: '1',
      domain: 'accounting',
      description:
        'Crea un periodo fiscal en estado abierto para la entidad contable. No debe solaparse con otro periodo ni repetir nombre. Cadena habilitante: list_fiscal_periods (ver huecos y nombres en uso).',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Nombre del periodo (ej. "Octubre 2026"). Único por entidad.',
          },
          start_date: {
            type: 'string',
            description: 'Inicio del periodo (YYYY-MM-DD).',
          },
          end_date: {
            type: 'string',
            description: 'Fin del periodo (YYYY-MM-DD), posterior al inicio.',
          },
        },
        required: ['name', 'start_date', 'end_date'],
      },
      requiredPermissions: [PERM_PERIODS_CREATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const name = cleanString(args?.name) ?? '(sin nombre)';
        const validated = toValidatedDto(CreateFiscalPeriodDto, {
          ...(args?.name !== undefined && { name: args.name }),
          ...(args?.start_date !== undefined && {
            start_date: args.start_date,
          }),
          ...(args?.end_date !== undefined && { end_date: args.end_date }),
        });
        if (!validated.ok) {
          return writePreviewError(
            `Periodo fiscal "${name}"`,
            validated.message,
          );
        }
        const start = new Date(validated.dto.start_date);
        const end = new Date(validated.dto.end_date);
        const periods: any[] = (await deps.fiscalPeriodsService.findAll()) as any[];
        const overlap = periods.find(
          (p) => new Date(p.start_date) <= end && new Date(p.end_date) >= start,
        );
        if (overlap) {
          return writePreviewError(
            `Periodo fiscal "${name}"`,
            `Se solapa con el periodo existente "${overlap.name}" (${isoDate(overlap.start_date)} a ${isoDate(overlap.end_date)}). Revisa los huecos con list_fiscal_periods.`,
          );
        }
        const sameName = periods.find((p) => p.name === validated.dto.name);
        if (sameName) {
          return writePreviewError(
            `Periodo fiscal "${name}"`,
            `Ya existe un periodo llamado "${validated.dto.name}". Elige otro nombre.`,
          );
        }
        return {
          status: 'ok',
          target: `Periodo fiscal "${validated.dto.name}"`,
          changes: [
            {
              field: 'range',
              label: 'Rango',
              from: null,
              to: `${validated.dto.start_date} a ${validated.dto.end_date}`,
            },
            { field: 'status', label: 'Estado inicial', from: null, to: 'open' },
          ],
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const validated = toValidatedDto(CreateFiscalPeriodDto, {
          ...(args?.name !== undefined && { name: args.name }),
          ...(args?.start_date !== undefined && {
            start_date: args.start_date,
          }),
          ...(args?.end_date !== undefined && { end_date: args.end_date }),
        });
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step:
              'Corrige los campos (nombre, inicio < fin, formato YYYY-MM-DD) y vuelve a proponer.',
          };
        }
        try {
          const created: any = await deps.fiscalPeriodsService.create(
            validated.dto,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            created: {
              ...periodSummary(created),
              entries_count: created._count?.accounting_entries ?? 0,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El periodo no se creó. Si otro usuario creó un periodo solapado entre la propuesta y la aprobación, revisa list_fiscal_periods.',
          };
        }
      }),
    },

    // ─── 16. close_fiscal_period (F-6, write) ────────────────────────
    {
      name: 'close_fiscal_period',
      version: '1',
      domain: 'accounting',
      description:
        'Cierra un periodo fiscal abierto: desde ese momento no acepta asientos nuevos. Exige cero borradores pendientes en el periodo. Es una acción de control con responsable registrado. Cadena habilitante: list_fiscal_periods + get_recent_journal_entries (sin drafts).',
      parameters: {
        type: 'object',
        properties: {
          fiscal_period_id: {
            type: 'number',
            description: 'ID del periodo abierto a cerrar.',
          },
        },
        required: ['fiscal_period_id'],
      },
      requiredPermissions: [PERM_PERIODS_UPDATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const label = `Periodo fiscal #${args?.fiscal_period_id ?? '?'}`;
        const fiscal_period_id = toPositiveInt(args?.fiscal_period_id);
        if (!fiscal_period_id) {
          return writePreviewError(
            label,
            'fiscal_period_id inválido. Resuelve el periodo con list_fiscal_periods.',
          );
        }
        let period: any;
        try {
          period = await deps.fiscalPeriodsService.findOne(fiscal_period_id);
        } catch {
          period = null;
        }
        if (!period) {
          return writePreviewError(
            label,
            `No existe el periodo fiscal ${fiscal_period_id}. Verifica el ID con list_fiscal_periods.`,
          );
        }
        if (period.status !== 'open') {
          return writePreviewError(
            `Periodo fiscal "${period.name}"`,
            `El periodo ya está ${period.status}: solo se cierran periodos abiertos.`,
          );
        }
        const drafts: any = await deps.journalEntriesService.findAll({
          page: 1,
          limit: 1,
          fiscal_period_id,
          status: 'draft',
        } as any);
        const draft_count = drafts?.meta?.total ?? 0;
        if (draft_count > 0) {
          return writePreviewError(
            `Periodo fiscal "${period.name}"`,
            `Tiene ${draft_count} asiento(s) en borrador: postealos o elimínalos antes de cerrar (get_recent_journal_entries con status=draft).`,
          );
        }
        return {
          status: 'warning',
          target: `Periodo fiscal "${period.name}" (${isoDate(period.start_date)} a ${isoDate(period.end_date)})`,
          changes: [
            { field: 'status', label: 'Estado', from: 'open', to: 'closed' },
          ],
          message:
            'Cerrar es un acto de control con responsable: el periodo dejará de aceptar asientos y no se reabre solo. Borradores en cero verificado.',
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const fiscal_period_id = toPositiveInt(args?.fiscal_period_id);
        if (!fiscal_period_id) {
          return {
            error: 'fiscal_period_id inválido.',
            next_step: 'Resuelve el periodo con list_fiscal_periods.',
          };
        }
        let period: any;
        try {
          period = await deps.fiscalPeriodsService.findOne(fiscal_period_id);
        } catch {
          period = null;
        }
        if (!period) {
          return {
            error: `No existe el periodo fiscal ${fiscal_period_id}. No se cerró nada.`,
            next_step: 'Verifica el ID con list_fiscal_periods.',
          };
        }
        if (period.status !== 'open') {
          return {
            error: `El periodo "${period.name}" ya está ${period.status}. No se cerró nada.`,
            next_step: 'Elige un periodo abierto con list_fiscal_periods.',
          };
        }
        try {
          const closed: any =
            await deps.fiscalPeriodsService.close(fiscal_period_id);
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            closed: {
              ...periodSummary(closed),
              closed_at: isoDate(closed.closed_at),
              entries_count: closed._count?.accounting_entries ?? null,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El periodo no se cerró. Si entraron borradores entre la propuesta y la aprobación, postealos o elimínalos primero.',
          };
        }
      }),
    },

    // ─── 17. create_puc_account (F-7, write) ─────────────────────────
    {
      name: 'create_puc_account',
      version: '1',
      domain: 'accounting',
      description:
        'Crea una cuenta en el plan único de cuentas (PUC) de la entidad: código único, nombre, tipo, naturaleza y opcionalmente cuenta padre. Cadena habilitante: find_puc_account (verificar que el código no exista y resolver el padre).',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Código PUC único (ej. "110505").',
          },
          name: {
            type: 'string',
            description: 'Nombre de la cuenta (ej. "Caja menor oficina").',
          },
          account_type: {
            type: 'string',
            enum: ACCOUNT_TYPES,
            description: 'Tipo de cuenta.',
          },
          nature: {
            type: 'string',
            enum: ['debit', 'credit'],
            description:
              'Naturaleza: debit (activos, gastos, costos) o credit (pasivos, patrimonio, ingresos).',
          },
          parent_id: {
            type: 'number',
            description:
              'ID de la cuenta padre (agrupadora). Omitelo para una cuenta de nivel 1.',
          },
          accepts_entries: {
            type: 'boolean',
            description:
              'true si la cuenta recibe movimientos directos (hoja). Por defecto false.',
          },
        },
        required: ['code', 'name', 'account_type', 'nature'],
      },
      requiredPermissions: [PERM_CHART_CREATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const code = cleanString(args?.code) ?? '(sin código)';
        const validated = toValidatedDto(CreateAccountDto, {
          ...(args?.code !== undefined && { code: args.code }),
          ...(args?.name !== undefined && { name: args.name }),
          ...(args?.account_type !== undefined && {
            account_type: args.account_type,
          }),
          ...(args?.nature !== undefined && { nature: args.nature }),
          ...(args?.parent_id !== undefined && { parent_id: args.parent_id }),
          ...(args?.accepts_entries !== undefined && {
            accepts_entries: args.accepts_entries,
          }),
        });
        if (!validated.ok) {
          return writePreviewError(`Cuenta PUC ${code}`, validated.message);
        }
        const existing: any = await deps.chartOfAccountsService.findByCode(
          validated.dto.code,
        );
        if (existing) {
          return writePreviewError(
            `Cuenta PUC ${code}`,
            `El código ${validated.dto.code} ya existe (${existing.name}). Elige otro código.`,
          );
        }
        let parent: any = null;
        if (validated.dto.parent_id) {
          try {
            parent = await deps.chartOfAccountsService.findOne(
              validated.dto.parent_id,
            );
          } catch {
            parent = null;
          }
          if (!parent) {
            return writePreviewError(
              `Cuenta PUC ${code}`,
              `La cuenta padre ${validated.dto.parent_id} no existe. Resuélvela con find_puc_account.`,
            );
          }
        }
        return {
          status: 'ok',
          target: `Cuenta PUC ${validated.dto.code} ${validated.dto.name}`,
          changes: [
            {
              field: 'account_type',
              label: 'Tipo / naturaleza',
              from: null,
              to: `${validated.dto.account_type} / ${validated.dto.nature}`,
            },
            {
              field: 'parent',
              label: 'Padre',
              from: null,
              to: parent ? `${parent.code} ${parent.name}` : 'nivel 1 (sin padre)',
            },
            {
              field: 'accepts_entries',
              label: 'Acepta movimientos',
              from: null,
              to: validated.dto.accepts_entries ? 'sí (hoja)' : 'no (agrupadora)',
            },
          ],
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const validated = toValidatedDto(CreateAccountDto, {
          ...(args?.code !== undefined && { code: args.code }),
          ...(args?.name !== undefined && { name: args.name }),
          ...(args?.account_type !== undefined && {
            account_type: args.account_type,
          }),
          ...(args?.nature !== undefined && { nature: args.nature }),
          ...(args?.parent_id !== undefined && { parent_id: args.parent_id }),
          ...(args?.accepts_entries !== undefined && {
            accepts_entries: args.accepts_entries,
          }),
        });
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step:
              'Corrige los campos (código, nombre, tipo, naturaleza) y vuelve a proponer.',
          };
        }
        try {
          const created: any = await deps.chartOfAccountsService.create(
            validated.dto,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            created: {
              id: created.id,
              code: created.code,
              name: created.name,
              account_type: created.account_type,
              nature: created.nature,
              level: created.level,
              accepts_entries: created.accepts_entries,
              parent: created.parent
                ? `${created.parent.code} ${created.parent.name}`
                : null,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'La cuenta no se creó. Si el código se ocupó entre la propuesta y la aprobación, elige otro.',
          };
        }
      }),
    },

    // ─── 18. update_puc_account (F-8, write) ─────────────────────────
    {
      name: 'update_puc_account',
      version: '1',
      domain: 'accounting',
      description:
        'Actualiza nombre, código, padre o flags de una cuenta PUC existente. Solo los campos enviados cambian. Cadena habilitante: find_puc_account (resolver la cuenta y validar el código nuevo).',
      parameters: {
        type: 'object',
        properties: {
          account_id: {
            type: 'number',
            description: 'ID de la cuenta a actualizar.',
          },
          code: { type: 'string', description: 'Nuevo código PUC (único).' },
          name: { type: 'string', description: 'Nuevo nombre.' },
          parent_id: {
            type: 'number',
            description: 'Nuevo padre (ID). No puede ser la propia cuenta.',
          },
          is_active: {
            type: 'boolean',
            description: 'Activa o desactiva la cuenta.',
          },
          accepts_entries: {
            type: 'boolean',
            description: 'Si acepta movimientos directos.',
          },
        },
        required: ['account_id'],
      },
      requiredPermissions: [PERM_CHART_UPDATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const label = `Cuenta PUC #${args?.account_id ?? '?'}`;
        const account_id = toPositiveInt(args?.account_id);
        if (!account_id) {
          return writePreviewError(
            label,
            'account_id inválido. Resuelve la cuenta con find_puc_account.',
          );
        }
        let account: any;
        try {
          account = await deps.chartOfAccountsService.findOne(account_id);
        } catch {
          account = null;
        }
        if (!account) {
          return writePreviewError(
            label,
            `No existe la cuenta ${account_id}. Verifica el ID con find_puc_account.`,
          );
        }
        const updatable = [
          'code',
          'name',
          'parent_id',
          'is_active',
          'accepts_entries',
        ] as const;
        const sent = updatable.filter((f) => args?.[f] !== undefined);
        if (!sent.length) {
          return writePreviewError(
            `${account.code} ${account.name}`,
            'No enviaste ningún campo a cambiar. Indica al menos uno de: code, name, parent_id, is_active, accepts_entries.',
          );
        }
        const payload: Record<string, unknown> = {};
        for (const f of sent) payload[f] = args[f];
        const validated = toValidatedDto(UpdateAccountDto, payload);
        if (!validated.ok) {
          return writePreviewError(
            `${account.code} ${account.name}`,
            validated.message,
          );
        }
        if (
          validated.dto.code &&
          validated.dto.code !== account.code
        ) {
          const clash: any = await deps.chartOfAccountsService.findByCode(
            validated.dto.code,
          );
          if (clash && clash.id !== account.id) {
            return writePreviewError(
              `${account.code} ${account.name}`,
              `El código ${validated.dto.code} ya lo usa "${clash.name}". Elige otro.`,
            );
          }
        }
        if (
          validated.dto.parent_id !== undefined &&
          validated.dto.parent_id !== account.parent_id
        ) {
          if (validated.dto.parent_id === account.id) {
            return writePreviewError(
              `${account.code} ${account.name}`,
              'Una cuenta no puede ser su propio padre.',
            );
          }
          let parent: any = null;
          try {
            parent =
              validated.dto.parent_id === null
                ? null
                : await deps.chartOfAccountsService.findOne(
                    validated.dto.parent_id,
                  );
          } catch {
            parent = 'missing';
          }
          if (parent === 'missing') {
            return writePreviewError(
              `${account.code} ${account.name}`,
              `La cuenta padre ${validated.dto.parent_id} no existe. Resuélvela con find_puc_account.`,
            );
          }
        }
        const labels: Record<string, string> = {
          code: 'Código',
          name: 'Nombre',
          parent_id: 'Padre (ID)',
          is_active: 'Activa',
          accepts_entries: 'Acepta movimientos',
        };
        return {
          status: 'ok',
          target: `${account.code} ${account.name}`,
          changes: sent.map((f) => ({
            field: f,
            label: labels[f],
            from: account[f] ?? null,
            to: (validated.dto as any)[f] ?? null,
          })),
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const account_id = toPositiveInt(args?.account_id);
        if (!account_id) {
          return {
            error: 'account_id inválido.',
            next_step: 'Resuelve la cuenta con find_puc_account.',
          };
        }
        let account: any;
        try {
          account = await deps.chartOfAccountsService.findOne(account_id);
        } catch {
          account = null;
        }
        if (!account) {
          return {
            error: `No existe la cuenta ${account_id}. No se cambió nada.`,
            next_step: 'Verifica el ID con find_puc_account.',
          };
        }
        const updatable = [
          'code',
          'name',
          'parent_id',
          'is_active',
          'accepts_entries',
        ] as const;
        const payload: Record<string, unknown> = {};
        for (const f of updatable) {
          if (args?.[f] !== undefined) payload[f] = args[f];
        }
        if (!Object.keys(payload).length) {
          return {
            error: 'No enviaste ningún campo a cambiar. No se cambió nada.',
            next_step:
              'Indica al menos uno de: code, name, parent_id, is_active, accepts_entries.',
          };
        }
        const validated = toValidatedDto(UpdateAccountDto, payload);
        if (!validated.ok) {
          return {
            error: validated.message,
            next_step: 'Corrige los campos y vuelve a proponer.',
          };
        }
        try {
          const updated: any = await deps.chartOfAccountsService.update(
            account_id,
            validated.dto,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            updated: {
              id: updated.id,
              code: updated.code,
              name: updated.name,
              level: updated.level,
              is_active: updated.is_active,
              accepts_entries: updated.accepts_entries,
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'La cuenta no se actualizó. Si el código se ocupó entre la propuesta y la aprobación, elige otro.',
          };
        }
      }),
    },

    // ─── 19. update_account_mapping (F-10, write) ────────────────────
    {
      name: 'update_account_mapping',
      version: '1',
      domain: 'accounting',
      description:
        'Cambia la cuenta PUC efectiva de una clave de contabilización automática (qué cuenta se usa cuando se vende, se compra, se paga nómina, etc.). SOLO crea/actualiza overrides (fila de organización o de tienda): los defaults del sistema (código + seed) nunca se tocan. Cadena habilitante: list_account_mappings (F-9) + find_puc_account.',
      parameters: {
        type: 'object',
        properties: {
          mapping_key: {
            type: 'string',
            description:
              'Clave del evento (ej. "invoice.validated.vat_payable"). Debe existir en el catálogo (list_account_mappings).',
          },
          account_code: {
            type: 'string',
            description:
              'Nuevo código PUC efectivo para esa clave (debe existir).',
          },
          store_id: {
            type: 'number',
            description:
              'Si se indica, el override queda a nivel tienda; si se omite, a nivel organización.',
          },
        },
        required: ['mapping_key', 'account_code'],
      },
      requiredPermissions: [PERM_MAPPINGS_UPDATE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const key = cleanString(args?.mapping_key) ?? '(sin clave)';
        const code = cleanString(args?.account_code) ?? '(sin cuenta)';
        if (!context.organization_id) {
          return writePreviewError(
            `Mapeo ${key}`,
            'Sin organización en contexto: los mapeos se resuelven por organización y tienda.',
          );
        }
        const mapping_key = cleanString(args?.mapping_key);
        const account_code = cleanString(args?.account_code);
        if (!mapping_key || !account_code) {
          return writePreviewError(
            `Mapeo ${key}`,
            'mapping_key y account_code son obligatorios.',
          );
        }
        const account: any = await deps.chartOfAccountsService.findByCode(
          account_code,
        );
        if (!account) {
          return writePreviewError(
            `Mapeo ${mapping_key}`,
            `La cuenta PUC ${account_code} no existe. Busca el código con find_puc_account.`,
          );
        }
        const store_id =
          args?.store_id !== undefined
            ? toPositiveInt(args.store_id) ?? undefined
            : (context.store_id ?? undefined);
        const current = await deps.accountMappingService.getMapping(
          context.organization_id,
          mapping_key,
          store_id,
        );
        if (!current) {
          return writePreviewError(
            `Mapeo ${mapping_key}`,
            `La clave "${mapping_key}" no existe en el catálogo de mapeos. Lista las claves válidas con list_account_mappings (F-9).`,
          );
        }
        const scope =
          store_id !== undefined
            ? `override de tienda ${store_id}`
            : 'base de organización';
        return {
          status: account.accepts_entries ? 'ok' : 'warning',
          target: `${mapping_key} → ${account.code} ${account.name}`,
          changes: [
            {
              field: mapping_key,
              label: `Cuenta efectiva (${current.source} → ${scope})`,
              from: `${current.account_code} (origen: ${current.source})`,
              to: `${account.code} ${account.name} (${scope})`,
            },
          ],
          ...(account.accepts_entries
            ? {
                message:
                  'Solo se escribe el override: los defaults del sistema quedan intactos y el cambio aplica a los próximos asientos automáticos, no recontabiliza el pasado.',
              }
            : {
                message: `La cuenta ${account.code} no acepta movimientos directos: la contabilización automática fallará si la usas aquí. Elige una cuenta hoja.`,
              }),
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        if (!context.organization_id) {
          return {
            error:
              'Sin organización en contexto: los mapeos se resuelven por organización y tienda.',
            next_step: 'Reintenta dentro de una sesión autenticada.',
          };
        }
        const mapping_key = cleanString(args?.mapping_key);
        const account_code = cleanString(args?.account_code);
        if (!mapping_key || !account_code) {
          return {
            error: 'mapping_key y account_code son obligatorios.',
            next_step:
              'Lista las claves con list_account_mappings (F-9) y la cuenta con find_puc_account.',
          };
        }
        const account: any = await deps.chartOfAccountsService.findByCode(
          account_code,
        );
        if (!account) {
          return {
            error: `La cuenta PUC ${account_code} no existe. No se cambió nada.`,
            next_step: 'Busca el código correcto con find_puc_account.',
          };
        }
        const store_id =
          args?.store_id !== undefined
            ? toPositiveInt(args.store_id) ?? undefined
            : (context.store_id ?? undefined);
        const current = await deps.accountMappingService.getMapping(
          context.organization_id,
          mapping_key,
          store_id,
        );
        if (!current) {
          return {
            error: `La clave "${mapping_key}" no existe en el catálogo. No se cambió nada.`,
            next_step: 'Lista las claves válidas con list_account_mappings (F-9).',
          };
        }
        try {
          await deps.accountMappingService.bulkUpsertMappings(
            context.organization_id,
            [{ mapping_key, account_id: account.id }],
            store_id,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            updated: {
              mapping_key,
              previous_account_code: current.account_code,
              previous_source: current.source,
              account_code: account.code,
              account_name: account.name,
              scope: store_id !== undefined ? 'store' : 'organization',
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El mapeo no se actualizó. Verifica la clave con list_account_mappings (F-9).',
          };
        }
      }),
    },

    // ─── 20. reset_account_mappings (F-11, write) ────────────────────
    {
      name: 'reset_account_mappings',
      version: '1',
      domain: 'accounting',
      description:
        'Elimina los overrides de mapeos contables (personalizaciones de organización o de tienda) para que la contabilización automática vuelva a los defaults del sistema. No toca los defaults: solo borra personalizaciones. Cadena habilitante: list_account_mappings (F-9).',
      parameters: {
        type: 'object',
        properties: {
          store_id: {
            type: 'number',
            description:
              'Si se indica, solo se borran los overrides de esa tienda; si se omite, los de la tienda en contexto (o los de organización si no hay tienda).',
          },
        },
      },
      requiredPermissions: [PERM_MAPPINGS_RESET],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.organization_id) {
          return writePreviewError(
            'Mapeos contables',
            'Sin organización en contexto: los mapeos se resuelven por organización y tienda.',
          );
        }
        const store_id =
          args?.store_id !== undefined
            ? toPositiveInt(args.store_id) ?? undefined
            : (context.store_id ?? undefined);
        const mappings = await deps.accountMappingService.getMappings(
          context.organization_id,
          undefined,
          store_id,
        );
        const overrides = mappings.filter((m) => m.source !== 'default');
        if (!overrides.length) {
          return writePreviewError(
            'Mapeos contables',
            'No hay overrides que borrar: todo ya resolvía a defaults del sistema. Nada que resetear.',
          );
        }
        const scope =
          store_id !== undefined ? `tienda ${store_id}` : 'organización';
        return {
          status: 'warning',
          target: `Reset de mapeos (${overrides.length} override(s), ${scope})`,
          changes: overrides.slice(0, 25).map((m) => ({
            field: m.mapping_key,
            label: m.mapping_key,
            from: `${m.account_code} (${m.source})`,
            to: 'default del sistema',
          })),
          message: `Se eliminarán ${overrides.length} personalizacion(es) y la contabilización automática volverá a los defaults.${overrides.length > 25 ? ` Se muestran 25 de ${overrides.length}.` : ''} Los defaults nunca se tocan: solo se borran overrides.`,
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        if (!context.organization_id) {
          return {
            error:
              'Sin organización en contexto: los mapeos se resuelven por organización y tienda.',
            next_step: 'Reintenta dentro de una sesión autenticada.',
          };
        }
        const store_id =
          args?.store_id !== undefined
            ? toPositiveInt(args.store_id) ?? undefined
            : (context.store_id ?? undefined);
        const mappings = await deps.accountMappingService.getMappings(
          context.organization_id,
          undefined,
          store_id,
        );
        const overrides = mappings.filter((m) => m.source !== 'default');
        if (!overrides.length) {
          return {
            error:
              'Ya no hay overrides que borrar (alguien los reseteó entre la propuesta y la aprobación). No se cambió nada.',
            next_step:
              'Verifica el estado con list_account_mappings (F-9).',
          };
        }
        try {
          await deps.accountMappingService.resetToDefaults(
            context.organization_id,
            store_id,
          );
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            reset: {
              overrides_removed: overrides.length,
              scope: store_id !== undefined ? 'store' : 'organization',
              keys: overrides.map((m) => m.mapping_key),
            },
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El reset no se aplicó. Verifica el estado con list_account_mappings (F-9).',
          };
        }
      }),
    },

    // ─── 21. retry_entry_failure (F-13, write) ───────────────────────
    {
      name: 'retry_entry_failure',
      version: '1',
      domain: 'accounting',
      description:
        'Re-encola el reintento de un fallo de contabilización automática: el evento de negocio vuelve a intentar generar su asiento. No recalcula nada: solo reintenta. Si el error era periodo cerrado o cuenta inexistente, resuelve eso primero. Cadena habilitante: list_entry_failures (F-12).',
      parameters: {
        type: 'object',
        properties: {
          failure_id: {
            type: 'number',
            description: 'ID del fallo sin resolver (list_entry_failures).',
          },
        },
        required: ['failure_id'],
      },
      requiredPermissions: [PERM_JOURNAL_UPDATE],
      requiresConfirmation: true,
      preview: async (args, _context) => {
        const label = `Fallo de contabilización #${args?.failure_id ?? '?'}`;
        const failure_id = toPositiveInt(args?.failure_id);
        if (!failure_id) {
          return writePreviewError(
            label,
            'failure_id inválido. Resuelve el fallo con list_entry_failures (F-12).',
          );
        }
        let failure: any;
        try {
          failure = await deps.entryFailureService.findOne(failure_id);
        } catch {
          failure = null;
        }
        if (!failure) {
          return writePreviewError(
            label,
            `No existe el fallo ${failure_id}. Verifica el ID con list_entry_failures (F-12).`,
          );
        }
        if (failure.resolved_at) {
          return writePreviewError(
            label,
            `El fallo ${failure_id} ya está resuelto: no hay nada que reintentar.`,
          );
        }
        const subject = failure.source_type
          ? `${failure.handler_key} — ${failure.source_type}${failure.source_id ? ` #${failure.source_id}` : ''}`
          : failure.handler_key;
        return {
          status: 'ok',
          target: subject,
          changes: [
            {
              field: 'retry',
              label: 'Reintento',
              from: `fallido (${failure.attempt_count ?? 0} intento(s))`,
              to: 'reintento encolado',
            },
          ],
          message: `Último error: ${failure.error_message ?? 'sin detalle'}. Si menciona periodo cerrado o cuenta inexistente, resuelve eso primero o el reintento volverá a fallar.`,
          domain: 'accounting',
        };
      },
      handler: guard(async (args, context) => {
        const failure_id = toPositiveInt(args?.failure_id);
        if (!failure_id) {
          return {
            error: 'failure_id inválido.',
            next_step: 'Resuelve el fallo con list_entry_failures (F-12).',
          };
        }
        let failure: any;
        try {
          failure = await deps.entryFailureService.findOne(failure_id);
        } catch {
          failure = null;
        }
        if (!failure) {
          return {
            error: `No existe el fallo ${failure_id}. No se encoló nada.`,
            next_step: 'Verifica el ID con list_entry_failures (F-12).',
          };
        }
        if (failure.resolved_at) {
          return {
            error: `El fallo ${failure_id} ya está resuelto. No se encoló nada.`,
            next_step:
              'Lista los pendientes con list_entry_failures (F-12).',
          };
        }
        try {
          await deps.entryFailureService.enqueueRetry(failure_id);
          const entity = await describeFiscalEntity(context);
          return {
            accounting_entity: entity,
            enqueued: {
              failure_id,
              handler_key: failure.handler_key,
              source: failure.source_type
                ? { type: failure.source_type, id: failure.source_id ?? null }
                : null,
            },
            next_step:
              'Reintento encolado. Si vuelve a fallar, aparecerá de nuevo en list_entry_failures (F-12) con el error actualizado.',
          };
        } catch (error: any) {
          return {
            error: describeError(error),
            next_step:
              'El reintento no se encoló. Verifica el fallo con list_entry_failures (F-12).',
          };
        }
      }),
    },
  ];
}
