import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  fiscal_obligation_status_enum,
  fiscal_obligation_type_enum,
  Prisma,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalStatusResolverService } from '@common/services/fiscal-status-resolver.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import {
  defaultAnnualDueDate,
  defaultMonthlyDueDate,
  resolveFiscalPeriodRange,
} from './fiscal-period.util';
import {
  ChangeFiscalObligationStatusDto,
  FiscalListQueryDto,
  GenerateFiscalObligationsDto,
} from '../dto/fiscal-operations.dto';
import { FiscalAuditService } from './fiscal-audit.service';

const FINAL_STATUSES: fiscal_obligation_status_enum[] = [
  'approved',
  'submitted',
  'accepted',
  'paid',
  'cancelled',
  'not_applicable',
];

const TERMINAL_OBLIGATION_STATUSES: fiscal_obligation_status_enum[] = [
  'paid',
  'cancelled',
  'not_applicable',
];

const EVIDENCE_REQUIRED_STATUSES: fiscal_obligation_status_enum[] = [
  'submitted',
  'accepted',
  'paid',
];

const OBLIGATION_STATUS_TRANSITIONS: Record<
  fiscal_obligation_status_enum,
  fiscal_obligation_status_enum[]
> = {
  pending: ['in_progress', 'blocked', 'ready', 'not_applicable', 'cancelled'],
  in_progress: ['blocked', 'ready', 'not_applicable', 'cancelled'],
  blocked: ['in_progress', 'ready', 'not_applicable', 'cancelled'],
  ready: ['approved', 'submitted', 'blocked', 'not_applicable', 'cancelled'],
  approved: ['submitted', 'cancelled'],
  submitted: ['accepted', 'rejected', 'paid'],
  accepted: ['paid'],
  rejected: ['in_progress', 'submitted', 'cancelled'],
  overdue: ['in_progress', 'ready', 'approved', 'submitted', 'not_applicable'],
  paid: [],
  cancelled: [],
  not_applicable: [],
};

@Injectable()
export class FiscalObligationService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalStatus: FiscalStatusResolverService,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: FiscalAuditService,
  ) {}

  async getOverview(contexts: FiscalOperationsContext[]) {
    const where = this.scopeWhereForContexts(contexts);
    const [
      upcoming,
      overdue,
      ready,
      blocked,
      rejectedDocuments,
      openCloseSessions,
      estimated,
      finalAmounts,
    ] = await Promise.all([
      this.prisma.fiscal_obligations.count({
        where: {
          ...where,
          status: { in: ['pending', 'in_progress', 'ready'] },
          due_date: { gte: new Date(), lte: this.daysFromNow(30) },
        } as Prisma.fiscal_obligationsWhereInput,
      }),
      this.prisma.fiscal_obligations.count({
        where: {
          ...where,
          status: 'overdue',
        } as Prisma.fiscal_obligationsWhereInput,
      }),
      this.prisma.tax_declaration_drafts.count({
        where: {
          ...where,
          status: 'ready',
        } as Prisma.tax_declaration_draftsWhereInput,
      }),
      this.prisma.fiscal_obligations.count({
        where: {
          ...where,
          status: 'blocked',
        } as Prisma.fiscal_obligationsWhereInput,
      }),
      this.prisma.fiscal_transmissions.count({
        where: {
          ...where,
          dian_status: { in: ['rejected', 'error'] },
        } as any,
      }),
      this.prisma.fiscal_close_sessions.count({
        where: {
          ...where,
          status: { in: ['draft', 'checking', 'blocked', 'ready'] },
        } as Prisma.fiscal_close_sessionsWhereInput,
      }),
      this.prisma.fiscal_obligations.aggregate({
        where: {
          ...where,
          status: { notIn: ['cancelled', 'not_applicable'] },
        } as Prisma.fiscal_obligationsWhereInput,
        _sum: { estimated_amount: true },
      }),
      this.prisma.fiscal_obligations.aggregate({
        where: {
          ...where,
          status: { in: ['approved', 'submitted', 'accepted', 'paid'] },
        } as Prisma.fiscal_obligationsWhereInput,
        _sum: { final_amount: true },
      }),
    ]);

    const nextObligations = await this.prisma.fiscal_obligations.findMany({
      where: where as Prisma.fiscal_obligationsWhereInput,
      orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
      take: 10,
      include: { accounting_entity: true, store: true },
    });

    return {
      stats: {
        upcoming,
        overdue,
        declarations_ready: ready,
        blocked,
        rejected_documents: rejectedDocuments,
        open_close_sessions: openCloseSessions,
        estimated_amount: Number(estimated._sum.estimated_amount || 0),
        final_amount: Number(finalAmounts._sum.final_amount || 0),
      },
      next_obligations: nextObligations,
    };
  }

  async list(contexts: FiscalOperationsContext[], query: FiscalListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.fiscal_obligationsWhereInput = {
      ...this.whereForContexts(contexts),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.period_year ? { period_year: query.period_year } : {}),
      ...(query.period_month ? { period_month: query.period_month } : {}),
      ...(query.store_id ? { store_id: query.store_id } : {}),
      ...(query.accounting_entity_id
        ? { accounting_entity_id: query.accounting_entity_id }
        : {}),
    };

    if (query.date_from || query.date_to) {
      where.due_date = {
        ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
        ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.fiscal_obligations.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
        include: { accounting_entity: true, store: true, evidence: true },
      }),
      this.prisma.fiscal_obligations.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(contexts: FiscalOperationsContext[], id: number) {
    const obligation = await this.prisma.fiscal_obligations.findFirst({
      where: { ...this.whereForContexts(contexts), id },
      include: {
        accounting_entity: true,
        store: true,
        evidence: true,
        declaration_drafts: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
      },
    });

    if (!obligation) {
      throw new NotFoundException('Fiscal obligation not found');
    }

    return obligation;
  }

  async generateForContext(
    context: FiscalOperationsContext,
    dto: GenerateFiscalObligationsDto,
  ) {
    const period = resolveFiscalPeriodRange(dto);
    const types = dto.types?.length
      ? dto.types
      : await this.defaultTypesForContext(context, period);
    const created_or_updated: any[] = [];

    for (const type of types) {
      const due_date = this.resolveDueDate(
        type,
        period.period_end,
        period.period_year,
      );
      const existing = await this.prisma.fiscal_obligations.findFirst({
        where: {
          accounting_entity_id: context.accounting_entity_id,
          type,
          period_year: period.period_year,
          period_month: period.period_month,
          period_quarter: period.period_quarter,
        },
      });

      if (existing) {
        if (dto.force_refresh && !FINAL_STATUSES.includes(existing.status)) {
          const updated = await this.prisma.fiscal_obligations.update({
            where: { id: existing.id },
            data: {
              period_start: period.period_start,
              period_end: period.period_end,
              due_date,
              source: 'generated',
            },
          });
          await this.audit.logForResource(updated, {
            event_type: 'fiscal.obligation.refreshed',
            resource_type: 'fiscal_obligation',
            obligation_id: updated.id,
            previous_status: existing.status,
            new_status: updated.status,
            metadata: {
              type,
              period_year: period.period_year,
              period_month: period.period_month,
              period_quarter: period.period_quarter,
              force_refresh: dto.force_refresh ?? false,
            },
          });
          created_or_updated.push(updated);
        } else {
          created_or_updated.push(existing);
        }
        continue;
      }

      const created = await this.prisma.fiscal_obligations.create({
        data: {
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id: context.accounting_entity_id,
          type,
          period_year: period.period_year,
          period_month: period.period_month,
          period_quarter: period.period_quarter,
          period_start: period.period_start,
          period_end: period.period_end,
          due_date,
          source: 'generated',
          created_by_user_id: RequestContextService.getUserId(),
        },
      });
      await this.audit.logForResource(created, {
        event_type: 'fiscal.obligation.generated',
        resource_type: 'fiscal_obligation',
        obligation_id: created.id,
        new_status: created.status,
        metadata: {
          type,
          period_year: period.period_year,
          period_month: period.period_month,
          period_quarter: period.period_quarter,
        },
      });
      created_or_updated.push(created);
    }

    return created_or_updated;
  }

  async updateStatus(
    contexts: FiscalOperationsContext[],
    id: number,
    dto: ChangeFiscalObligationStatusDto,
  ) {
    const obligation = await this.findOne(contexts, id);
    this.assertStatusTransition(obligation.status, dto.status);
    await this.assertEvidenceForStatus(obligation, dto);
    const now = new Date();
    const data: Prisma.fiscal_obligationsUpdateInput = {
      status: dto.status,
      notes: dto.notes ?? obligation.notes,
      blocking_reason: dto.blocking_reason ?? obligation.blocking_reason,
      ...(dto.evidence_id
        ? { evidence: { connect: { id: dto.evidence_id } } }
        : {}),
    };

    if (dto.status === 'approved') {
      data.approved_at = now;
      data.approved_by_user = RequestContextService.getUserId()
        ? { connect: { id: RequestContextService.getUserId()! } }
        : undefined;
    }
    if (dto.status === 'submitted') data.submitted_at = now;
    if (dto.status === 'accepted') data.accepted_at = now;
    if (dto.status === 'paid') data.paid_at = now;
    if (dto.status === 'not_applicable' && !dto.notes) {
      throw new BadRequestException('notes is required for not_applicable');
    }

    const updated = await this.prisma.fiscal_obligations.update({
      where: { id: obligation.id },
      data,
      include: { accounting_entity: true, store: true, evidence: true },
    });

    this.eventEmitter.emit('fiscal.obligation.status_changed', {
      id: updated.id,
      status: updated.status,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      accounting_entity_id: updated.accounting_entity_id,
    });
    await this.audit.logForResource(updated, {
      event_type: 'fiscal.obligation.status_changed',
      resource_type: 'fiscal_obligation',
      obligation_id: updated.id,
      evidence_id: updated.evidence_id,
      previous_status: obligation.status,
      new_status: updated.status,
      metadata: {
        notes: dto.notes,
        blocking_reason: dto.blocking_reason,
        payment_info: dto.payment_info as Prisma.InputJsonValue,
      },
    });

    return updated;
  }

  async refreshOverdue() {
    const due = await this.prisma.fiscal_obligations.findMany({
      where: {
        status: { in: ['pending', 'in_progress', 'blocked', 'ready'] },
        due_date: { lt: new Date() },
      },
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        accounting_entity_id: true,
        status: true,
      },
    });

    for (const item of due) {
      const updated = await this.prisma.fiscal_obligations.update({
        where: { id: item.id },
        data: { status: 'overdue' },
      });
      this.eventEmitter.emit('fiscal.obligation.overdue', item);
      await this.audit.logForResource(updated, {
        event_type: 'fiscal.obligation.overdue',
        resource_type: 'fiscal_obligation',
        obligation_id: updated.id,
        previous_status: item.status,
        new_status: updated.status,
      });
    }

    return { updated: due.length };
  }

  private async defaultTypesForContext(
    context: FiscalOperationsContext,
    period: { period_month: number | null; period_quarter: number | null },
  ): Promise<fiscal_obligation_type_enum[]> {
    const { fiscal_status } = await this.fiscalStatus.getStatusBlock(
      context.organization_id,
      context.store_id,
    );
    const types = new Set<fiscal_obligation_type_enum>();

    if (
      fiscal_status.invoicing.state === 'ACTIVE' ||
      fiscal_status.invoicing.state === 'LOCKED'
    ) {
      types.add('electronic_invoice_review');
      types.add('support_document_review');
      types.add('vat_return');
    }

    if (
      fiscal_status.accounting.state === 'ACTIVE' ||
      fiscal_status.accounting.state === 'LOCKED'
    ) {
      types.add('monthly_close');
      types.add('bank_reconciliation');
      types.add('inventory_valuation');
      types.add('withholding_return');
      types.add('reteiva_return');
      types.add('reteica_return');
      types.add('ica_return');
    }

    if (
      fiscal_status.payroll.state === 'ACTIVE' ||
      fiscal_status.payroll.state === 'LOCKED'
    ) {
      const activeEmployees = await this.prisma.employees.count({
        where: { organization_id: context.organization_id, status: 'active' },
      });
      if (activeEmployees > 0) types.add('payroll_electronic_review');
    }

    if (!period.period_month && !period.period_quarter) {
      types.add('exogenous_report');
      types.add('income_tax_precierre');
    }

    return Array.from(types);
  }

  private resolveDueDate(
    type: fiscal_obligation_type_enum,
    periodEnd: Date,
    year: number,
  ): Date {
    if (type === 'exogenous_report') return defaultAnnualDueDate(year, 4, 30);
    if (type === 'income_tax_precierre')
      return defaultAnnualDueDate(year, 3, 31);
    if (type === 'annual_close') return defaultAnnualDueDate(year, 4, 30);
    return defaultMonthlyDueDate(periodEnd);
  }

  private whereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_obligationsWhereInput {
    return this.scopeWhereForContexts(
      contexts,
    ) as Prisma.fiscal_obligationsWhereInput;
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

  private daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private assertStatusTransition(
    current: fiscal_obligation_status_enum,
    next: fiscal_obligation_status_enum,
  ) {
    if (current === next) return;
    if (TERMINAL_OBLIGATION_STATUSES.includes(current)) {
      throw new BadRequestException(
        `Fiscal obligation in ${current} status cannot transition to ${next}`,
      );
    }

    const allowed = OBLIGATION_STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid fiscal obligation status transition from ${current} to ${next}`,
      );
    }
  }

  private async assertEvidenceForStatus(
    obligation: Awaited<ReturnType<FiscalObligationService['findOne']>>,
    dto: ChangeFiscalObligationStatusDto,
  ) {
    const evidenceId = dto.evidence_id ?? obligation.evidence_id;
    if (EVIDENCE_REQUIRED_STATUSES.includes(dto.status) && !evidenceId) {
      throw new BadRequestException(
        `evidence_id is required when marking obligation as ${dto.status}`,
      );
    }

    if (!dto.evidence_id) return;

    const evidence = await this.prisma.fiscal_evidences.findFirst({
      where: {
        id: dto.evidence_id,
        organization_id: obligation.organization_id,
        accounting_entity_id: obligation.accounting_entity_id,
      },
      select: { id: true },
    });

    if (!evidence) {
      throw new BadRequestException(
        'Fiscal evidence does not belong to the obligation fiscal entity',
      );
    }
  }
}
