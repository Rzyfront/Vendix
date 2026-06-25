import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateMenuSectionDto,
  UpdateMenuSectionDto,
  AddMenuSectionItemDto,
  SortMenuSectionItemsDto,
  SortMenuSectionsDto,
} from './dto';

@Injectable()
export class MenuSectionsService {
  constructor(private prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  private async assertMenuOwned(menuId: number, storeId: number) {
    const menu = await this.prisma.menus.findFirst({
      where: { id: menuId, store_id: storeId },
      select: { id: true },
    });
    if (!menu) throw new VendixHttpException(ErrorCodes.MENU_NOT_FOUND);
  }

  private async assertSectionOwned(sectionId: number, storeId: number) {
    const section = await this.prisma.menu_sections.findFirst({
      where: { id: sectionId, store_id: storeId },
      select: { id: true, menu_id: true },
    });
    if (!section)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);
    return section;
  }

  async createSection(menuId: number, dto: CreateMenuSectionDto) {
    const storeId = this.requireStoreId();
    await this.assertMenuOwned(menuId, storeId);

    const dup = await this.prisma.menu_sections.findFirst({
      where: { menu_id: menuId, name: dto.name },
    });
    if (dup) throw new VendixHttpException(ErrorCodes.MENU_SECTION_DUP_NAME);

    return this.prisma.menu_sections.create({
      data: {
        menu_id: menuId,
        store_id: storeId,
        name: dto.name,
        sort_order: dto.sort_order ?? 0,
        updated_at: new Date(),
      },
    });
  }

  async listSections(menuId: number) {
    const storeId = this.requireStoreId();
    await this.assertMenuOwned(menuId, storeId);
    return this.prisma.menu_sections.findMany({
      where: { menu_id: menuId, store_id: storeId },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      include: {
        _count: { select: { items: true } },
      },
    });
  }

  async updateSection(
    menuId: number,
    sectionId: number,
    dto: UpdateMenuSectionDto,
  ) {
    const storeId = this.requireStoreId();
    const section = await this.assertSectionOwned(sectionId, storeId);
    if (section.menu_id !== menuId)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);

    if (dto.name !== undefined) {
      const dup = await this.prisma.menu_sections.findFirst({
        where: { menu_id: menuId, name: dto.name, NOT: { id: sectionId } },
      });
      if (dup)
        throw new VendixHttpException(ErrorCodes.MENU_SECTION_DUP_NAME);
    }

    return this.prisma.menu_sections.update({
      where: { id: sectionId },
      data: { ...dto, updated_at: new Date() },
    });
  }

  async deleteSection(menuId: number, sectionId: number) {
    const storeId = this.requireStoreId();
    const section = await this.assertSectionOwned(sectionId, storeId);
    if (section.menu_id !== menuId)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);
    // menu_sections.items cascades via FK; menu_availability_windows cascades
    // to null. We just delete the section row.
    await this.prisma.menu_sections.delete({ where: { id: sectionId } });
    return { deleted: true };
  }

  /**
   * Reorder sections of a menu to match the supplied ordered id list. Any
   * section that belongs to the menu but is omitted keeps its old sort_order.
   * Sections from other menus are silently ignored.
   */
  async sortSections(menuId: number, dto: SortMenuSectionsDto) {
    const storeId = this.requireStoreId();
    await this.assertMenuOwned(menuId, storeId);
    if (!Array.isArray(dto.section_ids) || dto.section_ids.length === 0) {
      return { updated: 0 };
    }
    const owned = await this.prisma.menu_sections.findMany({
      where: { menu_id: menuId, store_id: storeId, id: { in: dto.section_ids } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((s) => s.id));
    const updates = dto.section_ids
      .map((id, idx) => ({ id, sort_order: idx }))
      .filter((u) => ownedIds.has(u.id));
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.menu_sections.update({
          where: { id: u.id },
          data: { sort_order: u.sort_order, updated_at: new Date() },
        }),
      ),
    );
    return { updated: updates.length };
  }

  // ----------------------------------------------------- section items

  async addItem(menuId: number, sectionId: number, dto: AddMenuSectionItemDto) {
    const storeId = this.requireStoreId();
    const section = await this.assertSectionOwned(sectionId, storeId);
    if (section.menu_id !== menuId)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);

    // The product must exist in the same store. A carta is shown in the
    // storefront, so a dish added to it has to be both sellable and
    // available for ecommerce. Instead of rejecting products that lack
    // either flag, we promote them to true (see promotion below).
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id, store_id: storeId },
      select: {
        id: true,
        is_sellable: true,
        available_for_ecommerce: true,
        state: true,
      },
    });
    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    const dup = await this.prisma.menu_section_items.findFirst({
      where: { menu_section_id: sectionId, product_id: dto.product_id },
    });
    if (dup)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_ITEM_DUP);

    // Promote storefront-visibility flags so the dish is actually buyable
    // and shows up in the public carta/catalog. Only writes when needed and
    // never demotes (true stays true). Scoped by store_id for safety.
    if (!product.is_sellable || !product.available_for_ecommerce) {
      await this.prisma.products.updateMany({
        where: { id: product.id, store_id: storeId },
        data: {
          is_sellable: true,
          available_for_ecommerce: true,
          updated_at: new Date(),
        },
      });
    }

    try {
      return await this.prisma.menu_section_items.create({
        data: {
          menu_section_id: sectionId,
          product_id: dto.product_id,
          sort_order: dto.sort_order ?? 0,
          updated_at: new Date(),
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              base_price: true,
              is_sellable: true,
              is_combo: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.MENU_SECTION_ITEM_DUP);
      }
      throw error;
    }
  }

  async removeItem(menuId: number, sectionId: number, itemId: number) {
    const storeId = this.requireStoreId();
    const section = await this.assertSectionOwned(sectionId, storeId);
    if (section.menu_id !== menuId)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);
    const item = await this.prisma.menu_section_items.findFirst({
      where: { id: itemId, menu_section_id: sectionId },
    });
    if (!item)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_ITEM_NOT_FOUND);
    await this.prisma.menu_section_items.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async sortItems(
    menuId: number,
    sectionId: number,
    dto: SortMenuSectionItemsDto,
  ) {
    const storeId = this.requireStoreId();
    const section = await this.assertSectionOwned(sectionId, storeId);
    if (section.menu_id !== menuId)
      throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);
    if (!Array.isArray(dto.item_ids) || dto.item_ids.length === 0) {
      return { updated: 0 };
    }
    const owned = await this.prisma.menu_section_items.findMany({
      where: { menu_section_id: sectionId, id: { in: dto.item_ids } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((s) => s.id));
    const updates = dto.item_ids
      .map((id, idx) => ({ id, sort_order: idx }))
      .filter((u) => ownedIds.has(u.id));
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.menu_section_items.update({
          where: { id: u.id },
          data: { sort_order: u.sort_order, updated_at: new Date() },
        }),
      ),
    );
    return { updated: updates.length };
  }
}
