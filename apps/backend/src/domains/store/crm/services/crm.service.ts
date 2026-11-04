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
    await this.syncLandingApp(storeId, false);

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
    await this.syncLandingApp(storeId, true);

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

  /**
   * Keeps the Apps card of the landing (`store_apps(landing)`) in step with
   * the landing itself (apps-vistas-f1 S4), so publishing or switching it off
   * here is what Apps shows.
   *
   * Only the landing that lives on the store domain is synced (row without
   * its own domain, as the Fase 0 backfill left it). A landing published on
   * its own domain (`{tienda}-landing` or a custom one) is owned by
   * `LandingPageAppService`, which also releases that domain; it is not
   * touched here.
   *
   * A failed sync never undoes the landing action: it is logged and the card
   * catches up on the next publish or deactivation.
   */
  private async syncLandingApp(storeId: number, live: boolean): Promise<void> {
    try {
      const row = await this.prisma.store_apps.findFirst({
        where: { store_id: storeId, kind: 'landing' },
        select: { id: true, status: true, domain_settings_id: true },
      });
      if (row?.domain_settings_id) return;

      if (live) {
        if (!row) {
          await this.prisma.store_apps.create({
            data: {
              store_id: storeId,
              kind: 'landing',
              status: 'published',
              published_at: new Date(),
              config: {},
            },
          });
        } else if (row.status !== 'published') {
          await this.prisma.store_apps.update({
            where: { id: row.id },
            data: {
              status: 'published',
              published_at: new Date(),
              updated_at: new Date(),
            },
          });
        }
      } else if (row?.status === 'published') {
        await this.prisma.store_apps.update({
          where: { id: row.id },
          data: { status: 'disabled', updated_at: new Date() },
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[Crm] No se pudo sincronizar store_apps(landing): ${(err as Error)?.message}`,
      );
    }
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
