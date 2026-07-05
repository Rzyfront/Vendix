import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { MembershipAccessService } from '../domains/store/membership-access/membership-access.service';
import { ScheduleValidationService } from '../domains/store/settings/schedule-validation.service';
import { mergeStoreSettingsWithDefaults } from '../domains/store/settings/defaults/default-store-settings';
import { StoreIndustry } from '../domains/store/stores/dto';
import { MembershipSettings } from '../domains/store/settings/interfaces/store-settings.interface';

/**
 * MembershipAforoJob
 *
 * Hourly maintenance of the membership capacity (aforo) occupancy counter for
 * gym stores that have `membership.capacity_control_enabled`. Two concerns per
 * store, run inside the store's tenant context:
 *
 *   (a) RESET — return the counter to 0 for a new business day. Triggered when
 *       the local calendar day rolled over (stored `business_date` is a PREVIOUS
 *       local day) OR the local clock passed the store's close hour
 *       (`pos.business_hours` via `ScheduleValidationService`, only when the
 *       store has schedule validation enabled). A never-reset row with a live
 *       count adopts today's date as a baseline WITHOUT wiping it.
 *
 *   (b) LEVELING — for stores WITHOUT a turnstile that opted into auto-leveling,
 *       slowly self-correct upward drift: decrement by 1 once every
 *       `auto_leveling_interval_hours` (1 or 2) while the count is > 0.
 *
 * WHY hourly (not @midnight): NestJS `EVERY_DAY_AT_MIDNIGHT` fires at UTC
 * midnight, which is NOT local midnight for the store timezone. Running hourly
 * and comparing the store-local calendar day makes the daily reset land on the
 * store's real midnight regardless of timezone. Mirrors `OrderAutoFinishJob`:
 * a cross-store discovery query, then per-store work inside
 * `StoreContextRunner.runInStoreContext`.
 */
@Injectable()
export class MembershipAforoJob {
  private readonly logger = new Logger(MembershipAforoJob.name);

  constructor(
    private readonly membershipAccessService: MembershipAccessService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly scheduleValidation: ScheduleValidationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAforoMaintenance() {
    this.logger.debug('Starting membership aforo maintenance job...');

    let processed = 0;
    try {
      // Discover candidate stores: gym + capacity control enabled. The flag
      // lives in the store_settings JSON, so filter in JS after merging with
      // defaults (store count is bounded — same approach as other settings-
      // driven jobs).
      const settingsRows = await this.globalPrisma.store_settings.findMany({
        select: { store_id: true, settings: true },
      });

      for (const rowSettings of settingsRows) {
        const settings = mergeStoreSettingsWithDefaults(rowSettings.settings);
        const membership = settings.membership;
        if (!membership?.capacity_control_enabled) continue;
        const industries = settings.general?.industries ?? [];
        if (!industries.includes(StoreIndustry.GYM)) continue;

        const timezone = settings.general?.timezone || 'America/Bogota';
        const storeId = rowSettings.store_id;
        try {
          await this.storeContextRunner.runInStoreContext(storeId, () =>
            this.processStore(storeId, membership, timezone),
          );
          processed += 1;
        } catch (error) {
          this.logger.error(
            `Aforo maintenance failed for store #${storeId}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      this.logger.debug(
        `Membership aforo maintenance completed: ${processed} store(s) processed`,
      );
    } catch (error) {
      this.logger.error(
        `Membership aforo maintenance job failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /** Per-store maintenance. Runs inside the store's tenant context. */
  private async processStore(
    storeId: number,
    membership: MembershipSettings,
    timezone: string,
  ): Promise<void> {
    const row = await this.membershipAccessService.peekOccupancy(storeId);
    // No one counted yet → nothing to reset or level; avoid creating empty rows.
    if (!row) return;

    const localDay = this.localDay(timezone);
    const storedDay = row.business_date
      ? row.business_date.toISOString().slice(0, 10)
      : null;

    // (a) RESET ----------------------------------------------------------------
    if (storedDay === null) {
      // Never reset before → adopt today as the baseline WITHOUT wiping a live
      // count. Tomorrow this day will read as "previous" and trigger a reset.
      await this.membershipAccessService.updateOccupancyMeta(storeId, {
        business_date: this.dateOnlyUtc(localDay),
      });
      return;
    }
    if (storedDay < localDay) {
      // The counter belongs to a previous local day → new day: reset to 0.
      await this.membershipAccessService.resetOccupancy(storeId);
      return;
    }
    // Same local day: optional end-of-day cleanup once the store has closed.
    if (row.current_count > 0 && (await this.storeIsClosed(storeId))) {
      await this.membershipAccessService.resetOccupancy(storeId);
      return;
    }

    // (b) LEVELING -------------------------------------------------------------
    if (
      !membership.turnstile_mode &&
      membership.auto_leveling_enabled &&
      row.current_count > 0
    ) {
      const intervalHours =
        Number(membership.auto_leveling_interval_hours) === 1 ? 1 : 2;
      if (!row.last_leveled_at) {
        // Start the leveling clock without decrementing (avoid punishing a
        // member who just walked in).
        await this.membershipAccessService.updateOccupancyMeta(storeId, {
          last_leveled_at: new Date(),
        });
        return;
      }
      const elapsedMs = Date.now() - row.last_leveled_at.getTime();
      if (elapsedMs >= intervalHours * 3_600_000) {
        await this.membershipAccessService.adjustOccupancy(storeId, -1);
        await this.membershipAccessService.updateOccupancyMeta(storeId, {
          last_leveled_at: new Date(),
        });
      }
    }
  }

  /**
   * True when the store is currently outside its business hours. Only meaningful
   * when the store enabled schedule validation; otherwise this returns false and
   * the daily reset relies purely on the local-day rollover. Never throws.
   */
  private async storeIsClosed(storeId: number): Promise<boolean> {
    try {
      const schedule =
        await this.scheduleValidation.validateBusinessHours(storeId);
      return !schedule.isWithinBusinessHours;
    } catch {
      return false;
    }
  }

  /** Local calendar day 'YYYY-MM-DD' in the store timezone. */
  private localDay(timezone: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    }
  }

  /** A 'YYYY-MM-DD' day as a UTC-midnight Date (round-trips for `@db.Date`). */
  private dateOnlyUtc(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
  }
}
