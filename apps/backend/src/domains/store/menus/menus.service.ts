import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateMenuDto,
  UpdateMenuDto,
  MenuQueryDto,
} from './dto';

@Injectable()
export class MenusService {
  constructor(private prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  async create(dto: CreateMenuDto) {
    const storeId = this.requireStoreId();
    const dup = await this.prisma.menus.findFirst({
      where: { store_id: storeId, name: dto.name },
    });
    if (dup) throw new VendixHttpException(ErrorCodes.MENU_DUP_NAME);
    return this.prisma.menus.create({
      data: {
        store_id: storeId,
        name: dto.name,
        is_active: dto.is_active ?? true,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: MenuQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 20, search, is_active } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.menusWhereInput = {
      store_id: storeId,
      ...(is_active !== undefined && { is_active }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.menus.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
        include: {
          _count: { select: { sections: true, availability_windows: true } },
        },
      }),
      this.prisma.menus.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: number) {
    const storeId = this.requireStoreId();
    const menu = await this.prisma.menus.findFirst({
      where: { id, store_id: storeId },
    });
    if (!menu) throw new VendixHttpException(ErrorCodes.MENU_NOT_FOUND);
    return menu;
  }

  /**
   * Returns the full menu graph for a single menu: sections → items → product
   * snapshot, plus the menu-level availability windows. Used by the builder
   * page and the public carta endpoints.
   */
  async findFull(id: number) {
    const storeId = this.requireStoreId();
    const menu = await this.prisma.menus.findFirst({
      where: { id, store_id: storeId },
      include: {
        availability_windows: {
          where: { menu_id: id, menu_section_id: null },
          orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
        },
        sections: {
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
          include: {
            availability_windows: {
              orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
            },
            items: {
              orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    base_price: true,
                    is_sellable: true,
                    is_combo: true,
                    state: true,
                    stock_unit: true,
                    // La imagen vive en product_images (1:N), no en una columna.
                    // Traemos la principal (is_main) y, en su defecto, la de menor
                    // sort_order; luego la aplanamos a `image_url` para el builder.
                    product_images: {
                      select: { image_url: true },
                      orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!menu) throw new VendixHttpException(ErrorCodes.MENU_NOT_FOUND);

    // Aplana la imagen principal de cada producto (product_images[0]) a un
    // campo plano `image_url`, contrato que consume el builder de la carta.
    return {
      ...menu,
      sections: menu.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          if (!item.product) return item;
          const { product_images, ...productRest } = item.product;
          return {
            ...item,
            product: {
              ...productRest,
              image_url: product_images?.[0]?.image_url ?? null,
            },
          };
        }),
      })),
    };
  }

  async update(id: number, dto: UpdateMenuDto) {
    await this.findOne(id);
    if (dto.name !== undefined) {
      const storeId = this.requireStoreId();
      const dup = await this.prisma.menus.findFirst({
        where: {
          store_id: storeId,
          name: dto.name,
          NOT: { id },
        },
      });
      if (dup) throw new VendixHttpException(ErrorCodes.MENU_DUP_NAME);
    }
    return this.prisma.menus.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  async softDelete(id: number) {
    await this.findOne(id);
    return this.prisma.menus.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  /**
   * Aggregate stats for the menu list page (# active menus, # sections,
   * # products listed in carta). Caller is expected to invoke inside a
   * store scope.
   */
  async getStats() {
    const storeId = this.requireStoreId();
    const [menus, sections, items] = await Promise.all([
      this.prisma.menus.findMany({
        where: { store_id: storeId },
        select: { id: true, is_active: true },
      }),
      this.prisma.menu_sections.findMany({
        where: { store_id: storeId },
        select: { id: true },
      }),
      this.prisma.menu_section_items.findMany({
        where: { menu_section: { store_id: storeId } },
        select: { id: true },
      }),
    ]);
    return {
      total_menus: menus.length,
      active_menus: menus.filter((m) => m.is_active).length,
      total_sections: sections.length,
      total_section_items: items.length,
    };
  }
}
