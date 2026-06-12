import { Injectable } from '@nestjs/common';
import { fiscal_document_type_enum, Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalStatusResolverService } from '@common/services/fiscal-status-resolver.service';
import { FiscalArea } from '@common/interfaces/fiscal-status.interface';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalCloseService } from './fiscal-close.service';
import {
  buildDateRangeFilter,
  resolveFiscalPeriodRange,
} from './fiscal-period.util';
import { FiscalFlowStateQueryDto } from '../dto/fiscal-operations.dto';

export type FlowStageStatus =
  | 'ok'
  | 'warning'
  | 'blocked'
  | 'empty'
  | 'not_applicable';

export interface FlowStage {
  key: string;
  label: string;
  status: FlowStageStatus;
  counts: Record<string, number>;
  detail?: string;
}

export interface FiscalCloseChecksSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
}

export interface FiscalFlowStateResponse {
  period: {
    year: number;
    month: number;
    start_date: string;
    end_date: string;
  };
  flows: {
    sales: { stages: FlowStage[] };
    purchases: { stages: FlowStage[] };
    payroll: { stages: FlowStage[] };
  };
  convergence: {
    journal: FlowStage;
    declarations: FlowStage;
    obligations: FlowStage;
    close: FlowStage & { checks_summary?: FiscalCloseChecksSummary };
  };
}

const SALES_DOCUMENT_TYPES: fiscal_document_type_enum[] = [
  'sales_invoice',
  'credit_note',
  'debit_note',
];

const SUPPORT_DOCUMENT_TYPES: fiscal_document_type_enum[] = [
  'support_document',
  'support_adjustment_note',
];

type GroupRow = Record<string, unknown> & { _count: { _all: number } };

/**
 * Consolidador read-only del "Centro Fiscal": en una sola llamada devuelve el
 * estado por etapa de los 3 flujos fiscales del período (ventas, compras,
 * nómina) más la convergencia contable (asientos, declaraciones, obligaciones
 * y cierre). No escribe nada: solo counts/groupBy sobre las tablas fiscales y
 * un dry-run de checks de cierre vía FiscalCloseService.previewChecks.
 */
@Injectable()
export class FiscalFlowStateService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalStatus: FiscalStatusResolverService,
    private readonly closeService: FiscalCloseService,
  ) {}

  async getFlowState(
    contexts: FiscalOperationsContext[],
    query: FiscalFlowStateQueryDto,
  ): Promise<FiscalFlowStateResponse> {
    const period = resolveFiscalPeriodRange({
      period_year: query.year,
      period_month: query.month,
    });
    const periodInfo = {
      year: period.period_year,
      month: period.period_month as number,
      start_date: period.period_start.toISOString(),
      end_date: period.period_end.toISOString(),
    };

    if (contexts.length === 0) {
      return this.emptyResponse(periodInfo);
    }

    const periodRange = buildDateRangeFilter(
      period.period_start,
      period.period_end,
    );
    const scope = this.scopeWhereForContexts(contexts);
    const applicable = await this.resolveApplicableAreas(contexts);

    const [
      salesDianGroups,
      salesAccountingGroups,
      supportDianGroups,
      retryPending,
      withholdingGroups,
      payrollStatusGroups,
      payrollDianGroups,
      payrollAccountingGroups,
      draftEntries,
      postedEntries,
      declarationGroups,
      obligationGroups,
    ] = await Promise.all([
      this.prisma.fiscal_transmissions.groupBy({
        by: ['dian_status'],
        where: {
          ...scope,
          document_type: { in: SALES_DOCUMENT_TYPES },
          created_at: periodRange,
        } as Prisma.fiscal_transmissionsWhereInput,
        _count: { _all: true },
      }),
      this.prisma.fiscal_transmissions.groupBy({
        by: ['accounting_status'],
        where: {
          ...scope,
          document_type: { in: SALES_DOCUMENT_TYPES },
          created_at: periodRange,
        } as Prisma.fiscal_transmissionsWhereInput,
        _count: { _all: true },
      }),
      this.prisma.fiscal_transmissions.groupBy({
        by: ['dian_status'],
        where: {
          ...scope,
          document_type: { in: SUPPORT_DOCUMENT_TYPES },
          created_at: periodRange,
        } as Prisma.fiscal_transmissionsWhereInput,
        _count: { _all: true },
      }),
      this.prisma.invoice_retry_queue.count({
        where: {
          org_id: contexts[0].organization_id,
          ...this.retryStoreFilter(contexts),
          status: 'pending',
          created_at: periodRange,
        } as Prisma.invoice_retry_queueWhereInput,
      }),
      this.prisma.withholding_calculations.groupBy({
        by: ['withholding_type'],
        where: {
          ...scope,
          role: 'practiced',
          created_at: periodRange,
        } as Prisma.withholding_calculationsWhereInput,
        _count: { _all: true },
      }),
      this.prisma.payroll_runs.groupBy({
        by: ['status'],
        where: this.payrollOverlapWhere(scope, period),
        _count: { _all: true },
      }),
      this.prisma.payroll_runs.groupBy({
        by: ['dian_status'],
        where: this.payrollOverlapWhere(scope, period),
        _count: { _all: true },
      }),
      this.prisma.payroll_runs.groupBy({
        by: ['accounting_status'],
        where: this.payrollOverlapWhere(scope, period),
        _count: { _all: true },
      }),
      this.prisma.accounting_entries.count({
        where: {
          ...scope,
          entry_date: periodRange,
          status: 'draft',
        } as Prisma.accounting_entriesWhereInput,
      }),
      this.prisma.accounting_entries.count({
        where: {
          ...scope,
          entry_date: periodRange,
          status: 'posted',
        } as Prisma.accounting_entriesWhereInput,
      }),
      this.prisma.tax_declaration_drafts.groupBy({
        by: ['status'],
        where: {
          ...scope,
          period_year: query.year,
          period_month: query.month,
        } as Prisma.tax_declaration_draftsWhereInput,
        _count: { _all: true },
      }),
      this.prisma.fiscal_obligations.groupBy({
        by: ['status'],
        where: {
          ...scope,
          period_year: query.year,
          period_month: query.month,
        } as Prisma.fiscal_obligationsWhereInput,
        _count: { _all: true },
      }),
    ]);

    const salesDian = this.toCounts(salesDianGroups, 'dian_status');
    const salesAccounting = this.toCounts(
      salesAccountingGroups,
      'accounting_status',
    );
    const supportDian = this.toCounts(supportDianGroups, 'dian_status');
    const payrollStatus = this.toCounts(payrollStatusGroups, 'status');
    const payrollDian = this.toCounts(payrollDianGroups, 'dian_status');
    const payrollAccounting = this.toCounts(
      payrollAccountingGroups,
      'accounting_status',
    );

    const close = applicable.accounting
      ? await this.buildCloseStage(contexts, query.year, query.month)
      : this.notApplicableStage('close', 'Cierre fiscal del período');

    return {
      period: periodInfo,
      flows: {
        sales: {
          stages: [
            this.buildEmissionStage(salesDian, applicable.invoicing),
            this.buildDianStage(
              'dian',
              'Transmisión DIAN',
              salesDian,
              applicable.invoicing,
              retryPending,
            ),
            this.buildAccountingStage(
              'journal',
              'Asiento contable de ventas',
              salesAccounting,
              applicable.accounting,
            ),
          ],
        },
        purchases: {
          stages: [
            this.buildDianStage(
              'support_documents',
              'Documento soporte',
              supportDian,
              applicable.invoicing,
            ),
            this.buildWithholdingsStage(withholdingGroups, applicable.accounting),
          ],
        },
        payroll: {
          stages: [
            this.buildPayrollSettlementStage(payrollStatus, applicable.payroll),
            this.buildPayrollDianStage(payrollDian, applicable.payroll),
            this.buildAccountingStage(
              'journal',
              'Asiento contable de nómina',
              payrollAccounting,
              applicable.payroll && applicable.accounting,
            ),
          ],
        },
      },
      convergence: {
        journal: this.buildJournalStage(
          draftEntries,
          postedEntries,
          applicable.accounting,
        ),
        declarations: this.buildDeclarationsStage(
          this.toCounts(declarationGroups, 'status'),
          applicable.accounting,
        ),
        obligations: this.buildObligationsStage(
          this.toCounts(obligationGroups, 'status'),
          applicable.accounting,
        ),
        close,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Etapas
  // ---------------------------------------------------------------------------

  private buildEmissionStage(
    salesDian: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    const total = this.sumCounts(salesDian);
    if (!applicable) {
      return this.notApplicableStage('emission', 'Emisión de documentos');
    }
    return {
      key: 'emission',
      label: 'Emisión de documentos',
      status: total === 0 ? 'empty' : 'ok',
      counts: { total },
      detail:
        total === 0
          ? 'Sin documentos de venta emitidos en el período'
          : `${total} documento(s) de venta emitido(s)`,
    };
  }

  private buildDianStage(
    key: string,
    label: string,
    dianCounts: Record<string, number>,
    applicable: boolean,
    retryPending = 0,
  ): FlowStage {
    if (!applicable) return this.notApplicableStage(key, label);

    const rejected = (dianCounts.rejected ?? 0) + (dianCounts.error ?? 0);
    const pending = (dianCounts.pending ?? 0) + retryPending;
    const accepted = dianCounts.accepted ?? 0;
    const counts: Record<string, number> = {
      pending: dianCounts.pending ?? 0,
      accepted,
      rejected: dianCounts.rejected ?? 0,
      error: dianCounts.error ?? 0,
      ...(retryPending > 0 || key === 'dian'
        ? { retry_pending: retryPending }
        : {}),
    };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (rejected > 0) {
      status = 'blocked';
      detail = `${rejected} documento(s) rechazado(s) o con error ante DIAN`;
    } else if (pending > 0) {
      status = 'warning';
      detail = `${pending} documento(s) pendiente(s) de respuesta DIAN`;
    } else if (accepted > 0) {
      status = 'ok';
      detail = 'Todos los documentos del período fueron aceptados';
    } else {
      status = 'empty';
      detail = 'Sin documentos transmitidos en el período';
    }

    return { key, label, status, counts, detail };
  }

  private buildAccountingStage(
    key: string,
    label: string,
    accountingCounts: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) return this.notApplicableStage(key, label);

    const blocked = accountingCounts.blocked ?? 0;
    const provisional = accountingCounts.provisional ?? 0;
    const posted = accountingCounts.posted ?? 0;
    const pending = blocked + provisional;
    const counts = { blocked, provisional, posted };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (pending > 0) {
      status = 'warning';
      detail = `${pending} documento(s) sin asiento contable definitivo`;
    } else if (posted > 0) {
      status = 'ok';
      detail = 'Todos los asientos del flujo están contabilizados';
    } else {
      status = 'empty';
      detail = 'Sin movimientos contables en el período';
    }

    return { key, label, status, counts, detail };
  }

  private buildWithholdingsStage(
    groups: GroupRow[],
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('withholdings', 'Retenciones practicadas');
    }

    const counts: Record<string, number> = {
      total: 0,
      retefuente: 0,
      reteiva: 0,
      reteica: 0,
      untyped: 0,
    };
    for (const group of groups) {
      const count = group._count._all;
      counts.total += count;
      const type = group.withholding_type as string | null;
      if (type && type in counts) {
        counts[type] += count;
      } else if (!type) {
        counts.untyped += count;
      }
    }

    return {
      key: 'withholdings',
      label: 'Retenciones practicadas',
      status: counts.total === 0 ? 'empty' : 'ok',
      counts,
      detail:
        counts.total === 0
          ? 'Sin retenciones practicadas en el período'
          : `${counts.total} retención(es) practicada(s) en el período`,
    };
  }

  private buildPayrollSettlementStage(
    statusCounts: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('settlement', 'Liquidación de nómina');
    }

    const rejected = statusCounts.rejected ?? 0;
    const inProgress =
      (statusCounts.draft ?? 0) + (statusCounts.calculated ?? 0);
    const done =
      (statusCounts.approved ?? 0) +
      (statusCounts.sent ?? 0) +
      (statusCounts.accepted ?? 0) +
      (statusCounts.paid ?? 0);
    const counts: Record<string, number> = {
      draft: statusCounts.draft ?? 0,
      calculated: statusCounts.calculated ?? 0,
      approved: statusCounts.approved ?? 0,
      sent: statusCounts.sent ?? 0,
      accepted: statusCounts.accepted ?? 0,
      rejected,
      paid: statusCounts.paid ?? 0,
      cancelled: statusCounts.cancelled ?? 0,
    };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (rejected > 0) {
      status = 'blocked';
      detail = `${rejected} nómina(s) rechazada(s)`;
    } else if (inProgress > 0) {
      status = 'warning';
      detail = `${inProgress} nómina(s) sin aprobar en el período`;
    } else if (done > 0) {
      status = 'ok';
      detail = 'Nóminas del período liquidadas y aprobadas';
    } else {
      status = 'empty';
      detail = 'Sin nóminas en el período';
    }

    return { key: 'settlement', label: 'Liquidación de nómina', status, counts, detail };
  }

  private buildPayrollDianStage(
    dianCounts: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('dspne', 'Nómina electrónica (DSPNE)');
    }

    const rejected = (dianCounts.rejected ?? 0) + (dianCounts.error ?? 0);
    const pending = dianCounts.pending ?? 0;
    const accepted = dianCounts.accepted ?? 0;
    const counts: Record<string, number> = {
      pending,
      accepted,
      rejected: dianCounts.rejected ?? 0,
      error: dianCounts.error ?? 0,
      not_applicable: dianCounts.not_applicable ?? 0,
    };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (rejected > 0) {
      status = 'blocked';
      detail = `${rejected} nómina(s) electrónica(s) rechazada(s) o con error`;
    } else if (pending > 0) {
      status = 'warning';
      detail = `${pending} nómina(s) pendiente(s) de transmisión DIAN`;
    } else if (accepted > 0) {
      status = 'ok';
      detail = 'Nómina electrónica del período aceptada';
    } else {
      status = 'empty';
      detail = 'Sin nómina electrónica que transmitir en el período';
    }

    return {
      key: 'dspne',
      label: 'Nómina electrónica (DSPNE)',
      status,
      counts,
      detail,
    };
  }

  private buildJournalStage(
    draft: number,
    posted: number,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('journal', 'Asientos del período');
    }

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (draft > 0) {
      status = 'warning';
      detail = `${draft} asiento(s) en borrador pendiente(s) de contabilizar`;
    } else if (posted > 0) {
      status = 'ok';
      detail = 'Todos los asientos del período están contabilizados';
    } else {
      status = 'empty';
      detail = 'Sin asientos en el período';
    }

    return {
      key: 'journal',
      label: 'Asientos del período',
      status,
      counts: { draft, posted },
      detail,
    };
  }

  private buildDeclarationsStage(
    statusCounts: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('declarations', 'Declaraciones del período');
    }

    const rejected = statusCounts.rejected ?? 0;
    const inProgress =
      (statusCounts.draft ?? 0) +
      (statusCounts.calculating ?? 0) +
      (statusCounts.needs_review ?? 0) +
      (statusCounts.ready ?? 0);
    const done =
      (statusCounts.approved ?? 0) +
      (statusCounts.submitted ?? 0) +
      (statusCounts.accepted ?? 0) +
      (statusCounts.paid ?? 0);
    const counts: Record<string, number> = {
      draft: statusCounts.draft ?? 0,
      calculating: statusCounts.calculating ?? 0,
      ready: statusCounts.ready ?? 0,
      needs_review: statusCounts.needs_review ?? 0,
      approved: statusCounts.approved ?? 0,
      submitted: statusCounts.submitted ?? 0,
      accepted: statusCounts.accepted ?? 0,
      rejected,
      paid: statusCounts.paid ?? 0,
      voided: statusCounts.voided ?? 0,
    };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (rejected > 0) {
      status = 'blocked';
      detail = `${rejected} declaración(es) rechazada(s)`;
    } else if (inProgress > 0) {
      status = 'warning';
      detail = `${inProgress} borrador(es) de declaración en progreso`;
    } else if (done > 0) {
      status = 'ok';
      detail = 'Declaraciones del período presentadas';
    } else {
      status = 'empty';
      detail = 'Sin borradores de declaración en el período';
    }

    return {
      key: 'declarations',
      label: 'Declaraciones del período',
      status,
      counts,
      detail,
    };
  }

  private buildObligationsStage(
    statusCounts: Record<string, number>,
    applicable: boolean,
  ): FlowStage {
    if (!applicable) {
      return this.notApplicableStage('obligations', 'Obligaciones fiscales');
    }

    const blocked =
      (statusCounts.overdue ?? 0) +
      (statusCounts.rejected ?? 0) +
      (statusCounts.blocked ?? 0);
    const inProgress =
      (statusCounts.pending ?? 0) +
      (statusCounts.in_progress ?? 0) +
      (statusCounts.ready ?? 0);
    const done =
      (statusCounts.approved ?? 0) +
      (statusCounts.submitted ?? 0) +
      (statusCounts.accepted ?? 0) +
      (statusCounts.paid ?? 0);
    const counts: Record<string, number> = {
      pending: statusCounts.pending ?? 0,
      in_progress: statusCounts.in_progress ?? 0,
      ready: statusCounts.ready ?? 0,
      blocked: statusCounts.blocked ?? 0,
      overdue: statusCounts.overdue ?? 0,
      rejected: statusCounts.rejected ?? 0,
      approved: statusCounts.approved ?? 0,
      submitted: statusCounts.submitted ?? 0,
      accepted: statusCounts.accepted ?? 0,
      paid: statusCounts.paid ?? 0,
      cancelled: statusCounts.cancelled ?? 0,
      not_applicable: statusCounts.not_applicable ?? 0,
    };

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (blocked > 0) {
      status = 'blocked';
      detail = `${blocked} obligación(es) vencida(s), bloqueada(s) o rechazada(s)`;
    } else if (inProgress > 0) {
      status = 'warning';
      detail = `${inProgress} obligación(es) pendiente(s) del período`;
    } else if (done > 0) {
      status = 'ok';
      detail = 'Obligaciones del período cumplidas';
    } else {
      status = 'empty';
      detail = 'Sin obligaciones generadas para el período';
    }

    return {
      key: 'obligations',
      label: 'Obligaciones fiscales',
      status,
      counts,
      detail,
    };
  }

  private async buildCloseStage(
    contexts: FiscalOperationsContext[],
    year: number,
    month: number,
  ): Promise<FlowStage & { checks_summary?: FiscalCloseChecksSummary }> {
    const previews = await Promise.all(
      contexts.map((context) =>
        this.closeService.previewChecks(context, year, month),
      ),
    );

    let sessions = 0;
    let closedSessions = 0;
    const summary: FiscalCloseChecksSummary = {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0,
    };

    for (const preview of previews) {
      if (preview.session_id !== null) sessions += 1;
      if (preview.session_status === 'closed') closedSessions += 1;
      for (const check of preview.checks) {
        summary.total += 1;
        if (check.status === 'failed') {
          summary.failed += 1;
        } else if (check.status === 'warning' || check.status === 'pending') {
          summary.warnings += 1;
        } else {
          // passed o manually_overridden cuentan como superados
          summary.passed += 1;
        }
      }
    }

    let status: FlowStageStatus;
    let detail: string | undefined;
    if (summary.failed > 0) {
      status = 'blocked';
      detail = `${summary.failed} check(s) de cierre bloqueante(s) fallido(s)`;
    } else if (sessions > 0 && closedSessions === sessions) {
      status = 'ok';
      detail = 'Período cerrado';
    } else {
      status = 'warning';
      detail =
        sessions > 0
          ? 'Cierre del período en progreso'
          : 'Checks superados: el período está listo para iniciar cierre';
    }

    return {
      key: 'close',
      label: 'Cierre fiscal del período',
      status,
      counts: {
        sessions,
        closed_sessions: closedSessions,
        checks_passed: summary.passed,
        checks_warning: summary.warnings,
        checks_failed: summary.failed,
      },
      detail,
      checks_summary: summary,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveApplicableAreas(
    contexts: FiscalOperationsContext[],
  ): Promise<Record<FiscalArea, boolean>> {
    const blocks = await Promise.all(
      contexts.map((context) =>
        this.fiscalStatus.getStatusBlock(
          context.organization_id,
          context.store_id,
        ),
      ),
    );

    const isActive = (area: FiscalArea): boolean =>
      blocks.some((block) => {
        const state = block.fiscal_status[area]?.state;
        return state === 'ACTIVE' || state === 'LOCKED';
      });

    return {
      invoicing: isActive('invoicing'),
      accounting: isActive('accounting'),
      payroll: isActive('payroll'),
    };
  }

  private payrollOverlapWhere(
    scope: Record<string, unknown>,
    period: { period_start: Date; period_end: Date },
  ): Prisma.payroll_runsWhereInput {
    return {
      ...scope,
      period_start: { lte: period.period_end },
      period_end: { gte: period.period_start },
    } as Prisma.payroll_runsWhereInput;
  }

  private retryStoreFilter(
    contexts: FiscalOperationsContext[],
  ): Record<string, unknown> {
    const storeIds = contexts
      .map((context) => context.store_id)
      .filter((id): id is number => id !== null);
    return storeIds.length > 0 ? { store_id: { in: storeIds } } : {};
  }

  private scopeWhereForContexts(
    contexts: FiscalOperationsContext[],
  ): Record<string, unknown> {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }

  private toCounts(groups: GroupRow[], key: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const group of groups) {
      const value = group[key];
      if (value === null || value === undefined) continue;
      counts[String(value)] = group._count._all;
    }
    return counts;
  }

  private sumCounts(counts: Record<string, number>): number {
    return Object.values(counts).reduce((sum, value) => sum + value, 0);
  }

  private notApplicableStage(key: string, label: string): FlowStage {
    return {
      key,
      label,
      status: 'not_applicable',
      counts: {},
      detail: 'Área fiscal no activa',
    };
  }

  private emptyResponse(periodInfo: {
    year: number;
    month: number;
    start_date: string;
    end_date: string;
  }): FiscalFlowStateResponse {
    const empty = (key: string, label: string): FlowStage => ({
      key,
      label,
      status: 'empty',
      counts: {},
      detail: 'Sin entidades fiscales activas',
    });

    return {
      period: periodInfo,
      flows: {
        sales: {
          stages: [
            empty('emission', 'Emisión de documentos'),
            empty('dian', 'Transmisión DIAN'),
            empty('journal', 'Asiento contable de ventas'),
          ],
        },
        purchases: {
          stages: [
            empty('support_documents', 'Documento soporte'),
            empty('withholdings', 'Retenciones practicadas'),
          ],
        },
        payroll: {
          stages: [
            empty('settlement', 'Liquidación de nómina'),
            empty('dspne', 'Nómina electrónica (DSPNE)'),
            empty('journal', 'Asiento contable de nómina'),
          ],
        },
      },
      convergence: {
        journal: empty('journal', 'Asientos del período'),
        declarations: empty('declarations', 'Declaraciones del período'),
        obligations: empty('obligations', 'Obligaciones fiscales'),
        close: empty('close', 'Cierre fiscal del período'),
      },
    };
  }
}
