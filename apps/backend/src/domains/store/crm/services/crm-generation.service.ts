import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import { SettingsService } from '../../settings/settings.service';
import { ProductsAnalyticsService } from '../../analytics/services/products-analytics.service';
import {
  CrmLandingDocument,
  validateCrmLandingDocument,
} from '../crm-blocks.contract';
import {
  CrmLandingJob,
  CrmLandingJobStatusResult,
} from '../interfaces/crm-landing-job.interface';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

const CRM_LANDING_APP_KEY = 'crm_landing_generator';
const PRODUCTS_LIMIT = 6;
/** Ventana de análisis para "más vendidos" (días hacia atrás). */
const TOP_PRODUCTS_WINDOW_DAYS = 90;

@Injectable()
export class CrmGenerationService {
  private readonly logger = new Logger(CrmGenerationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly organizationPrisma: OrganizationPrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly operatingScope: OperatingScopeService,
    private readonly settingsService: SettingsService,
    private readonly productsAnalytics: ProductsAnalyticsService,
    @InjectQueue('crm-landing')
    private readonly crmLandingQueue: Queue<CrmLandingJob>,
  ) {}

  /**
   * Encola la generación de la landing. Snapshot del contexto de tenant
   * aquí (el worker NO tiene request context natural) y estado `pending`
   * en la fila; el processor lo mueve a generating→ready|failed.
   */
  async enqueueGeneration(): Promise<{ job_id: string }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);

    await this.prisma.crm_landing_pages.updateMany({
      where: { store_id },
      data: {
        generation_status: 'pending',
        last_generation_error: null,
      },
    });

    const payload: CrmLandingJob = {
      store_id,
      context: {
        store_id,
        organization_id: context?.organization_id,
        user_id: context?.user_id,
        // Correlación estable entre reintentos del MISMO job.
        request_id: context?.request_id ?? `queue-${randomUUID()}`,
      },
    };

    try {
      const job = await this.crmLandingQueue.add('generate', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
      this.logger.log(
        `[CrmLanding] Enqueued job ${job.id} (store_id=${store_id})`,
      );
      // Persistir el id para que el panel pueda hacer polling del estado
      // (GET /store/crm/generation/:jobId) aunque se recargue la página.
      await this.prisma.crm_landing_pages.updateMany({
        where: { store_id },
        data: { last_job_id: String(job.id) },
      });
      return { job_id: job.id! };
    } catch (err: any) {
      this.logger.error(`[CrmLanding] Failed to enqueue: ${err?.message}`);
      await this.prisma.crm_landing_pages.updateMany({
        where: { store_id },
        data: {
          generation_status: 'failed',
          last_generation_error: 'No se pudo encolar la generación',
        },
      });
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_004);
    }
  }

  /**
   * Poll del job con guard IDOR obligatorio: los ids de BullMQ son enteros
   * globales compartidos por todas las tiendas; devolver `job.returnvalue`
   * sin validar tenant permitiría enumerar resultados de otras tiendas.
   */
  async getGenerationJobStatus(jobId: string): Promise<CrmLandingJobStatusResult> {
    const job = await this.crmLandingQueue.getJob(jobId);
    const callerStoreId = RequestContextService.getContext()?.store_id;
    if (
      !job ||
      callerStoreId == null ||
      (job.data as CrmLandingJob | undefined)?.context?.store_id !==
        callerStoreId
    ) {
      // Mismo 404 que un job desconocido: no se filtra la existencia.
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }
    const status = (await job.getState()) as CrmLandingJobStatusResult['status'];
    return { status, error: job.failedReason || undefined };
  }

  /**
   * Pipeline completo dentro del worker (contexto de tenant ya restaurado):
   * bundle de configuración → IA → validación de contrato → persistencia.
   * Lanza en fallo para que BullMQ aplique reintentos; antes marca la fila
   * como `failed` con el mensaje legible.
   */
  async generateLanding(storeId: number): Promise<void> {
    try {
      await this.prisma.crm_landing_pages.updateMany({
        where: { store_id: storeId },
        data: { generation_status: 'generating' },
      });

      const document = await this.buildDocumentWithAi(storeId);

      await this.prisma.crm_landing_pages.updateMany({
        where: { store_id: storeId },
        data: {
          content_json: document as unknown as object,
          generation_status: 'ready',
          last_generation_error: null,
          version: { increment: 1 },
        },
      });
      this.logger.log(`[CrmLanding] Landing ready for store ${storeId}`);
    } catch (error: any) {
      const message =
        error?.errorCode === 'CRM_LANDING_003'
          ? error.message
          : (error?.message ?? 'Error desconocido en la generación');
      await this.prisma.crm_landing_pages
        .updateMany({
          where: { store_id: storeId },
          data: {
            generation_status: 'failed',
            last_generation_error: message.slice(0, 2000),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async buildDocumentWithAi(
    storeId: number,
  ): Promise<CrmLandingDocument> {
    const bundle = await this.gatherBusinessBundle(storeId);

    const variables: Record<string, string> = {
      store_name: bundle.storeName,
      industries: bundle.industries.join(', ') || 'retail',
      store_type: bundle.storeType,
      city_department: bundle.cityDepartment || 'Colombia',
      timezone: bundle.timezone || 'America/Bogota',
      fiscal_summary: bundle.fiscalSummary,
      products_json: JSON.stringify(bundle.products),
    };

    const response = await this.aiEngine.run(CRM_LANDING_APP_KEY, variables);
    if (!response.success || !response.content?.trim()) {
      throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
    }

    let parsed: unknown;
    try {
      parsed = parseAiJson(response.content);
    } catch {
      throw new VendixHttpException(
        ErrorCodes.CRM_LANDING_003,
        'La IA no devolvió JSON interpretable.',
      );
    }

    const validation = validateCrmLandingDocument(parsed);
    if (!validation.valid) {
      throw new VendixHttpException(
        ErrorCodes.CRM_LANDING_003,
        validation.errors.join(' '),
      );
    }
    return parsed as CrmLandingDocument;
  }

  /**
   * Bundle de información real del negocio. Resuelve tienda vs organización
   * vía operating scope y NUNCA inventa datos: si algo falta va vacío.
   */
  private async gatherBusinessBundle(storeId: number): Promise<{
    storeName: string;
    industries: string[];
    storeType: string;
    cityDepartment: string;
    timezone: string;
    fiscalSummary: string;
    products: Array<Record<string, unknown>>;
  }> {
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        slug: true,
        organization_id: true,
        store_type: true,
        industries: true,
        timezone: true,
        department_code: true,
        municipality_code: true,
        legal_name: true,
        tax_id: true,
      },
    });
    if (!store) throw new VendixHttpException(ErrorCodes.CRM_LANDING_001);

    const settings = await this.settingsService.getSettings();
    const general = settings?.general as unknown as
      | Record<string, unknown>
      | undefined;

    // Ubicación legible desde settings (ciudad/departamento) con fallback vacío.
    const city =
      (general?.city as string | undefined) ??
      (general?.address_city as string | undefined) ??
      '';
    const department =
      (general?.department as string | undefined) ??
      (general?.address_department as string | undefined) ??
      '';

    // Scope operativo: ORGANIZATION agrega razón social de la org al resumen.
    let orgSuffix = '';
    try {
      const scope = await this.operatingScope.getOperatingScope(
        store.organization_id,
      );
      if (scope === 'ORGANIZATION') {
        const org = await this.organizationPrisma
          .withoutScope()
          .organizations.findFirst({
            where: { id: store.organization_id },
            select: { name: true, legal_name: true },
          });
        if (org?.name) {
          orgSuffix = `, organización ${org.name}`;
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[CrmLanding] Operating scope resolution failed: ${err?.message}`,
      );
    }

    let fiscalSummary = '';
    try {
      const fiscal = await this.settingsService.getFiscalData();
      const parts = [
        fiscal?.legal_name,
        fiscal?.nit != null && fiscal?.nit_dv != null
          ? `${fiscal.nit}-${fiscal.nit_dv}`
          : fiscal?.nit,
        fiscal?.tax_regime,
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
      fiscalSummary = parts.join(' · ');
    } catch {
      fiscalSummary = '';
    }
    if (orgSuffix) {
      fiscalSummary = fiscalSummary ? `${fiscalSummary}${orgSuffix}` : orgSuffix.replace(', ', '');
    }

    return {
      storeName: store.name,
      industries:
        (general?.industries as string[] | undefined) ?? store.industries ?? [],
      storeType: String(general?.store_type ?? store.store_type ?? 'physical'),
      cityDepartment: [city, department].filter(Boolean).join(', '),
      timezone: store.timezone ?? '',
      fiscalSummary,
      products: await this.gatherTopProducts(storeId),
    };
  }

  /**
   * Productos para inspirar el copy: top ventas por revenue en la ventana;
   * sin ventas → fallback mejor margen ((base_price - cost_price)/price)
   * sobre productos activos vendibles. Nunca lanza: los productos son
   * opcionales para la generación.
   */
  private async gatherTopProducts(
    storeId: number,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const to = new Date();
      const from = new Date(
        to.getTime() - TOP_PRODUCTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const top = await this.productsAnalytics.getTopSellingProducts({
        date_from: from.toISOString().slice(0, 10),
        date_to: to.toISOString().slice(0, 10),
        limit: PRODUCTS_LIMIT,
        top_sellers_sort_by: 'revenue',
      } as never);

      const mapped = (Array.isArray(top) ? top : [])
        .slice(0, PRODUCTS_LIMIT)
        .map((p) => ({
          name: p.product_name ?? p.name,
          units_sold: p.units_sold,
          profit_margin: p.profit_margin,
        }))
        .filter((p) => !!p.name);

      if (mapped.length > 0) return mapped;

      // Fallback sin ventas: mejor margen sobre catálogo activo vendible.
      const candidates = await this.prisma.products.findMany({
        where: { store_id: storeId, state: 'active' },
        select: {
          name: true,
          base_price: true,
          cost_price: true,
        },
        take: 100,
      });
      return candidates
        .map((p) => {
          const price = Number(p.base_price);
          const cost = p.cost_price != null ? Number(p.cost_price) : null;
          const margin =
            cost != null && price > 0 ? (price - cost) / price : -1;
          return { name: p.name, margin };
        })
        .filter((p) => p.margin >= 0)
        .sort((a, b) => b.margin - a.margin)
        .slice(0, PRODUCTS_LIMIT)
        .map(({ name }) => ({ name }));
    } catch (err: any) {
      this.logger.warn(
        `[CrmLanding] Top products gathering failed: ${err?.message}`,
      );
      return [];
    }
  }
}
