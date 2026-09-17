import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import {
  POS_SEARCH_CAPABILITY_TTL_MS,
  POS_SEARCH_FLAGS_DEFAULT,
  POS_SEARCH_FLAGS_TTL_MS,
  POS_SEARCH_NORM_FUNCTION,
  POS_SEARCH_TOGGLE_AUDIT_ACTION,
  POS_SMART_SEARCH_KILL_SWITCH_ENV,
  PosSearchFlags,
  PosSearchPath,
  coerceSearchFlags,
  parseKillSwitch,
  resolveSearchPath,
} from './pos-search-flags';

/** Resolución completa flag×capability×kill-switch para un request. */
export interface PosSearchResolution {
  flags: PosSearchFlags;
  trigramCapable: boolean;
  killSwitch: boolean;
  path: PosSearchPath;
}

/** Entrada de audit para toggles: actor, key, old→new, scope, ts (F-071). */
export interface PosSearchToggleAuditInput {
  userId: number;
  storeId: number;
  organizationId?: number;
  before: PosSearchFlags;
  after: PosSearchFlags;
}

interface FlagsCacheEntry {
  flags: PosSearchFlags;
  expiresAt: number;
}

interface CapabilityCacheEntry {
  capable: boolean;
  expiresAt: number;
}

interface TrigramProbeRow {
  ext_count: bigint;
  wrapper_ok: boolean;
  trgm_index_count: bigint;
  invalid_count: bigint;
}

const FLAG_KEYS = ['l1', 'l2', 'trigram'] as const;
type FlagKey = (typeof FLAG_KEYS)[number];

/**
 * CP-pos-smart-search · A.0 — Lector never-throw + cutover + probe (ADR-07).
 *
 * Proveído por `SettingsModule` (mismo módulo que `SettingsService`, así no
 * hay ciclo de dependencias) y consumido desde B.1 por `ProductsService`
 * vía el `SettingsModule` que `ProductsModule` ya importa.
 *
 * Honestidad del rollback (F-051): el caché es en memoria POR INSTANCIA.
 * `invalidateStore` solo limpia la instancia que atendió el PATCH; las demás
 * réplicas convergen en ≤TTL (45s). El kill-switch Tier-0, en cambio, se lee
 * fresco en cada resolución y no espera al TTL.
 */
@Injectable()
export class PosSearchFlagsService {
  private readonly logger = new Logger(PosSearchFlagsService.name);
  private readonly flagsCache = new Map<number, FlagsCacheEntry>();
  private capabilityCache: CapabilityCacheEntry | null = null;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Tier-0: env fresco por llamada, nunca cacheado (F-007). */
  isKillSwitchOn(): boolean {
    try {
      return parseKillSwitch(
        this.config.get<string>(POS_SMART_SEARCH_KILL_SWITCH_ENV),
      );
    } catch {
      // Config caído ⇒ NO forzar legacy global: el kill-switch es opt-in y su
      // ausencia (o su ilegibilidad) significa "sin incidente".
      return false;
    }
  }

  /**
   * Tier-1 never-throw default-off (ERR-19, F-035): cualquier fallo de lectura
   * (DB caída, fila ausente, JSON corrupto) ⇒ flags off + warn log + path
   * legacy, grid intacta, sin cambio visible.
   */
  async resolveSearchFlags(storeId: number): Promise<PosSearchFlags> {
    if (this.isKillSwitchOn()) {
      // Sin caché: al apagar el kill-switch el próximo request ya ve flags.
      return { ...POS_SEARCH_FLAGS_DEFAULT };
    }

    const cached = this.flagsCache.get(storeId);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.flags };
    }

    let flags: PosSearchFlags;
    try {
      const row = await this.prisma.store_settings.findFirst({
        where: { store_id: storeId },
        select: { settings: true },
      });
      const settings =
        typeof row?.settings === 'object' && row.settings !== null
          ? (row.settings as Record<string, unknown>)
          : {};
      flags = coerceSearchFlags(settings['pos_smart_search']);
    } catch (error) {
      // ERR-19: flag-down ⇒ legacy + warn, NUNCA throw dentro del read path.
      this.logger.warn(
        `[PosSearch] flag source down storeId=${storeId} → legacy: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...POS_SEARCH_FLAGS_DEFAULT };
    }

    this.flagsCache.set(storeId, {
      flags: { ...flags },
      expiresAt: Date.now() + POS_SEARCH_FLAGS_TTL_MS,
    });
    return { ...flags };
  }

  /**
   * Capability Fase B cacheada (F-049): pg_trgm ∧ unaccent ∧ wrapper
   * `immutable_unaccent(text)` (C.1) ∧ ≥1 GIN trigram sobre products ∧ cero
   * índices products inválidos (C.2). Never-throw: fallo ⇒ false + warn.
   *
   * No nombra índices: C.2 crea DOS (name, sku) con nombres que A.0 no fija;
   * la probe detecta por opclass (`gin_trgm_ops` en el indexdef) para no
   * acoplarse al nombre que elija C.2.
   */
  async isTrigramCapable(): Promise<boolean> {
    if (
      this.capabilityCache &&
      this.capabilityCache.expiresAt > Date.now()
    ) {
      return this.capabilityCache.capable;
    }

    let capable = false;
    try {
      // `Prisma.raw` (no interpolación `$queryRaw`): interpolar el nombre como
      // parámetro rompería `to_regprocedure('public.$1(text)')`. El valor es
      // una constante interna, no input de usuario — sin riesgo de inyección.
      const normFn = Prisma.raw(`'public.${POS_SEARCH_NORM_FUNCTION}(text)'`);
      // `withoutScope()`: la probe lee catálogos globales (pg_extension,
      // pg_indexes), no filas de tenant — no hay predicado que scopar.
      const rows = await this.prisma
        .withoutScope()
        .$queryRaw<TrigramProbeRow[]>(Prisma.sql`
        SELECT
          (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')) AS ext_count,
          (to_regprocedure(${normFn}) IS NOT NULL) AS wrapper_ok,
          (SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'products'
              AND indexdef ILIKE '%gin_trgm_ops%') AS trgm_index_count,
          (SELECT count(*) FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE t.relname = 'products' AND t.relnamespace = 'public'::regnamespace
              AND NOT i.indisvalid) AS invalid_count
      `);
      const probe = rows[0];
      capable =
        probe !== undefined &&
        Number(probe.ext_count) === 2 &&
        probe.wrapper_ok === true &&
        Number(probe.trgm_index_count) >= 1 &&
        Number(probe.invalid_count) === 0;
    } catch (error) {
      this.logger.warn(
        `[PosSearch] capability probe failed → trigram off: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      capable = false;
    }

    this.capabilityCache = {
      capable,
      expiresAt: Date.now() + POS_SEARCH_CAPABILITY_TTL_MS,
    };
    return capable;
  }

  /**
   * Cutover por request: flags × capability × kill-switch → path.
   * Never-throw (sus dos lecturas lo son). Emite el warn de las filas
   * degradadas 5d–8d (trigram pedido sin capability ⇒ fallback Fase A).
   */
  async resolveSearchPathFor(storeId: number): Promise<PosSearchResolution> {
    const killSwitch = this.isKillSwitchOn();
    const flags = await this.resolveSearchFlags(storeId);
    const trigramCapable = killSwitch
      ? false
      : await this.isTrigramCapable();
    const path: PosSearchPath = killSwitch
      ? 'legacy'
      : resolveSearchPath(flags, { trigramCapable });

    if (!killSwitch && flags.trigram && !trigramCapable) {
      this.logger.warn(
        `[PosSearch] trigram requested without capability storeId=${storeId} ` +
          `→ fallback path=${path}`,
      );
    }
    return { flags, trigramCapable, killSwitch, path };
  }

  /**
   * Invalidación en PATCH (F-051): la llama `SettingsService` cuando el PATCH
   * trae `pos_smart_search` (y en reset/template, que reescriben todo).
   * Solo limpia ESTA instancia; el resto converge en ≤TTL.
   */
  invalidateStore(storeId: number): void {
    this.flagsCache.delete(storeId);
  }

  /**
   * Audit de toggles (F-071): una fila `audit_logs` por flag que cambió, con
   * actor (user_id), key, old→new, scope store y ts (created_at). Precedente:
   * `PRODUCT_ARCHIVE` en `products.service.ts`. `AuditService.log` nunca
   * lanza, así que auditar no rompe el PATCH.
   */
  async auditToggles(input: PosSearchToggleAuditInput): Promise<void> {
    for (const key of FLAG_KEYS) {
      const flagKey: FlagKey = key;
      const oldValue = input.before[flagKey];
      const newValue = input.after[flagKey];
      if (oldValue === newValue) continue;
      await this.audit.log({
        userId: input.userId,
        storeId: input.storeId,
        organizationId: input.organizationId,
        action: POS_SEARCH_TOGGLE_AUDIT_ACTION,
        resource: 'settings',
        oldValues: { key: flagKey, value: oldValue },
        newValues: { key: flagKey, value: newValue },
        metadata: {
          scope: 'store',
          store_id: input.storeId,
          section: 'pos_smart_search',
          key: flagKey,
        },
      });
    }
  }
}
