import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { resolveCrmViewer } from '../shared/crm-access';
import { CrmSegmentQueryService } from './crm-segment-query.service';
import { SEGMENT_FILTER_VERSION } from './segment-filter.compiler';
import {
  CreateCrmSegmentDto,
  CrmSegmentCustomersQueryDto,
  UpdateCrmSegmentDto,
} from './dto/crm-segments.dto';

/** Customers shown with a preview count. */
export const SEGMENT_PREVIEW_SAMPLE = 20;

/**
 * Saved segments (PLAN-CRM §4.5): a name and a v1 filter, evaluated every
 * time they are used (no member table). Saving re-validates and recounts the
 * filter, so `last_count` is what the owner saw in the preview.
 */
@Injectable()
export class CrmSegmentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly query: CrmSegmentQueryService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.crm_segments.findMany({
      orderBy: { name: 'asc' },
      select: SEGMENT_SELECT,
    });
  }

  async get(id: number) {
    return this.findOrFail(id);
  }

  /** Count and a sample of the filter, without saving anything. */
  async preview(filter: Record<string, unknown>) {
    const segment = await this.query.resolve(filter);
    const [count, sample] = await Promise.all([
      this.query.count(segment),
      this.query.page(segment, 1, SEGMENT_PREVIEW_SAMPLE),
    ]);
    return { count, sample, filter: segment.filter };
  }

  async create(dto: CreateCrmSegmentDto) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_SEGMENT_002);
    const segment = await this.query.resolve(dto.filter);
    const count = await this.query.count(segment);
    try {
      return await this.prisma.crm_segments.create({
        data: {
          store_id: viewer.store_id,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          filter: segment.filter as unknown as Prisma.InputJsonValue,
          filter_version: SEGMENT_FILTER_VERSION,
          is_dynamic: true,
          last_count: count,
          last_counted_at: new Date(),
          created_by_user_id: viewer.user_id,
        },
        select: SEGMENT_SELECT,
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(id: number, dto: UpdateCrmSegmentDto) {
    await this.findOrFail(id);
    const data: Prisma.crm_segmentsUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.filter !== undefined) {
      const segment = await this.query.resolve(dto.filter);
      data.filter = segment.filter as unknown as Prisma.InputJsonValue;
      data.filter_version = SEGMENT_FILTER_VERSION;
      data.last_count = await this.query.count(segment);
      data.last_counted_at = new Date();
    }
    try {
      await this.prisma.crm_segments.updateMany({ where: { id }, data });
    } catch (error) {
      throw this.mapUnique(error);
    }
    return this.findOrFail(id);
  }

  /** Campaigns keep their history: `crm_campaigns.segment_id` is `SET NULL`. */
  async remove(id: number) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_SEGMENT_002);
    const segment = await this.findOrFail(id);
    await this.prisma.crm_segments.deleteMany({ where: { id } });
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'DELETE',
      resource: 'crm_segments',
      resourceId: id,
      oldValues: { name: segment.name, filter: segment.filter },
    });
    return { id };
  }

  /** Re-evaluates the saved filter now and refreshes `last_count`. */
  async customers(id: number, query: CrmSegmentCustomersQueryDto) {
    const saved = await this.findOrFail(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const segment = await this.query.resolve(saved.filter);
    const [total, data] = await Promise.all([
      this.query.count(segment),
      this.query.page(segment, page, limit),
    ]);
    await this.prisma.crm_segments.updateMany({
      where: { id },
      data: { last_count: total, last_counted_at: new Date() },
    });
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async findOrFail(id: number) {
    const segment = await this.prisma.crm_segments.findFirst({
      where: { id },
      select: SEGMENT_SELECT,
    });
    if (!segment) throw new VendixHttpException(ErrorCodes.CRM_SEGMENT_002);
    return segment;
  }

  private mapUnique(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new VendixHttpException(ErrorCodes.CRM_SEGMENT_003);
    }
    return error;
  }
}

const SEGMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  filter: true,
  filter_version: true,
  is_dynamic: true,
  last_count: true,
  last_counted_at: true,
  created_by_user_id: true,
  created_at: true,
  updated_at: true,
} as const;
