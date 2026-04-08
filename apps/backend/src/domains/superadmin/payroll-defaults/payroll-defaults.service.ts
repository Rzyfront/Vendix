import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreatePayrollDefaultsDto, UpdatePayrollDefaultsDto } from './dto';

@Injectable()
export class PayrollDefaultsService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreatePayrollDefaultsDto) {
    const existing = await this.globalPrisma.payroll_system_defaults.findFirst({
      where: { year: dto.year },
    });

    if (existing) {
      throw new ConflictException(
        `Payroll defaults for year ${dto.year} already exist`,
      );
    }

    const { year, decree_ref, notes, ...rates } = dto;

    const record = await this.globalPrisma.payroll_system_defaults.create({
      data: {
        year,
        rules: rates as any,
        decree_ref,
        notes,
      },
    });

    return this.responseService.success(
      record,
      'Payroll defaults created successfully',
    );
  }

  async findAll() {
    const records = await this.globalPrisma.payroll_system_defaults.findMany({
      orderBy: { year: 'desc' },
    });

    return this.responseService.success(records);
  }

  async findOne(year: number) {
    const record = await this.globalPrisma.payroll_system_defaults.findFirst({
      where: { year },
    });

    if (!record) {
      throw new NotFoundException(
        `Payroll defaults for year ${year} not found`,
      );
    }

    return this.responseService.success(record);
  }

  async update(year: number, dto: UpdatePayrollDefaultsDto) {
    const record = await this.globalPrisma.payroll_system_defaults.findFirst({
      where: { year },
    });

    if (!record) {
      throw new NotFoundException(
        `Payroll defaults for year ${year} not found`,
      );
    }

    if (record.is_published) {
      throw new BadRequestException(
        `Payroll defaults for year ${year} are published and cannot be edited`,
      );
    }

    const { decree_ref, notes, ...rate_fields } = dto;

    // Deep merge arl_rates if provided
    const existing_rules = (record.rules as Record<string, any>) ?? {};
    const merged_rules: Record<string, any> = { ...existing_rules };

    for (const [key, value] of Object.entries(rate_fields)) {
      if (value === undefined) continue;
      if (key === 'arl_rates' && typeof value === 'object') {
        merged_rules['arl_rates'] = {
          ...(existing_rules['arl_rates'] ?? {}),
          ...(value as Record<string, number>),
        };
      } else {
        merged_rules[key] = value;
      }
    }

    const update_data: Record<string, any> = { rules: merged_rules };
    if (decree_ref !== undefined) update_data['decree_ref'] = decree_ref;
    if (notes !== undefined) update_data['notes'] = notes;

    const updated = await this.globalPrisma.payroll_system_defaults.update({
      where: { id: record.id },
      data: update_data,
    });

    return this.responseService.success(
      updated,
      'Payroll defaults updated successfully',
    );
  }

  async publish(year: number, user_id: number) {
    const record = await this.globalPrisma.payroll_system_defaults.findFirst({
      where: { year },
    });

    if (!record) {
      throw new NotFoundException(
        `Payroll defaults for year ${year} not found`,
      );
    }

    if (record.is_published) {
      throw new BadRequestException(
        `Payroll defaults for year ${year} are already published`,
      );
    }

    const published = await this.globalPrisma.payroll_system_defaults.update({
      where: { id: record.id },
      data: {
        is_published: true,
        published_at: new Date(),
        published_by: user_id,
      },
    });

    this.eventEmitter.emit('payroll_defaults.published', {
      year,
      decree_ref: published.decree_ref,
    });

    return this.responseService.success(
      published,
      `Payroll defaults for year ${year} published successfully`,
    );
  }

  async unpublish(year: number) {
    const record = await this.globalPrisma.payroll_system_defaults.findFirst({
      where: { year },
    });

    if (!record) {
      throw new NotFoundException(
        `Payroll defaults for year ${year} not found`,
      );
    }

    if (!record.is_published) {
      throw new BadRequestException(
        `Payroll defaults for year ${year} are not published`,
      );
    }

    const unpublished = await this.globalPrisma.payroll_system_defaults.update({
      where: { id: record.id },
      data: {
        is_published: false,
        published_at: null,
        published_by: null,
      },
    });

    return this.responseService.success(
      unpublished,
      `Payroll defaults for year ${year} unpublished successfully`,
    );
  }
}
