import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateSessionDto } from './dto/create-session.dto';
import { QuerySessionDto } from './dto/query-session.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@Injectable()
export class ConsolidationService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async validateMultiStore(): Promise<void> {
    const context = this.getContext();
    const org = await this.prisma.organizations.findFirst({
      where: { id: context.organization_id },
    });
    if (!org || org.account_type !== 'MULTI_STORE_ORG') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_NOT_MULTI_STORE);
    }
  }

  private async findSessionOrFail(id: number) {
    const session = await this.prisma.consolidation_sessions.findFirst({
      where: { id },
    });
    if (!session) {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_FOUND);
    }
    return session;
  }

  async findAllSessions(query: QuerySessionDto) {
    await this.validateMultiStore();

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.fiscal_period_id) where.fiscal_period_id = query.fiscal_period_id;
    if (query.status) where.status = query.status;

    const [sessions, total] = await Promise.all([
      this.prisma.consolidation_sessions.findMany({
        where,
        include: {
          fiscal_period: {
            select: { id: true, name: true, start_date: true, end_date: true },
          },
          created_by: {
            select: { id: true, first_name: true, last_name: true },
          },
          _count: {
            select: {
              adjustments: true,
              intercompany_txns: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.consolidation_sessions.count({ where }),
    ]);

    return {
      data: sessions,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOneSession(id: number) {
    await this.validateMultiStore();

    const session = await this.prisma.consolidation_sessions.findFirst({
      where: { id },
      include: {
        fiscal_period: true,
        created_by: {
          select: { id: true, first_name: true, last_name: true },
        },
        adjustments: {
          include: {
            account: {
              select: { id: true, code: true, name: true },
            },
            store: {
              select: { id: true, name: true },
            },
          },
          orderBy: { created_at: 'desc' },
        },
        _count: {
          select: {
            adjustments: true,
            intercompany_txns: true,
          },
        },
      },
    });

    if (!session) {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_FOUND);
    }

    return session;
  }

  async createSession(dto: CreateSessionDto) {
    await this.validateMultiStore();
    const context = this.getContext();

    // Validate fiscal period exists
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: { id: dto.fiscal_period_id },
    });
    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    return this.prisma.consolidation_sessions.create({
      data: {
        organization_id: context.organization_id,
        fiscal_period_id: dto.fiscal_period_id,
        name: dto.name,
        session_date: new Date(),
        status: 'draft',
        notes: dto.notes || null,
        created_by_user_id: context.user_id || null,
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
      },
    });
  }

  async startSession(id: number) {
    await this.validateMultiStore();
    const session = await this.findSessionOrFail(id);

    if (session.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_DRAFT);
    }

    return this.prisma.consolidation_sessions.update({
      where: { id },
      data: {
        status: 'in_progress',
        updated_at: new Date(),
      },
    });
  }

  async completeSession(id: number) {
    await this.validateMultiStore();
    const session = await this.findSessionOrFail(id);

    if (session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    if (session.status !== 'in_progress') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_DRAFT);
    }

    return this.prisma.consolidation_sessions.update({
      where: { id },
      data: {
        status: 'completed',
        completed_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  async cancelSession(id: number) {
    await this.validateMultiStore();
    const session = await this.findSessionOrFail(id);

    if (session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    return this.prisma.consolidation_sessions.update({
      where: { id },
      data: {
        status: 'cancelled',
        updated_at: new Date(),
      },
    });
  }

  async addManualAdjustment(session_id: number, dto: CreateAdjustmentDto) {
    await this.validateMultiStore();
    const context = this.getContext();
    const session = await this.findSessionOrFail(session_id);

    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    // Validate account exists
    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { id: dto.account_id },
    });
    if (!account) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_001);
    }

    return this.prisma.consolidation_adjustments.create({
      data: {
        session_id,
        account_id: dto.account_id,
        type: dto.type as any,
        debit_amount: dto.debit_amount,
        credit_amount: dto.credit_amount,
        description: dto.description,
        store_id: dto.store_id || null,
        created_by_user_id: context.user_id || null,
      },
      include: {
        account: {
          select: { id: true, code: true, name: true },
        },
        store: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async removeAdjustment(adjustment_id: number) {
    await this.validateMultiStore();

    const adjustment = await this.prisma.consolidation_adjustments.findFirst({
      where: { id: adjustment_id },
      include: { session: true },
    });

    if (!adjustment) {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_FOUND);
    }

    if (adjustment.session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    return this.prisma.consolidation_adjustments.delete({
      where: { id: adjustment_id },
    });
  }

  /**
   * Drill-down: get intercompany transactions with filters and pagination
   */
  async getTransactionsDrilldown(session_id: number, query: QueryTransactionsDto) {
    await this.validateMultiStore();
    await this.findSessionOrFail(session_id);

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { session_id };
    if (query.store_id) where.OR = [
      { from_store_id: query.store_id },
      { to_store_id: query.store_id },
    ];
    if (query.account_id) where.account_id = query.account_id;
    if (query.eliminated !== undefined) where.eliminated = query.eliminated;

    const [transactions, total] = await Promise.all([
      this.prisma.intercompany_transactions.findMany({
        where,
        include: {
          from_store: { select: { id: true, name: true } },
          to_store: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.intercompany_transactions.count({ where }),
    ]);

    return {
      data: transactions,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Export consolidation report:
   * 1. Gather trial balance, adjustments, IC transactions
   * 2. Build JSON
   * 3. Upload to S3
   * 4. Return presigned download URL
   */
  async exportConsolidation(session_id: number) {
    await this.validateMultiStore();
    const context = this.getContext();
    const session = await this.findSessionOrFail(session_id);

    // 1. Gather all data
    const [adjustments, ic_transactions] = await Promise.all([
      this.prisma.consolidation_adjustments.findMany({
        where: { session_id },
        include: {
          account: { select: { id: true, code: true, name: true } },
          store: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.intercompany_transactions.findMany({
        where: { session_id },
        include: {
          from_store: { select: { id: true, name: true } },
          to_store: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    // 2. Build export JSON
    const export_data = {
      exported_at: new Date().toISOString(),
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        session_date: session.session_date,
        fiscal_period_id: session.fiscal_period_id,
        completed_at: session.completed_at,
      },
      summary: {
        total_adjustments: adjustments.length,
        total_ic_transactions: ic_transactions.length,
        eliminated_count: ic_transactions.filter((t: any) => t.eliminated).length,
        pending_count: ic_transactions.filter((t: any) => !t.eliminated).length,
        total_elimination_amount: adjustments
          .filter((a: any) => a.type === 'elimination')
          .reduce((sum: number, a: any) => sum + Number(a.debit_amount), 0),
      },
      adjustments: adjustments.map((a: any) => ({
        id: a.id,
        account_code: a.account?.code,
        account_name: a.account?.name,
        type: a.type,
        debit_amount: Number(a.debit_amount),
        credit_amount: Number(a.credit_amount),
        description: a.description,
        store: a.store?.name || null,
      })),
      intercompany_transactions: ic_transactions.map((t: any) => ({
        id: t.id,
        from_store: t.from_store?.name,
        to_store: t.to_store?.name,
        account_code: t.account?.code,
        account_name: t.account?.name,
        amount: Number(t.amount),
        eliminated: t.eliminated,
        eliminated_at: t.eliminated_at,
      })),
    };

    // 3. Upload JSON to S3
    const json_buffer = Buffer.from(JSON.stringify(export_data, null, 2), 'utf-8');
    const s3_key = `organizations/${context.organization_id}/consolidation/export_session_${session_id}_${Date.now()}.json`;

    await this.s3_service.uploadFile(json_buffer, s3_key, 'application/json');

    // 4. Get presigned URL (24 hours)
    const download_url = await this.s3_service.getPresignedUrl(s3_key, 86400);

    return {
      download_url,
      s3_key,
      exported_at: export_data.exported_at,
      summary: export_data.summary,
    };
  }
}
