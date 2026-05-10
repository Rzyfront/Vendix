import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, inventory_locations } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

import { OrgLocationQueryDto } from './dto/org-location-query.dto';
import { CreateOrgLocationDto } from './dto/create-org-location.dto';
import { UpdateOrgLocationDto } from './dto/update-org-location.dto';

/**
 * Org-native inventory locations service (read + write).
 *
 * `inventory_locations` IS registered in `OrganizationPrismaService` (auto
 * org_id filter), so listing/reading org-wide is straightforward. The
 * `store_id` query param drives breakdown vs consolidated semantics via
 * `getScopedWhere`.
 *
 * Write methods (create/update/remove) — Plan P2.1 — enforce:
 *   - At most one `is_central_warehouse = true` location per organization
 *     (DB partial unique index `inventory_locations_one_central_per_org`,
 *     also validated here for friendlier errors).
 *   - Central warehouse must NOT have a `store_id`
 *     (DB CHECK `inventory_locations_central_no_store_chk`).
 *   - Any explicit `store_id` must belong to the current organization.
 *   - Cannot delete a location that holds stock or active reservations.
 */
@Injectable()
export class OrgLocationsService {
  private readonly logger = new Logger(OrgLocationsService.name);

  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  async findAll(query: OrgLocationQueryDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {
      organization_id: scoped.organization_id,
      ...(scoped.store_id != null ? { store_id: scoped.store_id } : {}),
      ...(query.is_active != null ? { is_active: query.is_active } : {}),
      ...(query.type != null ? { type: query.type } : {}),
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [data, total, central_count] = await Promise.all([
      this.orgPrisma.inventory_locations.findMany({
        where,
        include: {
          stores: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ store_id: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.orgPrisma.inventory_locations.count({ where }),
      // Org-wide central warehouse existence — independent of current filters
      // so the "no central warehouse" banner reflects the whole org, not the
      // visible page slice.
      this.orgPrisma.inventory_locations.count({
        where: {
          organization_id: scoped.organization_id,
          is_central_warehouse: true,
        },
      }),
    ]);

    return {
      data: data.map((r) => this.toFlatRow(r)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
        central_count,
      },
    };
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const row = await this.orgPrisma.inventory_locations.findFirst({
      where: { id, organization_id },
      include: {
        stores: { select: { id: true, name: true, slug: true } },
      },
    });
    return row ? this.toFlatRow(row) : null;
  }

  /**
   * Flattens Prisma nested relations into the contract expected by the
   * frontend (see `OrgLocationRow` in
   * `apps/frontend/.../inventory/services/org-inventory.service.ts`).
   */
  private toFlatRow(row: {
    id: number;
    name: string;
    code: string | null;
    type: string | null;
    is_active: boolean;
    is_default: boolean;
    is_central_warehouse: boolean;
    store_id: number | null;
    address_id: number | null;
    stores: { id: number; name: string | null; slug: string | null } | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      type: row.type ?? null,
      is_active: row.is_active,
      is_default: row.is_default,
      is_central_warehouse: row.is_central_warehouse,
      store_id: row.store_id ?? null,
      store_name: row.stores?.name ?? null,
      address_id: row.address_id ?? null,
    };
  }

  /**
   * Creates a new org-level inventory location. Enforces the central
   * warehouse rules and validates the optional `store_id` belongs to the
   * current organization. Optionally creates an inline address.
   */
  async create(dto: CreateOrgLocationDto) {
    const organization_id = this.requireOrgId();

    const isCentral = dto.is_central_warehouse === true;
    const requestedStoreId = dto.store_id ?? null;

    // Rule 1: central warehouse must NOT belong to a specific store.
    if (isCentral && requestedStoreId != null) {
      throw new BadRequestException(
        'La bodega central no puede pertenecer a una tienda específica',
      );
    }

    // Rule 2: only one central warehouse per organization (friendly error
    // before the DB partial unique index fires).
    if (isCentral) {
      const existingCentral =
        await this.orgPrisma.inventory_locations.findFirst({
          where: { is_central_warehouse: true },
          select: { id: true },
        });
      if (existingCentral) {
        throw new ConflictException(
          'La organización ya tiene una bodega central',
        );
      }
    }

    // Rule 3: store_id (if provided) must belong to this org.
    if (requestedStoreId != null) {
      const store = await this.globalPrisma.stores.findFirst({
        where: { id: requestedStoreId, organization_id },
        select: { id: true },
      });
      if (!store) {
        throw new ForbiddenException(
          `Store ${requestedStoreId} no pertenece a la organización`,
        );
      }
    }

    const { address, ...locationData } = dto;

    return this.orgPrisma.$transaction(async (tx: any) => {
      let addressId: number | undefined = locationData.address_id;

      if (address) {
        const newAddress = await tx.addresses.create({
          data: {
            address_line1: address.address_line_1,
            address_line2: address.address_line_2,
            city: address.city,
            state_province: address.state,
            postal_code: address.postal_code,
            country_code:
              address.country && address.country.length <= 3
                ? address.country
                : 'COL',
            organization_id,
            store_id: isCentral ? null : (requestedStoreId ?? undefined),
          },
        });
        addressId = newAddress.id;
      }

      const created = await tx.inventory_locations.create({
        data: {
          name: locationData.name,
          code: locationData.code,
          type: locationData.type ?? 'warehouse',
          is_active: locationData.is_active ?? true,
          is_default: locationData.is_default ?? false,
          is_central_warehouse: isCentral,
          // Central warehouse forces store_id = null.
          store_id: isCentral ? null : requestedStoreId,
          address_id: addressId,
          organization_id,
        },
        include: {
          stores: { select: { id: true, name: true, slug: true } },
        },
      });
      return this.toFlatRow(created);
    });
  }

  /**
   * Updates an org-level inventory location. Re-validates the central
   * warehouse rules using the merged shape (existing row + dto). Only fields
   * present in the dto are mutated.
   */
  async update(id: number, dto: UpdateOrgLocationDto) {
    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.inventory_locations.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    // Resolve the effective central + store_id values after merge.
    const nextIsCentral =
      dto.is_central_warehouse !== undefined
        ? dto.is_central_warehouse
        : existing.is_central_warehouse;
    const nextStoreId =
      dto.store_id !== undefined ? dto.store_id : existing.store_id;

    if (nextIsCentral && nextStoreId != null) {
      throw new BadRequestException(
        'La bodega central no puede pertenecer a una tienda específica',
      );
    }

    if (nextIsCentral && !existing.is_central_warehouse) {
      const otherCentral = await this.orgPrisma.inventory_locations.findFirst({
        where: { is_central_warehouse: true, NOT: { id } },
        select: { id: true },
      });
      if (otherCentral) {
        throw new ConflictException(
          'La organización ya tiene una bodega central',
        );
      }
    }

    if (
      dto.store_id !== undefined &&
      dto.store_id !== null &&
      dto.store_id !== existing.store_id
    ) {
      const store = await this.globalPrisma.stores.findFirst({
        where: { id: dto.store_id, organization_id },
        select: { id: true },
      });
      if (!store) {
        throw new ForbiddenException(
          `Store ${dto.store_id} no pertenece a la organización`,
        );
      }
    }

    const { address, ...locationData } = dto;

    return this.orgPrisma.$transaction(async (tx: any) => {
      const data: any = { ...locationData };

      // Always normalize: when central, force store_id = null.
      if (data.is_central_warehouse === true) {
        data.store_id = null;
      }

      if (address) {
        // Cannot mix relation write with the FK column.
        delete data.address_id;
        if (existing.address_id) {
          data.addresses = {
            update: {
              address_line1: address.address_line_1,
              address_line2: address.address_line_2,
              city: address.city,
              state_province: address.state,
              postal_code: address.postal_code,
              country_code:
                address.country && address.country.length <= 3
                  ? address.country
                  : 'COL',
            },
          };
        } else {
          data.addresses = {
            create: {
              address_line1: address.address_line_1,
              address_line2: address.address_line_2,
              city: address.city,
              state_province: address.state,
              postal_code: address.postal_code,
              country_code:
                address.country && address.country.length <= 3
                  ? address.country
                  : 'COL',
              organization_id,
              store_id: nextIsCentral ? null : (nextStoreId ?? undefined),
            },
          };
        }
      }

      const updated = await tx.inventory_locations.update({
        where: { id },
        data,
        include: {
          stores: { select: { id: true, name: true, slug: true } },
        },
      });
      return this.toFlatRow(updated);
    });
  }

  /**
   * Hard-deletes an org-level inventory location. Refuses to delete when
   * there is stock on hand or active reservations to avoid orphaning
   * inventory data.
   */
  async remove(id: number) {
    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.inventory_locations.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    const [stockSum, activeReservations] = await Promise.all([
      this.orgPrisma.stock_levels.aggregate({
        where: { location_id: id },
        _sum: { quantity_on_hand: true },
      }),
      this.globalPrisma.stock_reservations.count({
        where: {
          organization_id,
          location_id: id,
          status: 'active',
        },
      }),
    ]);

    if ((stockSum._sum.quantity_on_hand ?? 0) > 0) {
      throw new ConflictException(
        'No se puede eliminar una ubicación con existencias en stock',
      );
    }
    if (activeReservations > 0) {
      throw new ConflictException(
        `No se puede eliminar la ubicación: tiene ${activeReservations} reservas activas`,
      );
    }

    return this.orgPrisma.inventory_locations.delete({ where: { id } });
  }

  /**
   * Idempotent central-warehouse provisioning for an organization.
   *
   * Behavior:
   *   - If a central warehouse exists and `is_active=true` → no-op, returns
   *     the existing row.
   *   - If a central warehouse exists and `is_active=false` → reactivate
   *     (set `is_active=true`), returns updated row.
   *   - If no central warehouse exists → create with defaults, returns new row.
   *
   * Defaults for creation:
   *   - `name`: "Bodega Central"
   *   - `code`: `ORG-CENTRAL-${organizationId}`
   *   - `type`: `warehouse`
   *   - `is_central_warehouse`: `true`
   *   - `store_id`: `null` (DB CHECK constraint)
   *   - `is_active`: `true`
   *   - `is_default`: `false`
   *
   * Uses the provided `tx` client when given; falls back to
   * `globalPrisma.withoutScope()` so this method is safe to invoke from
   * non-request contexts (onboarding, scope-migration, single→multi
   * conversion). Idempotent across repeated calls.
   *
   * @param organizationId target organization
   * @param tx optional Prisma TransactionClient for atomic flows
   * @returns the central inventory_location row
   */
  async ensureCentralWarehouse(
    organizationId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<inventory_locations> {
    if (!organizationId || organizationId <= 0) {
      throw new BadRequestException(
        'organizationId is required to ensure a central warehouse',
      );
    }

    const client = (tx ?? this.globalPrisma.withoutScope()) as any;

    // Lookup using both organization_id AND is_central_warehouse=true so we
    // never collide with another org's central row. The partial unique index
    // `inventory_locations_one_central_per_org` already guarantees at most
    // one such row per org, but we still scope our lookup explicitly.
    const existing = await client.inventory_locations.findFirst({
      where: {
        organization_id: organizationId,
        is_central_warehouse: true,
      },
    });

    if (existing) {
      if (existing.is_active) {
        // No-op: already provisioned and active.
        return existing as inventory_locations;
      }

      // Reactivate the previously-deactivated central warehouse so we
      // preserve its history (audit, FKs, snapshots, etc.).
      const reactivated = await client.inventory_locations.update({
        where: { id: existing.id },
        data: { is_active: true, updated_at: new Date() },
      });
      this.logger.log(
        `ensureCentralWarehouse: reactivated central warehouse id=${existing.id} for org=${organizationId}`,
      );
      return reactivated as inventory_locations;
    }

    // Create the central warehouse with defaults. `store_id` is NULL to
    // satisfy the CHECK constraint `inventory_locations_central_no_store_chk`.
    const created = await client.inventory_locations.create({
      data: {
        organization_id: organizationId,
        store_id: null,
        name: 'Bodega Central',
        code: `ORG-CENTRAL-${organizationId}`,
        type: 'warehouse',
        is_central_warehouse: true,
        is_active: true,
        is_default: false,
      },
    });
    this.logger.log(
      `ensureCentralWarehouse: created central warehouse id=${created.id} (code=${created.code}) for org=${organizationId}`,
    );
    return created as inventory_locations;
  }

  /**
   * Marks the organization's central warehouse as inactive (downgrade flow).
   *
   * Idempotent:
   *   - No central warehouse exists → returns `null`.
   *   - Central warehouse already inactive → returns the existing row
   *     unchanged.
   *   - Central warehouse active → flips `is_active=false`, returns the
   *     updated row.
   *
   * The row is preserved (NOT deleted) to keep audit trails and FK targets
   * intact for historical inventory data.
   *
   * @param organizationId target organization
   * @param tx optional Prisma TransactionClient for atomic flows
   * @returns the updated row, the existing inactive row, or `null` if none
   */
  async deactivateCentralWarehouse(
    organizationId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<inventory_locations | null> {
    if (!organizationId || organizationId <= 0) {
      throw new BadRequestException(
        'organizationId is required to deactivate a central warehouse',
      );
    }

    const client = (tx ?? this.globalPrisma.withoutScope()) as any;

    const existing = await client.inventory_locations.findFirst({
      where: {
        organization_id: organizationId,
        is_central_warehouse: true,
      },
    });

    if (!existing) {
      return null;
    }

    if (!existing.is_active) {
      // Already inactive — idempotent no-op.
      return existing as inventory_locations;
    }

    const deactivated = await client.inventory_locations.update({
      where: { id: existing.id },
      data: { is_active: false, updated_at: new Date() },
    });
    this.logger.log(
      `deactivateCentralWarehouse: deactivated central warehouse id=${existing.id} for org=${organizationId}`,
    );
    return deactivated as inventory_locations;
  }

  async ensureCentralForCurrentOrg(): Promise<inventory_locations> {
    const organization_id = this.requireOrgId();
    return this.ensureCentralWarehouse(organization_id);
  }
}
