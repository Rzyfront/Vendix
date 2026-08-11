import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  stores,
  inventory_locations,
  addresses,
  cash_registers,
  kds,
} from '@prisma/client';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { VendixHttpException, ErrorCodes } from '../errors';

/**
 * Input shape for bootstrapping a store with its default inventory location.
 *
 * - `organization_id` is required and must match the caller's context (the caller
 *   is responsible for authorization / context validation).
 * - `store_data` carries the minimum persisted fields for the `stores` row.
 *   It purposefully avoids depending on CreateStoreDto / SetupStoreWizardDto
 *   so the helper stays reusable from both the stores service and the
 *   onboarding wizard without forcing a shared DTO.
 * - `address_data` is optional — when provided, an `addresses` row is created
 *   first and linked to both the store (via `store_id`) and the inventory
 *   location (via `address_id`).
 * - `location_overrides.code` / `location_overrides.name` let the caller
 *   customise the default location identifiers; otherwise defaults are
 *   derived from the store (see `buildDefaultLocationCode`).
 */
export interface StoreBootstrapInput {
  organization_id: number;
  store_data: {
    name: string;
    slug: string;
    store_type?: Prisma.storesCreateInput['store_type'];
    timezone?: string | null;
    manager_user_id?: number | null;
    store_code?: string | null;
    logo_url?: string | null;
    onboarding?: boolean;
    is_active?: boolean;
    /**
     * Store industries (multi-select). Persisted verbatim to
     * `stores.industries` (Prisma serializes the array to a Postgres
     * `industry_enum[]`). Validation (array + non-empty + each-is-enum) is
     * the caller's responsibility — this helper accepts whatever array
     * the caller passes and trusts it has been validated upstream
     * (the wizard DTO enforces `@ArrayMinSize(1)` + `@IsEnum`).
     */
    industries?: Prisma.storesCreateInput['industries'];
  };
  address_data?: {
    address_line1: string;
    address_line2?: string | null;
    city: string;
    state_province?: string | null;
    postal_code?: string | null;
    country_code: string;
    phone_number?: string | null;
    type?: Prisma.addressesCreateInput['type'];
    is_primary?: boolean;
    latitude?: Prisma.Decimal | number | null;
    longitude?: Prisma.Decimal | number | null;
  };
  location_overrides?: {
    name?: string;
    code?: string;
  };
  /**
   * Optional identifiers for the default cash register. Defaults to
   * `Caja principal` / `PRINCIPAL` (see `DEFAULT_CASH_REGISTER`).
   */
  cash_register_overrides?: {
    name?: string;
    code?: string;
  };
  /**
   * Optional identifiers for the default KDS station. Only consulted when the
   * store's industries include `restaurant`. Defaults to `Cocina` / `COCINA`.
   */
  kds_overrides?: {
    name?: string;
    code?: string;
  };
}

export interface StoreBootstrapResult {
  store: stores;
  default_location: inventory_locations;
  address: addresses | null;
  /**
   * The store's default cash register. Always present for stores created
   * through this helper — a store must be able to charge without any prior
   * configuration (QUI-654).
   */
  default_cash_register: cash_registers;
  /**
   * The store's default KDS station, or `null` when the store's industries do
   * not include `restaurant` — a retail store has nothing to cook.
   */
  default_kds: kds | null;
}

/**
 * Identifiers of the cash register every store is born with. Kept as a
 * module constant so the bootstrap path, the superadmin path and the backfill
 * migration all agree on the same `code` — the backfill relies on it to stay
 * idempotent against `@@unique([store_id, code])`.
 */
export const DEFAULT_CASH_REGISTER = {
  name: 'Caja principal',
  code: 'PRINCIPAL',
  description:
    'Caja creada automaticamente para que la tienda pueda cobrar sin configuracion previa.',
} as const;

/**
 * Identifiers of the KDS station every restaurant store is born with.
 *
 * `code` MUST match the backfill in
 * `prisma/migrations/20260809050000_kds_stations_and_sessions/migration.sql`:
 * the unique `(store_id, code)` is what makes the migration (existing stores)
 * and this bootstrap (new stores) converge on one row instead of two.
 */
export const DEFAULT_KDS = {
  name: 'Cocina',
  code: 'COCINA',
  description:
    'Estacion creada automaticamente para que la tienda tenga tablero sin configurar nada.',
} as const;

/**
 * Industry that makes a store need a kitchen display. Kept next to the default
 * so the gate and the identifiers travel together.
 */
const KDS_INDUSTRY = 'restaurant';

/**
 * StoreBootstrapHelper
 *
 * Atomically creates a `stores` row together with its default
 * `inventory_locations` row (and optionally an `addresses` row), and wires
 * `stores.default_location_id` to the freshly-created location.
 *
 * Why this exists
 * ---------------
 * Both `StoresService.create()` and `OnboardingWizardService.setupStore()`
 * need to produce a store + default location. Before this helper, the
 * onboarding path created the location inside a `try/catch` that silently
 * swallowed failures, and the stores service did not create the location
 * at all — leaving stores with `default_location_id = NULL` and later
 * breaking sale / inventory flows.
 *
 * The helper enforces:
 *  - One single transaction — any failure rolls the whole thing back.
 *  - No try/catch swallowing. Callers get a typed `VendixHttpException`
 *    and can decide what to do.
 *  - Guaranteed `default_location_id` set on the store.
 *  - Deterministic, collision-safe `inventory_locations.code`.
 *
 * Collision strategy for `code`
 * -----------------------------
 * `inventory_locations` has `@@unique([store_id, code])`. Since we are
 * creating the store row in the same transaction, `store_id` is new and
 * unique, so `STORE-{slug}` will not collide by construction. We still
 * check for a P2002 (`store_id+code`) at create time and fall back to a
 * timestamped suffix to stay robust against unexpected race conditions
 * or caller-supplied overrides that reuse a code from another bootstrap
 * call sharing the same store id (shouldn't happen, but cheap insurance).
 *
 * Transaction handling
 * --------------------
 * The main method accepts an optional `tx` — when the caller is already
 * inside a `$transaction`, the helper reuses it; otherwise the helper
 * opens its own. This keeps the helper composable with services that
 * already orchestrate multi-table work (e.g. the onboarding wizard's
 * setupStore may evolve to also create the user/org in a single tx).
 *
 * Responsibilities
 * ----------------
 * This helper does NOT:
 *  - Validate permissions (that is the service's / guard's job).
 *  - Create domain_settings rows (see StoresService.createStoreDomain).
 *  - Seed store_settings (kept in the calling service to preserve the
 *    existing settings composition logic per flow).
 *
 * This helper DOES:
 *  - Persist the `stores`, optional `addresses` and `inventory_locations`
 *    rows atomically, and attach `default_location_id` back on the store.
 */
@Injectable()
export class StoreBootstrapHelper {
  private readonly logger = new Logger(StoreBootstrapHelper.name);

  constructor(private readonly prisma: OrganizationPrismaService) {}

  /**
   * Create a store together with its default location (and optional address)
   * in a single atomic transaction.
   *
   * @param input   Bootstrap payload.
   * @param tx      Optional existing TransactionClient — when provided the
   *                helper runs inside it; otherwise a new transaction is
   *                opened on the Organization-scoped client.
   * @throws VendixHttpException with an ORG_* / INV_* / SYS_* code on
   *         unrecoverable failures (validation, duplicate slug, etc.).
   */
  async createStoreWithDefaultLocation(
    input: StoreBootstrapInput,
    tx?: Prisma.TransactionClient,
  ): Promise<StoreBootstrapResult> {
    this.validateInput(input);

    const exec = (client: Prisma.TransactionClient) =>
      this.executeBootstrap(client, input);

    if (tx) {
      return exec(tx);
    }

    // NOTE: OrganizationPrismaService extends BasePrismaService which
    // delegates $transaction to the underlying PrismaClient. The scope
    // interceptor (Prisma Client Extension) is NOT re-applied to the
    // raw TransactionClient passed to the callback, so inside the
    // transaction we rely on explicit `organization_id` and `store_id`
    // fields — which this helper always sets.
    return (this.prisma as any).$transaction(exec);
  }

  /**
   * Ensure the store owns at least one cash register, creating the default one
   * when it owns none. Idempotent by design: re-running it never produces a
   * second register.
   *
   * Why this is public and takes an explicit `store_id`
   * ---------------------------------------------------
   * There are THREE store-creation paths, not two. The organization service
   * and the onboarding wizard both funnel through
   * `createStoreWithDefaultLocation`, but `SuperadminStoresService.create`
   * writes `stores` directly and is **not** transactional. Rather than
   * refactor that path's transaction model (out of scope), it calls this same
   * method after its store row exists. One implementation, three call sites.
   *
   * Idempotency contract
   * --------------------
   * The guard is "does this store have ANY cash register", not "does it have
   * one with code PRINCIPAL". A store where the operator already created
   * `CAJA-1` must not also get a `PRINCIPAL` it never asked for.
   *
   * `location_id` is deliberately left NULL: the POS resolves its sale
   * location from `stores.default_location_id`, and pinning the register to a
   * location here would override that cascade for every new store.
   *
   * Why it opens its own transaction when none is passed
   * ---------------------------------------------------
   * The scoped services each expose an explicit allow-list of models, and
   * `cash_registers` is not on `GlobalPrismaService`'s. `$transaction`
   * delegates to the raw `baseClient`, so the callback client carries EVERY
   * model — at the cost of losing the tenant filter, which is why every write
   * below names `store_id` explicitly.
   */
  async ensureDefaultCashRegister(
    params: {
      store_id: number;
      name?: string;
      code?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<cash_registers> {
    if (!tx) {
      return (this.prisma as any).$transaction((t: Prisma.TransactionClient) =>
        this.ensureDefaultCashRegister(params, t),
      );
    }
    const client = tx;

    const existing = await client.cash_registers.findFirst({
      where: { store_id: params.store_id },
      orderBy: { id: 'asc' },
    });
    if (existing) return existing;

    const now = new Date();
    try {
      return await client.cash_registers.create({
        data: {
          store_id: params.store_id,
          name: params.name ?? DEFAULT_CASH_REGISTER.name,
          code: params.code ?? DEFAULT_CASH_REGISTER.code,
          description: DEFAULT_CASH_REGISTER.description,
          is_active: true,
          location_id: null,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (e: any) {
      // P2002 on (store_id, code) means a concurrent caller won the race.
      // Read theirs instead of failing the whole bootstrap over a register
      // that now exists anyway.
      if (e?.code === 'P2002') {
        const raced = await client.cash_registers.findFirst({
          where: { store_id: params.store_id },
          orderBy: { id: 'asc' },
        });
        if (raced) return raced;
      }
      throw e;
    }
  }

  /**
   * Ensure a restaurant store owns at least one KDS station, creating the
   * default one when it owns none. Idempotent, same contract as
   * `ensureDefaultCashRegister`.
   *
   * Returns `null` for stores that do not need a station — that is a valid
   * outcome, not a failure: a retail store has nothing to cook, and creating an
   * empty board for it would put a dead module in its panel.
   *
   * Why `is_default: true` matters beyond convenience
   * -------------------------------------------------
   * `fireOrderItemsInTx` resolves each item's destination station through
   * `products.kds_id ?? <default station>`, and fails loudly with
   * KITCHEN_FIRE_NO_DEFAULT_KDS when there is no default. So this row is not a
   * nicety: without it a restaurant store cannot send anything to the kitchen.
   *
   * The DB carries a partial unique index (`kds_one_default_per_store`,
   * `WHERE is_default`), so a concurrent caller cannot produce a second default.
   */
  async ensureDefaultKds(
    params: {
      store_id: number;
      industries?: readonly string[] | null;
      name?: string;
      code?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<kds | null> {
    const industries = (params.industries ?? []) as string[];
    if (!industries.includes(KDS_INDUSTRY)) return null;

    if (!tx) {
      return (this.prisma as any).$transaction((t: Prisma.TransactionClient) =>
        this.ensureDefaultKds(params, t),
      );
    }
    const client = tx;

    // Guard is "does this store have ANY station", mirroring the cash register:
    // a restaurant that already configured BARRA must not also get a COCINA it
    // never asked for.
    const existing = await client.kds.findFirst({
      where: { store_id: params.store_id },
      orderBy: { id: 'asc' },
    });
    if (existing) return existing;

    const now = new Date();
    try {
      return await client.kds.create({
        data: {
          store_id: params.store_id,
          name: params.name ?? DEFAULT_KDS.name,
          code: params.code ?? DEFAULT_KDS.code,
          description: DEFAULT_KDS.description,
          is_active: true,
          is_default: true,
          location_id: null,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (e: any) {
      // P2002 covers both unique indexes here: (store_id, code) and the partial
      // one-default-per-store. Either way a station now exists — read the
      // winner instead of failing the bootstrap over it.
      if (e?.code === 'P2002') {
        const raced = await client.kds.findFirst({
          where: { store_id: params.store_id },
          orderBy: { id: 'asc' },
        });
        if (raced) return raced;
      }
      throw e;
    }
  }

  private validateInput(input: StoreBootstrapInput): void {
    if (!input?.organization_id || input.organization_id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.ORG_CONTEXT_001,
        'organization_id is required to bootstrap a store',
      );
    }
    if (!input.store_data?.name?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.STORE_VALIDATE_001,
        'store_data.name is required',
      );
    }
    if (!input.store_data?.slug?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.STORE_VALIDATE_001,
        'store_data.slug is required',
      );
    }
  }

  /**
   * Derive the default location code from the store slug.
   * Replicates the existing onboarding format: `STORE-{slug}`.
   *
   * We normalise to upper-case to keep codes visually stable across the
   * codebase (`store_code` on stores is also upper in most seeds) and
   * to match the `STORE-` literal prefix the onboarding wizard uses.
   */
  private buildDefaultLocationCode(slug: string): string {
    return `STORE-${slug}`.toUpperCase();
  }

  /**
   * Internal orchestration that runs inside a Prisma transaction.
   */
  private async executeBootstrap(
    client: Prisma.TransactionClient,
    input: StoreBootstrapInput,
  ): Promise<StoreBootstrapResult> {
    const now = new Date();

    // 1) Optional address — created first so the store/location rows can
    //    link to it via address_id.
    let address: addresses | null = null;
    if (input.address_data) {
      address = await client.addresses.create({
        data: {
          address_line1: input.address_data.address_line1,
          address_line2: input.address_data.address_line2 ?? null,
          city: input.address_data.city,
          state_province: input.address_data.state_province ?? null,
          postal_code: input.address_data.postal_code ?? null,
          country_code: input.address_data.country_code,
          phone_number: input.address_data.phone_number ?? null,
          type: input.address_data.type ?? 'store_physical',
          is_primary: input.address_data.is_primary ?? true,
          latitude: input.address_data.latitude as any,
          longitude: input.address_data.longitude as any,
          organization_id: input.organization_id,
        },
      });
    }

    // 2) Store row. We connect the organization via relation rather than
    //    relying on a bare `organization_id` FK to match the existing
    //    StoresService.create() style, and because the scope extension
    //    is bypassed in raw transactions.
    let store: stores;
    try {
      store = await client.stores.create({
        data: {
          name: input.store_data.name,
          slug: input.store_data.slug,
          store_type: input.store_data.store_type ?? 'physical',
          timezone: input.store_data.timezone ?? null,
          manager_user_id: input.store_data.manager_user_id ?? null,
          store_code: input.store_data.store_code ?? null,
          logo_url: input.store_data.logo_url ?? null,
          industries: input.store_data.industries ?? ['retail'],
          onboarding: input.store_data.onboarding ?? false,
          is_active: input.store_data.is_active ?? true,
          created_at: now,
          updated_at: now,
          organizations: { connect: { id: input.organization_id } },
          ...(address && { addresses: { connect: { id: address.id } } }),
        },
      });
    } catch (e: any) {
      // Unique constraint on (organization_id, slug).
      if (e?.code === 'P2002') {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Store slug already exists in this organization',
        );
      }
      throw e;
    }

    // 3) Default inventory_location. `store_id` is brand-new so the
    //    (store_id, code) unique constraint cannot collide within this
    //    organization — but we still handle P2002 defensively.
    const baseCode =
      input.location_overrides?.code ??
      this.buildDefaultLocationCode(store.slug);
    const locationName = input.location_overrides?.name ?? store.name;

    let default_location: inventory_locations;
    try {
      default_location = await client.inventory_locations.create({
        data: {
          organization_id: input.organization_id,
          store_id: store.id,
          name: locationName,
          code: baseCode,
          type: 'store',
          is_active: true,
          is_default: true,
          address_id: address?.id ?? null,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Extremely unlikely (same store_id + same code within one tx)
        // — add a timestamp suffix and retry once. Not a loop on purpose:
        // if this second insert still collides something is seriously
        // wrong and we want the transaction to abort.
        const fallbackCode = `${baseCode}-${Date.now()}`;
        this.logger.warn(
          `inventory_locations code collision for store_id=${store.id} code=${baseCode}; retrying with ${fallbackCode}`,
        );
        default_location = await client.inventory_locations.create({
          data: {
            organization_id: input.organization_id,
            store_id: store.id,
            name: locationName,
            code: fallbackCode,
            type: 'store',
            is_active: true,
            is_default: true,
            address_id: address?.id ?? null,
            created_at: now,
            updated_at: now,
          },
        });
      } else {
        throw e;
      }
    }

    // 4) Wire default_location_id back on the store. This is the
    //    denormalised pointer consumed by resolveSaleLocation and the
    //    inventory scope logic in later phases.
    const storeWithDefault = await client.stores.update({
      where: { id: store.id },
      data: {
        default_location_id: default_location.id,
        updated_at: new Date(),
      },
    });

    // 5) Default cash register. A store that cannot charge is not operable,
    //    and until QUI-654 nothing in either creation path created one — the
    //    first cashier hit an empty register list and had to configure it
    //    before selling. Inside the same transaction on purpose: a store must
    //    never exist without its caja, and a listener would admit that window.
    const default_cash_register = await this.ensureDefaultCashRegister(
      {
        store_id: store.id,
        name: input.cash_register_overrides?.name,
        code: input.cash_register_overrides?.code,
      },
      client,
    );

    // 6) Default KDS station, only for stores that cook. Same transaction and
    //    same reason as the caja: `fireOrderItemsInTx` refuses to fire without a
    //    default station, so a restaurant store committed without one could take
    //    orders and never send them to the kitchen.
    //
    //    `store.industries` is read from the PERSISTED row rather than from
    //    `input.store_data.industries`, because the store row applies the
    //    `['retail']` default when the caller passes nothing — reading the input
    //    would miss that and could gate on a value the DB does not hold.
    const default_kds = await this.ensureDefaultKds(
      {
        store_id: store.id,
        industries: store.industries as unknown as string[],
        name: input.kds_overrides?.name,
        code: input.kds_overrides?.code,
      },
      client,
    );

    return {
      store: storeWithDefault,
      default_location,
      address,
      default_cash_register,
      default_kds,
    };
  }
}
