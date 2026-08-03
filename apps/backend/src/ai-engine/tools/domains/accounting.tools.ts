import { RegisteredTool, ToolExecutionContext } from '../interfaces/tool.interface';
import { AccountingReportsService } from '../../../domains/store/accounting/reports/accounting-reports.service';
import { FiscalPeriodsService } from '../../../domains/store/accounting/fiscal-periods/fiscal-periods.service';
import { JournalEntriesService } from '../../../domains/store/accounting/journal-entries/journal-entries.service';
import { ChartOfAccountsService } from '../../../domains/store/accounting/chart-of-accounts/chart-of-accounts.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

/**
 * Familia contable de Vexi. Todas las herramientas son de LECTURA: ninguna
 * escribe asientos, ninguna cierra periodos, ninguna toca mapeos de cuentas.
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
  chartOfAccountsService: ChartOfAccountsService;
  fiscalScopeService: FiscalScopeService;
  prisma: StorePrismaService;
}

const PERM_REPORTS = 'store:accounting:reports:read';
const PERM_PERIODS = 'store:accounting:fiscal_periods:read';
const PERM_JOURNAL = 'store:accounting:journal_entries:read';
const PERM_CHART = 'store:accounting:chart_of_accounts:read';

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

  return [
    // ─── 1. list_fiscal_periods ──────────────────────────────────────
    {
      name: 'list_fiscal_periods',
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
  ];
}
