import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import {
  buildDateRangeFilter,
  resolveFiscalPeriodRange,
} from './fiscal-period.util';
import { FISCAL_CLOSE_CHECKS } from '../constants/fiscal-close-checks';
import {
  CreateFiscalCloseSessionDto,
  FiscalCloseQueryDto,
  OverrideFiscalCloseCheckDto,
  ReopenFiscalCloseDto,
} from '../dto/fiscal-operations.dto';
import { FiscalAuditService } from './fiscal-audit.service';

export interface FiscalClosePreviewCheck {
  check_key: string;
  title: string;
  blocking: boolean;
  status: string;
  result_summary: string | null;
}

export interface FiscalClosePreview {
  session_id: number | null;
  session_status: string | null;
  checks: FiscalClosePreviewCheck[];
}

@Injectable()
export class FiscalCloseService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: FiscalAuditService,
  ) {}

  async list(contexts: FiscalOperationsContext[], query: FiscalCloseQueryDto) {
    return this.prisma.fiscal_close_sessions.findMany({
      where: {
        ...this.whereForContexts(contexts),
        ...(query.status ? { status: query.status } : {}),
        ...(query.period_year ? { period_year: query.period_year } : {}),
        ...(query.store_id ? { store_id: query.store_id } : {}),
      },
      orderBy: [{ period_end: 'desc' }, { id: 'desc' }],
      include: {
        accounting_entity: true,
        store: true,
        checks: { orderBy: { id: 'asc' } },
      },
    });
  }

  async findOne(contexts: FiscalOperationsContext[], id: number) {
    const session = await this.prisma.fiscal_close_sessions.findFirst({
      where: { ...this.whereForContexts(contexts), id },
      include: {
        accounting_entity: true,
        store: true,
        fiscal_period: true,
        checks: { orderBy: { id: 'asc' } },
      },
    });

    if (!session) throw new NotFoundException('Fiscal close session not found');
    return session;
  }

  async createCloseSession(
    context: FiscalOperationsContext,
    dto: CreateFiscalCloseSessionDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) throw new BadRequestException('User context is required');

    const period = resolveFiscalPeriodRange(dto);
    const fiscalPeriod = await this.prisma.fiscal_periods.findFirst({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        start_date: period.period_start,
        end_date: period.period_end,
      },
      select: { id: true },
    });

    const existing = await this.prisma.fiscal_close_sessions.findFirst({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        close_type: dto.close_type ?? 'monthly',
        period_year: period.period_year,
        period_month: period.period_month,
      },
      include: { checks: true },
    });
    if (existing) return existing;

    const session = await this.prisma.fiscal_close_sessions.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id: context.accounting_entity_id,
        fiscal_period_id: fiscalPeriod?.id,
        close_type: dto.close_type ?? 'monthly',
        period_year: period.period_year,
        period_month: period.period_month,
        period_start: period.period_start,
        period_end: period.period_end,
        started_by_user_id: userId,
      },
    });

    this.eventEmitter.emit('fiscal.close.created', {
      id: session.id,
      organization_id: session.organization_id,
      store_id: session.store_id,
      accounting_entity_id: session.accounting_entity_id,
    });
    await this.audit.logForResource(session, {
      event_type: 'fiscal.close.created',
      resource_type: 'fiscal_close_session',
      close_session_id: session.id,
      new_status: session.status,
      metadata: {
        close_type: session.close_type,
        period_year: session.period_year,
        period_month: session.period_month,
      },
    });

    return this.runChecks([context], session.id);
  }

  async runChecks(contexts: FiscalOperationsContext[], sessionId: number) {
    const session = await this.findOne(contexts, sessionId);
    const results = await this.evaluateChecks(session);
    const existingChecks = await this.prisma.fiscal_close_checks.findMany({
      where: { close_session_id: session.id },
      select: {
        check_key: true,
        status: true,
        metadata: true,
      },
    });
    const existingByKey = new Map(
      existingChecks.map((check) => [check.check_key, check]),
    );
    const persistedResults = results.map((result) => {
      const existing = existingByKey.get(result.check_key);
      const preserveOverride =
        existing?.status === 'manually_overridden' &&
        result.blocking &&
        result.status === 'failed';

      if (!preserveOverride) {
        return { ...result, preserveOverride: false };
      }

      return {
        ...result,
        status: 'manually_overridden' as const,
        preserveOverride: true,
        metadata: {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          latest_check_result: {
            status: result.status,
            result_summary: result.result_summary,
            metadata: result.metadata,
            checked_at: new Date().toISOString(),
          },
        },
      };
    });
    const hasBlockingFailure = persistedResults.some(
      (result) => result.blocking && result.status === 'failed',
    );

    await this.prisma.$transaction(async (tx) => {
      for (const result of persistedResults) {
        await tx.fiscal_close_checks.upsert({
          where: {
            fiscal_close_checks_session_key: {
              close_session_id: session.id,
              check_key: result.check_key,
            },
          },
          create: {
            close_session_id: session.id,
            check_key: result.check_key,
            title: result.title,
            description: result.description,
            status: result.status,
            severity: result.blocking ? 'blocking' : 'warning',
            result_summary: result.result_summary,
            blocking: result.blocking,
            metadata: result.metadata,
          },
          update: {
            title: result.title,
            description: result.description,
            status: result.status,
            severity: result.blocking ? 'blocking' : 'warning',
            result_summary: result.result_summary,
            blocking: result.blocking,
            metadata: result.metadata,
            ...(result.preserveOverride
              ? {}
              : {
                  override_reason: null,
                  resolved_by_user_id: null,
                  resolved_at: null,
                }),
          },
        });
      }

      await tx.fiscal_close_sessions.update({
        where: { id: session.id },
        data: {
          status: hasBlockingFailure ? 'blocked' : 'ready',
          summary: {
            checked_at: new Date().toISOString(),
            failures: persistedResults.filter(
              (item) => item.status === 'failed',
            ).length,
            warnings: persistedResults.filter(
              (item) => item.status === 'warning',
            ).length,
            overrides: persistedResults.filter(
              (item) => item.status === 'manually_overridden',
            ).length,
          },
        },
      });
    });

    const updated = await this.findOne(contexts, session.id);
    await this.audit.logForResource(updated, {
      event_type: 'fiscal.close.checks_run',
      resource_type: 'fiscal_close_session',
      close_session_id: updated.id,
      previous_status: session.status,
      new_status: updated.status,
      metadata: {
        total_checks: results.length,
        failures: persistedResults.filter((item) => item.status === 'failed')
          .length,
        warnings: persistedResults.filter((item) => item.status === 'warning')
          .length,
        overrides: persistedResults.filter(
          (item) => item.status === 'manually_overridden',
        ).length,
      },
    });
    return updated;
  }

  /**
   * Dry-run read-only de los checks de cierre para un período mensual.
   *
   * - Si ya existe una sesión de cierre del período para la entidad fiscal del
   *   contexto, devuelve sus checks PERSISTIDOS (incluyendo overrides) en lugar
   *   de re-evaluar, para no divergir de lo que el flujo de cierre ya decidió.
   * - Si no existe sesión, evalúa los checks en memoria sin crear sesión ni
   *   escribir nada en la base de datos.
   */
  async previewChecks(
    context: FiscalOperationsContext,
    period_year: number,
    period_month: number,
  ): Promise<FiscalClosePreview> {
    const existing = await this.prisma.fiscal_close_sessions.findFirst({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        close_type: 'monthly',
        period_year,
        period_month,
      },
      orderBy: { id: 'desc' },
      include: { checks: { orderBy: { id: 'asc' } } },
    });

    if (existing) {
      return {
        session_id: existing.id,
        session_status: String(existing.status),
        checks: existing.checks.map((check) => ({
          check_key: check.check_key,
          title: check.title,
          blocking: check.blocking,
          status: String(check.status),
          result_summary: check.result_summary ?? null,
        })),
      };
    }

    const period = resolveFiscalPeriodRange({ period_year, period_month });
    const results = await this.evaluateChecks({
      organization_id: context.organization_id,
      store_id: context.store_id,
      accounting_entity_id: context.accounting_entity_id,
      period_year,
      period_month,
      period_start: period.period_start,
      period_end: period.period_end,
    });

    return {
      session_id: null,
      session_status: null,
      checks: results.map((result) => ({
        check_key: result.check_key,
        title: result.title,
        blocking: result.blocking,
        status: result.status,
        result_summary: result.result_summary,
      })),
    };
  }

  async overrideCheck(
    contexts: FiscalOperationsContext[],
    sessionId: number,
    checkId: number,
    dto: OverrideFiscalCloseCheckDto,
  ) {
    const session = await this.findOne(contexts, sessionId);
    const check = await this.prisma.fiscal_close_checks.findFirst({
      where: { id: checkId, close_session_id: sessionId },
    });
    if (!check) throw new NotFoundException('Fiscal close check not found');

    const overridden = await this.prisma.fiscal_close_checks.update({
      where: { id: check.id },
      data: {
        status: 'manually_overridden',
        override_reason: dto.reason,
        resolved_by_user_id: RequestContextService.getUserId(),
        resolved_at: new Date(),
        metadata: {
          ...((check.metadata as Record<string, unknown> | null) ?? {}),
          evidence_id: dto.evidence_id,
        },
      },
    });
    await this.audit.logForResource(session, {
      event_type: 'fiscal.close.check_overridden',
      resource_type: 'fiscal_close_check',
      resource_id: overridden.id,
      close_session_id: session.id,
      previous_status: check.status,
      new_status: overridden.status,
      evidence_id: dto.evidence_id,
      metadata: {
        check_key: overridden.check_key,
        reason: dto.reason,
      },
    });
    return overridden;
  }

  async approveClose(contexts: FiscalOperationsContext[], sessionId: number) {
    const session = await this.findOne(contexts, sessionId);
    const blockingFailures = session.checks.filter(
      (check) => check.blocking && check.status === 'failed',
    );
    if (blockingFailures.length > 0) {
      throw new BadRequestException(
        'Blocking checks must pass or be overridden',
      );
    }

    const approved = await this.prisma.fiscal_close_sessions.update({
      where: { id: session.id },
      data: {
        status: 'approved',
        approved_by_user_id: RequestContextService.getUserId(),
        approved_at: new Date(),
      },
    });
    await this.audit.logForResource(approved, {
      event_type: 'fiscal.close.approved',
      resource_type: 'fiscal_close_session',
      close_session_id: approved.id,
      previous_status: session.status,
      new_status: approved.status,
    });
    return approved;
  }

  async close(contexts: FiscalOperationsContext[], sessionId: number) {
    const session = await this.findOne(contexts, sessionId);
    if (session.status !== 'approved' && session.status !== 'ready') {
      throw new BadRequestException('Fiscal close must be approved or ready');
    }
    const blockingFailures = session.checks.filter(
      (check) => check.blocking && check.status === 'failed',
    );
    if (blockingFailures.length > 0) {
      throw new BadRequestException(
        'Blocking checks must pass or be overridden',
      );
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      if (session.fiscal_period_id) {
        await tx.fiscal_periods.update({
          where: { id: session.fiscal_period_id },
          data: {
            status: 'closed',
            closed_by_user_id: RequestContextService.getUserId(),
            closed_at: new Date(),
          },
        });
      }

      return tx.fiscal_close_sessions.update({
        where: { id: session.id },
        data: {
          status: 'closed',
          closed_by_user_id: RequestContextService.getUserId(),
          closed_at: new Date(),
        },
      });
    });

    this.eventEmitter.emit('fiscal.close.closed', {
      id: closed.id,
      organization_id: closed.organization_id,
      store_id: closed.store_id,
      accounting_entity_id: closed.accounting_entity_id,
    });
    await this.audit.logForResource(closed, {
      event_type: 'fiscal.close.closed',
      resource_type: 'fiscal_close_session',
      close_session_id: closed.id,
      previous_status: session.status,
      new_status: closed.status,
      metadata: {
        fiscal_period_id: session.fiscal_period_id,
      },
    });

    return closed;
  }

  async reopen(
    contexts: FiscalOperationsContext[],
    sessionId: number,
    dto: ReopenFiscalCloseDto,
  ) {
    const session = await this.findOne(contexts, sessionId);
    if (session.status !== 'closed') {
      throw new BadRequestException('Only closed sessions can be reopened');
    }

    const reopened = await this.prisma.$transaction(async (tx) => {
      if (session.fiscal_period_id) {
        await tx.fiscal_periods.update({
          where: { id: session.fiscal_period_id },
          data: { status: 'open', closed_by_user_id: null, closed_at: null },
        });
      }

      return tx.fiscal_close_sessions.update({
        where: { id: session.id },
        data: {
          status: 'reopened',
          reopened_at: new Date(),
          reopen_reason: dto.reason,
        },
      });
    });
    await this.audit.logForResource(reopened, {
      event_type: 'fiscal.close.reopened',
      resource_type: 'fiscal_close_session',
      close_session_id: reopened.id,
      previous_status: session.status,
      new_status: reopened.status,
      metadata: {
        reason: dto.reason,
        fiscal_period_id: session.fiscal_period_id,
      },
    });
    return reopened;
  }

  private async evaluateChecks(session: any) {
    const periodRange = buildDateRangeFilter(
      session.period_start,
      session.period_end,
    );
    const [
      pendingInvoices,
      pendingNotes,
      pendingSupportDocuments,
      pendingPayroll,
      incompleteBanks,
      inventorySnapshots,
      openDeclarationObligations,
      draftEntries,
      postedLines,
      overdueAr,
      overdueAp,
    ] = await Promise.all([
      this.prisma.fiscal_transmissions.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          document_type: 'sales_invoice',
          created_at: periodRange,
          dian_status: { in: ['pending', 'rejected', 'error'] },
        },
      }),
      this.prisma.fiscal_transmissions.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          document_type: { in: ['credit_note', 'debit_note'] },
          created_at: periodRange,
          dian_status: { in: ['pending', 'rejected', 'error'] },
        },
      }),
      this.prisma.fiscal_transmissions.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          document_type: {
            in: ['support_document', 'support_adjustment_note'],
          },
          created_at: periodRange,
          dian_status: { in: ['pending', 'rejected', 'error'] },
        },
      }),
      this.prisma.payroll_runs.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          period_start: { lte: session.period_end },
          period_end: { gte: session.period_start },
          dian_status: { in: ['pending', 'rejected', 'error'] },
        },
      }),
      this.prisma.bank_reconciliations.count({
        where: {
          period_start: { lte: session.period_end },
          period_end: { gte: session.period_start },
          status: { not: 'completed' },
          bank_account: {
            organization_id: session.organization_id,
            ...(session.store_id ? { store_id: session.store_id } : {}),
          },
        } as any,
      }),
      this.prisma.inventory_valuation_snapshots.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          snapshot_at: periodRange,
        },
      }),
      this.prisma.fiscal_obligations.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          period_year: session.period_year,
          period_month: session.period_month,
          type: {
            in: [
              'vat_return',
              'inc_return',
              'withholding_return',
              'reteiva_return',
              'reteica_return',
              'ica_return',
            ],
          },
          status: {
            notIn: [
              'approved',
              'submitted',
              'accepted',
              'paid',
              'not_applicable',
            ],
          },
        },
      }),
      this.prisma.accounting_entries.count({
        where: {
          accounting_entity_id: session.accounting_entity_id,
          entry_date: periodRange,
          status: 'draft',
        },
      }),
      this.prisma.accounting_entry_lines.findMany({
        where: {
          entry: {
            accounting_entity_id: session.accounting_entity_id,
            entry_date: periodRange,
            status: 'posted',
          },
        },
        select: { debit_amount: true, credit_amount: true },
      }),
      this.prisma.accounts_receivable.count({
        where: {
          organization_id: session.organization_id,
          ...(session.store_id ? { store_id: session.store_id } : {}),
          status: 'open',
          due_date: { lt: session.period_end },
        },
      }),
      this.prisma.accounts_payable.count({
        where: {
          organization_id: session.organization_id,
          ...(session.store_id ? { store_id: session.store_id } : {}),
          status: 'open',
          due_date: { lt: session.period_end },
        },
      }),
    ]);

    const debit = postedLines.reduce(
      (sum, line) => sum + Number(line.debit_amount || 0),
      0,
    );
    const credit = postedLines.reduce(
      (sum, line) => sum + Number(line.credit_amount || 0),
      0,
    );
    const byKey: Record<
      string,
      { count?: number; passed: boolean; metadata?: Record<string, unknown> }
    > = {
      dian_invoices_all_accepted: {
        count: pendingInvoices,
        passed: pendingInvoices === 0,
      },
      dian_credit_notes_all_accepted: {
        count: pendingNotes,
        passed: pendingNotes === 0,
      },
      support_documents_complete: {
        count: pendingSupportDocuments,
        passed: pendingSupportDocuments === 0,
      },
      payroll_electronic_complete: {
        count: pendingPayroll,
        passed: pendingPayroll === 0,
      },
      bank_reconciliations_complete: {
        count: incompleteBanks,
        passed: incompleteBanks === 0,
      },
      inventory_valuation_complete: {
        count: inventorySnapshots,
        passed: inventorySnapshots > 0,
      },
      tax_declarations_ready: {
        count: openDeclarationObligations,
        passed: openDeclarationObligations === 0,
      },
      journal_entries_posted: {
        count: draftEntries,
        passed: draftEntries === 0,
      },
      trial_balance_balanced: {
        passed: Math.abs(debit - credit) < 0.01,
        metadata: { debit, credit, difference: debit - credit },
      },
      accounts_receivable_reviewed: {
        count: overdueAr,
        passed: overdueAr === 0,
      },
      accounts_payable_reviewed: { count: overdueAp, passed: overdueAp === 0 },
    };

    return FISCAL_CLOSE_CHECKS.map((definition) => {
      const result = byKey[definition.key] ?? { passed: true };
      const failed = !result.passed;
      return {
        check_key: definition.key,
        title: definition.title,
        description: definition.description,
        blocking: definition.blocking,
        status: failed
          ? definition.blocking
            ? 'failed'
            : 'warning'
          : 'passed',
        result_summary: failed
          ? `Revisión pendiente: ${result.count ?? 'diferencia detectada'}`
          : 'Sin hallazgos bloqueantes',
        metadata: result.metadata ?? { count: result.count ?? 0 },
      } as const;
    });
  }

  private whereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_close_sessionsWhereInput {
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
}
