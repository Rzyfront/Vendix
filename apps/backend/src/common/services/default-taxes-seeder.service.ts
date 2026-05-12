import { Injectable, Logger } from '@nestjs/common';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../errors';

export type DefaultTaxesScope = 'STORE' | 'ORGANIZATION';

export interface SeedTaxesParams {
  scope: DefaultTaxesScope;
  /** Required when scope='STORE'. */
  store_id?: number;
  /** Required when scope='ORGANIZATION'. */
  organization_id?: number;
  /** When true, existing default taxes are not blocking and rows get upserted. */
  force?: boolean;
}

export interface SeedTaxesResult {
  scope: DefaultTaxesScope;
  store_id?: number;
  organization_id?: number;
  categories_processed: number;
  rates_processed: number;
  forced: boolean;
}

interface DefaultTaxTemplate {
  name: string;
  description: string;
  /** Decimal rate, e.g. 0.19 for 19%. Stored at decimal(6,5). */
  rate: number;
  is_compound?: boolean;
  priority?: number;
}

/**
 * DefaultTaxesSeederService
 *
 * HTTP-triggered, tenant-scoped seeder for the Colombian default tax
 * catalogue (IVA 19/5/0, ICA Bogotá, RETEFUENTE 2.5%). Created so the
 * fiscal-activation wizard can offer a one-click "Use Colombian defaults"
 * option without forcing operators to type the rates by hand.
 *
 * Since the `add_organization_id_to_tax_categories` migration,
 * organization-level seeding is supported: rows are written with
 * `organization_id = <tenantId>` and `store_id = NULL`. Store-level seeding
 * continues writing rows with `store_id = <tenantId>` and
 * `organization_id = NULL`. The DB enforces exactly one of those columns is
 * set via a CHECK constraint.
 *
 * Idempotency: when force=false (default) we refuse to run if any
 * `tax_categories` row already exists for the target scope. With force=true
 * we upsert rows; lookup is done by `findFirst` on the appropriate scope
 * column because uniqueness is enforced via partial unique indexes that
 * Prisma cannot model as a compound unique.
 */
@Injectable()
export class DefaultTaxesSeederService {
  private readonly logger = new Logger(DefaultTaxesSeederService.name);

  private readonly defaultTaxes: DefaultTaxTemplate[] = [
    {
      name: 'IVA 19%',
      description: 'Impuesto al Valor Agregado - Tarifa general',
      rate: 0.19,
      priority: 10,
    },
    {
      name: 'IVA 5%',
      description: 'Impuesto al Valor Agregado - Tarifa reducida',
      rate: 0.05,
      priority: 11,
    },
    {
      name: 'IVA 0%',
      description: 'Impuesto al Valor Agregado - Exento / Tarifa cero',
      rate: 0.0,
      priority: 12,
    },
    {
      name: 'ICA Bogotá',
      description:
        'Impuesto de Industria y Comercio - Bogotá (tarifa común 9.66 x 1000)',
      rate: 0.00966,
      priority: 20,
    },
    {
      name: 'Retención en la Fuente 2.5%',
      description: 'Retención en la fuente - Servicios generales',
      rate: 0.025,
      priority: 30,
    },
  ];

  constructor(private readonly prisma: GlobalPrismaService) {}

  async seed(params: SeedTaxesParams): Promise<SeedTaxesResult> {
    const { scope, force = false } = params;

    let store_id: number | null = null;
    let organization_id: number | null = null;
    let countWhere: { store_id?: number; organization_id?: number };

    if (scope === 'ORGANIZATION') {
      if (!params.organization_id || !Number.isFinite(params.organization_id)) {
        throw new VendixHttpException(
          ErrorCodes.STORE_CONTEXT_001,
          'organization_id is required for ORGANIZATION-scoped tax seeding.',
        );
      }
      organization_id = params.organization_id;
      countWhere = { organization_id };
    } else {
      if (!params.store_id || !Number.isFinite(params.store_id)) {
        throw new VendixHttpException(
          ErrorCodes.STORE_CONTEXT_001,
          'store_id is required for STORE-scoped tax seeding.',
        );
      }
      store_id = params.store_id;
      if (params.organization_id) {
        const store = await this.prisma.withoutScope().stores.findFirst({
          where: { id: store_id, organization_id: params.organization_id },
          select: { id: true },
        });
        if (!store) {
          throw new VendixHttpException(
            ErrorCodes.STORE_CONTEXT_001,
            'Store does not belong to the current organization.',
          );
        }
      }
      countWhere = { store_id };
    }

    if (!force) {
      const existing = await this.prisma.withoutScope().tax_categories.count({
        where: countWhere,
      });
      if (existing > 0) {
        throw new VendixHttpException(ErrorCodes.TAXES_ALREADY_SEEDED);
      }
    }

    let categories_processed = 0;
    let rates_processed = 0;

    for (const template of this.defaultTaxes) {
      // Upsert-by-(scope, name). Partial unique indexes (Postgres) enforce
      // uniqueness but Prisma can't model them — we emulate upsert manually.
      const existingCategory = await this.prisma
        .withoutScope()
        .tax_categories.findFirst({
          where: {
            name: template.name,
            store_id,
            organization_id,
          },
          select: { id: true },
        });

      let categoryId: number;
      if (existingCategory) {
        const updated = await this.prisma
          .withoutScope()
          .tax_categories.update({
            where: { id: existingCategory.id },
            data: { description: template.description },
            select: { id: true },
          });
        categoryId = updated.id;
      } else {
        const created = await this.prisma
          .withoutScope()
          .tax_categories.create({
            data: {
              name: template.name,
              description: template.description,
              store_id,
              organization_id,
            },
            select: { id: true },
          });
        categoryId = created.id;
      }
      categories_processed++;

      const existingRate = await this.prisma.withoutScope().tax_rates.findFirst({
        where: {
          tax_category_id: categoryId,
          store_id,
          name: template.name,
        },
        select: { id: true },
      });

      if (existingRate) {
        await this.prisma.withoutScope().tax_rates.update({
          where: { id: existingRate.id },
          data: {
            rate: template.rate,
            is_compound: template.is_compound ?? false,
            priority: template.priority ?? 0,
          },
        });
      } else {
        await this.prisma.withoutScope().tax_rates.create({
          data: {
            tax_category_id: categoryId,
            store_id,
            rate: template.rate,
            name: template.name,
            is_compound: template.is_compound ?? false,
            priority: template.priority ?? 0,
          },
        });
      }
      rates_processed++;
    }

    this.logger.log(
      `Seeded default Colombian taxes (scope=${scope}, store_id=${store_id}, ` +
        `organization_id=${organization_id}): ` +
        `${categories_processed} categories, ${rates_processed} rates ` +
        `(force=${force})`,
    );

    return {
      scope,
      store_id: store_id ?? undefined,
      organization_id: organization_id ?? undefined,
      categories_processed,
      rates_processed,
      forced: force,
    };
  }
}
