import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { StorefrontPriceService } from '../../../ecommerce/shared/services/storefront-price.service';
import { PromotionEngineService } from '../../promotions/promotion-engine/promotion-engine.service';
import { isPlanProduct } from '../../reservations/service-plans/service-plan-pricing.util';
import {
  PREVIEW_IMAGE_ORDER,
  PreviewProductCard,
  PreviewProductRow,
  buildPreviewProductSelect,
  extractBlockProductIds,
  resolvePreviewProductCards,
} from '../shared/app-page-products.helper';
import {
  onlineServicesWhere,
  orderServices,
  parseServicePageConfig,
  secondaryProductsWhere,
} from './service-page.reader';

type ServiceCategory = { id: number; name: string; slug: string };

/** Fila de servicio leída para la vista previa (campos de precio de tarjetas más datos del servicio). */
type ServiceRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  base_price: unknown;
  sale_price: unknown;
  is_on_sale: boolean | null;
  service_duration_minutes: number | null;
  service_duration_unit: 'minute' | 'hour' | 'day' | null;
  service_modality: string | null;
  requires_booking: boolean | null;
  service_pricing_type?: string | null;
  plan_duration_days?: number | null;
  product_images: { image_url: string }[];
  product_categories: { categories: ServiceCategory | null }[];
};

/** Datos del catálogo que pinta la vista previa y usa el selector de servicios. */
export interface ServicePageViewData {
  services: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    /** Precio regular antes de impuestos. */
    price: number;
    /**
     * Precio que muestra la página pública: resuelto igual que el catálogo
     * ecommerce (impuestos, presentación por defecto y promociones automáticas).
     */
    final_price: number;
    image_url: string | null;
    service_duration_minutes: number | null;
    /** Unidad en que se muestra la duración; null se interpreta como 'minute'. */
    service_duration_unit: 'minute' | 'hour' | 'day' | null;
    service_modality: string | null;
    requires_booking: boolean;
    /** Plan de varios días (QUI-1060): no se agenda directo en línea («Ver plan»). */
    is_plan: boolean;
    categories: { id: number; name: string; slug: string }[];
  }[];
  featured_service_ids: number[];
  products: PreviewProductCard[];
  /** Productos elegidos manualmente en el bloque `products` activo (en el orden configurado). */
  block_products?: PreviewProductCard[];
}

/**
 * F6-B — the catalog data of the service page for the editor's preview
 * (`GET /store/apps/service_page/preview-context`). It applies the selection
 * rules of the public read (`readPublishedServicePage`): the same "sold
 * online" filters, featured services first in the owner's order, the rest by
 * name and the same cap, and the secondary products in the owner's order. It
 * does not require the page to be published (the owner previews before
 * publishing).
 *
 * Tenant isolation: every query filters by the `storeId` the caller resolved
 * from the request context (JWT), through the reader's `where` helpers.
 */
@Injectable()
export class ServicePageViewService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3: S3Service,
    private readonly storefrontPrice: StorefrontPriceService,
    private readonly promotionEngine: PromotionEngineService,
  ) {}

  async read(storeId: number, rawConfig: unknown): Promise<ServicePageViewData> {
    const config = parseServicePageConfig(rawConfig);
    const blockProductIds = extractBlockProductIds(rawConfig);
    const allProductIds = Array.from(new Set([...config.product_ids, ...blockProductIds]));
    const image = {
      select: { image_url: true },
      orderBy: PREVIEW_IMAGE_ORDER,
      take: 1,
    };

    const [rows, productRows] = await Promise.all([
      this.globalPrisma.products.findMany({
        where: onlineServicesWhere(storeId),
        select: {
          // Same price fields as the product cards, so the service price is
          // resolved by the catalog's own rule (`resolvePreviewProductCards`).
          ...buildPreviewProductSelect(true),
          service_duration_minutes: true,
          service_duration_unit: true,
          service_modality: true,
          requires_booking: true,
          service_pricing_type: true,
          plan_duration_days: true,
          product_images: image,
          product_categories: {
            select: {
              category_id: true,
              categories: { select: { id: true, name: true, slug: true } },
            },
          },
        } as any,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }) as unknown as Promise<ServiceRow[]>,
      this.findProducts(storeId, allProductIds),
    ]);

    const { cardsById } = await resolvePreviewProductCards(
      [...(rows as unknown as PreviewProductRow[]), ...productRows],
      {
        prisma: this.globalPrisma as any,
        s3: this.s3,
        storefrontPrice: this.storefrontPrice,
        promotionEngine: this.promotionEngine,
      },
    );

    // En el contexto de vista previa y el selector devolvemos TODOS los servicios
    // en línea de la tienda sin el tope de 60, para que el dueño pueda buscar
    // cualquiera y la selección manual incluya todos sus IDs. El tope de 60 lo
    // aplica solo el modo automático (`selectPreviewServices` / `orderServices`).
    const { services, featuredIds } = orderServices(rows, config.featured_service_ids, null);

    const serviceViews: ServicePageViewData['services'] = [];
    for (const s of services) {
      const price = Number(s.is_on_sale && s.sale_price != null ? s.sale_price : s.base_price);
      const card = cardsById.get(s.id);
      serviceViews.push({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description ?? null,
        price,
        final_price: card?.final_price ?? price,
        image_url: card?.image_url ?? null,
        service_duration_minutes: s.service_duration_minutes ?? null,
        service_duration_unit: s.service_duration_unit ?? null,
        service_modality: s.service_modality ?? null,
        requires_booking: !!s.requires_booking,
        is_plan: isPlanProduct(s),
        categories: s.product_categories
          .map((pc) => pc.categories)
          .filter((c): c is ServiceCategory => !!c),
      });
    }

    const products: ServicePageViewData['products'] = [];
    for (const id of config.product_ids) {
      const card = cardsById.get(id);
      if (card) products.push(card);
    }

    if (blockProductIds.length === 0) {
      return { services: serviceViews, featured_service_ids: featuredIds, products };
    }

    const blockProducts: PreviewProductCard[] = [];
    for (const id of blockProductIds) {
      const card = cardsById.get(id);
      if (card) blockProducts.push(card);
    }

    return {
      services: serviceViews,
      featured_service_ids: featuredIds,
      products,
      block_products: blockProducts,
    };
  }

  private async findProducts(
    storeId: number,
    ids: number[],
  ): Promise<PreviewProductRow[]> {
    if (ids.length === 0) return [];
    return (await this.globalPrisma.products.findMany({
      where: secondaryProductsWhere(storeId, ids),
      select: buildPreviewProductSelect(false) as any,
    })) as unknown as PreviewProductRow[];
  }
}
