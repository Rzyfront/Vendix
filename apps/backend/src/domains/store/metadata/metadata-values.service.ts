import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { SetMetadataValueDto } from './dto/set-metadata-value.dto';

@Injectable()
export class MetadataValuesService {
  private readonly logger = new Logger(MetadataValuesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  async setValues(
    entityType: string,
    entityId: number,
    values: SetMetadataValueDto[],
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id)
      throw new ForbiddenException('Store context required');
    const results: any[] = [];

    for (const val of values) {
      const field = await this.prisma.entity_metadata_fields.findUnique({
        where: { id: val.field_id },
      });
      if (!field) {
        this.logger.warn(`Field ${val.field_id} not found, skipping`);
        continue;
      }

      const result = await this.prisma.entity_metadata_values.upsert({
        where: {
          field_id_entity_type_entity_id: {
            field_id: val.field_id,
            entity_type: entityType as any,
            entity_id: entityId,
          },
        },
        create: {
          store_id: context.store_id,
          field_id: val.field_id,
          entity_type: entityType as any,
          entity_id: entityId,
          value_text: val.value_text,
          value_number: val.value_number,
          value_date: val.value_date ? new Date(val.value_date) : undefined,
          value_bool: val.value_bool,
          value_json: val.value_json ?? undefined,
        },
        update: {
          value_text: val.value_text,
          value_number: val.value_number,
          value_date: val.value_date ? new Date(val.value_date) : undefined,
          value_bool: val.value_bool,
          value_json: val.value_json ?? undefined,
          updated_at: new Date(),
        },
      });
      results.push(result);
    }

    return results;
  }

  async setValuesUnscoped(
    storeId: number,
    entityType: string,
    entityId: number,
    values: SetMetadataValueDto[],
  ) {
    const results: any[] = [];
    const unscoped = this.prisma.withoutScope();

    for (const val of values) {
      const field = await unscoped.entity_metadata_fields.findUnique({
        where: { id: val.field_id },
      });
      if (!field) {
        this.logger.warn(`Field ${val.field_id} not found, skipping`);
        continue;
      }

      const result = await unscoped.entity_metadata_values.upsert({
        where: {
          field_id_entity_type_entity_id: {
            field_id: val.field_id,
            entity_type: entityType as any,
            entity_id: entityId,
          },
        },
        create: {
          store_id: storeId,
          field_id: val.field_id,
          entity_type: entityType as any,
          entity_id: entityId,
          value_text: val.value_text,
          value_number: val.value_number,
          value_date: val.value_date ? new Date(val.value_date) : undefined,
          value_bool: val.value_bool,
          value_json: val.value_json ?? undefined,
        },
        update: {
          value_text: val.value_text,
          value_number: val.value_number,
          value_date: val.value_date ? new Date(val.value_date) : undefined,
          value_bool: val.value_bool,
          value_json: val.value_json ?? undefined,
          updated_at: new Date(),
        },
      });
      results.push(result);
    }

    return results;
  }

  async getValuesForEntities(
    queries: Array<{ entityType: string; entityId: number }>,
  ) {
    if (!queries.length) return [];

    const orConditions = queries.map((q) => ({
      entity_type: q.entityType as any,
      entity_id: q.entityId,
    }));

    return this.prisma.entity_metadata_values.findMany({
      where: { OR: orConditions },
      include: { field: true },
      orderBy: { field: { sort_order: 'asc' } },
    });
  }

  async getValues(entityType: string, entityId: number) {
    return this.prisma.entity_metadata_values.findMany({
      where: {
        entity_type: entityType as any,
        entity_id: entityId,
      },
      include: { field: true },
      orderBy: { field: { sort_order: 'asc' } },
    });
  }

  async getValuesByStoreAndEntity(
    storeId: number,
    entityType: string,
    entityId: number,
  ) {
    return this.prisma.withoutScope().entity_metadata_values.findMany({
      where: {
        store_id: storeId,
        entity_type: entityType as any,
        entity_id: entityId,
      },
      include: { field: true },
      orderBy: { field: { sort_order: 'asc' } },
    });
  }

  async deleteValue(fieldId: number, entityType: string, entityId: number) {
    try {
      return await this.prisma.entity_metadata_values.delete({
        where: {
          field_id_entity_type_entity_id: {
            field_id: fieldId,
            entity_type: entityType as any,
            entity_id: entityId,
          },
        },
      });
    } catch {
      throw new VendixHttpException(ErrorCodes.META_FIND_001);
    }
  }
}
