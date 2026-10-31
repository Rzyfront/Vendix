import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { resolveCrmViewer } from '../shared/crm-access';
import { CreateCrmTagDto, UpdateCrmTagDto } from '../profile/dto/customer-crm.dto';

/**
 * Tag catalog of the store (PLAN-CRM §4.5). Deleting a tag removes its
 * assignments (`crm_customer_tags.tag_id` is `ON DELETE CASCADE` towards the
 * CRM catalog only), never a customer.
 */
@Injectable()
export class CrmTagsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async list() {
    const rows = await this.prisma.crm_tags.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { customer_tags: true } } },
    });
    return rows.map(({ _count, ...tag }) => ({
      ...tag,
      customers_count: _count.customer_tags,
    }));
  }

  async create(dto: CreateCrmTagDto) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_TAG_001);
    try {
      return await this.prisma.crm_tags.create({
        data: {
          store_id: viewer.store_id,
          name: dto.name.trim(),
          color: dto.color ?? null,
        },
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(id: number, dto: UpdateCrmTagDto) {
    await this.findOrFail(id);
    try {
      await this.prisma.crm_tags.updateMany({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
    return this.findOrFail(id);
  }

  async remove(id: number) {
    await this.findOrFail(id);
    await this.prisma.crm_tags.deleteMany({ where: { id } });
    return { id };
  }

  private async findOrFail(id: number) {
    const tag = await this.prisma.crm_tags.findFirst({ where: { id } });
    if (!tag) throw new VendixHttpException(ErrorCodes.CRM_TAG_001);
    return tag;
  }

  private mapUnique(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new VendixHttpException(ErrorCodes.CRM_TAG_002);
    }
    return error;
  }
}
