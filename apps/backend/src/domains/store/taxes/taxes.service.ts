import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
  TaxFiscalType,
} from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from '@common/services/fiscal-scope.service';

@Injectable()
export class TaxesService {
  constructor(
    private prisma: StorePrismaService,
    private fiscalScope: FiscalScopeService,
  ) {}

  private async getFiscalContext(): Promise<{
    organization_id: number;
    store_id: number;
    fiscal_scope: OrganizationFiscalScope;
  }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    let organization_id = context?.organization_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    if (!organization_id) {
      const store = await this.prisma.withoutScope().stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }

    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const fiscal_scope =
      await this.fiscalScope.requireFiscalScope(organization_id);
    return { organization_id, store_id, fiscal_scope };
  }

  /**
   * Calculates taxes for a product based on its assignments.
   * Logic: Sums all tax rates from assigned categories.
   *
   * `options.client` permite pasar el cliente de una transacción en curso. Sin
   * él, la consulta sale por `this.prisma`, o sea por OTRA conexión del pool:
   * llamado desde dentro de un `$transaction` eso toma una segunda conexión
   * mientras la primera sostiene locks, y con suficientes cobros concurrentes el
   * pool (`new Pool(...)` sin `max` ⇒ 10 conexiones) se queda sin ninguna libre y
   * nadie avanza. Los llamadores que ya están en una transacción deben pasar su
   * `tx`. Es opcional para no romper a quienes llaman fuera de transacción.
   *
   * `options.store_id` es OBLIGATORIO en la práctica cuando se pasa `client`:
   * `$transaction` sale del `baseClient` (`base-prisma.service.ts:43-45`), no del
   * `scoped_client`, así que el `tx` NO lleva el scoping de la extensión y el
   * filtro de tenant que `product_tax_assignments` tenía automáticamente
   * (`store-prisma.service.ts:436` → `{ products: { store_id } }`) hay que
   * reponerlo a mano. Sin `client`, el scoping automático sigue aplicando y el
   * filtro extra es redundante pero inocuo.
   */
  // CAVEAT (QUI-772 / 2026-08-31). Este resolver SUMA todas las tasas de
  // todas las categorías. El otro camino,
  // `OrdersService.resolveLineTaxesForOrder` (venta fresca POS), elige
  // UNA y descarta el resto (`break` + `take: 1`). Para el mismo producto
  // multi-impuesto los dos persisten `order_item_taxes` distintos y este
  // cobra más. Antes de tocar la política de acá, mirá el CAVEAT de allá:
  // cambiar uno solo ensancha la grieta. Ver QUI-772.
  async calculateProductTaxes(
    productId: number,
    basePrice: number,
    options?: {
      client?: { product_tax_assignments: { findMany: (args: any) => any } };
      store_id?: number;
    },
  ) {
    const db = options?.client ?? this.prisma;
    const assignments = await db.product_tax_assignments.findMany({
      where: {
        product_id: productId,
        ...(options?.store_id != null
          ? { products: { store_id: options.store_id } }
          : {}),
      },
      include: {
        tax_categories: {
          include: {
            tax_rates: {
              where: {
                // In a multi-tenant environment, rates should belong to the store or be global.
                // StorePrismaService filters by store_id automatically.
              },
            },
          },
        },
      },
    });

    let totalRate = 0;
    const taxes: {
      tax_rate_id: number;
      name: string;
      rate: number;
      amount: number;
      tax_type: TaxFiscalType;
    }[] = [];

    for (const assignment of assignments) {
      if (assignment.tax_categories?.tax_rates) {
        // Fiscal type is owned by the category (source of truth) and carried
        // down to each rate row so the downstream breakdown stays typed.
        const taxType =
          (assignment.tax_categories.tax_type as TaxFiscalType | null) ??
          TaxFiscalType.IVA;
        for (const rate of assignment.tax_categories.tax_rates) {
          const rateVal = Number(rate.rate);
          const amount = basePrice * rateVal;
          totalRate += rateVal;
          taxes.push({
            tax_rate_id: rate.id,
            name: rate.name,
            rate: rateVal,
            amount,
            tax_type: taxType,
          });
        }
      }
    }

    return {
      total_rate: totalRate,
      total_tax_amount: basePrice * totalRate,
      taxes,
    };
  }

  async create(createTaxCategoryDto: CreateTaxCategoryDto, user: any) {
    const context = await this.getFiscalContext();
    if (context.fiscal_scope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Taxes are managed at organization level for this organization.',
      );
    }

    // Idempotent upsert-by-(store_id, name). The fiscal wizard's "use Colombian
    // defaults" and manual creation can both target the same category name;
    // an unconditional create() duplicated categories. Uniqueness is enforced
    // via partial unique indexes that Prisma cannot model as a compound
    // unique, so we emulate the upsert with a scope-safe findFirst (mirrors
    // DefaultTaxesSeederService). Only reachable for fiscal_scope=STORE — the
    // ORGANIZATION rejection above still stands.
    const existing = await this.prisma.tax_categories.findFirst({
      where: { name: createTaxCategoryDto.name, store_id: context.store_id },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.tax_categories.update({
        where: { id: existing.id },
        data: {
          description: createTaxCategoryDto.description,
          tax_type: createTaxCategoryDto.tax_type ?? TaxFiscalType.IVA,
        },
        include: {
          tax_rates: true,
        },
      });
    }

    return this.prisma.tax_categories.create({
      data: {
        name: createTaxCategoryDto.name,
        description: createTaxCategoryDto.description,
        tax_type: createTaxCategoryDto.tax_type ?? TaxFiscalType.IVA,
        store_id: context.store_id,
        tax_rates: {
          create: {
            name: createTaxCategoryDto.name,
            rate: Number(createTaxCategoryDto.rate) / 100,
            store_id: context.store_id,
            is_compound: createTaxCategoryDto.is_compound || false,
            priority: createTaxCategoryDto.sort_order || 0,
          },
        },
      },
      include: {
        tax_rates: true,
      },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const context = await this.getFiscalContext();
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search)
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];

    // ✅ BYPASS MANUAL ELIMINADO - ahora usa scoping automático de PrismaService
    // El filtro store_id se aplica automáticamente según el contexto del usuario
    // Los usuarios solo pueden ver tax_categories de su store actual

    if (context.fiscal_scope === 'ORGANIZATION') {
      where.organization_id = context.organization_id;
      where.store_id = null;
      const [taxCategories, total] = await Promise.all([
        this.prisma.withoutScope().tax_categories.findMany({
          where,
          skip,
          take: limit,
          include: { tax_rates: true },
        }),
        this.prisma.withoutScope().tax_categories.count({ where }),
      ]);

      return {
        data: taxCategories,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    const [taxCategories, total] = await Promise.all([
      this.prisma.tax_categories.findMany({
        where,
        skip,
        take: limit,
        include: { tax_rates: true },
      }),
      this.prisma.tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, user: any) {
    const context = await this.getFiscalContext();
    if (context.fiscal_scope === 'ORGANIZATION') {
      const taxCategory =
        await this.prisma.withoutScope().tax_categories.findFirst({
          where: {
            id,
            organization_id: context.organization_id,
            store_id: null,
          },
          include: { tax_rates: true },
        });
      if (!taxCategory) throw new VendixHttpException(ErrorCodes.CAT_FIND_001);
      return taxCategory;
    }

    // Auto-scoped by StorePrismaService
    const taxCategory = await this.prisma.tax_categories.findFirst({
      where: { id },
    });
    if (!taxCategory) throw new VendixHttpException(ErrorCodes.CAT_FIND_001);

    return taxCategory;
  }

  async update(
    id: number,
    updateTaxCategoryDto: UpdateTaxCategoryDto,
    user: any,
  ) {
    const context = await this.getFiscalContext();
    if (context.fiscal_scope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Taxes are managed at organization level for this organization.',
      );
    }
    await this.findOne(id, user);
    return this.prisma.tax_categories.update({
      where: { id },
      data: updateTaxCategoryDto,
    });
  }

  async remove(id: number, user: any) {
    const context = await this.getFiscalContext();
    if (context.fiscal_scope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Taxes are managed at organization level for this organization.',
      );
    }
    await this.findOne(id, user);
    return this.prisma.tax_categories.delete({ where: { id } });
  }
}
