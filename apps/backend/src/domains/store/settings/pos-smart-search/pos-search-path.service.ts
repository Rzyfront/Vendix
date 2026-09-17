import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  POS_SEARCH_CAPABILITY_TTL_MS,
  POS_SEARCH_NORM_FUNCTION,
  POS_SMART_SEARCH_KILL_SWITCH_ENV,
  type PosSearchResolution,
  parseKillSwitch,
  resolveSearchPath,
} from './pos-search-path';

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

/**
 * CP-pos-smart-search · A.0 — Cutover capability + kill-switch (ADR-07).
 *
 * Sin flags por tienda (removidos a pedido del dueño): la resolución es
 * global — kill-switch ⇒ legacy; si no, capability ⇒ trigram, si no ⇒ l2.
 *
 * Proveído por `SettingsModule` y consumido por `ProductsService` + D.1/D.2
 * (gates) vía los módulos que ya lo importan. El kill-switch se lee fresco
 * en cada resolución y no espera ningún TTL.
 */
@Injectable()
export class PosSearchPathService {
  private readonly logger = new Logger(PosSearchPathService.name);
  private capabilityCache: CapabilityCacheEntry | null = null;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly config: ConfigService,
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
   * Cutover por request: kill-switch × capability → path. Global (sin
   * storeId: no hay nada por-tienda que resolver). Never-throw: ambas
   * lecturas lo son; ante cualquier duda ⇒ legacy. Sin warn cuando falta
   * capability: l2 es el default diseñado, no una degradación.
   */
  async resolveSearchPathFor(): Promise<PosSearchResolution> {
    const killSwitch = this.isKillSwitchOn();
    const trigramCapable = killSwitch
      ? false
      : await this.isTrigramCapable();
    return {
      path: resolveSearchPath(killSwitch, { trigramCapable }),
      trigramCapable,
      killSwitch,
    };
  }
}
