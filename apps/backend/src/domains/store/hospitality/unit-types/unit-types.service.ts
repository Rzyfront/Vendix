import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { generateSlug } from '@common/utils/slug.util';
import { S3Service } from '@common/services/s3.service';
import { ProductsService } from '../../products/products.service';
import { ProductType } from '../../products/dto';
import { CreateUnitTypeDto, UpdateUnitTypeDto } from './dto';
import { normalizeLodgingImageKeys } from './lodging-media';

/** Name of the service product that sells one night of a room type. */
export function nightProductName(unitTypeName: string): string {
  return `Noche – ${unitTypeName.trim()}`;
}

interface Capacity {
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
}

/**
 * Normalizes and validates a room type capacity. `max_occupancy` defaults to
 * adults + children so the owner only fills what a hotel usually knows.
 */
export function resolveCapacity(input: Partial<Capacity>): Capacity {
  const max_adults = input.max_adults ?? 0;
  const max_children = input.max_children ?? 0;
  const max_occupancy = input.max_occupancy ?? max_adults + max_children;
  const base_occupancy = input.base_occupancy ?? Math.min(2, max_occupancy);

  if (max_adults < 1 || max_occupancy < 1) {
    throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_CAPACITY_001);
  }
  if (base_occupancy > max_occupancy) {
    throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_CAPACITY_002);
  }
  return { base_occupancy, max_adults, max_children, max_occupancy };
}

const UNIT_TYPE_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      base_price: true,
      state: true,
      product_tax_assignments: {
        select: { tax_categories: { select: { id: true, name: true } } },
      },
    },
  },
  // H0.3 — sellable rooms of the type: inactive rooms are out of the count.
  _count: { select: { units: { where: { is_active: true } } } },
} satisfies Prisma.lodging_unit_typesInclude;

/**
 * Hospitality Suite (H0.2) — room types.
 *
 * Each room type owns a service product ("Noche – {name}", no inventory) that
 * carries the nightly base price and its tax. The product is created and
 * edited through `ProductsService`, so pricing, tax-combination and VAT rules
 * stay in one place.
 */
@Injectable()
export class UnitTypesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly s3Service: S3Service,
  ) {}

  async findAll() {
    const unitTypes = await this.prisma.lodging_unit_types.findMany({
      include: UNIT_TYPE_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(unitTypes.map((u) => this.withImageUrls(u)));
  }

  async findOne(id: number) {
    const unitType = await this.prisma.lodging_unit_types.findFirst({
      where: { id },
      include: UNIT_TYPE_INCLUDE,
    });
    if (!unitType) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
    return this.withImageUrls(unitType);
  }

  async create(dto: CreateUnitTypeDto) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const name = dto.name.trim();
    const capacity = resolveCapacity(dto);
    const images = this.normalizeImages(dto.images);
    await this.assertNameAvailable(name);

    const product = await this.productsService.create({
      name: nightProductName(name),
      base_price: dto.base_price,
      product_type: ProductType.SERVICE,
      requires_booking: false,
      available_for_ecommerce: false,
      tax_category_ids: dto.tax_category_ids ?? [],
    });

    try {
      const created = await this.prisma.lodging_unit_types.create({
        data: {
          store_id,
          product_id: product.id,
          name,
          code: dto.code ?? null,
          description: dto.description ?? null,
          ...capacity,
          bed_config: dto.bed_config ?? null,
          images: images ?? [],
          amenities: dto.amenities ?? [],
          overbooking_allowance: dto.overbooking_allowance ?? 0,
          sort_order: dto.sort_order ?? 0,
          is_active: dto.is_active ?? true,
          updated_at: new Date(),
        },
      });
      return this.findOne(created.id);
    } catch (error) {
      // The product lives in its own transaction inside ProductsService:
      // archive it so a failed room type never leaves an orphan night product.
      await this.productsService.remove(product.id).catch(() => undefined);
      throw this.mapUniqueViolation(error);
    }
  }

  async update(id: number, dto: UpdateUnitTypeDto) {
    const current = await this.findOne(id);
    const name = dto.name?.trim() ?? current.name;
    const capacity = resolveCapacity({
      base_occupancy: dto.base_occupancy ?? current.base_occupancy,
      max_adults: dto.max_adults ?? current.max_adults,
      max_children: dto.max_children ?? current.max_children,
      max_occupancy:
        dto.max_occupancy ??
        (dto.max_adults !== undefined || dto.max_children !== undefined
          ? undefined
          : current.max_occupancy),
    });
    const images = this.normalizeImages(dto.images);
    if (name !== current.name) {
      await this.assertNameAvailable(name, id);
    }

    const productChanges = {
      // The slug follows the name so the old name is free for a new type.
      ...(name !== current.name && {
        name: nightProductName(name),
        slug: generateSlug(nightProductName(name)),
      }),
      ...(dto.base_price !== undefined && { base_price: dto.base_price }),
      ...(dto.tax_category_ids !== undefined && {
        tax_category_ids: dto.tax_category_ids,
      }),
    };
    if (Object.keys(productChanges).length > 0) {
      await this.productsService.update(current.product_id, productChanges);
    }

    try {
      await this.prisma.lodging_unit_types.update({
        where: { id },
        data: {
          name,
          ...(dto.code !== undefined && { code: dto.code || null }),
          ...(dto.description !== undefined && {
            description: dto.description || null,
          }),
          ...capacity,
          ...(dto.bed_config !== undefined && {
            bed_config: dto.bed_config || null,
          }),
          ...(images !== undefined && { images }),
          ...(dto.amenities !== undefined && { amenities: dto.amenities }),
          ...(dto.overbooking_allowance !== undefined && {
            overbooking_allowance: dto.overbooking_allowance,
          }),
          ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
          ...(dto.is_active !== undefined && { is_active: dto.is_active }),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
    return this.findOne(id);
  }

  /** Photos are stored as S3 keys and signed on every read. */
  private async withImageUrls<T extends { images: string[] }>(unitType: T) {
    const image_urls = await Promise.all(
      unitType.images.map(
        async (key) => (await this.s3Service.signUrl(key)) ?? '',
      ),
    );
    return { ...unitType, image_urls };
  }

  private normalizeImages(images: string[] | undefined): string[] | undefined {
    if (images === undefined) return undefined;
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return normalizeLodgingImageKeys(images, {
      organization_id: context.organization_id,
      store_id: context.store_id,
    });
  }

  private async assertNameAvailable(name: string, excludeId?: number) {
    const existing = await this.prisma.lodging_unit_types.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_DUP_001);
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_DUP_001);
    }
    return error;
  }
}
