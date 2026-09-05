import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { SettingsService } from '../../settings/settings.service';
import { CustomersService } from '../../customers/customers.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../../../email/email.service';
import { S3Service } from '@common/services/s3.service';
import { ProductsAnalyticsService } from '../../analytics/services/products-analytics.service';
import {
  CrmLandingDocument,
  validateCrmLandingDocument,
} from '../crm-blocks.contract';
import { CrmContactDto } from '../dto/crm-contact.dto';

const PUBLIC_PRODUCTS_LIMIT = 6;
const TOP_PRODUCTS_WINDOW_DAYS = 90;

/**
 * Superficie pública de la CRM Landing (`/ecommerce/crm/*`). Sin auth:
 * el tenant llega por DomainResolverMiddleware (hostname del storefront o
 * ?store_id=). Sirve ÚNICAMENTE `published_json` y solo si el módulo está
 * activado y la tienda publicada.
 */
@Injectable()
export class CrmPublicService {
  private readonly logger = new Logger(CrmPublicService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly settingsService: SettingsService,
    private readonly customersService: CustomersService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly s3Service: S3Service,
    private readonly productsAnalytics: ProductsAnalyticsService,
  ) {}

  /**
   * Hostname del dominio STORE_ECOMMERCE activo de la tienda (para los
   * deep-links de la landing). null si no tiene ecommerce publicado.
   */
  private async ecommerceBaseUrl(storeId: number): Promise<string | null> {
    try {
      const domain = await this.globalPrisma.domain_settings.findFirst({
        where: {
          store_id: storeId,
          app_type: 'STORE_ECOMMERCE',
          status: 'active',
        },
        select: { hostname: true },
        orderBy: { id: 'asc' },
      });
      return domain?.hostname ? `https://${domain.hostname}` : null;
    } catch {
      return null;
    }
  }

  async getPublicLanding(): Promise<{
    document: CrmLandingDocument | null;
    ecommerce_base_url: string | null;
  }> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return { document: null, ecommerce_base_url: null };

    const landing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
      select: {
        enabled: true,
        published_json: true,
        published_at: true,
        version: true,
      },
    });

    if (!landing?.enabled || !landing.published_json)
      return { document: null, ecommerce_base_url: null };

    // Gate de publicación de la tienda: apagarlo oculta la landing aunque
    // exista contenido publicado.
    let publication: Record<string, unknown> | undefined;
    try {
      const settings = await this.settingsService.getSettings();
      publication = settings?.publication as unknown as Record<string, unknown> | undefined;
    } catch {
      publication = undefined;
    }
    if (publication && publication.landing_enabled === false)
      return { document: null, ecommerce_base_url: null };

    const parsed = landing.published_json as unknown;
    if (!validateCrmLandingDocument(parsed).valid) {
      this.logger.warn(
        `[CrmPublic] published_json inválido para store ${storeId}; se sirve vacío`,
      );
      return { document: null, ecommerce_base_url: null };
    }

    const document = parsed as CrmLandingDocument;
    await this.enrichProductsGrid(storeId, document);
    return {
      document,
      ecommerce_base_url: await this.ecommerceBaseUrl(storeId),
    };
  }

  /**
   * Inyecta productos reales en los bloques products_grid al momento de leer
   * (datos siempre frescos, sin re-publicar): top ventas por revenue en la
   * ventana; fallback a productos activos más recientes. Solo campos
   * públicos (nombre, slug, precio e imagen firmada).
   */
  private async enrichProductsGrid(
    storeId: number,
    document: CrmLandingDocument,
  ): Promise<void> {
    try {
      const items = await this.topProductsForStore(storeId);
      if (items.length === 0) return;
      document.blocks = document.blocks.map((block) =>
        block.type === 'products_grid'
          ? { ...block, props: { ...block.props, items: items as never } }
          : block,
      );
    } catch (err: any) {
      this.logger.warn(
        `[CrmPublic] Enriquecimiento de productos falló: ${
          err?.message || JSON.stringify(err)?.slice(0, 500) || 'desconocido'
        }\n${err?.stack?.slice(0, 400) ?? ''}`,
      );
    }
  }

  private async topProductsForStore(
    storeId: number,
  ): Promise<
    Array<{ name: string; slug: string; price: number | null; image_url: string | null }>
  > {
    const to = new Date();
    const from = new Date(
      to.getTime() - TOP_PRODUCTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    // Top ventas por revenue vía el servicio de analytics existente.
    // OJO: getTopSellingProducts lanza si el store no tiene ventas en la
    // ventana (bug latente de join([]) sobre resultado vacío) — cualquier
    // fallo se trata como "sin ventas" y cae al fallback de catálogo.
    let productIds: number[] = [];
    try {
      const to = new Date();
      const from = new Date(
        to.getTime() - TOP_PRODUCTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const top = await this.productsAnalytics.getTopSellingProducts({
        date_from: from.toISOString().slice(0, 10),
        date_to: to.toISOString().slice(0, 10),
        limit: PUBLIC_PRODUCTS_LIMIT,
        top_sellers_sort_by: 'revenue',
      } as never);
      productIds = (Array.isArray(top) ? top : [])
        .map((row) => row.product_id)
        .filter((id): id is number => id != null);
    } catch (err: any) {
      this.logger.warn(
        `[CrmPublic] Top sellers no disponible (${err?.message?.slice(0, 120)}); usando catálogo reciente`,
      );
    }

    if (productIds.length === 0) {
      // Fallback sin ventas: productos activos más recientes.
      const recent = await this.prisma.products.findMany({
        where: { store_id: storeId, state: 'active' },
        select: { id: true },
        orderBy: { created_at: 'desc' },
        take: PUBLIC_PRODUCTS_LIMIT,
      });
      productIds = recent.map((p) => p.id);
    }

    if (productIds.length === 0) return [];

    const products = await this.prisma.products.findMany({
      where: { id: { in: productIds }, state: 'active' },
      select: {
        id: true,
        name: true,
        slug: true,
        base_price: true,
        product_images: {
          take: 1,
          orderBy: { id: 'asc' as const },
          select: { image_url: true },
        },
      },
    });

    const byIdOrder = new Map(productIds.map((id, i) => [id, i]));
    const sorted = products.sort(
      (a, b) => (byIdOrder.get(a.id) ?? 99) - (byIdOrder.get(b.id) ?? 99),
    );
    return Promise.all(
      sorted.map(async (p) => ({
        name: p.name,
        slug: p.slug,
        price: p.base_price != null ? Number(p.base_price) : null,
        image_url: p.product_images?.[0]?.image_url
          ? await this.s3Service.signUrl(p.product_images[0].image_url)
          : null,
      })),
    );
  }

  /**
   * Contacto público: crea/actualiza el cliente con la semántica guest
   * existente (dedupe email→teléfono→documento; cero lógica nueva de
   * creación) y notifica al dueño con el texto de la consulta.
   */
  async submitContact(dto: CrmContactDto): Promise<{
    customer_created: boolean;
    customer_id: number | null;
  }> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);

    const landing = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
      select: {
        enabled: true,
        published_json: true,
      },
    });

    if (!landing?.enabled || !landing.published_json) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_007);
    }

    let publication: Record<string, unknown> | undefined;
    try {
      const settings = await this.settingsService.getSettings();
      publication = settings?.publication as unknown as Record<string, unknown> | undefined;
    } catch {
      publication = undefined;
    }
    if (publication && publication.landing_enabled === false) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_007);
    }

    const hasEmail = !!dto.email?.trim();
    const hasPhone = !!dto.phone?.trim();
    if (!hasEmail && !hasPhone) {
      throw new VendixHttpException(ErrorCodes.CRM_LANDING_006);
    }

    const resolved = await this.customersService.resolveTableGuestCustomer(
      storeId,
      {
        first_name: dto.first_name.trim(),
        last_name: dto.last_name?.trim() || undefined,
        email: hasEmail ? dto.email!.toLowerCase().trim() : undefined,
        phone: hasPhone ? dto.phone!.replace(/\s+/g, '') : undefined,
      },
    );

    await this.notificationsService.createAndBroadcast(
      storeId,
      'crm_contact_request',
      'Nuevo contacto desde tu landing',
      `${resolved.name}: ${dto.message.slice(0, 140)}`,
      {
        source: 'crm_landing',
        customer_id: resolved.customer_id,
        name: resolved.name,
        message: dto.message,
        status: 'new',
        reply_to: {
          email: dto.email ?? null,
          phone: dto.phone ?? null,
        },
      },
    );

    // Si proporcionó email, enviar correo de bienvenida/confirmación
    if (hasEmail && dto.email) {
      try {
        const store = await this.prisma.stores.findUnique({
          where: { id: storeId },
          select: { name: true },
        });
        const storeName = store?.name || 'Vendix';
        const subject = `¡Gracias por escribir a ${storeName}!`;
        const html = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <h2 style="color: #0f172a; margin-top: 0;">¡Hola ${dto.first_name}!</h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">
              Hemos recibido tu mensaje en <strong>${storeName}</strong> y ya estás registrado como cliente preferencial en nuestro sistema.
            </p>
            <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 14px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 13px; color: #475569; font-style: italic;">"${dto.message}"</p>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
              Uno de nuestros asesores se pondrá en contacto contigo a la brevedad posible.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              Este mensaje fue enviado automáticamente por ${storeName} a través de la plataforma Vendix.
            </p>
          </div>
        `;
        const text = `¡Hola ${dto.first_name}!\nHemos recibido tu mensaje en ${storeName} y ya estás registrado en nuestro sistema.\n\nTu consulta: "${dto.message}"\n\nPronto nos pondremos en contacto contigo.`;

        await this.emailService.sendEmail(dto.email.toLowerCase().trim(), subject, html, text);
      } catch (err) {
        this.logger.warn(`No se pudo enviar correo de confirmación de contacto a ${dto.email}: ${err}`);
      }
    }

    return {
      customer_created: resolved.was_created,
      customer_id: resolved.customer_id,
    };
  }
}
