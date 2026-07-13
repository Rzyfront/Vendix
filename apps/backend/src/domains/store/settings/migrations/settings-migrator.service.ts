import { Injectable, Logger } from '@nestjs/common';

/**
 * Current schema version for store_settings JSON.
 * Bump when adding a new migration entry to MIGRATIONS.
 */
export const CURRENT_SCHEMA_VERSION = 3;

export interface SettingsMigration {
  from: number;
  to: number;
  apply: (raw: any) => any;
}

/**
 * Versioned migrations for `store_settings.settings` JSON.
 *
 * Each migration is idempotent: it inspects `raw` for legacy shape and
 * normalizes it to the next version. Migrations run lazily on read and
 * can also be applied in batch via the super-admin sync endpoint.
 */
export const MIGRATIONS: SettingsMigration[] = [
  {
    from: 0,
    to: 1,
    apply: (raw: any) => {
      // Move deprecated top-level `accounting_flows` into `module_flows.accounting`.
      if (raw && raw.accounting_flows) {
        raw.module_flows = raw.module_flows ?? {};
        raw.module_flows.accounting = {
          ...(raw.module_flows.accounting ?? {}),
          ...raw.accounting_flows,
        };
        delete raw.accounting_flows;
      }
      // Drop legacy `app` block — branding is the source of truth.
      if (raw && raw.app !== undefined) {
        delete raw.app;
      }
      return raw;
    },
  },
  {
    from: 1,
    to: 2,
    apply: (raw: any) => {
      if (raw?.pos && !raw.pos.schedule_mode) {
        raw.pos.schedule_mode = 'continuous';
      }
      return raw;
    },
  },
  {
    from: 2,
    to: 3,
    apply: (raw: any) => {
      // Backfill the opt-in `promotions` home-section for stores that already
      // configured their ecommerce home sections but predate this section.
      // Idempotent: only sets it when `home_sections` exists and does not
      // already carry `promotions`. Never touches other sections, and never
      // injects an ecommerce/home_sections block into stores that never had
      // one (they inherit the default via the ecommerce settings flow).
      const homeSections = raw?.ecommerce?.home_sections;
      if (
        homeSections &&
        typeof homeSections === 'object' &&
        !Array.isArray(homeSections) &&
        homeSections.promotions === undefined
      ) {
        homeSections.promotions = {
          enabled: false,
          title: 'Promociones activas',
          sort_order: 60,
        };
      }
      return raw;
    },
  },
];

export interface MigrateResult {
  migrated: any;
  changed: boolean;
  fromVersion: number;
  toVersion: number;
}

@Injectable()
export class SettingsMigratorService {
  private readonly logger = new Logger(SettingsMigratorService.name);

  /**
   * Run all applicable migrations against `raw`.
   * Returns the migrated object plus a `changed` flag indicating whether
   * any migration applied (caller can decide to persist).
   */
  migrate(raw: any): MigrateResult {
    const fromVersion = (raw && typeof raw._schema_version === 'number'
      ? raw._schema_version
      : 0) as number;

    let working: any = { ...(raw ?? {}) };
    let current = fromVersion;
    let changed = false;

    for (const m of MIGRATIONS) {
      if (current === m.from) {
        try {
          working = m.apply(working) ?? working;
          current = m.to;
          changed = true;
        } catch (err: any) {
          this.logger.error(
            `Migration v${m.from}->v${m.to} failed: ${err?.message ?? err}`,
          );
          throw err;
        }
      }
    }

    // Always stamp the current version when we actually changed something or
    // when the input was missing a version (so lazy reads converge on a
    // versioned shape without needing a no-op migration).
    if (changed || working._schema_version !== CURRENT_SCHEMA_VERSION) {
      if (working._schema_version !== CURRENT_SCHEMA_VERSION) {
        working._schema_version = CURRENT_SCHEMA_VERSION;
        changed = changed || fromVersion !== CURRENT_SCHEMA_VERSION;
      }
    }

    return {
      migrated: working,
      changed,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
    };
  }
}
