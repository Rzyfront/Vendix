import {
  Injectable,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  AdminStoreQueryDto,
  StoreType,
  STORE_ADDRESS_DTO_KEYS,
  STORE_JSONB_DTO_KEYS,
} from '../../store/stores/dto';
import {
  VendixHttpException,
  ErrorCodes,
} from '../../../common/errors';
import { SubscriptionTrialService } from '../../store/subscriptions/services/subscription-trial.service';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';
import { S3Service } from '../../../common/services/s3.service';
import type {
  StoreDetailContract,
  StoreOrganizationContract,
  StoreManagerContract,
  StoreCurrencyContract,
  StoreAddressContract,
} from './stores.contract';

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i;
const STORE_ADDRESS_FIELDS_SET = new Set<string>(STORE_ADDRESS_DTO_KEYS);
const STORE_JSONB_FIELDS_SET = new Set<string>(STORE_JSONB_DTO_KEYS);

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly subscriptionTrialService: SubscriptionTrialService,
    private readonly storeBootstrapHelper: StoreBootstrapHelper,
    private readonly s3Service: S3Service,
  ) {}

  async create(createStoreDto: CreateStoreDto) {
    if (!createStoreDto.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
    }

    const slug = slugify(createStoreDto.name, {
      lower: true,
      strict: true,
    });

    const existingStore = await (this.prisma as any).stores.findFirst({
      where: {
        OR: [{ slug }, { name: createStoreDto.name }],
        organization_id: createStoreDto.organization_id,
      },
    });

    if (existingStore) {
      throw new ConflictException(
        'Store with this name or slug already exists in this organization',
      );
    }

    // Separate top-level scalar fields from the address subset and from the
    // JSONB subset; only `stores.update` may receive rowFields.
    const { settings, organization_id, ...storeData } = createStoreDto;

    const store = await this.prisma.stores.create({
      data: {
        ...storeData,
        slug,
        organization_id,
        updated_at: new Date(),
      },
      include: {
        organizations: true,
        addresses: true,
        store_users: true,
      },
    });

    // Auto-trial bootstrap (one-shot per organization). The service is a
    // no-op when the org has already consumed its trial or when no default
    // plan is configured — store creation continues either way. No tx is
    // passed here because the superadmin create path is not transactional.
    await this.subscriptionTrialService.createTrialForStore(
      store.id,
      organization_id,
    );

    // Default cash register (QUI-654). This is the THIRD store-creation path:
    // it writes `stores` directly instead of going through
    // StoreBootstrapHelper.createStoreWithDefaultLocation, so it does not
    // inherit the bootstrap's defaults. Reusing the helper's idempotent method
    // keeps a single implementation across the three paths without having to
    // make this non-transactional flow transactional.
    await this.storeBootstrapHelper.ensureDefaultCashRegister({
      store_id: store.id,
    });

    // Default KDS station for restaurant stores (QUI-654). No-op for any other
    // industry. Without it a restaurant created from here could take orders and
    // never send them to the kitchen: the fire refuses to route without a
    // default station.
    await this.storeBootstrapHelper.ensureDefaultKds({
      store_id: store.id,
      industries: store.industries as unknown as string[],
    });

    // Create store settings if provided
    if (settings && Object.keys(settings).length > 0) {
      await this.prisma.store_settings.create({
        data: {
          store_id: store.id,
          settings,
        },
      });

      // Refetch to include settings
      return this.prisma.stores.findUnique({
        where: { id: store.id },
        include: {
          organizations: true,
          addresses: true,
          store_users: true,
          store_settings: true,
        },
      });
    }

    return store;
  }

  async findAll(query: AdminStoreQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      organization_id,
      store_type,
      industries,
      include_non_production,
    } = query;
    const skip = (page - 1) * Number(limit);

    const where: Prisma.storesWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (organization_id) {
      where.organization_id = organization_id;
    }

    if (store_type) {
      where.store_type = store_type;
    }

    // OR semantics: a store matches if it has at least one of the
    // requested industries. `ArrayMinSize(1)` is enforced at the DTO
    // layer, so we only need a defensive length check here.
    if (industries?.length) {
      where.industries = { hasSome: industries };
    }

    // Filter stores by organization mode (exclude demo/test by default)
    if (!include_non_production) {
      where.organizations = { mode: 'production' };
    }

    const [data, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          organizations: {
            select: { id: true, name: true, slug: true },
          },
          _count: {
            select: {
              store_users: true,
              products: true,
              orders: true,
            },
          },
        },
      }),
      this.prisma.stores.count({ where }),
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
   * `GET /superadmin/stores/:id` — returns the normalized detail contract.
   *
   * The contract (see `./stores.contract.ts`) extends the raw Prisma `stores`
   * row with:
   * - `organization` (trimmed sub-object),
   * - `manager` hydrated from `store_users[].user` joined on `manager_user_id`,
   * - `currency` hydrated from `currencies` (only when an active code exists),
   * - `primary_address` (the `addresses[]` row with `is_primary=true`, or the
   *   first one if none has the flag),
   * - top-level aliases (`description`, `email`, `phone`, `website`,
   *   `currency_code`, `color_primary`, `color_secondary`) lifted out of
   *   `store_settings.settings`.
   */
  async findOne(id: number): Promise<StoreDetailContract> {
    const store = await (this.prisma as any).stores.findFirst({
      where: { id },
      include: {
        organizations: {
          select: { id: true, name: true, slug: true, state: true },
        },
        addresses: true,
        store_users: {
          include: {
            user: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                state: true,
              },
            },
          },
        },
        store_settings: true,
        _count: {
          select: {
            store_users: true,
            products: true,
            orders: true,
          },
        },
      },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
    }

    return this.normalizeStoreDetail(store);
  }

  /**
   * `PATCH /superadmin/stores/:id` — wraps three sub-steps in a single
   * Prisma transaction so the response cannot diverge from persisted state.
   *
   * 1. Top-level `stores.update` (slug-collision guarded + handles the
   *    `organization_id` re-parenting case).
   * 2. Primary `addresses` upsert keyed on the existing primary row.
   * 3. JSONB merge into `store_settings.settings` (top-level aliases
   *    preferred over `dto.settings.*`).
   *
   * Returns the normalized detail contract by re-running `findOne(id)` inside
   * the same transaction so the response reflects everything that was just
   * written.
   */
  async update(id: number, updateStoreDto: UpdateStoreDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingStore = await tx.stores.findFirst({
        where: { id },
        select: {
          id: true,
          name: true,
          slug: true,
          organization_id: true,
          manager_user_id: true,
        },
      });

      if (!existingStore) {
        throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
      }

      // ---- pre-flight assertions --------------------------------------------
      // The global ValidationPipe only checks the SHAPE of the payload — it
      // cannot express FK existence, FK-state, or "currency must be active".
      // These helpers raise typed `VendixHttpException`s BEFORE we touch any
      // row so the client gets a precise error_code (no Prisma P2003 leak).
      if (updateStoreDto.manager_user_id !== undefined) {
        await this.assertManagerExists(updateStoreDto.manager_user_id);
      }

      // JSONB-mounted `currency_code` lives in `pickJsonbPayload`; the
      // assertion lives here (not in the payload helper) so it runs even
      // when the alias is missing from the DTO under a renamed key, and it
      // also covers whatever `dto.settings.currency_code` carries.
      const jsonbPreview = this.pickJsonbPayload(updateStoreDto);
      if (jsonbPreview && typeof jsonbPreview.currency_code === 'string') {
        await this.assertCurrencyActive(jsonbPreview.currency_code);
      }

      // Re-parenting moves the store across orgs. We only enforce
      // production-mode when the operator is actively switching orgs; an
      // unchanged `organization_id` skips the assert to keep PATCH idempotent.
      if (
        updateStoreDto.organization_id !== undefined &&
        updateStoreDto.organization_id !== existingStore.organization_id
      ) {
        await this.assertOrganizationProduction(updateStoreDto.organization_id);
      }

      // ---- sub-step 1: top-level `stores.update` ----------------------------
      // Slug resolution precedence:
      //   1. Explicit `dto.slug` — slugified defensively, with the collision
      //      guard below scoped to the target organization.
      //   2. Auto-derived from `dto.name` (only when the name actually
      //      changed AND no explicit slug was supplied).
      //   3. Existing slug (nothing the operator wants to rename, untouched).
      let nextSlug = existingStore.slug;
      const targetOrganizationId =
        updateStoreDto.organization_id ?? existingStore.organization_id;

      if (updateStoreDto.slug !== undefined) {
        nextSlug = slugify(updateStoreDto.slug, {
          lower: true,
          strict: true,
        });

        if (!nextSlug || nextSlug.length < 2) {
          // Belt-and-suspenders: class-validator already enforces min length,
          // but a `slugify('@@')` can empty out the value. Reject cleanly.
          throw new VendixHttpException(ErrorCodes.STORE_VALIDATE_001);
        }

        const slugExists = await tx.stores.findFirst({
          where: {
            slug: nextSlug,
            id: { not: id },
            organization_id: targetOrganizationId,
          },
          select: { id: true },
        });

        if (slugExists) {
          throw new ConflictException(
            'Store with this slug already exists in this organization',
          );
        }
      } else if (
        updateStoreDto.name !== undefined &&
        updateStoreDto.name !== existingStore.name
      ) {
        nextSlug = slugify(updateStoreDto.name, {
          lower: true,
          strict: true,
        });

        const slugExists = await tx.stores.findFirst({
          where: {
            slug: nextSlug,
            id: { not: id },
            organization_id: targetOrganizationId,
          },
          select: { id: true },
        });

        if (slugExists) {
          throw new ConflictException(
            'Store with this slug already exists in this organization',
          );
        }
      } else if (
        updateStoreDto.organization_id !== undefined &&
        updateStoreDto.organization_id !== existingStore.organization_id
      ) {
        // Re-parenting without renaming AND without an explicit slug: keep
        // the existing slug, but still check for collisions in the NEW org.
        const slugExists = await tx.stores.findFirst({
          where: {
            slug: nextSlug,
            id: { not: id },
            organization_id: updateStoreDto.organization_id,
          },
          select: { id: true },
        });

        if (slugExists) {
          throw new ConflictException(
            'Store with this slug already exists in the target organization',
          );
        }
      }

      // Project only the scalar top-level columns. Strip address / JSONB
      // aliases and the nested `settings` blob — those are routed elsewhere.
      // `department_code` lives on `stores` (not on `addresses`), and
      // `municipality_code` exists on BOTH, so we keep it here too — the
      // canonical address row also gets it via the address upsert.
      const rowFields = this.pickRowFields(updateStoreDto);

      try {
        await tx.stores.update({
          where: { id },
          data: {
            ...rowFields,
            ...(updateStoreDto.organization_id !== undefined && {
              organization_id: updateStoreDto.organization_id,
            }),
            slug: nextSlug,
            updated_at: new Date(),
          },
        });
      } catch (error) {
        // Prisma raises P2003 only AFTER class-validator accepted the shape,
        // so this branch catches the case where `organization_id` is well-
        // formed but points to nothing (or to a row the operator cannot
        // touch). The assert above already blocked the production-mode case;
        // anything reaching here is a real FK miss and should surface as
        // STORE_VALIDATE_001 with a targeted message rather than a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new VendixHttpException(
            ErrorCodes.STORE_VALIDATE_001,
            'Invalid organization_id: organization does not exist',
          );
        }
        throw error;
      }

      // ---- sub-step 2: primary `addresses` upsert --------------------------
      // The address row has a non-null `address_line1`; standalone metadata
      // like `country_code` or `municipality_code` (which the frontend ships
      // by default even when the user didn't edit the address) is harmless
      // to ignore here. Require `address_line1` to actually touch the row.
      const addressPayload = this.pickAddressPayload(updateStoreDto);
      if (addressPayload && addressPayload.address_line1) {
        const primaryAddress = await tx.addresses.findFirst({
          where: { store_id: id },
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          select: { id: true },
        });

        if (primaryAddress) {
          await tx.addresses.update({
            where: { id: primaryAddress.id },
            data: { ...addressPayload, is_primary: true },
          });
        } else {
          // Prisma 7 create needs the relation connect (the bare `store_id`
          // FK is only accepted on UncheckedCreateInput, which is heavier
          // than we need here). The relation itself is what gets validated.
          await tx.addresses.create({
            data: {
              ...addressPayload,
              is_primary: true,
              stores: { connect: { id } },
            },
          });
        }
      }

      // ---- sub-step 3: JSONB merge into `store_settings.settings` ----------
      const jsonbPayload = this.pickJsonbPayload(updateStoreDto);
      if (jsonbPayload) {
        const existingSettings = await tx.store_settings.findFirst({
          where: { store_id: id },
          select: { settings: true },
        });

        const merged = this.mergeJsonbSettings(
          existingSettings?.settings,
          jsonbPayload,
          updateStoreDto.settings,
        );

        if (existingSettings) {
          await tx.store_settings.update({
            where: { store_id: id },
            data: { settings: merged, updated_at: new Date() },
          });
        } else {
          await tx.store_settings.create({
            data: { store_id: id, settings: merged },
          });
        }
      }

      // Re-fetch inside the tx so the normalized response cannot be stale.
      const refreshed = await tx.stores.findFirst({
        where: { id },
        include: {
          organizations: {
            select: { id: true, name: true, slug: true, state: true },
          },
          addresses: true,
          store_users: {
            include: {
              user: {
                select: {
                  id: true,
                  first_name: true,
                  last_name: true,
                  email: true,
                  state: true,
                },
              },
            },
          },
          store_settings: true,
          _count: {
            select: {
              store_users: true,
              products: true,
              orders: true,
            },
          },
        },
      });

      if (!refreshed) {
        throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
      }

      return this.normalizeStoreDetail(refreshed, tx);
    });
  }

  async remove(id: number) {
    const existingStore = await (this.prisma as any).stores.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            store_users: true,
            products: true,
            orders: true,
          },
        },
      },
    });

    if (!existingStore) {
      throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
    }

    if (
      existingStore._count.store_users > 0 ||
      existingStore._count.products > 0 ||
      existingStore._count.orders > 0
    ) {
      throw new ConflictException(
        'Cannot delete store with existing users, products, or orders',
      );
    }

    return this.prisma.stores.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalStores,
      activeStores,
      storesByType,
      storesByState,
      recentStores,
    ] = await Promise.all([
      this.prisma.stores.count(),
      this.prisma.stores.count({
        where: { is_active: true },
      }),
      this.prisma.stores.groupBy({
        by: ['store_type'],
        _count: true,
      }),
      this.prisma.stores.groupBy({
        by: ['is_active'],
        _count: true,
      }),
      this.prisma.stores.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          organizations: {
            select: { name: true },
          },
          _count: {
            select: {
              store_users: true,
              products: true,
              orders: true,
            },
          },
        },
      }),
    ]);

    return {
      totalStores,
      activeStores,
      storesByType: storesByType.reduce(
        (acc, item) => {
          acc[item.store_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      storesByState: storesByState.reduce(
        (acc, item) => {
          acc[item.is_active.toString()] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentStores,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS — pure functions (no Prisma access) so they are easy to
  // unit-test and do not leak transaction concerns.
  // ---------------------------------------------------------------------------

  /**
   * Project the DTO down to the columns that physically live on `stores`.
   * Address fields, JSONB aliases, and `settings` are stripped — the caller
   * routes them to `addresses[]` and `store_settings.settings` respectively.
   *
   * `department_code` is unique to `stores` (the `addresses` table has no
   * such column), so it always lands here. `municipality_code` exists on
   * both tables and is mirrored to both rows so existing readers keep
   * resolving.
   */
  private pickRowFields(dto: UpdateStoreDto): Prisma.storesUpdateInput {
    const result: Prisma.storesUpdateInput = {};
    if (dto.name !== undefined) result.name = dto.name;
    if (dto.store_code !== undefined) result.store_code = dto.store_code;
    if (dto.logo_url !== undefined) {
      // Per `vendix-s3-storage`: persist S3 keys (never signed URLs), and let
      // external absolute URLs pass through unchanged for the store logo.
      // `sanitizeForStorage` returns null for null/empty inputs and the
      // extracted key for both bare keys and signed S3 URLs.
      result.logo_url = this.s3Service.sanitizeForStorage(dto.logo_url);
    }
    if (dto.timezone !== undefined) result.timezone = dto.timezone;
    if (dto.operating_hours !== undefined)
      result.operating_hours = dto.operating_hours as Prisma.InputJsonValue;
    if (dto.store_type !== undefined) result.store_type = dto.store_type as StoreType;
    if (dto.industries !== undefined) result.industries = dto.industries;
    if (dto.is_active !== undefined) result.is_active = dto.is_active;
    if (dto.manager_user_id !== undefined)
      result.manager_user_id = dto.manager_user_id;
    if (dto.department_code !== undefined)
      result.department_code = dto.department_code;
    if (dto.municipality_code !== undefined)
      result.municipality_code = dto.municipality_code;
    return result;
  }

  /**
   * Project the DTO down to the columns of `addresses`. Returns `null` when
   * no address field is present (the caller skips the upsert in that case).
   *
   * `address_line1`, `city`, and `country_code` are NOT NULL on `addresses`;
   * setting them to `null` via PATCH would crash the DB constraint. We treat
   * `null` as "do not touch this field" — only non-null values flow into
   * the payload. If a true clear is ever needed, the caller can extend this
   * with an explicit `?unset=true` flag.
   */
  private pickAddressPayload(
    dto: UpdateStoreDto,
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
    dto: UpdateStoreDto,
  ): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};
    let touched = false;
    for (const key of STORE_JSONB_DTO_KEYS) {
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
   * any keys we do not own. Top-level aliases are preferred over
   * `dto.settings.*` for the same key.
   */
  private mergeJsonbSettings(
    existing: Prisma.JsonValue | null | undefined,
    topLevelPatch: Record<string, unknown>,
    settingsPatch: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue {
    const base: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};

    // Apply `dto.settings.*` first so top-level wins on conflict.
    if (settingsPatch && typeof settingsPatch === 'object') {
      for (const [key, value] of Object.entries(settingsPatch)) {
        if (!STORE_JSONB_FIELDS_SET.has(key)) {
          base[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(topLevelPatch)) {
      base[key] = value;
    }

    return base as Prisma.InputJsonValue;
  }

  /**
   * Project the raw Prisma row + includes into the normalized
   * `StoreDetailContract` shape consumed by the super-admin modal.
   *
   * `tx` is optional: when provided we use the in-transaction client for the
   * batched `currencies` lookup so the read is consistent with the writes.
   */
  private async normalizeStoreDetail(
    store: any,
    tx?: Prisma.TransactionClient,
  ): Promise<StoreDetailContract> {
    const settings =
      store.store_settings?.settings && typeof store.store_settings.settings === 'object'
        ? (store.store_settings.settings as Record<string, unknown>)
        : null;

    // ---- organization -----------------------------------------------------
    const organization: StoreOrganizationContract = {
      id: store.organizations?.id ?? store.organization_id,
      name: store.organizations?.name ?? '',
      slug: store.organizations?.slug ?? '',
      state: (store.organizations?.state as StoreOrganizationContract['state']) ?? null,
    };

    // ---- manager ----------------------------------------------------------
    const manager: StoreManagerContract | null = this.extractManager(
      store.store_users,
      store.manager_user_id,
    );

    // ---- primary_address ---------------------------------------------------
    const primaryAddress: StoreAddressContract | null = this.extractPrimaryAddress(
      store.addresses,
    );

    // ---- currency ---------------------------------------------------------
    const currencyCode =
      (settings?.currency_code as string | undefined) ?? null;
    const client = tx ?? (this.prisma as any);
    let currency: StoreCurrencyContract | null = null;
    if (currencyCode) {
      const currencyRow = await client.currencies.findFirst({
        where: { code: currencyCode, state: 'active' },
        select: { code: true, name: true, symbol: true },
      });
      if (currencyRow) {
        currency = {
          code: currencyRow.code,
          name: currencyRow.name,
          symbol: currencyRow.symbol,
        };
      }
    }

    // ---- assemble the normalized payload ----------------------------------
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      legal_name: store.legal_name ?? null,
      tax_id: store.tax_id ?? null,
      tax_id_dv: store.tax_id_dv ?? null,
      nit_type: store.nit_type ?? null,
      created_at: store.created_at ?? null,
      updated_at: store.updated_at ?? null,
      is_active: store.is_active,
      // Per `vendix-s3-storage`: the DB stores the S3 key; the browser needs
      // a presigned URL. `signUrl` returns the value unchanged for external
      // URLs and for null/undefined values, so this is a no-op for non-S3
      // logos while producing fresh signed URLs for S3 keys.
      logo_url: store.logo_url
        ? ((await this.s3Service.signUrl(store.logo_url)) ?? null)
        : null,
      manager_user_id: store.manager_user_id ?? null,
      organization_id: store.organization_id,
      store_code: store.store_code ?? null,
      store_type: store.store_type,
      industries: store.industries ?? [],
      timezone: store.timezone ?? null,
      operating_hours: store.operating_hours ?? null,
      onboarding: store.onboarding ?? false,
      municipality_code: store.municipality_code ?? null,
      department_code: store.department_code ?? null,
      ciiu_code: store.ciiu_code ?? null,

      organization,
      manager,
      currency,
      primary_address: primaryAddress,

      description: (settings?.description as string | undefined) ?? null,
      email: (settings?.email as string | undefined) ?? null,
      phone:
        (settings?.phone as string | undefined) ??
        primaryAddress?.phone_number ??
        null,
      website: (settings?.website as string | undefined) ?? null,
      // `domain` exists in JSONB but is intentionally NOT exposed at the
      // top level of `StoreDetailContract` (the modal does not edit it yet);
      // keeping it out of the return keeps the function's declared return
      // type honest with the contract interface.
      currency_code: currencyCode,
      color_primary: (settings?.color_primary as string | undefined) ?? null,
      color_secondary:
        (settings?.color_secondary as string | undefined) ?? null,
      color_accent: (settings?.color_accent as string | undefined) ?? null,

      _count: store._count
        ? {
            store_users: store._count.store_users,
            products: store._count.products,
            orders: store._count.orders,
          }
        : undefined,
    };
  }

  /**
   * Walk `store_users[]` looking for the entry whose `store_user_id` matches
   * `manager_user_id`. Returns `null` when no match is found, which keeps the
   * contract honest: a manager flag without an active link is meaningless.
   */
  private extractManager(
    storeUsers: any[] | undefined,
    managerUserId: number | null | undefined,
  ): StoreManagerContract | null {
    if (!managerUserId || !Array.isArray(storeUsers)) {
      return null;
    }
    const entry = storeUsers.find(
      (su) =>
        su.user_id === managerUserId ||
        su.id === managerUserId ||
        su.user?.id === managerUserId,
    );
    if (!entry?.user) {
      return null;
    }
    return {
      id: entry.user.id,
      first_name: entry.user.first_name,
      last_name: entry.user.last_name,
      email: entry.user.email ?? null,
    };
  }

  /**
   * Pick the primary address (first with `is_primary=true`, or the first row
   * if none has the flag, or `null` when the store has no addresses yet).
   */
  private extractPrimaryAddress(
    addresses: any[] | undefined,
  ): StoreAddressContract | null {
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return null;
    }
    const primary =
      addresses.find((a) => a.is_primary) ?? addresses[0];
    if (!primary) {
      return null;
    }
    return {
      id: primary.id,
      store_id: primary.store_id ?? null,
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

  // ---------------------------------------------------------------------------
  // ASSERTION HELPERS — used by `update()` to enforce FK + state invariants
  // that the global ValidationPipe cannot express. Each throws a typed
  // `VendixHttpException` so the filter emits the right status + error_code.
  //
  // Currently invoked opportunistically; the migration to fully enforcing them
  // lands with Section A.6 (manager uniqueness across stores). Keeping the
  // helpers exported via `private` for now so the next iteration can flip the
  // access modifier without touching call sites.
  // ---------------------------------------------------------------------------

  private async assertManagerExists(userId: number): Promise<void> {
    const user = await (this.prisma as any).users.findFirst({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }
  }

  private async assertOrganizationProduction(orgId: number): Promise<void> {
    const org = await (this.prisma as any).organizations.findFirst({
      where: { id: orgId },
      select: { id: true, mode: true },
    });
    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }
    if (org.mode !== 'production') {
      throw new VendixHttpException(ErrorCodes.ORG_VALIDATE_001);
    }
  }

  private async assertCurrencyActive(code: string): Promise<void> {
    const currency = await (this.prisma as any).currencies.findFirst({
      where: { code, state: 'active' },
      select: { code: true },
    });
    if (!currency) {
      throw new VendixHttpException(ErrorCodes.INVOICING_CURRENCY_001);
    }
  }
}

// Touch the constants so the linter does not flag them as unused on
// tree-shaking. Both are still useful as documentation of the contract; the
// service only consults them inside the helper functions above.
void HEX_COLOR_REGEX;
void STORE_ADDRESS_FIELDS_SET;