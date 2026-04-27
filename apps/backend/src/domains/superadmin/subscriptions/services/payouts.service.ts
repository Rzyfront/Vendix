import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PayoutQueryDto, ApprovePayoutDto } from '../dto';

@Injectable()
export class PayoutsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async findAll(query: PayoutQueryDto) {
    const { page = 1, limit = 10, partner_organization_id, state, sort_by = 'created_at', sort_order = 'desc' } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.partner_payout_batchesWhereInput = {};

    if (partner_organization_id) where.partner_organization_id = partner_organization_id;
    if (state) where.state = state;

    const [data, total] = await Promise.all([
      this.prisma.partner_payout_batches.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          organization: { select: { id: true, name: true } },
          _count: { select: { commissions: true } },
        },
      }),
      this.prisma.partner_payout_batches.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const batch = await this.prisma.partner_payout_batches.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        commissions: {
          include: {
            invoice: { select: { id: true, invoice_number: true, total: true } },
          },
        },
      },
    });

    if (!batch) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return batch;
  }

  async approve(id: number, dto: ApprovePayoutDto) {
    const batch = await this.prisma.partner_payout_batches.findUnique({ where: { id } });

    if (!batch) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (batch.state !== 'pending') {
      throw new VendixHttpException(ErrorCodes.PARTNER_004);
    }

    const updated = await this.prisma.partner_payout_batches.update({
      where: { id },
      data: {
        state: 'approved',
        payout_method: dto.payout_method || batch.payout_method,
        reference: dto.reference || null,
        updated_at: new Date(),
      },
    });

    await this.prisma.partner_commissions.updateMany({
      where: { payout_batch_id: id },
      data: { state: 'pending_payout' },
    });

    return updated;
  }

  async rejectBatch(id: number, reason: string) {
    const batch = await this.prisma.partner_payout_batches.findUnique({ where: { id } });

    if (!batch) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (!['draft', 'pending', 'sent'].includes(batch.state)) {
      throw new VendixHttpException(
        ErrorCodes.PARTNER_004,
        `Cannot reject batch in state ${batch.state}`,
      );
    }

    const existingMetadata = (batch.metadata && typeof batch.metadata === 'object' && !Array.isArray(batch.metadata))
      ? (batch.metadata as Prisma.JsonObject)
      : {};

    const updated = await this.prisma.partner_payout_batches.update({
      where: { id },
      data: {
        state: 'rejected',
        metadata: {
          ...existingMetadata,
          reject_reason: reason,
          rejected_at: new Date().toISOString(),
        } as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });

    // Release commissions back to accrued so they can be re-batched
    await this.prisma.partner_commissions.updateMany({
      where: { payout_batch_id: id },
      data: { state: 'accrued', payout_batch_id: null },
    });

    return updated;
  }

  async markPaid(id: number) {
    const batch = await this.prisma.partner_payout_batches.findUnique({ where: { id } });

    if (!batch) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (batch.state !== 'approved') {
      throw new VendixHttpException(ErrorCodes.PARTNER_004);
    }

    const updated = await this.prisma.partner_payout_batches.update({
      where: { id },
      data: {
        state: 'paid',
        paid_at: new Date(),
        updated_at: new Date(),
      },
    });

    await this.prisma.partner_commissions.updateMany({
      where: { payout_batch_id: id },
      data: { state: 'paid', paid_at: new Date() },
    });

    return updated;
  }
}
