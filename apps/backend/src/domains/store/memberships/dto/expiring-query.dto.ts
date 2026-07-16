import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query DTO for the expiring-memberships endpoint.
 *
 * Combines "vencidas" (already past `period_end`) with "por vencer" (within
 * the next `days` days). The frontend uses this single endpoint to power the
 * dashboard widget that prompts renewals / re-engagement.
 *
 * Defaults:
 *  - `days = 7`  → look 7 days ahead (already-expired rows are always included
 *                  because `period_end <= now + days`).
 *  - `limit = 15` → bounded list (no pagination on purpose: this is a widget,
 *                   not a full report).
 */
export class ExpiringQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number = 7;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 15;
}