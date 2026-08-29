import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { UpdateCrmLandingDto } from '../dto/crm.dto';

export interface CrmLandingState {
  enabled: boolean;
  generation_status: string;
  content_json: unknown;
  published_json: unknown;
  published_at: Date | null;
  version: number;
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  async getLanding(): Promise<CrmLandingState> {
    const storeId = this.requireStoreId();
    const landing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
    });

    if (!landing) {
      return {
        enabled: false,
        generation_status: 'idle',
        content_json: null,
        published_json: null,
        published_at: null,
        version: 0,
      };
    }

    return {
      enabled: landing.enabled,
      generation_status: landing.generation_status,
      content_json: landing.content_json,
      published_json: landing.published_json,
      published_at: landing.published_at,
      version: landing.version,
    };
  }

  async activate(): Promise<CrmLandingState> {
    const storeId = this.requireStoreId();
    const existing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
    });

    if (!existing) {
      await this.prisma.crm_landing_pages.create({
        data: { store_id: storeId, enabled: true },
      });
    } else if (!existing.enabled) {
      await this.prisma.crm_landing_pages.updateMany({
        where: { id: existing.id, store_id: storeId },
        data: { enabled: true },
      });
    }

    return this.getLanding();
  }

  async deactivate(): Promise<CrmLandingState> {
    const storeId = this.requireStoreId();
    const existing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_001);
    }

    await this.prisma.crm_landing_pages.updateMany({
      where: { id: existing.id, store_id: storeId },
      data: { enabled: false },
    });

    return this.getLanding();
  }

  async updateLanding(dto: UpdateCrmLandingDto): Promise<CrmLandingState> {
    const storeId = this.requireStoreId();
    const existing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_001);
    }
    if (!existing.enabled) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_002);
    }

    await this.prisma.crm_landing_pages.updateMany({
      where: { id: existing.id, store_id: storeId },
      data: {
        ...(dto.content_json !== undefined && {
          content_json: dto.content_json as object,
          version: { increment: 1 },
        }),
      },
    });

    return this.getLanding();
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
