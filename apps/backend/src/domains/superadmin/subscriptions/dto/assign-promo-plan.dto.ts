import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * RNC-05 — Body for `POST /superadmin/orgs/:id/assign-promo-plan`.
 *
 * No trial extensions are accepted by this DTO (RNC-05 explicit). Operators
 * grant a promotional plan; the org's stores are switched to active state and
 * the promo flags are persisted.
 */
export class AssignPromoPlanDto {
  /** ID of the promotional plan (`plan_type='promotional', state='active'`). */
  @IsInt()
  @Min(1)
  plan_id!: number;

  /** Optional: target a single store. Omit to broadcast to every eligible store of the org. */
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number;

  /** Operator-provided justification (logged in `subscription_events.payload.reason`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
