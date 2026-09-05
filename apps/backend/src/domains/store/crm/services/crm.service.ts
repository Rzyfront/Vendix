import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { UpdateCrmLandingDto } from '../dto/crm.dto';
import { CrmGenerationService } from './crm-generation.service';
import { validateCrmLandingDocument } from '../crm-blocks.contract';
import { SettingsService } from '../../settings/settings.service';

export interface CrmLandingState {
  enabled: boolean;
  generation_status: string;
  content_json: unknown;
  published_json: unknown;
  published_at: Date | null;
  version: number;
  last_job_id: string | null;
}

export interface CrmLead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  status: 'new' | 'contacted' | 'converted';
  customer_id: number | null;
  created_at: Date;
}

export interface CrmLeadsResponse {
  leads: CrmLead[];
  stats: {
    total: number;
    new_count: number;
    contacted_count: number;
    converted_count: number;
    conversion_rate: number;
  };
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly crmGenerationService: CrmGenerationService,
    private readonly settingsService: SettingsService,
  ) {}

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
        last_job_id: null,
      };
    }

    return {
      enabled: landing.enabled,
      generation_status: landing.generation_status,
      content_json: landing.content_json,
      published_json: landing.published_json,
      published_at: landing.published_at,
      version: landing.version,
      last_job_id: landing.last_job_id,
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

    // Activación ⇒ generación (o regeneración) del draft con IA.
    await this.crmGenerationService.enqueueGeneration();

    return this.getLanding();
  }

  async getGenerationJobStatus(jobId: string) {
    return this.crmGenerationService.getGenerationJobStatus(jobId);
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

    if (
      dto.content_json !== undefined &&
      !validateCrmLandingDocument(dto.content_json).valid
    ) {
      throw new VendixHttpException(
        ErrorCodes.CRM_LANDING_003,
        validateCrmLandingDocument(dto.content_json).errors.join(' '),
      );
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

  /**
   * Publica el draft: copia inmutable `content_json` → `published_json`
   * (el draft sigue editable sin tocar lo vivo) y asegura el gate
   * `publication.landing_enabled` en store_settings. El published_json
   * es lo único que el render público servirá.
   */
  async publish(): Promise<CrmLandingState> {
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
    if (!existing.content_json) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_005);
    }

    await this.prisma.crm_landing_pages.updateMany({
      where: { id: existing.id, store_id: storeId },
      data: {
        published_json: existing.content_json as object,
        published_at: new Date(),
      },
    });

    try {
      const settings = await this.settingsService.getSettings();
      await this.settingsService.updateSettings({
        publication: {
          ...(settings?.publication ?? {}),
          landing_enabled: true,
        },
      });
    } catch (err: any) {
      // Publicar no debe fallar completo si el gate ya estaba encendido
      // o la escritura de settings tropieza: el contenido quedó publicado.
      this.logger.warn(
        `[Crm] No se pudo asegurar publication.landing_enabled: ${err?.message}`,
      );
    }

    return this.getLanding();
  }

  async getLeads(filterStatus?: string): Promise<CrmLeadsResponse> {
    const storeId = this.requireStoreId();
    const rows = await this.prisma.notifications.findMany({
      where: {
        store_id: storeId,
        type: 'crm_contact_request',
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    let newCount = 0;
    let contactedCount = 0;
    let convertedCount = 0;

    const leads: CrmLead[] = rows.map((r) => {
      const data = (r.data as Record<string, any>) || {};
      const status: 'new' | 'contacted' | 'converted' =
        data.status === 'contacted' || data.status === 'converted' ? data.status : 'new';

      if (status === 'new') newCount++;
      else if (status === 'contacted') contactedCount++;
      else if (status === 'converted') convertedCount++;

      return {
        id: r.id,
        name: data.name || r.title?.replace('Nuevo contacto desde tu landing', '')?.trim() || 'Contacto',
        email: data.reply_to?.email || null,
        phone: data.reply_to?.phone || null,
        message: data.message || r.body || '',
        status,
        customer_id: data.customer_id ? Number(data.customer_id) : null,
        created_at: r.created_at,
      };
    });

    const filteredLeads = filterStatus && filterStatus !== 'all'
      ? leads.filter((l) => l.status === filterStatus)
      : leads;

    const total = leads.length;
    const conversionRate = total > 0 ? Math.round((convertedCount / total) * 100) : 0;

    return {
      leads: filteredLeads,
      stats: {
        total,
        new_count: newCount,
        contacted_count: contactedCount,
        converted_count: convertedCount,
        conversion_rate: conversionRate,
      },
    };
  }

  async updateLeadStatus(leadId: number, status: 'new' | 'contacted' | 'converted'): Promise<CrmLead> {
    const storeId = this.requireStoreId();
    const notification = await this.prisma.notifications.findFirst({
      where: {
        id: leadId,
        store_id: storeId,
        type: 'crm_contact_request',
      },
    });

    if (!notification) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    const currentData = (notification.data as Record<string, any>) || {};
    const updatedData = { ...currentData, status };

    await this.prisma.notifications.updateMany({
      where: { id: leadId, store_id: storeId },
      data: {
        data: updatedData as any,
        is_read: true,
      },
    });

    return {
      id: notification.id,
      name: updatedData.name || notification.title || 'Contacto',
      email: updatedData.reply_to?.email || null,
      phone: updatedData.reply_to?.phone || null,
      message: updatedData.message || notification.body || '',
      status,
      customer_id: updatedData.customer_id ? Number(updatedData.customer_id) : null,
      created_at: notification.created_at,
    };
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
