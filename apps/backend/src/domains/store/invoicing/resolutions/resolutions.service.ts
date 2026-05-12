import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateResolutionDto } from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';

@Injectable()
export class ResolutionsService {
  private readonly logger = new Logger(ResolutionsService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll() {
    return this.prisma.invoice_resolutions.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id },
    });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_002);
    }

    return resolution;
  }

  async create(dto: CreateResolutionDto) {
    const context = this.getContext();

    const resolution = await this.prisma.invoice_resolutions.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        resolution_number: dto.resolution_number,
        resolution_date: new Date(dto.resolution_date),
        prefix: dto.prefix,
        range_from: dto.range_from,
        range_to: dto.range_to,
        current_number: dto.range_from - 1, // Start just before range_from
        valid_from: new Date(dto.valid_from),
        valid_to: new Date(dto.valid_to),
        is_active: dto.is_active ?? true,
        technical_key: dto.technical_key,
      },
    });

    this.logger.log(
      `Resolution ${resolution.resolution_number} created (prefix: ${resolution.prefix}, range: ${resolution.range_from}-${resolution.range_to})`,
    );
    return resolution;
  }

  async update(id: number, dto: UpdateResolutionDto) {
    await this.findOne(id);

    const update_data: any = {
      ...(dto.resolution_number && {
        resolution_number: dto.resolution_number,
      }),
      ...(dto.resolution_date && {
        resolution_date: new Date(dto.resolution_date),
      }),
      ...(dto.prefix && { prefix: dto.prefix }),
      ...(dto.range_from !== undefined && { range_from: dto.range_from }),
      ...(dto.range_to !== undefined && { range_to: dto.range_to }),
      ...(dto.valid_from && { valid_from: new Date(dto.valid_from) }),
      ...(dto.valid_to && { valid_to: new Date(dto.valid_to) }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.technical_key !== undefined && {
        technical_key: dto.technical_key,
      }),
    };

    const updated = await this.prisma.invoice_resolutions.update({
      where: { id },
      data: update_data,
    });

    this.logger.log(`Resolution #${id} updated`);
    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);

    // Check if resolution has been used
    const usage_count = await this.prisma.invoices.count({
      where: { resolution_id: id },
    });

    if (usage_count > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Cannot delete resolution with associated invoices. Deactivate it instead.',
      );
    }

    await this.prisma.invoice_resolutions.delete({
      where: { id },
    });

    this.logger.log(`Resolution #${id} deleted`);
  }
}
