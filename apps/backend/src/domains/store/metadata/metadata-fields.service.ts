import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateMetadataFieldDto } from './dto/create-metadata-field.dto';
import { UpdateMetadataFieldDto } from './dto/update-metadata-field.dto';

@Injectable()
export class MetadataFieldsService {
  private readonly logger = new Logger(MetadataFieldsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createField(dto: CreateMetadataFieldDto) {
    try {
      const field = await this.prisma.entity_metadata_fields.create({
        data: {
          entity_type: dto.entity_type as any,
          field_key: dto.field_key,
          field_type: dto.field_type as any,
          label: dto.label,
          description: dto.description,
          is_required: dto.is_required ?? false,
          display_mode: (dto.display_mode as any) ?? 'detail',
          sort_order: dto.sort_order ?? 0,
          options: dto.options ?? undefined,
          default_value: dto.default_value,
        },
      });

      this.logger.log(`Created metadata field: ${field.field_key} (${field.entity_type})`);
      return field;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.META_DUP_001, `Field key '${dto.field_key}' already exists for entity type '${dto.entity_type}'`);
      }
      throw error;
    }
  }

  async updateField(fieldId: number, dto: UpdateMetadataFieldDto) {
    const existing = await this.prisma.entity_metadata_fields.findUnique({ where: { id: fieldId } });
    if (!existing) throw new VendixHttpException(ErrorCodes.META_FIND_001);

    return this.prisma.entity_metadata_fields.update({
      where: { id: fieldId },
      data: {
        ...dto,
        entity_type: dto.entity_type as any,
        field_type: dto.field_type as any,
        display_mode: dto.display_mode as any,
        updated_at: new Date(),
      },
    });
  }

  async listFields(entityType?: string) {
    const where: any = { is_active: true };
    if (entityType) where.entity_type = entityType;

    return this.prisma.entity_metadata_fields.findMany({
      where,
      orderBy: [{ entity_type: 'asc' }, { sort_order: 'asc' }],
    });
  }

  async getField(fieldId: number) {
    const field = await this.prisma.entity_metadata_fields.findUnique({ where: { id: fieldId } });
    if (!field) throw new VendixHttpException(ErrorCodes.META_FIND_001);
    return field;
  }

  async toggleField(fieldId: number, isActive: boolean) {
    const existing = await this.prisma.entity_metadata_fields.findUnique({ where: { id: fieldId } });
    if (!existing) throw new VendixHttpException(ErrorCodes.META_FIND_001);

    return this.prisma.entity_metadata_fields.update({
      where: { id: fieldId },
      data: { is_active: isActive, updated_at: new Date() },
    });
  }

  async deleteField(fieldId: number) {
    const existing = await this.prisma.entity_metadata_fields.findUnique({
      where: { id: fieldId },
      include: { values: { take: 1 } },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.META_FIND_001);

    if (existing.values.length > 0) {
      return this.toggleField(fieldId, false);
    }

    return this.prisma.entity_metadata_fields.delete({ where: { id: fieldId } });
  }
}
