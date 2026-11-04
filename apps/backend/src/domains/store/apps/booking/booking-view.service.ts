import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { secondaryProductsWhere } from '../service-page/service-page.reader';
import { parseBookingPageConfig } from './booking-page.reader';

const IMAGE_ORDER = [
  { is_main: 'desc' as const },
  { sort_order: 'asc' as const },
  { id: 'asc' as const },
];

type ProductRow = {
  id: number;
  slug: string;
  name: string;
  product_images: { image_url: string }[];
};

/** What the booking page paints from the store's data: its room types and the "para tu estadía" products. */
export interface BookingViewData {
  room_types: {
    id: number;
    name: string;
    description: string | null;
    max_occupancy: number;
    bed_config: string | null;
    image_url: string | null;
  }[];
  products: {
    id: number;
    slug: string;
    name: string;
    image_url: string | null;
  }[];
}

/**
 * F6-B — the data of the booking page for the editor's preview
 * (`GET /store/apps/booking/preview-context`). Rates and availability come
 * from the PMS engine at booking time and are not read here: the preview shows
 * the real room types (active ones, like the public read counts them) and the
 * secondary products in the owner's order. It does not require the page to be
 * published.
 *
 * Tenant isolation: every query filters by the `storeId` the caller resolved
 * from the request context (JWT).
 */
@Injectable()
export class BookingViewService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  async read(storeId: number, rawConfig: unknown): Promise<BookingViewData> {
    const config = parseBookingPageConfig(rawConfig);
    const [roomTypes, productRows] = await Promise.all([
      this.globalPrisma.lodging_unit_types.findMany({
        where: { store_id: storeId, is_active: true },
        select: {
          id: true,
          name: true,
          description: true,
          max_occupancy: true,
          bed_config: true,
          images: true,
        },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      this.findProducts(storeId, config.product_ids),
    ]);

    const sign = async (key?: string) => (await this.s3.signUrl(key)) ?? null;

    const room_types: BookingViewData['room_types'] = [];
    for (const r of roomTypes) {
      room_types.push({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        max_occupancy: r.max_occupancy,
        bed_config: r.bed_config ?? null,
        image_url: await sign(r.images[0]),
      });
    }

    const byId = new Map(productRows.map((p) => [p.id, p]));
    const products: BookingViewData['products'] = [];
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

    return { room_types, products };
  }

  private findProducts(storeId: number, ids: number[]) {
    if (ids.length === 0) return Promise.resolve([] as ProductRow[]);
    return this.globalPrisma.products.findMany({
      where: secondaryProductsWhere(storeId, ids),
      select: {
        id: true,
        slug: true,
        name: true,
        product_images: {
          select: { image_url: true },
          orderBy: IMAGE_ORDER,
          take: 1,
        },
      },
    });
  }
}
