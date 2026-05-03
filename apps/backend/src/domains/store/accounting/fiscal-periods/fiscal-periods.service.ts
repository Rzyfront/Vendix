import { Injectable, ConflictException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from './dto/update-fiscal-period.dto';
import { OperatingScopeService } from '@common/services/operating-scope.service';

@Injectable()
export class FiscalPeriodsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly operatingScopeService: OperatingScopeService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll() {
    const context = this.getContext();
    const accountingEntity = await this.operatingScopeService.resolveAccountingEntity({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });

    return this.prisma.fiscal_periods.findMany({
      where: { accounting_entity_id: accountingEntity.id },
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
    const period = await this.prisma.fiscal_periods.findFirst({
      where: { id },
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
    const context = this.getContext();
    const accountingEntity = await this.operatingScopeService.resolveAccountingEntity({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });
    const start_date = new Date(create_dto.start_date);
    const end_date = new Date(create_dto.end_date);

    // Validate date range
    if (start_date >= end_date) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_002,
        'Start date must be before end date',
      );
    }

    // Check for overlapping periods
    const overlapping = await this.prisma.fiscal_periods.findFirst({
      where: {
        accounting_entity_id: accountingEntity.id,
        OR: [
          {
            start_date: { lte: end_date },
            end_date: { gte: start_date },
          },
        ],
      },
    });

    if (overlapping) {
      throw new ConflictException(
        `Fiscal period overlaps with existing period '${overlapping.name}' (${overlapping.start_date.toISOString().split('T')[0]} to ${overlapping.end_date.toISOString().split('T')[0]})`,
      );
    }

    // Check name uniqueness (handled by @@unique but give better error)
    const existing_name = await this.prisma.fiscal_periods.findFirst({
      where: { name: create_dto.name, accounting_entity_id: accountingEntity.id },
    });

    if (existing_name) {
      throw new ConflictException(
        `Fiscal period with name '${create_dto.name}' already exists`,
      );
    }

    return this.prisma.fiscal_periods.create({
      data: {
        name: create_dto.name,
        start_date,
        end_date,
        status: 'open',
        organization_id: context.organization_id!,
        accounting_entity_id: accountingEntity.id,
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

    // Only allow updating open periods
    if (period.status !== 'open') {
      throw new ConflictException(
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

    // Check overlapping (excluding current period)
    if (update_dto.start_date || update_dto.end_date) {
      const overlapping = await this.prisma.fiscal_periods.findFirst({
        where: {
          id: { not: id },
          accounting_entity_id: period.accounting_entity_id,
          OR: [
            {
              start_date: { lte: end_date },
              end_date: { gte: start_date },
            },
          ],
        },
      });

      if (overlapping) {
        throw new ConflictException(
          `Fiscal period overlaps with existing period '${overlapping.name}'`,
        );
      }
    }

    // Check name uniqueness if changing name
    if (update_dto.name && update_dto.name !== period.name) {
      const existing_name = await this.prisma.fiscal_periods.findFirst({
        where: {
          name: update_dto.name,
          accounting_entity_id: period.accounting_entity_id,
          id: { not: id },
        },
      });

      if (existing_name) {
        throw new ConflictException(
          `Fiscal period with name '${update_dto.name}' already exists`,
        );
      }
    }

    return this.prisma.fiscal_periods.update({
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

  async close(id: number) {
    const period = await this.findOne(id);
    const context = this.getContext();

    if (period.status !== 'open') {
      throw new ConflictException(
        `Cannot close fiscal period — current status is '${period.status}'`,
      );
    }

    // Check for draft entries in this period
    const draft_entries_count = await this.prisma.accounting_entries.count({
      where: {
        fiscal_period_id: id,
        status: 'draft',
      },
    });

    if (draft_entries_count > 0) {
      throw new ConflictException(
        `Cannot close fiscal period: there are ${draft_entries_count} draft entries. Post or delete them first.`,
      );
    }

    return this.prisma.fiscal_periods.update({
      where: { id },
      data: {
        status: 'closed',
        closed_by_user_id: context.user_id,
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

  async remove(id: number) {
    const period = await this.findOne(id);

    // Check if period has any entries
    const entries_count = await this.prisma.accounting_entries.count({
      where: { fiscal_period_id: id },
    });

    if (entries_count > 0) {
      throw new ConflictException(
        `Cannot delete fiscal period with ${entries_count} associated entries`,
      );
    }

    await this.prisma.fiscal_periods.delete({
      where: { id },
    });
  }

  /**
   * Find the open fiscal period that contains a given date
   */
  async findOpenPeriodForDate(date: Date) {
    return this.prisma.fiscal_periods.findFirst({
      where: {
        status: 'open',
        start_date: { lte: date },
        end_date: { gte: date },
      },
    });
  }
}
