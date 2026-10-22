import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateBrandDto,
  UpdateBrandDto,
  BrandQueryDto,
  AssignProductsDto,
  PreviewAssignProductsDto,
  AssignBrandProductsResult,
  BrandProductIdsResult,
  BrandAssignPreviewResult,
  BrandMovedFrom,
} from './dto';
import { S3Service } from '@common/services/s3.service';
import { ImageContext } from '@common/config/image-presets';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class BrandsService {
  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
    private eventEmitter: EventEmitter2,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async create(createBrandDto: CreateBrandDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    try {
      const sanitizedLogoUrl = extractS3KeyFromUrl(createBrandDto.logo_url);
      const slug = createBrandDto.slug?.trim()
        ? this.generateSlug(createBrandDto.slug)
        : this.generateSlug(createBrandDto.name);

      const brandData: any = {
        name: createBrandDto.name,
        slug,
        description: createBrandDto.description,
        logo_url: sanitizedLogoUrl,
        store_id,
        state: createBrandDto.state ?? 'active',
      };

      if (createBrandDto.is_featured !== undefined) {
        brandData.is_featured = createBrandDto.is_featured;
      }

      const brand = await this.prisma.brands.create({
        data: brandData,
      });

      return {
        ...brand,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
      };
    } catch (error) {
      if (error instanceof VendixHttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
      }
      throw error;
    }
  }

  async findAll(query: BrandQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      is_featured,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (state) where.state = state;
    else where.state = { not: 'archived' }; // Excluir archivados por defecto

    if (is_featured !== undefined) {
      where.is_featured = is_featured;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [brands, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.brands.count({ where }),
    ]);

    // product_count: productos NO archivados por marca (el _count existente
    // incluye archivados y se conserva por compatibilidad).
    const counts = brands.length
      ? await this.prisma.products.groupBy({
          by: ['brand_id'],
          where: {
            brand_id: { in: brands.map((b) => b.id) },
            state: { not: 'archived' },
          },
          _count: { _all: true },
        })
      : [];
    const countByBrand = new Map<number, number>(
      counts.map((c: any) => [c.brand_id as number, c._count._all as number]),
    );

    const signedBrands = await Promise.all(
      brands.map(async (brand) => ({
        ...brand,
        product_count: countByBrand.get(brand.id) ?? 0,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
      })),
    );

    return {
      data: signedBrands,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByStore(storeId: number, query: BrandQueryDto) {
    // Scope is applied automatically by StorePrismaService
    return this.findAll(query);
  }

  async findOne(id: number, options?: { includeInactive?: boolean }) {
    const brand = await this.prisma.brands.findFirst({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!brand) {
      throw new VendixHttpException(ErrorCodes.BRAND_FIND_001);
    }

    return {
      ...brand,
      logo_url: await this.s3Service.signUrl(brand.logo_url),
    };
  }

  async update(id: number, updateBrandDto: UpdateBrandDto, user: any) {
    const brand = await this.findOne(id);

    const updateData: any = {};

    if (updateBrandDto.name) {
      updateData.name = updateBrandDto.name;
      updateData.slug = this.generateSlug(updateBrandDto.name);
    }

    if (updateBrandDto.slug !== undefined && updateBrandDto.slug.trim()) {
      updateData.slug = this.generateSlug(updateBrandDto.slug);
    }

    if (updateBrandDto.description !== undefined) {
      updateData.description = updateBrandDto.description;
    }

    if (updateBrandDto.logo_url !== undefined) {
      updateData.logo_url = extractS3KeyFromUrl(updateBrandDto.logo_url);
    }

    if (updateBrandDto.state !== undefined) {
      updateData.state = updateBrandDto.state;
    }

    if (updateBrandDto.is_featured !== undefined) {
      updateData.is_featured = updateBrandDto.is_featured;
    }

    try {
      const updated = await this.prisma.brands.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: { products: true },
          },
        },
      });

      return {
        ...updated,
        logo_url: await this.s3Service.signUrl(updated.logo_url),
      };
    } catch (error) {
      if (error instanceof VendixHttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
      }
      throw error;
    }
  }

  async remove(id: number, user: any, options: { force?: boolean } = {}) {
    const brand = await this.findOne(id);

    const productCount = await this.prisma.products.count({
      where: { brand_id: id },
    });

    if (productCount > 0 && !options.force) {
      throw new VendixHttpException(
        ErrorCodes.BRAND_DELETE_HAS_PRODUCTS,
        undefined,
        { product_count: productCount },
      );
    }

    if (productCount > 0 && options.force) {
      await this.prisma.products.updateMany({
        where: { brand_id: id },
        data: { brand_id: null },
      });
    }

    await this.prisma.brands.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date(),
      },
    });
  }

  /** Valida marca activa/inactiva (no archivada) y productos de la tienda. */
  private async loadAssignContext(
    client: any,
    store_id: number,
    brandId: number,
    ids: number[],
    rejectArchived: boolean,
  ) {
    const brand = await client.brands.findFirst({
      where: { id: brandId, store_id, state: { not: 'archived' } },
      select: { id: true, name: true },
    });
    if (!brand) throw new VendixHttpException(ErrorCodes.BRAND_FIND_001);

    const products: Array<{ id: number; brand_id: number | null; state: string }> =
      await client.products.findMany({
        where: { id: { in: ids }, store_id },
        select: { id: true, brand_id: true, state: true },
      });
    const valid = new Set<number>(
      products
        .filter((p) => !rejectArchived || p.state !== 'archived')
        .map((p) => p.id),
    );
    const invalid = ids.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.PROD_FIND_001,
        'Algunos productos no existen en la tienda o están archivados',
        { invalid_product_ids: invalid },
      );
    }
    return { brand, products };
  }

  /** Agrupa los productos que pertenecen a OTRA marca (brand_id no nulo). */
  private async groupByOtherBrand(
    client: any,
    store_id: number,
    brandId: number,
    products: Array<{ id: number; brand_id: number | null }>,
  ): Promise<Array<BrandMovedFrom & { product_ids: number[] }>> {
    const groups = new Map<number, number[]>();
    for (const p of products) {
      if (p.brand_id !== null && p.brand_id !== brandId) {
        const list = groups.get(p.brand_id) ?? [];
        list.push(p.id);
        groups.set(p.brand_id, list);
      }
    }
    if (groups.size === 0) return [];
    const brands: Array<{ id: number; name: string }> =
      await client.brands.findMany({
        where: { id: { in: [...groups.keys()] }, store_id },
        select: { id: true, name: true },
      });
    const names = new Map(brands.map((b) => [b.id, b.name]));
    return [...groups.entries()].map(([brand_id, product_ids]) => ({
      brand_id,
      brand_name: names.get(brand_id) ?? '',
      count: product_ids.length,
      product_ids,
    }));
  }

  /**
   * Asigna (add) o desasigna (remove) productos a una marca en bloque. Todo o
   * nada ante productos inválidos. `remove` solo afecta productos que tengan
   * esta marca.
   */
  async assignProducts(
    brandId: number,
    dto: AssignProductsDto,
  ): Promise<AssignBrandProductsResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const ids = [...new Set(dto.product_ids)];

    let affectedIds: number[] = [];
    const result = await this.prisma.$transaction(async (tx: any) => {
      const { products } = await this.loadAssignContext(
        tx,
        store_id,
        brandId,
        ids,
        dto.action === 'add',
      );

      if (dto.action === 'remove') {
        const res = await tx.products.updateMany({
          where: { id: { in: ids }, store_id, brand_id: brandId },
          data: { brand_id: null, updated_at: new Date() },
        });
        if (res.count > 0) {
          affectedIds = products
            .filter((p) => p.brand_id === brandId)
            .map((p) => p.id);
        }
        return {
          added: 0,
          removed: res.count,
          unchanged: ids.length - res.count,
          moved_from_brands: [],
        };
      }

      const toChange = products.filter((p) => p.brand_id !== brandId);
      const moved = await this.groupByOtherBrand(tx, store_id, brandId, toChange);
      let added = 0;
      if (toChange.length > 0) {
        const res = await tx.products.updateMany({
          where: { id: { in: toChange.map((p) => p.id) }, store_id },
          data: { brand_id: brandId, updated_at: new Date() },
        });
        added = res.count;
        if (added > 0) affectedIds = toChange.map((p) => p.id);
      }
      return {
        added,
        removed: 0,
        unchanged: ids.length - added,
        moved_from_brands: moved.map(({ product_ids, ...rest }) => rest),
      };
    });

    this.emitProductsBulkUpdated(store_id, affectedIds);
    return result;
  }

  private emitProductsBulkUpdated(
    store_id: number,
    product_ids: number[],
  ): void {
    if (product_ids.length === 0) return;
    try {
      const organization_id = RequestContextService.getOrganizationId();
      if (!organization_id) return;
      this.eventEmitter.emit('products.bulk_updated', {
        store_id,
        organization_id,
        product_ids,
      });
    } catch {
      // Reindexar es enriquecimiento: jamás rompe la respuesta.
    }
  }

  /** IDs de los productos no archivados de la marca en la tienda. */
  async getProductIds(brandId: number): Promise<BrandProductIdsResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const brand = await this.prisma.brands.findFirst({
      where: { id: brandId, store_id, state: { not: 'archived' } },
      select: { id: true },
    });
    if (!brand) throw new VendixHttpException(ErrorCodes.BRAND_FIND_001);

    const rows = await this.prisma.products.findMany({
      where: { brand_id: brandId, store_id, state: { not: 'archived' } },
      select: { id: true },
    });
    const product_ids = rows.map((r) => r.id);
    return { product_ids, total: product_ids.length };
  }

  /** Vista previa de `assignProducts(add)`: no escribe nada. */
  async previewAssignProducts(
    brandId: number,
    dto: PreviewAssignProductsDto,
  ): Promise<BrandAssignPreviewResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const ids = [...new Set(dto.product_ids)];
    const { products } = await this.loadAssignContext(
      this.prisma,
      store_id,
      brandId,
      ids,
      true,
    );
    return {
      already_in_brand: products.filter((p) => p.brand_id === brandId).length,
      without_brand: products.filter((p) => p.brand_id === null).length,
      to_move: await this.groupByOtherBrand(this.prisma, store_id, brandId, products),
    };
  }

  async uploadBrandLogo(file: Buffer, filename: string) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const timestamp = Date.now();
    const cleanFilename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const basePath = this.s3PathHelper.buildBrandPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${timestamp}-${cleanFilename}`;

    try {
      const result = await this.s3Service.uploadImage(file, key, {
        generateThumbnail: true,
        context: ImageContext.LOGO,
      });
      const signedUrl = await this.s3Service.getPresignedUrl(result.key);

      return {
        key: result.key,
        url: signedUrl,
        thumbKey: result.thumbKey,
      };
    } catch (error) {
      if (error instanceof VendixHttpException) {
        throw error;
      }
      throw new VendixHttpException(ErrorCodes.MEDIA_UPLOAD_FAILED_001);
    }
  }

  private async validateUniqueName(name: string, excludeId?: number) {
    const where: any = { name };
    if (excludeId) {
      where.id = { not: excludeId };
    }

    const existing = await this.prisma.brands.findFirst({ where });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
    }
  }
}
