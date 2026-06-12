import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from './dto/update-fiscal-period.dto';

@Injectable()
export class FiscalPeriodsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  private async requireContext() {
    return this.platformOrg.requirePlatformContext();
  }

  async findAll() {
    const ctx = await this.requireContext();
    return this.prisma.withoutScope().fiscal_periods.findMany({
      where: {
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
      orderBy: { start_date: 'desc' },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
  }

  async findOne(id: number) {
    const ctx = await this.requireContext();
    const period = await this.prisma.withoutScope().fiscal_periods.findFirst({
      where: {
        id,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
    if (!period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }
    return period;
  }

  async create(create_dto: CreateFiscalPeriodDto) {
    const ctx = await this.requireContext();
    const start_date = new Date(create_dto.start_date);
    const end_date = new Date(create_dto.end_date);

    if (start_date >= end_date) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_002,
        'Start date must be before end date',
      );
    }

    const overlapping = await this.prisma
      .withoutScope()
      .fiscal_periods.findFirst({
        where: {
          accounting_entity_id: ctx.accounting_entity_id,
          organization_id: ctx.organization_id,
          OR: [
            {
              start_date: { lte: end_date },
              end_date: { gte: start_date },
            },
          ],
        },
      });

    if (overlapping) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Fiscal period overlaps with existing period '${overlapping.name}' (${overlapping.start_date.toISOString().split('T')[0]} to ${overlapping.end_date.toISOString().split('T')[0]})`,
      );
    }

    const existing_name = await this.prisma
      .withoutScope()
      .fiscal_periods.findFirst({
        where: {
          name: create_dto.name,
          accounting_entity_id: ctx.accounting_entity_id,
          organization_id: ctx.organization_id,
        },
      });

    if (existing_name) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Fiscal period with name '${create_dto.name}' already exists`,
      );
    }

    return this.prisma.withoutScope().fiscal_periods.create({
      data: {
        name: create_dto.name,
        start_date,
        end_date,
        status: 'open',
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
      },
      include: {
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
  }

  async update(id: number, update_dto: UpdateFiscalPeriodDto) {
    const period = await this.findOne(id);

    if (period.status !== 'open') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot edit fiscal period in '${period.status}' status. Only open periods can be edited.`,
      );
    }

    const start_date = update_dto.start_date
      ? new Date(update_dto.start_date)
      : period.start_date;
    const end_date = update_dto.end_date
      ? new Date(update_dto.end_date)
      : period.end_date;

    if (start_date >= end_date) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_002,
        'Start date must be before end date',
      );
    }

    if (update_dto.start_date || update_dto.end_date) {
      const overlapping = await this.prisma
        .withoutScope()
        .fiscal_periods.findFirst({
          where: {
            id: { not: id },
            accounting_entity_id: period.accounting_entity_id ?? undefined,
            organization_id: period.organization_id,
            OR: [
              {
                start_date: { lte: end_date },
                end_date: { gte: start_date },
              },
            ],
          },
        });

      if (overlapping) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Fiscal period overlaps with existing period '${overlapping.name}'`,
        );
      }
    }

    if (update_dto.name && update_dto.name !== period.name) {
      const existing_name = await this.prisma
        .withoutScope()
        .fiscal_periods.findFirst({
          where: {
            name: update_dto.name,
            accounting_entity_id: period.accounting_entity_id,
            organization_id: period.organization_id,
            id: { not: id },
          },
        });

      if (existing_name) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Fiscal period with name '${update_dto.name}' already exists`,
        );
      }
    }

    return this.prisma.withoutScope().fiscal_periods.update({
      where: { id },
      data: {
        ...(update_dto.name && { name: update_dto.name }),
        ...(update_dto.start_date && { start_date }),
        ...(update_dto.end_date && { end_date }),
      },
      include: {
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
  }

  async close(id: number, user_id: number | null) {
    const period = await this.findOne(id);

    if (period.status !== 'open') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot close fiscal period — current status is '${period.status}'`,
      );
    }

    const draft_entries_count = await this.prisma
      .withoutScope()
      .accounting_entries.count({
        where: {
          fiscal_period_id: id,
          status: 'draft',
        },
      });

    if (draft_entries_count > 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot close fiscal period: there are ${draft_entries_count} draft entries. Post or delete them first.`,
      );
    }

    return this.prisma.withoutScope().fiscal_periods.update({
      where: { id },
      data: {
        status: 'closed',
        closed_by_user_id: user_id,
        closed_at: new Date(),
      },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
  }

  async reopen(id: number) {
    const period = await this.findOne(id);

    if (period.status !== 'closed') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot reopen fiscal period — current status is '${period.status}'`,
      );
    }

    return this.prisma.withoutScope().fiscal_periods.update({
      where: { id },
      data: {
        status: 'open',
        closed_by_user_id: null,
        closed_at: null,
      },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: {
          select: { accounting_entries: true },
        },
      },
    });
  }
}
