import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Mirrors promotion_type_enum from Prisma. Each tier expresses its own
 * discount shape (percentage vs fixed_amount) independent of the parent
 * promotion, so a quantity_tiered promotion can mix 10% off on 2 units
 * with $5 off on 5 units.
 */
export type QuantityTierType = 'percentage' | 'fixed_amount';

export class QuantityTierDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  min_quantity: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  max_quantity?: number;

  @IsEnum(['percentage', 'fixed_amount'])
  type: QuantityTierType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sort_order?: number;
}

/**
 * Result of validating a list of QuantityTierDto. Kept as a single struct so
 * the class-level decorator can return a precise defaultMessage without
 * having to re-walk the array.
 */
type FailureReason =
  | 'not_an_array'
  | 'empty'
  | 'min_quantity_non_positive'
  | 'max_below_min'
  | 'open_ended_not_last'
  | 'gap_or_overlap'
  | 'percentage_above_100'
  | 'value_non_positive';

interface ResolveResult {
  ok: boolean;
  reason?: FailureReason;
  index?: number;
  nextIndex?: number;
}

function resolve(value: unknown): ResolveResult {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'not_an_array' };
  }
  if (value.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const sorted = value as QuantityTierDto[];

  // Per-tier shape checks.
  for (const tier of sorted) {
    if (!Number.isInteger(tier.min_quantity) || tier.min_quantity < 1) {
      return { ok: false, reason: 'min_quantity_non_positive' };
    }
    if (
      tier.max_quantity !== undefined &&
      tier.max_quantity !== null &&
      tier.max_quantity < tier.min_quantity
    ) {
      return { ok: false, reason: 'max_below_min' };
    }
    if (!(tier.value > 0)) {
      return { ok: false, reason: 'value_non_positive' };
    }
    if (tier.type === 'percentage' && tier.value > 100) {
      return { ok: false, reason: 'percentage_above_100' };
    }
  }

  // Sort tiers by min_quantity (then by sort_order to break ties) to apply
  // adjacency/gap rules. We mutate a copy — the input array is preserved.
  const indexed = sorted.map((tier, index) => ({ tier, index }));
  indexed.sort((a, b) => {
    if (a.tier.min_quantity !== b.tier.min_quantity) {
      return a.tier.min_quantity - b.tier.min_quantity;
    }
    return (a.tier.sort_order ?? 0) - (b.tier.sort_order ?? 0);
  });

  // Only the LAST tier (by sort order) may have max_quantity omitted.
  for (let i = 0; i < indexed.length - 1; i += 1) {
    const tier = indexed[i].tier;
    if (tier.max_quantity === undefined || tier.max_quantity === null) {
      return {
        ok: false,
        reason: 'open_ended_not_last',
        index: indexed[i].index,
      };
    }
  }

  // Adjacency rule: tier[i].max_quantity must equal tier[i+1].min_quantity - 1.
  // Any gap or overlap fails the rule.
  for (let i = 0; i < indexed.length - 1; i += 1) {
    const cur = indexed[i].tier;
    const nxt = indexed[i + 1].tier;
    const curMax = cur.max_quantity as number;
    const expectedNext = curMax + 1;
    if (nxt.min_quantity !== expectedNext) {
      return {
        ok: false,
        reason: 'gap_or_overlap',
        index: indexed[i].index,
        nextIndex: indexed[i + 1].index,
      };
    }
  }

  return { ok: true };
}

/**
 * Cross-field validator for `quantity_tiers` arrays. Enforces:
 *   - non-empty (>= 1 item)
 *   - strictly ascending `min_quantity` with no gaps
 *     (adjacency: max === next.min - 1)
 *   - only the last tier may omit `max_quantity`
 *   - `max_quantity >= min_quantity` when present
 *   - `value > 0` and `value <= 100` when type === 'percentage'
 *
 * Use via `@IsValidQuantityTiers()` on the `quantity_tiers` field.
 */
@ValidatorConstraint({ name: 'IsValidQuantityTiers', async: false })
export class IsValidQuantityTiersConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, _args: ValidationArguments): boolean {
    return resolve(value).ok;
  }

  defaultMessage(_args: ValidationArguments): string {
    const result = resolve(_args.value);

    if (result.ok) return 'quantity_tiers es valido';

    switch (result.reason) {
      case 'not_an_array':
        return 'quantity_tiers debe ser un arreglo';
      case 'empty':
        return 'quantity_tiers debe contener al menos un tramo';
      case 'min_quantity_non_positive':
        return 'min_quantity debe ser un entero mayor o igual a 1';
      case 'max_below_min':
        return 'max_quantity debe ser mayor o igual a min_quantity';
      case 'open_ended_not_last':
        return 'Solo el ultimo tramo puede omitir max_quantity';
      case 'gap_or_overlap':
        return 'Los tramos deben ser contiguos: max_quantity de un tramo debe ser igual a min_quantity del siguiente menos 1';
      case 'percentage_above_100':
        return 'value en porcentaje debe ser menor o igual a 100';
      case 'value_non_positive':
        return 'value debe ser mayor a 0';
      default:
        return 'quantity_tiers invalido';
    }
  }
}

export function IsValidQuantityTiers(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsValidQuantityTiers',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsValidQuantityTiersConstraint,
    });
  };
}