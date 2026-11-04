import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  onlineServicesWhere,
  orderServices,
  parseServicePageConfig,
  secondaryProductsWhere,
} from './service-page.reader';

const IMAGE_ORDER = [
  { is_main: 'desc' as const },
  { sort_order: 'asc' as const },
  { id: 'asc' as const },
];

/** What the service page paints from the store's catalog: services (featured first) and secondary products. */
export interface ServicePageViewData {
  services: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    /** Regular price before taxes (the public page shows the tax-derived final price). */
    price: number;
    image_url: string | null;
    service_duration_minutes: number | null;
    service_modality: string | null;
    requires_booking: boolean;
    categories: { id: number; name: string; slug: string }[];
  }[];
  featured_service_ids: number[];
  products: {
    id: number;
    slug: string;
    name: string;
    image_url: string | null;
  }[];
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
  ) {}

  async read(storeId: number, rawConfig: unknown): Promise<ServicePageViewData> {
    const config = parseServicePageConfig(rawConfig);
    const image = {
      select: { image_url: true },
      orderBy: IMAGE_ORDER,
      take: 1,
    };

    const productsSelect = {
      id: true,
      slug: true,
      name: true,
      product_images: image,
    } as const;
    const [rows, productRows] = await Promise.all([
      this.globalPrisma.products.findMany({
        where: onlineServicesWhere(storeId),
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          base_price: true,
          sale_price: true,
          is_on_sale: true,
          service_duration_minutes: true,
          service_modality: true,
          requires_booking: true,
          product_images: image,
          product_categories: {
            select: { categories: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.findProducts(storeId, config.product_ids, productsSelect),
    ]);

    const { services, featuredIds } = orderServices(rows, config.featured_service_ids);
    const sign = async (key?: string) => (await this.s3.signUrl(key)) ?? null;

    const serviceViews: ServicePageViewData['services'] = [];
    for (const s of services) {
      serviceViews.push({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description ?? null,
        price: Number(s.is_on_sale && s.sale_price != null ? s.sale_price : s.base_price),
        image_url: await sign(s.product_images[0]?.image_url),
        service_duration_minutes: s.service_duration_minutes ?? null,
        service_modality: s.service_modality ?? null,
        requires_booking: !!s.requires_booking,
        categories: s.product_categories
          .map((pc) => pc.categories)
          .filter((c): c is { id: number; name: string; slug: string } => !!c),
      });
    }

    const byId = new Map(productRows.map((p) => [p.id, p]));
    const products: ServicePageViewData['products'] = [];
    for (const id of config.product_ids) {
      const p = byId.get(id);
      if (!p) continue;
      products.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        image_url: await sign(p.product_images[0]?.image_url),
      });
    }

    return { services: serviceViews, featured_service_ids: featuredIds, products };
  }

  private async findProducts<T extends Prisma.productsSelect>(
    storeId: number,
    ids: number[],
    select: T,
  ) {
    if (ids.length === 0) return [] as Prisma.productsGetPayload<{ select: T }>[];
    return this.globalPrisma.products.findMany({
      where: secondaryProductsWhere(storeId, ids),
      select,
    });
  }
}
