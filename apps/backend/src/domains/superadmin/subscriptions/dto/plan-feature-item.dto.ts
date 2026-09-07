import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * One "what the plan includes" item, as edited by the super-admin and rendered
 * on the public landing / pricing surfaces.
 *
 * This is the canonical shape of `subscription_plans.feature_matrix`: an ARRAY
 * of these items. The legacy object shape (`{ pos: true, users: { max: 3 } }`)
 * is still parsed on read (see PublicPlansService.parseFeatureMatrix) but is
 * never written any more.
 *
 * Purely presentational: no guard, quota or panel_ui rule reads it. Feature
 * gating lives in `ai_feature_flags`.
 */
export class PlanFeatureItemDto {
  /** Stable slug derived from the label by the client (kebab-case, no accents). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key: string;

  /** Human text shown to the customer. Must be identical across plans so the
   *  public comparison table can align rows. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  /** false renders the item struck through / as "not included". */
  @IsBoolean()
  enabled: boolean;

  /** true renders the item as partially included ("limitado"). */
  @IsOptional()
  @IsBoolean()
  is_limited?: boolean;

  /** Short qualifier shown next to the label ("Ilimitados", "1 usuario"). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  value?: string;

  /** Legacy numeric cap kept for backwards compatibility; not edited in the UI. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  limit?: number | null;

  /** Legacy unit for `limit`; not edited in the UI. */
  @IsOptional()
  @IsString()
  @MaxLength(24)
  unit?: string | null;
}
