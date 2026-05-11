import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body for `POST /store/accounting/chart-of-accounts/seed-default` and the
 * organization gemelo. Both flags are optional; the default behaviour is
 * idempotent + 409 on existing data.
 */
export class SeedDefaultChartDto {
  /**
   * When true, the seeder skips the pre-existence check and re-upserts every
   * canonical account. Useful to repair drift after manual edits. Without
   * this flag, tenants with any existing chart_of_accounts row receive
   * CHART_ALREADY_SEEDED (409).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
