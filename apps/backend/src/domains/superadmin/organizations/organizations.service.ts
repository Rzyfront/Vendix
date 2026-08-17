import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  AdminOrganizationQueryDto,
  OrganizationState,
  OrganizationDashboardDto,
  ORG_JSONB_DTO_KEYS,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { S3Service } from '../../../common/services/s3.service';
import type {
  OrganizationDetailContract,
  OrganizationPrimaryAddressContract,
  OrganizationPartnerContract,
  OrganizationFraudContract,
} from './organizations.contract';

const ORG_JSONB_FIELDS_SET = new Set<string>(ORG_JSONB_DTO_KEYS);

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    const slug = slugify(createOrganizationDto.name, {
      lower: true,
      strict: true,
    });

    const existingOrg = await this.prisma.organizations.findFirst({
      where: { OR: [{ slug }, ...(createOrganizationDto.tax_id ? [{ tax_id: createOrganizationDto.tax_id }] : [])] },
    });

    if (existingOrg) {
      throw new ConflictException(
        'Organization with this slug or tax ID already exists',
      );
    }

    // Separate top-level scalar fields from the address subset and from the
    // JSONB subset; the JSONB subset only carries the three brand colors
    // and lives in `organization_settings.settings`. The address subset
    // flows into a separate `addresses` row.
    const {
      address_line1,
      address_line2,
      city,
      state_province,
      country_code,
      department_code,
      municipality_code,
      postal_code,
      latitude,
      longitude,
      color_primary,
      color_secondary,
      color_accent,
      ...orgData
    } = createOrganizationDto;

    const organization = await this.prisma.organizations.create({
      data: {
        ...orgData,
        slug,
        logo_url: orgData.logo_url
          ? this.s3Service.sanitizeForStorage(orgData.logo_url)
          : null,
        partner_settings: orgData.partner_settings
          ? (orgData.partner_settings as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        updated_at: new Date(),
      },
    });

    // ---- primary address (if any) ----------------------------------------
    if (address_line1) {
      await this.prisma.addresses.create({
        data: {
          address_line1,
          address_line2: address_line2 ?? null,
          city: city ?? '',
          state_province: state_province ?? null,
          country_code: country_code ?? 'CO',
          postal_code: postal_code ?? null,
          municipality_code: municipality_code ?? null,
          latitude: latitude !== undefined && latitude !== null ? new Prisma.Decimal(latitude) : null,
          longitude: longitude !== undefined && longitude !== null ? new Prisma.Decimal(longitude) : null,
          is_primary: true,
          type: 'billing',
          organizations: { connect: { id: organization.id } },
        },
      });
    }

    // ---- JSONB branding (if any) -----------------------------------------
    const jsonbPayload: Record<string, unknown> = {};
    if (color_primary !== undefined) jsonbPayload.color_primary = color_primary;
    if (color_secondary !== undefined) jsonbPayload.color_secondary = color_secondary;
    if (color_accent !== undefined) jsonbPayload.color_accent = color_accent;

    if (Object.keys(jsonbPayload).length > 0) {
      await this.prisma.organization_settings.create({
        data: {
          organization_id: organization.id,
          settings: jsonbPayload as Prisma.InputJsonValue,
        },
      });
    }

    return this.findOne(organization.id);
  }

  async findAll(query: AdminOrganizationQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
      mode,
      include_non_production,
    } = query;
    const skip = (page - 1) * Number(limit);

    const where: Prisma.organizationsWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { tax_id: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.state = status;
    }

    if (is_active !== undefined) {
      where.state = is_active
        ? OrganizationState.ACTIVE
        : OrganizationState.INACTIVE;
    }

    // Filter by organization mode
    if (mode) {
      where.mode = mode;
    } else if (!include_non_production) {
      where.mode = 'production';
    }

    const [data, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: {
            select: { id: true, name: true, is_active: true },
          },
          _count: {
            select: {
              users: true,
              stores: true,
            },
          },
        },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  /**
   * `GET /superadmin/organizations/:id` — returns the normalized detail
   * contract (see `./organizations.contract.ts`).
   *
   * The contract extends the raw Prisma `organizations` row with:
   * - `color_primary`, `color_secondary`, `color_accent` lifted out of
   *   `organization_settings.settings`.
   * - `primary_address` — the `addresses[]` row with `is_primary=true`, or
   *   the first one if none has the flag.
   * - `partner` / `fraud` grouped sub-objects.
   * - `_count` of stores, users, addresses, suppliers, employees.
   */
  async findOne(id: number): Promise<OrganizationDetailContract> {
    const organization = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        organization_settings: true,
        addresses: {
          where: { is_primary: true },
        },
        _count: {
          select: {
            stores: true,
            users: true,
            addresses: true,
            suppliers: true,
            employees: true,
          },
        },
      },
    });

    if (!organization) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ORG_001);
    }

    return this.normalizeOrganizationDetail(organization);
  }

  async findBySlug(slug: string) {
    const organization = await this.prisma.organizations.findUnique({
      where: { slug },
      include: {
        stores: true,
        addresses: true,
        users: true,
      },
    });

    if (!organization) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ORG_001);
    }

    return organization;
  }

  /**
   * `PATCH /superadmin/organizations/:id` — wraps three sub-steps in a
   * single Prisma transaction so the response cannot diverge from
   * persisted state.
   *
   * 1. Top-level `organizations.update` (slug-collision guarded + tax_id
   *    collision guarded). Slug resolution precedence:
   *    - Explicit `dto.slug` (slugified defensively, collision-scoped).
   *    - Auto-derived from `dto.name` (only when name actually changed AND
   *      no explicit slug was supplied).
   *    - Existing slug (no rename, untouched).
   * 2. Primary `addresses` upsert keyed on the existing primary row.
   *    Gated by `addressPayload && addressPayload.address_line1`.
   * 3. JSONB merge into `organization_settings.settings` (top-level
   *    aliases preferred).
   *
   * Returns the normalized detail contract by re-fetching inside the
   * same transaction.
   */
  async update(id: number, updateOrganizationDto: UpdateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingOrg = await tx.organizations.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          slug: true,
          tax_id: true,
        },
      });

      if (!existingOrg) {
        throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ORG_001);
      }

      // ---- slug resolution ------------------------------------------------
      let nextSlug = existingOrg.slug;
      if (updateOrganizationDto.slug !== undefined) {
        nextSlug = slugify(updateOrganizationDto.slug, {
          lower: true,
          strict: true,
        });

        if (!nextSlug || nextSlug.length < 2) {
          // Belt-and-suspenders: class-validator already enforces min length,
          // but a `slugify('@@')` can empty out the value. Reject cleanly.
          throw new VendixHttpException(ErrorCodes.ORG_VALIDATE_001);
        }

        if (nextSlug !== existingOrg.slug) {
          const slugExists = await tx.organizations.findFirst({
            where: { slug: nextSlug, id: { not: id } },
            select: { id: true },
          });

          if (slugExists) {
            throw new ConflictException(
              'Organization with this slug already exists',
            );
          }
        }
      } else if (
        updateOrganizationDto.name !== undefined &&
        updateOrganizationDto.name !== existingOrg.name
      ) {
        nextSlug = slugify(updateOrganizationDto.name, {
          lower: true,
          strict: true,
        });

        const slugExists = await tx.organizations.findFirst({
          where: { slug: nextSlug, id: { not: id } },
          select: { id: true },
        });

        if (slugExists) {
          throw new ConflictException(
            'Organization with this slug already exists',
          );
        }
      }

      // ---- tax_id collision guard ----------------------------------------
      if (
        updateOrganizationDto.tax_id !== undefined &&
        updateOrganizationDto.tax_id !== existingOrg.tax_id &&
        updateOrganizationDto.tax_id !== null
      ) {
        const taxIdExists = await tx.organizations.findFirst({
          where: { tax_id: updateOrganizationDto.tax_id, id: { not: id } },
          select: { id: true },
        });

        if (taxIdExists) {
          throw new ConflictException(
            'Organization with this tax ID already exists',
          );
        }
      }

      // ---- sub-step 1: top-level `organizations.update` --------------------
      const rowFields = this.pickRowFields(updateOrganizationDto);

      try {
        await tx.organizations.update({
          where: { id },
          data: {
            ...rowFields,
            slug: nextSlug,
            updated_at: new Date(),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // P2002 unique constraint failure (slug/tax_id) — surface as a
          // typed validation error.
          if (error.code === 'P2002') {
            throw new ConflictException(
              'Organization with this slug or tax ID already exists',
            );
          }
        }
        throw error;
      }

      // ---- sub-step 2: primary `addresses` upsert -------------------------
      // The address row has a non-null `address_line1`; standalone metadata
      // like `country_code` or `municipality_code` (which the frontend ships
      // by default even when the user didn't edit the address) is harmless
      // to ignore here. Require `address_line1` to actually touch the row.
      const addressPayload = this.pickAddressPayload(updateOrganizationDto);
      if (addressPayload && addressPayload.address_line1) {
        const primaryAddress = await tx.addresses.findFirst({
          where: { organization_id: id },
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          select: { id: true },
        });

        if (primaryAddress) {
          await tx.addresses.update({
            where: { id: primaryAddress.id },
            data: { ...addressPayload, is_primary: true },
          });
        } else {
          // Prisma relation connect (the bare `organization_id` FK is only
          // accepted on UncheckedCreateInput, which is heavier than we need
          // here). The relation itself is what gets validated.
          await tx.addresses.create({
            data: {
              address_line1: addressPayload.address_line1 as string,
              address_line2: (addressPayload.address_line2 as string | null | undefined) ?? null,
              city: (addressPayload.city as string | undefined) ?? '',
              state_province: (addressPayload.state_province as string | null | undefined) ?? null,
              country_code: (addressPayload.country_code as string | undefined) ?? 'CO',
              postal_code: (addressPayload.postal_code as string | null | undefined) ?? null,
              municipality_code: (addressPayload.municipality_code as string | null | undefined) ?? null,
              latitude: (addressPayload.latitude as Prisma.Decimal | null | undefined) ?? null,
              longitude: (addressPayload.longitude as Prisma.Decimal | null | undefined) ?? null,
              is_primary: true,
              type: 'billing',
              organizations: { connect: { id } },
            },
          });
        }
      }

      // ---- sub-step 3: JSONB merge into `organization_settings.settings` --
      const jsonbPayload = this.pickJsonbPayload(updateOrganizationDto);
      if (jsonbPayload) {
        const existingSettings = await tx.organization_settings.findUnique({
          where: { organization_id: id },
          select: { settings: true },
        });

        const merged = this.mergeJsonbSettings(
          existingSettings?.settings,
          jsonbPayload,
        );

        if (existingSettings) {
          await tx.organization_settings.update({
            where: { organization_id: id },
            data: { settings: merged, updated_at: new Date() },
          });
        } else {
          await tx.organization_settings.create({
            data: { organization_id: id, settings: merged },
          });
        }
      }

      // Re-fetch inside the tx so the normalized response cannot be stale.
      const refreshed = await tx.organizations.findUnique({
        where: { id },
        include: {
          organization_settings: true,
          addresses: {
            where: { is_primary: true },
          },
          _count: {
            select: {
              stores: true,
              users: true,
              addresses: true,
              suppliers: true,
              employees: true,
            },
          },
        },
      });

      if (!refreshed) {
        throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ORG_001);
      }

      return this.normalizeOrganizationDetail(refreshed);
    });
  }

  async remove(id: number) {
    const existingOrg = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            stores: true,
            users: true,
          },
        },
      },
    });

    if (!existingOrg) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ORG_001);
    }

    if (existingOrg._count.stores > 0 || existingOrg._count.users > 0) {
      throw new BadRequestException(
        'Cannot delete organization with existing stores or users',
      );
    }

    // QUI-473: deleting the organization must clean up its roles too.
    //
    // Background: the FK `roles_organization_id_fkey` is `ON DELETE SET NULL`
    // and the new unique `roles_organization_id_name_key` uses NULLS NOT
    // DISTINCT. If two organizations share a role name (e.g. both have a
    // 'Preventista' role), the SET NULL would orphan both rows to
    // `(NULL, 'Preventista')` — and NULLS NOT DISTINCT treats those as a
    // duplicate → PostgreSQL raises 23505 (P2002) on the second delete.
    //
    // The pre-checks in `organization/roles.service.ts` and
    // `store-roles.service.ts` already block creation of roles with
    // system-role names, so names that legitimately collide here are
    // always between TWO organizations. We delete the org's roles in the
    // same transaction; FK `role_permissions.role_id` is ON DELETE CASCADE
    // (cleaned automatically), and `user_roles.role_id` / `organization_users`
    // / `store_staff` cannot reference these roles because we just verified
    // the org has zero users / stores.
    return this.prisma.$transaction(async (tx) => {
      await tx.roles.deleteMany({ where: { organization_id: id } });
      return tx.organizations.delete({ where: { id } });
    });
  }

  async getDashboardStats() {
    const productionFilter = { mode: 'production' as const };

    const [
      totalOrganizations,
      activeOrganizations,
      inactiveOrganizations,
      suspendedOrganizations,
      demoOrganizations,
      testOrganizations,
      recentOrganizations,
    ] = await Promise.all([
      this.prisma.organizations.count({ where: productionFilter }),
      this.prisma.organizations.count({
        where: { state: 'active', ...productionFilter },
      }),
      this.prisma.organizations.count({
        where: { state: 'inactive', ...productionFilter },
      }),
      this.prisma.organizations.count({
        where: { state: 'suspended', ...productionFilter },
      }),
      this.prisma.organizations.count({ where: { mode: 'demo' } }),
      this.prisma.organizations.count({ where: { mode: 'test' } }),
      this.prisma.organizations.findMany({
        where: productionFilter,
        take: 5,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          created_at: true,
          mode: true,
          _count: {
            select: {
              stores: true,
              users: true,
            },
          },
        },
      }),
    ]);

    return {
      totalOrganizations,
      activeOrganizations,
      inactiveOrganizations,
      suspendedOrganizations,
      demoOrganizations,
      testOrganizations,
      recentOrganizations,
      organizationsByStatus: {
        active: activeOrganizations,
        inactive: inactiveOrganizations,
        suspended: suspendedOrganizations,
      },
    };
  }

  async getDashboard(id: number, query: OrganizationDashboardDto) {
    const { start_date, end_date } = query;

    const organization = await this.findOne(id);

    const dateFilter: Prisma.ordersWhereInput = {};
    if (start_date || end_date) {
      dateFilter.created_at = {};
      if (start_date) dateFilter.created_at.gte = new Date(start_date);
      if (end_date) dateFilter.created_at.lte = new Date(end_date);
    }

    const [
      totalStores,
      activeStores,
      totalUsers,
      activeUsers,
      totalOrders,
      totalRevenue,
      recentOrders,
      topStores,
    ] = await Promise.all([
      this.prisma.stores.count({
        where: { organization_id: id },
      }),
      this.prisma.stores.count({
        where: { organization_id: id, is_active: true },
      }),
      this.prisma.users.count({
        where: { organization_id: id },
      }),
      this.prisma.users.count({
        where: { organization_id: id, state: 'active' },
      }),
      this.prisma.orders.count({
        where: { stores: { organization_id: id }, ...dateFilter },
      }),
      this.prisma.orders.aggregate({
        where: { stores: { organization_id: id }, ...dateFilter },
        _sum: { grand_total: true },
      }),
      this.prisma.orders.findMany({
        where: { stores: { organization_id: id } },
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          stores: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.stores.findMany({
        where: { organization_id: id },
        take: 5,
        orderBy: {
          orders: {
            _count: 'desc',
          },
        },
        include: {
          _count: {
            select: {
              orders: true,
              store_users: true,
              products: true,
            },
          },
        },
      }),
    ]);

    return {
      organization,
      stats: {
        totalStores,
        activeStores,
        totalUsers,
        activeUsers,
        totalOrders,
        totalRevenue: Number(totalRevenue._sum.grand_total) || 0,
      },
      recentOrders,
      topStores,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS — pure functions (no Prisma access) so they are easy to
  // unit-test and do not leak transaction concerns.
  // ---------------------------------------------------------------------------

  /**
   * Project the DTO down to the columns that physically live on
   * `organizations`. Address fields, JSONB aliases, and `settings` are
   * stripped — the caller routes them to `addresses[]` and
   * `organization_settings.settings` respectively.
   */
  private pickRowFields(
    dto: UpdateOrganizationDto,
  ): Prisma.organizationsUpdateInput {
    const result: Prisma.organizationsUpdateInput = {};

    if (dto.name !== undefined) result.name = dto.name;
    if (dto.legal_name !== undefined) result.legal_name = dto.legal_name;
    if (dto.tax_id !== undefined) result.tax_id = dto.tax_id;

    // ---- DIAN fiscal identity ----
    if (dto.document_type !== undefined) result.document_type = dto.document_type;
    if (dto.verification_digit !== undefined) result.verification_digit = dto.verification_digit;
    if (dto.person_type !== undefined) result.person_type = dto.person_type;
    if (dto.tax_regime !== undefined) result.tax_regime = dto.tax_regime;
    if (dto.fiscal_responsibilities !== undefined) {
      result.fiscal_responsibilities = dto.fiscal_responsibilities;
    }
    if (dto.ciiu_code !== undefined) result.ciiu_code = dto.ciiu_code;

    // ---- scopes ----
    if (dto.account_type !== undefined) result.account_type = dto.account_type;
    if (dto.operating_scope !== undefined) result.operating_scope = dto.operating_scope;
    if (dto.fiscal_scope !== undefined) result.fiscal_scope = dto.fiscal_scope;

    // ---- partner ----
    if (dto.is_partner !== undefined) result.is_partner = dto.is_partner;
    if (dto.partner_settings !== undefined) {
      result.partner_settings = dto.partner_settings as Prisma.InputJsonValue;
    }
    if (dto.partner_since !== undefined) result.partner_since = dto.partner_since;

    // ---- fraud ----
    if (dto.fraud_blocked !== undefined) result.fraud_blocked = dto.fraud_blocked;
    if (dto.fraud_blocked_reason !== undefined) {
      result.fraud_blocked_reason = dto.fraud_blocked_reason;
    }

    // ---- onboarding ----
    if (dto.onboarding !== undefined) result.onboarding = dto.onboarding;
    if (dto.has_consumed_trial !== undefined) result.has_consumed_trial = dto.has_consumed_trial;

    // ---- contact ----
    if (dto.email !== undefined) result.email = dto.email;
    if (dto.phone !== undefined) result.phone = dto.phone;
    if (dto.website !== undefined) result.website = dto.website;
    if (dto.logo_url !== undefined) {
      // Per `vendix-s3-storage`: persist S3 keys (never signed URLs), and
      // let external absolute URLs pass through unchanged.
      result.logo_url = this.s3Service.sanitizeForStorage(dto.logo_url);
    }
    if (dto.description !== undefined) result.description = dto.description;
    if (dto.state !== undefined) result.state = dto.state;
    if (dto.mode !== undefined) result.mode = dto.mode;

    return result;
  }

  /**
   * Project the DTO down to the columns of `addresses`. Returns `null` when
   * no address field is present (the caller skips the upsert in that case).
   *
   * `address_line1`, `city`, and `country_code` are NOT NULL on `addresses`;
   * setting them to `null` via PATCH would crash the DB constraint. We treat
   * `null` as "do not touch this field" — only non-null values flow into
   * the payload.
   */
  private pickAddressPayload(
    dto: UpdateOrganizationDto,
  ): Prisma.addressesUncheckedUpdateInput | null {
    const payload: Prisma.addressesUncheckedUpdateInput = {};
    let touched = false;

    if (dto.address_line1 !== undefined && dto.address_line1 !== null) {
      payload.address_line1 = dto.address_line1;
      touched = true;
    }
    if (dto.address_line2 !== undefined && dto.address_line2 !== null) {
      payload.address_line2 = dto.address_line2;
      touched = true;
    }
    if (dto.city !== undefined && dto.city !== null) {
      payload.city = dto.city;
      touched = true;
    }
    if (dto.state_province !== undefined && dto.state_province !== null) {
      payload.state_province = dto.state_province;
      touched = true;
    }
    if (dto.country_code !== undefined && dto.country_code !== null) {
      payload.country_code = dto.country_code;
      touched = true;
    }
    if (dto.municipality_code !== undefined && dto.municipality_code !== null) {
      payload.municipality_code = dto.municipality_code;
      touched = true;
    }
    if (dto.postal_code !== undefined && dto.postal_code !== null) {
      payload.postal_code = dto.postal_code;
      touched = true;
    }
    if (dto.latitude !== undefined) {
      // lat/lng ARE nullable in the schema, so null is a real value here.
      payload.latitude =
        dto.latitude === null ? null : new Prisma.Decimal(dto.latitude);
      touched = true;
    }
    if (dto.longitude !== undefined) {
      payload.longitude =
        dto.longitude === null ? null : new Prisma.Decimal(dto.longitude);
      touched = true;
    }

    return touched ? payload : null;
  }

  /**
   * Project the DTO down to the JSONB keys we own. Returns `null` when
   * none of the JSONB aliases were provided (caller skips the upsert).
   */
  private pickJsonbPayload(
    dto: UpdateOrganizationDto,
  ): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};
    let touched = false;
    for (const key of ORG_JSONB_DTO_KEYS) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) {
        payload[key] = value;
        touched = true;
      }
    }
    return touched ? payload : null;
  }

  /**
   * Merge the new JSONB payload over the existing settings blob, preserving
   * any keys we do not own. Top-level aliases win over any pre-existing
   * values for the same key.
   */
  private mergeJsonbSettings(
    existing: Prisma.JsonValue | null | undefined,
    topLevelPatch: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const base: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(topLevelPatch)) {
      base[key] = value;
    }

    // Touch the constants so the linter does not flag them as unused on
    // tree-shaking. The set is consulted in future iterations when more
    // JSONB aliases need to be filtered out.
    void ORG_JSONB_FIELDS_SET;

    return base as Prisma.InputJsonValue;
  }

  /**
   * Project the raw Prisma row + includes into the normalized
   * `OrganizationDetailContract` shape consumed by the super-admin modal.
   */
  private async normalizeOrganizationDetail(
    organization: any,
  ): Promise<OrganizationDetailContract> {
    const settings =
      organization.organization_settings?.settings &&
      typeof organization.organization_settings.settings === 'object'
        ? (organization.organization_settings.settings as Record<string, unknown>)
        : null;

    // ---- primary address ---------------------------------------------------
    const primaryAddress: OrganizationPrimaryAddressContract | null =
      this.extractPrimaryAddress(organization.addresses);

    // ---- partner ------------------------------------------------------------
    const partner: OrganizationPartnerContract = {
      is_partner: organization.is_partner ?? false,
      partner_settings:
        organization.partner_settings &&
        typeof organization.partner_settings === 'object'
          ? (organization.partner_settings as Record<string, unknown>)
          : null,
      partner_since: organization.partner_since
        ? organization.partner_since.toISOString()
        : null,
    };

    // ---- fraud --------------------------------------------------------------
    const fraud: OrganizationFraudContract = {
      fraud_blocked: organization.fraud_blocked ?? false,
      fraud_blocked_at: organization.fraud_blocked_at
        ? organization.fraud_blocked_at.toISOString()
        : null,
      fraud_blocked_reason: organization.fraud_blocked_reason ?? null,
      chargeback_count: organization.chargeback_count ?? 0,
    };

    // ---- assemble the normalized payload -----------------------------------
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      legal_name: organization.legal_name ?? null,
      tax_id: organization.tax_id ?? null,
      email: organization.email,
      phone: organization.phone ?? null,
      website: organization.website ?? null,
      description: organization.description ?? null,
      // Per `vendix-s3-storage`: the DB stores the S3 key; the browser needs
      // a presigned URL. `signUrl` returns the value unchanged for external
      // URLs and for null/undefined values.
      logo_url: organization.logo_url
        ? ((await this.s3Service.signUrl(organization.logo_url)) ?? null)
        : null,
      state: organization.state,
      mode: organization.mode,
      created_at: organization.created_at ?? null,
      updated_at: organization.updated_at ?? null,

      // ---- DIAN fiscal identity ----
      document_type: organization.document_type ?? null,
      verification_digit: organization.verification_digit ?? null,
      person_type: organization.person_type ?? null,
      tax_regime: organization.tax_regime ?? null,
      fiscal_responsibilities: organization.fiscal_responsibilities ?? [],
      ciiu_code: organization.ciiu_code ?? null,

      // ---- scopes ----
      account_type: organization.account_type,
      operating_scope: organization.operating_scope,
      fiscal_scope: organization.fiscal_scope,

      // ---- partner ----
      is_partner: organization.is_partner ?? false,
      partner_settings: partner.partner_settings,
      partner_since: organization.partner_since ?? null,

      // ---- fraud ----
      fraud_blocked: organization.fraud_blocked ?? false,
      fraud_blocked_at: organization.fraud_blocked_at ?? null,
      fraud_blocked_reason: organization.fraud_blocked_reason ?? null,
      chargeback_count: organization.chargeback_count ?? 0,

      // ---- onboarding ----
      onboarding: organization.onboarding ?? false,
      has_consumed_trial: organization.has_consumed_trial ?? false,
      trial_consumed_at: organization.trial_consumed_at ?? null,

      // ---- platform ----
      is_platform: organization.is_platform ?? false,
      acm_certificate_arn: organization.acm_certificate_arn ?? null,
      acm_cert_revision: organization.acm_cert_revision ?? 0,

      // ---- branding aliases (top-level mirrors from JSONB) ----
      color_primary: (settings?.color_primary as string | undefined) ?? null,
      color_secondary: (settings?.color_secondary as string | undefined) ?? null,
      color_accent: (settings?.color_accent as string | undefined) ?? null,

      // ---- sub-objetos hidratados ----
      primary_address: primaryAddress,
      partner,
      fraud,

      // ---- conteos auxiliares ----
      _count: organization._count
        ? {
            stores: organization._count.stores,
            users: organization._count.users,
            addresses: organization._count.addresses,
            suppliers: organization._count.suppliers,
            employees: organization._count.employees,
          }
        : undefined,
    };
  }

  /**
   * Pick the primary address (first with `is_primary=true`, or the first row
   * if none has the flag, or `null` when the org has no addresses yet).
   */
  private extractPrimaryAddress(
    addresses: any[] | undefined,
  ): OrganizationPrimaryAddressContract | null {
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return null;
    }
    const primary = addresses.find((a) => a.is_primary) ?? addresses[0];
    if (!primary) {
      return null;
    }
    return {
      id: primary.id,
      organization_id: primary.organization_id ?? null,
      address_line1: primary.address_line1,
      address_line2: primary.address_line2 ?? null,
      city: primary.city,
      state_province: primary.state_province ?? null,
      country_code: primary.country_code,
      postal_code: primary.postal_code ?? null,
      municipality_code: primary.municipality_code ?? null,
      phone_number: primary.phone_number ?? null,
      type: primary.type,
      is_primary: Boolean(primary.is_primary),
      latitude: primary.latitude ? String(primary.latitude) : null,
      longitude: primary.longitude ? String(primary.longitude) : null,
    };
  }
}
